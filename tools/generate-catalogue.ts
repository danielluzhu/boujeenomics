/**
 * Expands tools/families.ts into data/catalogue.json.
 *
 * What is real here: the brands, the model families, the variant axes (materials, sizes,
 * dial colours, canvases, leathers, condition grades, vintages) and the first year each
 * model existed. What is NOT real is a tracked price history for any individual entry.
 *
 * Each entry stores a *specification*, not a price series. src/catalogue.ts derives the
 * series at seed time:
 *
 *   resale:  price(y) = base × variant × ( categoryIndex(y) / categoryIndex(y0) ) ^ beta
 *   retail:  price(y) = base × variant × ( cpi(y) / cpi(y0) ) × (1 + drift) ^ (y − y0)
 *
 * so the path is the category's own published-ish trajectory applied to this variant's
 * price level. Every entry is labelled `modelled` and is excluded from the site's headline
 * claims, which only count items with a real tracked series.
 *
 * Run: bun tools/generate-catalogue.ts
 */
import { BAGS, BOTTLES, CARS, INSTRUMENTS, JEWELLERY, WATCHES, type Family, type Variant } from "./families";

const INSTRUMENT_CONDITION: Variant[] = [
  { label: "all original", mult: 1, bm: 1.06 },
  { label: "refinished or altered", mult: 0.44, bm: 0.84 },
  { label: "player grade", mult: 0.66, bm: 0.92 },
];
const SYNTH_CONDITION: Variant[] = [
  { label: "serviced, original", mult: 1 },
  { label: "unserviced", mult: 0.62 },
];
const WINE_VINTAGES: Variant[] = [
  { label: "2000 vintage", mult: 1.35, bm: 1.05 }, { label: "2005 vintage", mult: 1.1, bm: 1 },
  { label: "2009 vintage", mult: 1.2, bm: 1.08 }, { label: "2010 vintage", mult: 1.15, bm: 1.06 },
];
const WHISKY_BOTTLINGS: Variant[] = [
  { label: "original bottling", mult: 1, bm: 1 }, { label: "sealed, original box", mult: 1.22, bm: 1.06 },
];

const SYNTH_BRANDS = new Set(["Moog", "Roland", "Yamaha", "Sequential Circuits", "ARP", "Fairlight"]);

type Group = { list: Family[]; category: string; kind: "retail" | "resale"; extra?: (f: Family) => Variant[] };

const GROUPS: Group[] = [
  { list: WATCHES, category: "watches", kind: "resale" },
  { list: BAGS, category: "handbags", kind: "resale" },
  { list: JEWELLERY, category: "jewellery", kind: "retail" },
  { list: CARS, category: "cars", kind: "resale" },
  {
    list: INSTRUMENTS, category: "art", kind: "resale",
    // Condition is the dominant price axis for a vintage instrument; it does not apply to
    // a piano bought new.
    extra: (f) => (f.kind === "retail" ? [] : SYNTH_BRANDS.has(f.brand) ? SYNTH_CONDITION : INSTRUMENT_CONDITION),
  },
  {
    list: BOTTLES, category: "wine", kind: "resale",
    extra: (f) => (f.category === "whisky" ? WHISKY_BOTTLINGS : WINE_VINTAGES),
  },
];

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
   .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const out: any[] = [];
const seen = new Set<string>();

for (const g of GROUPS) {
  for (const f of g.list) {
    const kind = f.kind ?? g.kind;
    const category = f.category ?? g.category;
    const from = f.from ?? 2005;
    const variants = f.variants ?? g.extra?.(f) ?? [];
    const list: (Variant | null)[] = variants.length ? variants : [null];

    for (const v of list) {
      // A variant that post-dates the family starts when the variant does.
      const start = Math.max(from, v?.from ?? 0);
      if (start > 2024) continue;   // needs at least two years inside the dataset

      const ref = v?.label ?? "";
      // Many family names already carry the brand ("Seiko 5 Sports", "Panthère de Cartier"),
      // so prefixing unconditionally produces "Seiko Seiko 5 Sports".
      const head = f.brand.split(" ")[0].toLowerCase();
      const display = f.name.toLowerCase().includes(head) ? f.name : `${f.brand} ${f.name}`;
      let id = slugify(`${display} ${ref}`).slice(0, 72);
      if (seen.has(id)) { let i = 2; while (seen.has(`${id}-${i}`)) i++; id = `${id}-${i}`; }
      seen.add(id);

      out.push({
        id, brand: f.brand, name: display, ref, category, kind,
        base: Math.round(f.base * (v?.mult ?? 1)),
        baseYear: start,
        ...(kind === "retail"
          ? { drift: Math.round((f.drift ?? 3) * (v?.bm ?? 1) * 100) / 100 }
          : { beta: Math.round((f.beta ?? 1) * (v?.bm ?? 1) * 1000) / 1000 }),
        from: start,
        ...(f.note ? { note: f.note } : {}),
      });
    }
  }
}

const byCat: Record<string, number> = {};
const byKind: Record<string, number> = {};
for (const o of out) { byCat[o.category] = (byCat[o.category] ?? 0) + 1; byKind[o.kind] = (byKind[o.kind] ?? 0) + 1; }

await Bun.write("data/catalogue.json", JSON.stringify({
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    count: out.length,
    confidence: "modelled",
    how: "Identity (brand, family, variant, era) is real. The price path is DERIVED, not tracked: " +
         "resale = base x (category index ratio) ^ beta; retail = base x CPI ratio x (1 + drift) ^ years. " +
         "Regenerate with: bun tools/generate-catalogue.ts",
  },
  items: out,
}, null, 1) + "\n");

console.log(`wrote data/catalogue.json — ${out.length} items`);
console.log("by category:", byCat);
console.log("by kind    :", byKind);
