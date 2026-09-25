import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { analyse } from "../src/analytics";
import { seed } from "../src/db";

const TMP = "/tmp/boujee-test.db";
const db: Database = seed(TMP);

afterAll(() => {
  db.close();
  for (const s of ["", "-wal", "-shm"]) { try { unlinkSync(TMP + s); } catch {} }
});

const get = (a: ReturnType<typeof analyse>, id: string) => a.assets.find((x) => x.id === id)!;

describe("windowing", () => {
  test("base year carries no return, so an N-year window has N-1 compounding steps", () => {
    const a = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    expect(a.years.length).toBe(20);
    expect(get(a, "sp500").returns.length).toBe(19);
    expect(get(a, "sp500").values.length).toBe(20);
  });

  test("the investment starts at exactly the amount put in", () => {
    for (const amt of [1, 10000, 250000]) {
      const a = analyse(db, { from: 2010, to: 2020, real: false, amount: amt });
      for (const m of a.assets) expect(m.values[0]).toBeCloseTo(amt, 6);
    }
  });

  test("a window narrower than the data is honoured on both ends", () => {
    const a = analyse(db, { from: 2015, to: 2019, real: false, amount: 10000 });
    expect(a.from).toBe(2015);
    expect(a.to).toBe(2019);
    expect(get(a, "gold").returns.length).toBe(4);
  });
});

describe("return maths", () => {
  test("CAGR compounds back to the ending multiple", () => {
    const a = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    for (const m of a.assets) {
      const rebuilt = Math.pow(1 + m.cagrPct / 100, m.returns.length);
      expect(rebuilt).toBeCloseTo(m.multiple, 6);
    }
  });

  test("ending value equals amount times multiple", () => {
    const a = analyse(db, { from: 2008, to: 2022, real: false, amount: 7500 });
    for (const m of a.assets) expect(m.values.at(-1)!).toBeCloseTo(7500 * m.multiple, 6);
  });

  test("cash measured against cash is a wash", () => {
    const a = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    expect(get(a, "cash").vsCash).toBeCloseTo(0, 6);
  });

  test("S&P 500 nominal CAGR over 2005-2024 lands near the real-world ~10.5%", () => {
    const m = get(analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 }), "sp500");
    expect(m.cagrPct).toBeGreaterThan(10);
    expect(m.cagrPct).toBeLessThan(11.5);
  });
});

describe("inflation adjustment", () => {
  test("real returns are strictly below nominal whenever inflation is positive", () => {
    const nom = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    const real = analyse(db, { from: 2005, to: 2024, real: true, amount: 10000 });
    expect(nom.cpi.cumulativePct).toBeGreaterThan(0);
    for (const m of nom.assets) expect(get(real, m.id).cagrPct).toBeLessThan(m.cagrPct);
  });

  test("deflating cash by CPI reproduces the known loss of purchasing power", () => {
    const real = analyse(db, { from: 2005, to: 2024, real: true, amount: 10000 });
    // T-bills returned ~33% while CPI ran ~60%: cash must end below what went in.
    expect(get(real, "cash").values.at(-1)!).toBeLessThan(10000);
  });

  test("real multiple equals nominal multiple divided by cumulative inflation", () => {
    const nom = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    const real = analyse(db, { from: 2005, to: 2024, real: true, amount: 10000 });
    const infl = 1 + nom.cpi.cumulativePct / 100;
    for (const m of nom.assets) expect(get(real, m.id).multiple).toBeCloseTo(m.multiple / infl, 8);
  });
});

describe("risk measures", () => {
  test("max drawdown is never positive and never below -100%", () => {
    const a = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    for (const m of a.assets) {
      expect(m.maxDrawdownPct).toBeLessThanOrEqual(0);
      expect(m.maxDrawdownPct).toBeGreaterThan(-100);
    }
  });

  test("an asset that never fell has no drawdown", () => {
    const m = get(analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 }), "cash");
    expect(m.maxDrawdownPct).toBe(0);
  });

  test("the S&P records 2008 as its worst year at roughly -37%", () => {
    const m = get(analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 }), "sp500");
    expect(m.worstYear.year).toBe(2008);
    expect(m.worstYear.pct).toBeCloseTo(-37, 1);
    expect(m.bestYear.year).toBe(2013);
  });

  test("volatility is zero-ish for the flattest series and large for equities", () => {
    const a = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    expect(get(a, "sp500").volatilityPct).toBeGreaterThan(get(a, "cash").volatilityPct);
  });
});

describe("data integrity", () => {
  test("every asset covers the full year range with no gaps", () => {
    const rows = db.query<{ id: string; n: number }, []>(
      "SELECT asset_id id, COUNT(*) n FROM returns GROUP BY asset_id",
    ).all();
    // Derived, not hardcoded: adding a category should not break this test.
    const assetCount = db.query<{ n: number }, []>("SELECT COUNT(*) n FROM assets").get()!.n;
    expect(rows.length).toBe(assetCount);
    expect(assetCount).toBeGreaterThan(12);
    for (const r of rows) expect(r.n).toBe(20);
  });

  test("CPI is excluded from the asset list but drives the real adjustment", () => {
    const a = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    expect(a.assets.some((x) => x.id === "cpi")).toBe(false);
    const nonBenchmark = db.query<{ n: number }, []>(
      "SELECT COUNT(*) n FROM assets WHERE class <> 'benchmark'",
    ).get()!.n;
    expect(a.assets.length).toBe(nonBenchmark);
    expect(a.cpi.cagrPct).toBeGreaterThan(1);
  });

  test("every luxury series is flagged estimated and every traditional one sourced", () => {
    const a = analyse(db, { from: 2005, to: 2024, real: false, amount: 10000 });
    for (const m of a.assets) {
      expect(m.confidence).toBe(m.class === "luxury" ? "estimated" : "high");
    }
  });
});
