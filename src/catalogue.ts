import type { Database } from "bun:sqlite";
import raw from "../data/catalogue.json";

/**
 * Turns a catalogue specification into a price series.
 *
 * The identity of each entry is real; the path is derived, which is why everything built
 * here is stored with confidence 'modelled' and kept out of the site's headline claims.
 *
 *   resale: base x ( categoryIndex(y) / categoryIndex(y0) ) ^ beta
 *   retail: base x ( cpi(y) / cpi(y0) ) x (1 + drift) ^ (y - y0)
 *
 * beta scales how hard a model moves with its category (a hyped steel sports watch moves
 * more than the watch index; a mass-market bag moves less). drift is annual real price
 * escalation above inflation, which is how luxury retail actually behaves.
 */
export interface CatalogueSpec {
  id: string; brand: string; name: string; ref: string;
  category: string; kind: "retail" | "resale";
  base: number; baseYear: number; from: number;
  beta?: number; drift?: number; note?: string;
}

/** Index level per year for a stored annual-return series, rebased to 1 at its first year. */
function indexOf(db: Database, assetId: string): Map<number, number> {
  const rows = db.query<{ year: number; pct: number }, [string]>(
    "SELECT year, pct FROM returns WHERE asset_id = ? ORDER BY year",
  ).all(assetId);
  const out = new Map<number, number>();
  if (!rows.length) return out;
  let level = 1;
  out.set(rows[0].year - 1, 1);              // the base year carries no return
  for (const r of rows) { level *= 1 + r.pct / 100; out.set(r.year, level); }
  return out;
}

export function buildSeries(
  spec: CatalogueSpec,
  idx: Map<number, number>,
  cpi: Map<number, number>,
  lastYear: number,
): { year: number; price: number }[] {
  const out: { year: number; price: number }[] = [];
  const source = spec.kind === "retail" ? cpi : idx;
  const b0 = source.get(spec.baseYear);
  if (b0 === undefined) return out;

  for (let y = spec.baseYear; y <= lastYear; y++) {
    const level = source.get(y);
    if (level === undefined) continue;
    const ratio = level / b0;
    const price = spec.kind === "retail"
      ? spec.base * ratio * Math.pow(1 + (spec.drift ?? 3) / 100, y - spec.baseYear)
      : spec.base * Math.pow(ratio, spec.beta ?? 1);
    out.push({ year: y, price: Math.round(price * 100) / 100 });
  }
  return out;
}

export function seedCatalogue(db: Database, lastYear: number): number {
  const specs = raw.items as CatalogueSpec[];
  const cpi = indexOf(db, "cpi");
  const idxCache = new Map<string, Map<number, number>>();

  const insItem = db.prepare(
    `INSERT INTO items (id,name,ref,brand,category_id,kind,blurb,source,confidence,caveat,origin,created_at,ord)
     VALUES (?,?,?,?,?,?,?,?,'modelled',?,'seed',?,?)`,
  );
  const insPrice = db.prepare("INSERT INTO item_prices (item_id,year,price) VALUES (?,?,?)");
  const now = new Date().toISOString();
  const base = (db.query<{ m: number }, []>("SELECT COALESCE(MAX(ord),0) m FROM items").get()?.m ?? 0) + 1;

  let n = 0;
  db.transaction(() => {
    for (const [i, spec] of specs.entries()) {
      if (!idxCache.has(spec.category)) idxCache.set(spec.category, indexOf(db, spec.category));
      const series = buildSeries(spec, idxCache.get(spec.category)!, cpi, lastYear);
      if (series.length < 2) continue;

      const how = spec.kind === "retail"
        ? `Modelled: ${spec.baseYear} price level carried forward by US inflation plus ${spec.drift}% a year of real luxury price escalation.`
        : `Modelled: ${spec.baseYear} price level moved with the ${spec.category} category index at beta ${spec.beta}.`;

      insItem.run(
        spec.id, spec.name, spec.ref, spec.brand, spec.category, spec.kind,
        "", how,
        `Not a tracked price for this reference. The model, the variant and the era are real; the price path is derived from the category index and this variant's price level.${spec.note ? " " + spec.note : ""}`,
        now, base + i,
      );
      for (const p of series) insPrice.run(spec.id, p.year, p.price);
      n++;
    }
  })();
  return n;
}
