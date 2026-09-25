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
    cpi: {
      cumulativePct: (cpiMult - 1) * 100,
      cagrPct: cpiReturns.length ? (Math.pow(cpiMult, 1 / cpiReturns.length) - 1) * 100 : 0,
    },
  };
}
