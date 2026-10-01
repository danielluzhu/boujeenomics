// Builds data/housing.json from public sources. Run: bun tools/fetch-housing.ts
//
// Starter-home values  Zillow ZHVI bottom tier (5th–35th percentile), metro, from Jan 2000.
//                      1995–1999 are back-cast with the metro's Case-Shiller index (FHFA for Dallas).
// Rents                Zillow ZORI, metro, from 2015. Earlier years are back-cast with the metro's
//                      BLS CPI "rent of primary residence" index.
// Mortgage rates       Freddie Mac PMMS 30-year fixed (FRED MORTGAGE30US).
// S&P 500 and gold     Damodaran, "Historical Returns on Stocks, Bonds, Bills, Real Estate and Gold",
//                      January 2026 update (histretSP.xls). Hard-coded below because the source is an
//                      .xls workbook and pulling a parser in for 60 numbers is not worth a dependency.

const FIRST = 1995;
const LAST = 2025;
const OUT = new URL("../data/housing.json", import.meta.url);

// Annual total returns, % — Damodaran histretSP.xls, "Returns by year", 1996..2025.
const SP500 = [
  22.68, 33.1, 28.34, 20.89, -9.03, -11.85, -21.97, 28.36, 10.74, 4.83,
  15.61, 5.48, -36.55, 25.94, 14.82, 2.1, 15.89, 32.15, 13.52, 1.38,
  11.77, 21.61, -4.23, 31.21, 18.02, 28.47, -18.04, 26.06, 24.88, 17.72,
];
const GOLD = [
  -4.59, -21.41, -0.83, 0.85, -5.44, 0.75, 25.57, 19.89, 4.65, 17.77,
  23.2, 31.92, 4.32, 25.04, 29.24, 12.02, 5.68, -27.61, 0.12, -12.11,
  8.1, 12.66, -0.93, 19.08, 24.17, -3.75, 0.55, 13.26, 25.96, 66.22,
];

type Monthly = Map<string, number>; // "YYYY-MM" -> value

// taxRate is the effective owner-occupied rate (% of assessed value). taxCap limits how fast the
// assessed value of a home its owner lives in can rise (%/yr); taxCapRental is the same for a
// rental — California's Prop 13 covers both, Florida caps non-homestead property at 10%, Texas
// caps only homesteads. Rates are rounded county-level estimates (Tax Foundation / ATTOM).
const MARKETS = [
  { id: "us", name: "United States", short: "US", zillow: "United States", hpi: "CSUSHPINSA",
    rent: ["CUUR0000SEHA"], county: "National average", taxRate: 0.9, taxCap: null, insurance: 0.45 },
  { id: "sf", name: "San Francisco Bay Area", short: "SF", zillow: "San Francisco, CA", hpi: "SFXRNSA",
    rent: ["CUURA422SEHA", "CUUSA422SEHA"], county: "San Francisco County", taxRate: 1.18, taxCap: 2, taxCapRental: 2, insurance: 0.3 },
  { id: "nyc", name: "New York City metro", short: "NYC", zillow: "New York, NY", hpi: "NYXRNSA",
    rent: ["CUURA101SEHA", "CUUSA101SEHA"], county: "New York metro", taxRate: 0.9, taxCap: null, insurance: 0.35 },
  { id: "sea", name: "Seattle metro", short: "Seattle", zillow: "Seattle, WA", hpi: "SEXRNSA",
    rent: ["CUURA423SEHA", "CUUSA423SEHA"], county: "King County", taxRate: 0.9, taxCap: null, insurance: 0.3 },
  { id: "la", name: "Los Angeles metro", short: "LA", zillow: "Los Angeles, CA", hpi: "LXXRNSA",
    rent: ["CUURA421SEHA", "CUUSA421SEHA", "BLS:CUURS49ASEHA"], county: "Los Angeles County", taxRate: 1.2, taxCap: 2, taxCapRental: 2, insurance: 0.45 },
  { id: "bos", name: "Boston metro", short: "Boston", zillow: "Boston, MA", hpi: "BOXRNSA",
    rent: ["CUURA103SEHA", "CUUSA103SEHA"], county: "Suffolk / Middlesex", taxRate: 1.0, taxCap: null, insurance: 0.35 },
  { id: "chi", name: "Chicago metro", short: "Chicago", zillow: "Chicago, IL", hpi: "CHXRNSA",
    rent: ["CUURA207SEHA", "CUUSA207SEHA"], county: "Cook County", taxRate: 2.0, taxCap: null, insurance: 0.45 },
  { id: "mia", name: "Miami metro", short: "Miami", zillow: "Miami, FL", hpi: "MIXRNSA",
    rent: ["CUURA320SEHA", "CUUSA320SEHA"], county: "Miami-Dade County", taxRate: 1.0, taxCap: 3, taxCapRental: 10, insurance: 1.2 },
  { id: "atl", name: "Atlanta metro", short: "Atlanta", zillow: "Atlanta, GA", hpi: "ATXRNSA",
    rent: ["CUURA319SEHA", "CUUSA319SEHA"], county: "Fulton County", taxRate: 1.0, taxCap: null, insurance: 0.5 },
  { id: "dal", name: "Dallas–Fort Worth", short: "Dallas", zillow: "Dallas, TX", hpi: "ATNHPIUS19124Q",
    rent: ["CUURA316SEHA", "CUUSA316SEHA"], county: "Dallas County", taxRate: 2.0, taxCap: 10, insurance: 0.7 },
];

async function fred(id: string): Promise<Monthly> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`FRED ${id}: ${res.status}`);
  const m: Monthly = new Map();
  for (const line of (await res.text()).trim().split("\n").slice(1)) {
    const [d, v] = line.split(",");
    if (v && v !== ".") m.set(d.slice(0, 7), Number(v));
  }
  if (!m.size) throw new Error(`FRED ${id}: no observations`);
  return m;
}

// Areas BLS revised in 2018 (Los Angeles became S49A) are not on FRED, so they come from the
// BLS API — unkeyed, which allows ten years per request.
async function bls(id: string): Promise<Monthly> {
  const m: Monthly = new Map();
  for (const [a, b] of [[2016, 2025], [2026, 2026]]) {
    const res = await fetch(`https://api.bls.gov/publicAPI/v2/timeseries/data/${id}?startyear=${a}&endyear=${b}`);
    const j: any = await res.json();
    if (j.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS ${id}: ${j.message}`);
    for (const o of j.Results.series[0].data) {
      if (/^M(0[1-9]|1[0-2])$/.test(o.period)) m.set(`${o.year}-${o.period.slice(1)}`, Number(o.value));
    }
  }
  return m;
}

async function zillow(url: string, regions: string[]) {
  const text = await (await fetch(url)).text();
  const rows = text.trim().split("\n").map((l) => l.split(","));
  const head = rows[0];
  const out = new Map<string, Monthly>();
  for (const r of rows.slice(1)) {
    // RegionName is quoted when it contains a comma ("San Francisco, CA"), which splits it in two.
    const name = r[2].startsWith('"') ? `${r[2]},${r[3]}`.replaceAll('"', "") : r[2];
    if (!regions.includes(name)) continue;
    const shift = r[2].startsWith('"') ? 1 : 0;
    const m: Monthly = new Map();
    for (let i = 5; i < head.length; i++) {
      const v = r[i + shift];
      if (v) m.set(head[i].slice(0, 7), Number(v));
    }
    out.set(name, m);
  }
  return out;
}

const annualMean = (m: Monthly, y: number) => {
  const v = [...m].filter(([k]) => k.startsWith(`${y}-`)).map(([, x]) => x);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
// Latest observation in a year at or before December — a quarterly or bimonthly series has no
// December value in some years.
const yearEnd = (m: Monthly, y: number) => {
  for (let mo = 12; mo >= 1; mo--) {
    const v = m.get(`${y}-${String(mo).padStart(2, "0")}`);
    if (v !== undefined) return v;
  }
  return null;
};
const latest = (m: Monthly) => [...m].sort(([a], [b]) => (a < b ? -1 : 1)).at(-1)!;

async function main() {
  const years = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
  const names = MARKETS.map((m) => m.zillow);
  const Z = "https://files.zillowstatic.com/research/public_csvs";
  console.log("fetching Zillow…");
  // Home types. "starter" is the bottom third of the market; the rest are the middle third, which
  // is what Zillow's headline index tracks.
  const zhvi = {
    starter: await zillow(`${Z}/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.0_0.33_sm_sa_month.csv`, names),
    typical: await zillow(`${Z}/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`, names),
    sfr: await zillow(`${Z}/zhvi/Metro_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv`, names),
    condo: await zillow(`${Z}/zhvi/Metro_zhvi_uc_condo_tier_0.33_0.67_sm_sa_month.csv`, names),
  };
  // Rent types: every rental, single-family houses only, and apartments (multifamily) only.
  const zori = {
    all: await zillow(`${Z}/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv`, names),
    sfr: await zillow(`${Z}/zori/Metro_zori_uc_sfr_sm_month.csv`, names),
    mfr: await zillow(`${Z}/zori/Metro_zori_uc_mfr_sm_month.csv`, names),
  };

  console.log("fetching FRED…");
  const mortgage = await fred("MORTGAGE30US");
  const cpi = await fred("CPIAUCNS");

  const markets = [];
  for (const mk of MARKETS) {
    const hpi = await fred(mk.hpi);
    const rentSeries: Monthly[] = [];
    for (const id of mk.rent) rentSeries.push(id.startsWith("BLS:") ? await bls(id.slice(4)) : await fred(id));
    // Monthly-series annual mean, falling back to the semiannual series, then the BLS API.
    const rentIndex = years.map((y) => {
      for (const s of rentSeries) { const v = annualMean(s, y); if (v !== null) return v; }
      throw new Error(`${mk.id}: no rent index for ${y}`);
    });

    const homes: Record<string, number[]> = {}, homeFrom: Record<string, number> = {};
    const homesNow: Record<string, number> = {};
    let homeAsOf = "";
    for (const [k, all] of Object.entries(zhvi)) {
      const zv = all.get(mk.zillow);
      if (!zv) throw new Error(`Zillow ZHVI ${k} has no row for ${mk.zillow}`);
      // December values where Zillow has them; earlier years scaled off its first month by the
      // metro's repeat-sales index.
      const [firstKey, firstVal] = [...zv].sort(([a], [b]) => (a < b ? -1 : 1))[0];
      const base = hpi.get(firstKey) ?? yearEnd(hpi, Number(firstKey.slice(0, 4)))!;
      homes[k] = years.map((y) => Math.round(zv.get(`${y}-12`) ?? firstVal * (yearEnd(hpi, y)! / base)));
      homeFrom[k] = years.find((y) => zv.has(`${y}-12`))!;
      [homeAsOf, homesNow[k]] = latest(zv);
      homesNow[k] = Math.round(homesNow[k]);
    }

    const rents: Record<string, number[]> = {}, rentFrom: Record<string, number> = {};
    const rentsNow: Record<string, number> = {};
    let rentAsOf = "";
    for (const [k, all] of Object.entries(zori)) {
      const zr = all.get(mk.zillow);
      if (!zr) throw new Error(`Zillow ZORI ${k} has no row for ${mk.zillow}`);
      // Anchor on the first full calendar year Zillow covers; earlier years follow the CPI rent index.
      const from = years.find((y) => [...zr.keys()].filter((d) => d.startsWith(`${y}-`)).length === 12)!;
      const scale = annualMean(zr, from)! / rentIndex[years.indexOf(from)];
      rents[k] = years.map((y, i) => Math.round(y >= from ? annualMean(zr, y)! : rentIndex[i] * scale));
      rentFrom[k] = from;
      [rentAsOf, rentsNow[k]] = latest(zr);
      rentsNow[k] = Math.round(rentsNow[k]);
    }

    markets.push({
      id: mk.id, name: mk.name, short: mk.short, county: mk.county,
      homes, rents, homeFrom, rentFrom,
      now: { homes: homesNow, homeAsOf, rents: rentsNow, rentAsOf },
      taxRate: mk.taxRate, taxCap: mk.taxCap, taxCapRental: (mk as any).taxCapRental ?? null, insurance: mk.insurance,
      sources: {
        home: `Zillow ZHVI, ${mk.zillow} metro, December values; years before Zillow coverage back-cast with FRED ${mk.hpi}`,
        rent: `Zillow ZORI, ${mk.zillow} metro, annual mean; years before Zillow coverage back-cast with BLS rent of primary residence ${mk.rent.map((r) => r.replace("BLS:", "")).join(" / ")}`,
      },
    });
    const f = (a: number[]) => `${a[0]} → ${a.at(-1)}`;
    console.log(`${mk.short.padEnd(8)} starter ${f(homes.starter)}  typical ${f(homes.typical)}  sfr ${f(homes.sfr)}  condo ${f(homes.condo)} (${homeFrom.condo})`);
    console.log(`${"".padEnd(8)} rent all ${f(rents.all)}  sfr ${f(rents.sfr)} (${rentFrom.sfr})  mfr ${f(rents.mfr)} (${rentFrom.mfr})`);
  }

  const [rateAsOf, rateNow] = latest(mortgage);
  const data = {
    meta: {
      firstYear: FIRST, lastYear: LAST, generated: new Date().toISOString().slice(0, 10),
      note: "homes.* are December home values for each year; rents.* are the mean monthly market rent during that year; homeFrom/rentFrom give the first year Zillow itself covers, before which values are back-cast. sp500[] and gold[] are total returns for the years after firstYear.",
    },
    years,
    sp500: SP500,
    gold: GOLD,
    cpi: years.map((y) => yearEnd(cpi, y)!),
    // The rate a buyer locks at the end of each year — the last weekly survey reading in December
    // (the weekly series keys by month, so later weeks overwrite earlier ones).
    mortgageRate: years.map((y) => mortgage.get(`${y}-12`)!),
    now: { mortgageRate: rateNow, mortgageRateAsOf: rateAsOf },
    // One-unit loan limits (FHFA, HUD). The 1995 conforming limit governs the historical purchase.
    loanLimits: {
      1995: { conformingBaseline: 203150 },
      2026: { conformingBaseline: 832750, highCostCeiling: 1249125, fhaFloor: 541287 },
    },
    markets,
  };
  await Bun.write(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log(`wrote ${OUT.pathname}`);
}

await main();
