import type { Database } from "bun:sqlite";

export interface Metrics {
  id: string;
  name: string;
  class: string;
  confidence: string;
  source: string;
  blurb: string;
  caveat: string;
  /** Index rebased to 100 at the first year of the window. */
  index: number[];
  /** Value of the initial investment, one entry per year including the base year. */
  values: number[];
  /** Annual percentage returns within the window (length = years.length - 1). */
  returns: number[];
  multiple: number;
  totalReturnPct: number;
  cagrPct: number;
  volatilityPct: number;
  maxDrawdownPct: number;
  bestYear: { year: number; pct: number };
  worstYear: { year: number; pct: number };
  /** Ending value less what cash would have returned over the same window. */
  vsCash: number;
}

export interface Analysis {
  years: number[];
  from: number;
  to: number;
  real: boolean;
  amount: number;
  provisionalFrom: number;
  assets: Metrics[];
  /** CPI level rebased to 100 at the window's first year, one entry per year. */
  cpiIndex: number[];
  cpi: { cumulativePct: number; cagrPct: number };
}

const compound = (rs: number[]) => rs.reduce((a, r) => a * (1 + r / 100), 1);

function maxDrawdown(index: number[]): number {
  let peak = index[0];
  let worst = 0;
  for (const v of index) {
    if (v > peak) peak = v;
    const dd = (v / peak - 1) * 100;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function analyse(
  db: Database,
  opts: { from: number; to: number; real: boolean; amount: number },
): Analysis {
  const { from, to, real, amount } = opts;
  const bounds = db.query<{ lo: number; hi: number }, []>(
    "SELECT MIN(year) lo, MAX(year) hi FROM returns",
  ).get()!;
  // The base year holds no return; returns run from base+1 through `to`.
  const lo = Math.max(from, bounds.lo - 1);
  const hi = Math.min(to, bounds.hi);
  const years: number[] = [];
  for (let y = lo; y <= hi; y++) years.push(y);

  const rowsFor = (id: string) =>
    db.query<{ year: number; pct: number }, [string, number, number]>(
      "SELECT year, pct FROM returns WHERE asset_id = ? AND year > ? AND year <= ? ORDER BY year",
    ).all(id, lo, hi).map((r) => r.pct);

  const cpiReturns = rowsFor("cpi");
  // Deflate by chaining CPI so the adjustment lines up year-for-year with the asset.
  const deflator: number[] = [1];
  for (const p of cpiReturns) deflator.push(deflator[deflator.length - 1] * (1 + p / 100));

  const assetRows = db.query<
    { id: string; name: string; class: string; confidence: string; source: string; blurb: string; caveat: string },
    []
  >("SELECT id,name,class,confidence,source,blurb,caveat FROM assets WHERE class <> 'benchmark' ORDER BY ord").all();

  const cashNominal = compound(rowsFor("cash"));

  const assets: Metrics[] = assetRows.map((a) => {
    const nominal = rowsFor(a.id);
    // Real return: strip inflation year by year, so both the path and the endpoint are deflated.
    const returns = real
      ? nominal.map((p, i) => ((1 + p / 100) / (1 + cpiReturns[i] / 100) - 1) * 100)
      : nominal;

    const index = [100];
    for (const p of returns) index.push(index[index.length - 1] * (1 + p / 100));
    const values = index.map((v) => (v / 100) * amount);

    const multiple = index[index.length - 1] / 100;
    const n = returns.length;
    const cash = real ? cashNominal / deflator[deflator.length - 1] : cashNominal;
    const best = returns.reduce((b, p, i) => (p > b.pct ? { year: lo + 1 + i, pct: p } : b), { year: lo + 1, pct: -Infinity });
    const worst = returns.reduce((b, p, i) => (p < b.pct ? { year: lo + 1 + i, pct: p } : b), { year: lo + 1, pct: Infinity });

    return {
      ...a,
      index,
      values,
      returns,
      multiple,
      totalReturnPct: (multiple - 1) * 100,
      cagrPct: n > 0 ? (Math.pow(multiple, 1 / n) - 1) * 100 : 0,
      volatilityPct: stdev(returns),
      maxDrawdownPct: maxDrawdown(index),
      bestYear: best,
      worstYear: worst,
      vsCash: (multiple - cash) * amount,
    };
  });

  const cpiMult = compound(cpiReturns);
  return {
    years,
    from: lo,
    to: hi,
    real,
    amount,
    provisionalFrom: Number(
      db.query<{ value: string }, []>("SELECT value FROM meta WHERE key='provisionalFrom'").get()?.value ?? 9999,
    ),
    assets,
    cpiIndex: deflator.map((d) => d * 100),
    cpi: {
      cumulativePct: (cpiMult - 1) * 100,
      cagrPct: cpiReturns.length ? (Math.pow(cpiMult, 1 / cpiReturns.length) - 1) * 100 : 0,
    },
  };
}

/* ------------------------------------------------------------------ items */

export interface ItemMetrics {
  id: string;
  name: string;
  ref: string;
  brand: string;
  category: string;
  categoryName: string;
  kind: "retail" | "resale";
  blurb: string;
  source: string;
  confidence: string;
  caveat: string;
  /** Anchor years actually priced, ascending. */
  points: { year: number; price: number }[];
  /** One price per year from firstYear to lastYear, geometrically interpolated between anchors. */
  annual: { year: number; price: number }[];
  firstYear: number;
  lastYear: number;
  firstPrice: number;
  lastPrice: number;
  multiple: number;
  cagrPct: number;
  /** What the benchmark did over this item's own span, so the comparison is like-for-like. */
  benchmarkId: "sp500" | "cpi";
  benchmarkName: string;
  benchmarkCagrPct: number;
  /** Percentage points per year above or below the benchmark. */
  edgePct: number;
  /** What the same money would have become in the benchmark over the same span. */
  benchmarkValue: number;
  /** 'seed' for the shipped catalogue, 'user' for models added through the app. */
  origin: string;
}

/**
 * Fill the years between anchors. Interpolation is geometric rather than linear, so a
 * stretch between two anchors compounds at a constant rate and agrees with the CAGR
 * reported for that stretch; a straight line in price terms would not.
 */
export function interpolateAnnual(
  points: { year: number; price: number }[],
): { year: number; price: number }[] {
  const out: { year: number; price: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const span = b.year - a.year;
    const rate = Math.pow(b.price / a.price, 1 / span);
    for (let k = 0; k < span; k++) out.push({ year: a.year + k, price: a.price * Math.pow(rate, k) });
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Compound annual growth of a stored annual-return series between two years. */
function spanCagr(db: Database, id: string, y0: number, y1: number): number {
  if (y1 <= y0) return 0;
  const rs = db.query<{ pct: number }, [string, number, number]>(
    "SELECT pct FROM returns WHERE asset_id = ? AND year > ? AND year <= ? ORDER BY year",
  ).all(id, y0, y1).map((r) => r.pct);
  if (!rs.length) return 0;
  return (Math.pow(compound(rs), 1 / rs.length) - 1) * 100;
}

export interface ItemQuery {
  from?: number;
  to?: number;
  /** Free text over name, brand and reference. */
  q?: string;
  category?: string;
  kind?: "retail" | "resale";
  /** Only items with a real tracked series — excludes the generated catalogue. */
  tracked?: boolean;
  ids?: string[];
  limit?: number;
  offset?: number;
  sort?: "edge" | "cagr" | "name" | "price";
  /** Include the price anchors and the filled annual path. Off by default: at catalogue
   *  scale those arrays dominate the payload. */
  withSeries?: boolean;
}

export interface ItemPage { total: number; items: ItemMetrics[] }

export function analyseItems(db: Database, q: ItemQuery = {}): ItemPage {
  const from = q.from ?? 0, to = q.to ?? 9999;

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.category) { where.push("i.category_id = ?"); args.push(q.category); }
  if (q.kind) { where.push("i.kind = ?"); args.push(q.kind); }
  if (q.tracked) where.push("i.confidence <> 'modelled'");
  if (q.ids?.length) {
    where.push(`i.id IN (${q.ids.map(() => "?").join(",")})`);
    args.push(...q.ids);
  }
  if (q.q?.trim()) {
    // Each term must appear somewhere in the name, brand or reference.
    for (const term of q.q.trim().toLowerCase().split(/\s+/).slice(0, 6)) {
      where.push("(lower(i.name) LIKE ? OR lower(i.brand) LIKE ? OR lower(i.ref) LIKE ?)");
      const like = `%${term}%`;
      args.push(like, like, like);
    }
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db.query<
    { id: string; name: string; ref: string; brand: string; category_id: string; categoryName: string;
      kind: "retail" | "resale"; blurb: string; source: string; confidence: string; caveat: string;
      origin: string },
    (string | number)[]
  >(`SELECT i.id, i.name, i.ref, i.brand, i.category_id, a.name categoryName,
            i.kind, i.blurb, i.source, i.confidence, i.caveat, i.origin
     FROM items i JOIN assets a ON a.id = i.category_id ${clause} ORDER BY i.ord`).all(...args);
  if (!rows.length) return { total: 0, items: [] };

  // One query for every matching item's prices, grouped in memory — a per-item query would
  // be a thousand round trips at catalogue scale.
  const priceRows = db.query<{ item_id: string; year: number; price: number }, (string | number)[]>(
    `SELECT p.item_id, p.year, p.price FROM item_prices p
     JOIN items i ON i.id = p.item_id ${clause}
     AND p.year BETWEEN ? AND ? ORDER BY p.item_id, p.year`,
  ).all(...args, from, to);

  const byItem = new Map<string, { year: number; price: number }[]>();
  for (const r of priceRows) {
    let list = byItem.get(r.item_id);
    if (!list) byItem.set(r.item_id, (list = []));
    list.push({ year: r.year, price: r.price });
  }

  const spanCache = new Map<string, number>();
  const cachedSpan = (id: string, y0: number, y1: number) => {
    const key = `${id}:${y0}:${y1}`;
    if (!spanCache.has(key)) spanCache.set(key, spanCagr(db, id, y0, y1));
    return spanCache.get(key)!;
  };

  const all: ItemMetrics[] = [];
  for (const r of rows) {
    const points = byItem.get(r.id);
    if (!points || points.length < 2) continue;   // one anchor says nothing about a rate

    const firstYear = points[0].year, lastYear = points.at(-1)!.year;
    const firstPrice = points[0].price, lastPrice = points.at(-1)!.price;
    const n = lastYear - firstYear;
    const multiple = lastPrice / firstPrice;
    const benchmarkId = r.kind === "retail" ? "cpi" : "sp500";
    const benchmarkCagrPct = cachedSpan(benchmarkId, firstYear, lastYear);
    const cagrPct = (Math.pow(multiple, 1 / n) - 1) * 100;

    all.push({
      id: r.id, name: r.name, ref: r.ref, brand: r.brand,
      category: r.category_id, categoryName: r.categoryName, kind: r.kind,
      blurb: r.blurb, source: r.source, confidence: r.confidence, caveat: r.caveat,
      origin: r.origin,
      points: q.withSeries ? points : [],
      annual: q.withSeries ? interpolateAnnual(points) : [],
      firstYear, lastYear, firstPrice, lastPrice, multiple, cagrPct,
      benchmarkId,
      benchmarkName: benchmarkId === "cpi" ? "US inflation" : "S&P 500",
      benchmarkCagrPct,
      edgePct: cagrPct - benchmarkCagrPct,
      benchmarkValue: firstPrice * Math.pow(1 + benchmarkCagrPct / 100, n),
    });
  }

  const dir = q.sort === "name" ? 1 : -1;
  all.sort((a, b) => {
    switch (q.sort) {
      case "name": return a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref);
      case "cagr": return (b.cagrPct - a.cagrPct) * 1;
      case "price": return (b.lastPrice - a.lastPrice) * 1;
      default: return (b.edgePct - a.edgePct) * 1;
    }
  });
  if (q.sort === "name") { /* already ascending */ } else void dir;

  const offset = Math.max(0, q.offset ?? 0);
  const limit = q.limit ?? all.length;
  return { total: all.length, items: all.slice(offset, offset + limit) };
}

/** Headline counts, over tracked items only — the generated catalogue is excluded. */
export function summarise(db: Database, opts: { from: number; to: number; real: boolean }) {
  const a = analyse(db, { ...opts, amount: 10000 });
  const sp = a.assets.find((x) => x.id === "sp500")!;
  const lux = a.assets.filter((x) => x.class === "luxury");

  const tracked = analyseItems(db, { from: opts.from, to: opts.to, tracked: true }).items;
  const resale = tracked.filter((i) => i.kind === "resale");
  const retail = tracked.filter((i) => i.kind === "retail").sort((x, y) => y.edgePct - x.edgePct);

  const catalogue = db.query<{ n: number }, []>(
    "SELECT COUNT(*) n FROM items WHERE confidence = 'modelled'",
  ).get()!.n;

  return {
    from: a.from, to: a.to, real: a.real,
    objects: { beat: resale.filter((i) => i.edgePct > 0).length, of: resale.length },
    categories: { beat: lux.filter((x) => x.cagrPct > sp.cagrPct).length, of: lux.length },
    spCagrPct: sp.cagrPct,
    cpi: a.cpi,
    catalogueCount: catalogue,
    topRetail: retail[0] ?? null,
  };
}
