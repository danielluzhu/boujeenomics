import { afterAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { analyseItems, brands, facets, interpolateAnnual, summarise } from "../src/analytics";

/** The catalogue is large, so tests ask for what they need rather than everything. */
const items = (q: any = {}) => analyseItems(db, { limit: 5000, withSeries: true, ...q }).items;
import { seed } from "../src/db";
import { ValidationError, deleteItem, insertItem, validate } from "../src/items-write";

const TMP = "/tmp/boujee-items-test.db";
const db: Database = seed(TMP);

afterAll(() => {
  db.close();
  for (const s of ["", "-wal", "-shm"]) { try { unlinkSync(TMP + s); } catch {} }
});

const ok = {
  name: "Rolex GMT-Master II", brand: "Rolex", ref: "126710BLRO",
  category: "watches", kind: "resale" as const,
  points: { "2018": 12000, "2021": 22000, "2024": 17000 },
};
const reject = (body: unknown, re: RegExp) => {
  expect(() => validate(db, body)).toThrow(ValidationError);
  try { validate(db, body); } catch (e) { expect((e as Error).message).toMatch(re); }
};

describe("validation", () => {
  test("accepts a well-formed model and sorts its points by year", () => {
    const v = validate(db, { ...ok, points: { "2024": 17000, "2018": 12000, "2021": 22000 } });
    expect(v.points.map((p) => p.year)).toEqual([2018, 2021, 2024]);
  });

  test("requires a name and a brand", () => {
    reject({ ...ok, name: "  " }, /name is required/i);
    reject({ ...ok, brand: "" }, /brand is required/i);
  });

  test("rejects a category that is not a luxury category", () => {
    reject({ ...ok, category: "sp500" }, /luxury categories/);   // real asset, wrong class
    reject({ ...ok, category: "nonsense" }, /luxury categories/);
  });

  test("rejects an unknown kind or confidence", () => {
    reject({ ...ok, kind: "bogus" }, /retail.*resale/);
    reject({ ...ok, confidence: "high" }, /confidence/);         // users cannot self-certify as sourced
  });

  test("rejects years outside the dataset's range and non-integers", () => {
    reject({ ...ok, points: { "1999": 1, "2011": 2 } }, /between 2005 and 2025/);
    reject({ ...ok, points: { "2030": 1, "2011": 2 } }, /between 2005 and 2025/);
    reject({ ...ok, points: { "2011.5": 1, "2012": 2 } }, /between 2005 and 2025/);
  });

  test("rejects prices that are not positive finite numbers", () => {
    for (const bad of [-5, 0, "abc", null, Infinity, 1e13]) {
      reject({ ...ok, points: { "2010": bad, "2011": 2 } }, /positive number|between/);
    }
  });

  test("needs at least two priced years", () => {
    reject({ ...ok, points: { "2010": 100 } }, /at least two/);
    reject({ ...ok, points: {} }, /at least two/);
  });

  test("rejects an over-long field", () => {
    reject({ ...ok, name: "x".repeat(81) }, /80 characters/);
  });

  test("accepts the array form of points as well as the object form", () => {
    const v = validate(db, { ...ok, points: [{ year: 2010, price: 1 }, { year: 2012, price: 2 }] });
    expect(v.points.length).toBe(2);
  });
});

describe("insert and delete", () => {
  test("insert makes the model visible to the read path with metrics computed", () => {
    const { id } = insertItem(db, ok);
    const found = items().find((i) => i.id === id)!;
    expect(found).toBeDefined();
    expect(found.origin).toBe("user");
    expect(found.firstYear).toBe(2018);
    expect(found.lastYear).toBe(2024);
    expect(found.benchmarkId).toBe("sp500");
    expect(found.cagrPct).toBeCloseTo((Math.pow(17000 / 12000, 1 / 6) - 1) * 100, 6);
  });

  test("a second model of the same name gets its own id rather than overwriting", () => {
    const a = insertItem(db, { ...ok, name: "Duplicate Name" });
    const b = insertItem(db, { ...ok, name: "Duplicate Name" });
    expect(a.id).not.toBe(b.id);
    expect(items().filter((i) => i.name === "Duplicate Name").length).toBe(2);
  });

  test("retail submissions are benchmarked against inflation, not the index", () => {
    const { id } = insertItem(db, { ...ok, name: "Retail Thing", kind: "retail" });
    expect(items().find((i) => i.id === id)!.benchmarkId).toBe("cpi");
  });

  test("delete removes a user model and its prices", () => {
    const { id } = insertItem(db, { ...ok, name: "Temporary" });
    expect(deleteItem(db, id)).toBe(true);
    expect(items().some((i) => i.id === id)).toBe(false);
    expect(db.query("SELECT COUNT(*) n FROM item_prices WHERE item_id = ?").get(id).n).toBe(0);
  });

  test("the shipped catalogue cannot be deleted", () => {
    expect(deleteItem(db, "daytona-116500ln")).toBe(false);
    expect(items().some((i) => i.id === "daytona-116500ln")).toBe(true);
  });

  test("deleting something that does not exist is a no-op, not a crash", () => {
    expect(deleteItem(db, "no-such-id")).toBe(false);
  });
});

describe("seed items", () => {
  test("every shipped item has at least two anchors and lands inside the year range", () => {
    for (const i of items({ tracked: true }).filter((x) => x.origin === "seed")) {
      expect(i.points.length).toBeGreaterThanOrEqual(2);
      expect(i.firstYear).toBeGreaterThanOrEqual(2005);
      expect(i.lastYear).toBeLessThanOrEqual(2025);
      expect(i.lastYear).toBeGreaterThan(i.firstYear);
    }
  });

  test("retail items benchmark to CPI and resale items to the S&P", () => {
    for (const i of items()) {
      expect(i.benchmarkId).toBe(i.kind === "retail" ? "cpi" : "sp500");
    }
  });

  test("a window that excludes an item's anchors drops it rather than reporting nonsense", () => {
    const narrow = items({ from: 2005, to: 2006 });
    expect(narrow.every((i) => i.points.length >= 2)).toBe(true);
    expect(narrow.length).toBeLessThan(items().length);
  });
});

describe("annual interpolation", () => {
  test("keeps every anchor exactly and fills only the gaps", () => {
    const out = interpolateAnnual([{ year: 2010, price: 100 }, { year: 2014, price: 200 }]);
    expect(out.map((p) => p.year)).toEqual([2010, 2011, 2012, 2013, 2014]);
    expect(out[0].price).toBe(100);
    expect(out.at(-1)!.price).toBe(200);
  });

  test("interpolates geometrically, so each filled year compounds at one constant rate", () => {
    const out = interpolateAnnual([{ year: 2010, price: 100 }, { year: 2014, price: 1600 }]);
    // 100 -> 1600 over four years is exactly x2 a year.
    expect(out.map((p) => Math.round(p.price))).toEqual([100, 200, 400, 800, 1600]);
  });

  test("a straight line in price terms would be wrong, and is not what this produces", () => {
    const out = interpolateAnnual([{ year: 2010, price: 100 }, { year: 2012, price: 400 }]);
    expect(out[1].price).toBeCloseTo(200, 6);  // geometric midpoint
    expect(out[1].price).not.toBeCloseTo(250, 1); // arithmetic midpoint
  });

  test("handles consecutive anchors with no gap to fill", () => {
    const out = interpolateAnnual([{ year: 2010, price: 5 }, { year: 2011, price: 6 }, { year: 2012, price: 7 }]);
    expect(out.map((p) => p.price)).toEqual([5, 6, 7]);
  });

  test("a falling stretch interpolates downward without overshooting", () => {
    const out = interpolateAnnual([{ year: 2020, price: 400 }, { year: 2022, price: 100 }]);
    expect(out[1].price).toBeCloseTo(200, 6);
    expect(Math.min(...out.map((p) => p.price))).toBe(100);
  });

  test("every shipped item yields one price for every year it covers", () => {
    for (const i of items()) {
      expect(i.annual.length).toBe(i.lastYear - i.firstYear + 1);
      expect(i.annual[0].price).toBe(i.firstPrice);
      expect(i.annual.at(-1)!.price).toBeCloseTo(i.lastPrice, 6);
      expect(i.annual.every((p) => p.price > 0)).toBe(true);
    }
  });
});

describe("catalogue at scale", () => {
  test("the generated catalogue is present and labelled modelled, never sourced", () => {
    const all = items();
    const modelled = all.filter((i) => i.confidence === "modelled");
    expect(modelled.length).toBeGreaterThan(900);
    // A generated entry must never claim to be tracked.
    for (const i of modelled.slice(0, 50)) {
      expect(i.source).toMatch(/^Modelled:/);
      expect(i.caveat).toMatch(/Not a tracked price/);
    }
  });

  test("headline counts exclude the generated catalogue", () => {
    const s = summarise(db, { from: 2005, to: 2024, real: false });
    const tracked = items({ tracked: true });
    expect(s.objects.of).toBe(tracked.filter((i) => i.kind === "resale").length);
    expect(s.objects.of).toBeLessThan(40);          // tracked items only, not 1000+
    expect(s.catalogueCount).toBeGreaterThan(900);
  });

  test("tracked filter returns only hand-sourced entries", () => {
    for (const i of items({ tracked: true })) expect(i.confidence).not.toBe("modelled");
  });

  test("search matches on name, brand and reference, and requires every term", () => {
    expect(items({ q: "submariner" }).length).toBeGreaterThan(0);
    expect(items({ q: "rolex submariner" }).every((i) => /rolex/i.test(i.brand + i.name))).toBe(true);
    expect(items({ q: "birkin togo" }).every((i) => /togo/i.test(i.ref))).toBe(true);
    expect(items({ q: "zzzz nothing" }).length).toBe(0);
  });

  test("paging is stable and covers the set exactly once", () => {
    const total = analyseItems(db, { kind: "resale" }).total;
    const seen = new Set<string>();
    for (let off = 0; off < Math.min(total, 200); off += 25) {
      for (const i of analyseItems(db, { kind: "resale", limit: 25, offset: off }).items) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
      }
    }
    expect(seen.size).toBe(Math.min(total, 200));
  });

  test("the list omits series and the detail lookup includes them", () => {
    const lite = analyseItems(db, { limit: 1 }).items[0];
    expect(lite.annual.length).toBe(0);
    const full = analyseItems(db, { ids: [lite.id], withSeries: true }).items[0];
    expect(full.annual.length).toBeGreaterThan(1);
  });

  test("every generated entry derives a positive, finite price for each of its years", () => {
    for (const i of items({ limit: 5000 })) {
      expect(Number.isFinite(i.firstPrice)).toBe(true);
      expect(i.firstPrice).toBeGreaterThan(0);
      expect(i.lastPrice).toBeGreaterThan(0);
      expect(Number.isFinite(i.cagrPct)).toBe(true);
    }
  });

  test("a retail entry tracks inflation and a resale entry tracks its category", () => {
    const retail = items({ kind: "retail" })[0];
    const resale = items({ kind: "resale" })[0];
    expect(retail.benchmarkId).toBe("cpi");
    expect(resale.benchmarkId).toBe("sp500");
  });

  test("no entry starts before the dataset or after it ends", () => {
    for (const i of items({ limit: 5000 })) {
      expect(i.firstYear).toBeGreaterThanOrEqual(2005);
      expect(i.lastYear).toBeLessThanOrEqual(2025);
      expect(i.lastYear).toBeGreaterThan(i.firstYear);
    }
  });
});

describe("browsing the whole catalogue", () => {
  test("omitting kind returns every item, not one side of it", () => {
    const all = analyseItems(db, { limit: 1 }).total;
    const resale = analyseItems(db, { kind: "resale", limit: 1 }).total;
    const retail = analyseItems(db, { kind: "retail", limit: 1 }).total;
    expect(resale).toBeGreaterThan(0);
    expect(retail).toBeGreaterThan(0);
    expect(all).toBe(resale + retail);
  });

  test("facets count the same population the list does", () => {
    const f = facets(db);
    expect(f.total).toBe(analyseItems(db, { limit: 1 }).total);
    expect(f.byCategory.reduce((a, c) => a + c.n, 0)).toBe(f.total);
    expect(f.byConfidence.reduce((a, c) => a + c.n, 0)).toBe(f.total);
    expect(f.byKind.reduce((a, c) => a + c.n, 0)).toBe(f.total);
  });

  test("brand facet counts match filtering by that brand", () => {
    const list = brands(db);
    expect(list.length).toBeGreaterThan(50);
    for (const b of list.slice(0, 12)) {
      expect(analyseItems(db, { brand: b.brand, limit: 1 }).total).toBe(b.n);
    }
  });

  test("brands are returned in case-insensitive alphabetical order", () => {
    const names = brands(db).map((b) => b.brand);
    const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    expect(names).toEqual(sorted);
  });

  test("filtering by confidence isolates one tier", () => {
    for (const tier of ["modelled", "medium"]) {
      const got = analyseItems(db, { confidence: tier, limit: 500 }).items;
      expect(got.length).toBeGreaterThan(0);
      for (const i of got) expect(i.confidence).toBe(tier);
    }
  });

  test("filters compose, and narrowing never widens the result", () => {
    const wide = analyseItems(db, { category: "watches", limit: 1 }).total;
    const narrow = analyseItems(db, { category: "watches", brand: "Rolex", limit: 1 }).total;
    const narrower = analyseItems(db, { category: "watches", brand: "Rolex", kind: "resale", limit: 1 }).total;
    expect(narrow).toBeLessThanOrEqual(wide);
    expect(narrower).toBeLessThanOrEqual(narrow);
    expect(narrower).toBeGreaterThan(0);
  });

  test("an unknown brand or category yields nothing rather than everything", () => {
    expect(analyseItems(db, { brand: "NotARealBrand", limit: 1 }).total).toBe(0);
    expect(analyseItems(db, { category: "nope", limit: 1 }).total).toBe(0);
  });

  test("name sort is alphabetical across the full catalogue", () => {
    const page = analyseItems(db, { sort: "name", limit: 60 }).items.map((i) => i.name);
    const sorted = [...page].sort((a, b) => a.localeCompare(b));
    expect(page).toEqual(sorted);
  });

  test("walking every page reaches every item exactly once", () => {
    const total = analyseItems(db, { category: "jewellery", limit: 1 }).total;
    const seen = new Set<string>();
    for (let off = 0; off < total; off += 50) {
      for (const i of analyseItems(db, { category: "jewellery", limit: 50, offset: off, sort: "name" }).items) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
      }
    }
    expect(seen.size).toBe(total);
  });
});

describe("filtering by outcome", () => {
  test("beat and lost partition the set exactly", () => {
    const base = { kind: "resale" as const, limit: 1 };
    const all = analyseItems(db, base).total;
    const beat = analyseItems(db, { ...base, outcome: "beat" }).total;
    const lost = analyseItems(db, { ...base, outcome: "lost" }).total;
    expect(beat + lost).toBe(all);
    expect(beat).toBeGreaterThan(0);
  });

  test("every item in the beat set actually beat its benchmark", () => {
    for (const i of analyseItems(db, { outcome: "beat", limit: 500 }).items) {
      expect(i.edgePct).toBeGreaterThan(0);
      expect(i.cagrPct).toBeGreaterThan(i.benchmarkCagrPct);
    }
  });

  test("every item in the lost set did not", () => {
    for (const i of analyseItems(db, { outcome: "lost", limit: 500 }).items) {
      expect(i.edgePct).toBeLessThanOrEqual(0);
    }
  });

  test("outcome composes with the other filters", () => {
    const winners = analyseItems(db, { outcome: "beat", tracked: true, kind: "resale", limit: 100 });
    expect(winners.total).toBeGreaterThan(0);
    for (const i of winners.items) {
      expect(i.confidence).not.toBe("modelled");
      expect(i.kind).toBe("resale");
      expect(i.edgePct).toBeGreaterThan(0);
    }
  });

  test("the outlier set really does beat the index, and the controls really do not", () => {
    const by = (id: string) => analyseItems(db, { ids: [id], from: 2005, to: 2025, limit: 1 }).items[0];
    for (const id of ["karuizawa-cask", "macallan-1926", "mclaren-f1-tracked", "daytona-6239-paul-newman"]) {
      expect(by(id).edgePct).toBeGreaterThan(0);
    }
    // Deliberately included controls: famous multi-baggers that still trail the index.
    for (const id of ["lespaul-59-tracked", "journe-bleu-tracked", "carrera-rs-27"]) {
      expect(by(id).edgePct).toBeLessThan(0);
    }
  });

  test("paging the winners never repeats or drops one", () => {
    const total = analyseItems(db, { outcome: "beat", limit: 1 }).total;
    const seen = new Set<string>();
    for (let off = 0; off < total; off += 25) {
      for (const i of analyseItems(db, { outcome: "beat", limit: 25, offset: off, sort: "name" }).items) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
      }
    }
    expect(seen.size).toBe(total);
  });
});
