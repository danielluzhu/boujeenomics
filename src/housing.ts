// Rent vs buy vs the S&P 500 vs gold, for a first-time buyer putting down the minimum.
//
// Every strategy starts with the same pot of money — the minimum down payment — and is budget-
// matched year by year: whichever choice costs more that year, the other invests the difference.
// The renter who would have paid a mortgage puts the gap into stocks (or gold); the owner whose
// fixed payment has fallen below market rent puts the gap into stocks. So every line on the chart
// is the same person spending the same money, and the only question is what it ends up as.

import raw from "../data/housing.json";

export type HomeType = "starter" | "typical" | "sfr" | "condo";
export type Scenario = "owner" | "hack" | "investor";
type Data = typeof raw;
type Market = Data["markets"][number];

export const DATA = raw as Data;

export const ASSUMPTIONS = {
  maintenancePct: 1.0,        // of home value, per year
  vacancyPct: 5,              // of gross rent, for rentals and rented rooms
  managementPct: 8,           // of collected rent, investor only
  sellingCostPct: 6,          // agent + closing, shown as "after sale"
  mortgageInsurancePct: 0.55, // FHA annual MIP / typical PMI, of balance, until 78% LTV
  investorRatePremium: 0.625, // non-owner-occupied loans price above owner-occupied
  investorDownPct: 15,        // Fannie Mae minimum for a one-unit investment property
  jumboDownPct: 10,
  roomsRented: 2,             // house hack: a three-bedroom starter, owner keeps one room
  roomShare: 0.38,            // one room rents for this share of the whole home's rent
  starterRentElasticity: 0.5, // starter rent = apartment rent × (starter / condo value)^0.5
  // Condo and mixed-stock starter homes carry association dues; houses mostly do not.
  hoaPct: { starter: 0.2, typical: 0.1, sfr: 0, condo: 0.5 } as Record<HomeType, number>,
  termYears: 30,
};

export const HOME_TYPES: Record<HomeType, { label: string; rent: "derived" | "sfr" | "mfr" | "all" }> = {
  starter: { label: "Starter home", rent: "derived" },
  typical: { label: "Typical home", rent: "all" },
  sfr: { label: "Single-family house", rent: "sfr" },
  condo: { label: "Condo", rent: "mfr" },
};

/** What renting the same kind of home costs per month, for each year of a market's path. */
export function rentFor(type: HomeType, homes: Record<HomeType, number[]>, rents: { all: number[]; sfr: number[]; mfr: number[] }) {
  const src = HOME_TYPES[type].rent;
  if (src !== "derived") return rents[src];
  // Zillow publishes no rent for the bottom third of homes, and charging a starter home the
  // typical rent overstates what renting it costs. Apartments rent against condos, the nearest
  // comparable stock, so the starter rent scales the apartment rent by relative value — with an
  // elasticity under 1, because rent rises more slowly than price.
  return rents.mfr.map((r, i) =>
    Math.round(r * Math.pow(homes.starter[i] / homes.condo[i], ASSUMPTIONS.starterRentElasticity)));
}

/** The smallest down payment a first-time buyer can get, under the given year's loan limits. */
export function minimumDown(price: number, scenario: Scenario, limits: { conformingBaseline: number; highCostCeiling?: number }) {
  if (scenario === "investor") {
    return { pct: ASSUMPTIONS.investorDownPct, product: "Conventional investment loan" };
  }
  if (price * 0.97 <= limits.conformingBaseline) {
    return { pct: 3, product: "Conventional 97 (first-time buyer)" };
  }
  const ceiling = limits.highCostCeiling ?? Infinity;
  if (price * 0.965 <= ceiling) return { pct: 3.5, product: "FHA" };
  return { pct: ASSUMPTIONS.jumboDownPct, product: "Jumbo" };
}

const payment = (loan: number, ratePct: number, years: number) => {
  const i = ratePct / 100 / 12, n = years * 12;
  return i === 0 ? loan / n : (loan * i) / (1 - Math.pow(1 + i, -n));
};
const balanceAfter = (loan: number, ratePct: number, pay: number, months: number) => {
  const i = ratePct / 100 / 12;
  if (i === 0) return Math.max(0, loan - pay * months);
  const g = Math.pow(1 + i, months);
  return Math.max(0, loan * g - (pay * (g - 1)) / i);
};

export interface Path {
  /** home value at the end of each period; index 0 is the purchase */
  home: number[];
  /** mean monthly rent for the comparable home during each period; index 0 is unused */
  rent: number[];
  /** annual % returns for periods 1..n */
  sp500: number[];
  gold: number[];
}

export interface Terms {
  scenario: Scenario;
  homeType: HomeType;
  ratePct: number;
  downPct: number;
  taxRate: number;
  taxCapPct: number | null;
  insurancePct: number;
}

export interface Result {
  fund: number;
  price: number;
  loan: number;
  monthlyPayment: number;
  value: number[];
  loanBalance: number[];
  equity: number[];
  sidePot: number[];
  netWorth: number[];
  netAfterSale: number[];
  sp500: number[];
  gold: number[];
  /** what this strategy spends on housing each year, net of any rent it collects */
  cost: number[];
  /** what the comparison spends: market rent for owner and hack, nothing for the investor */
  baseline: number[];
  /** rent collected each year (hack and investor) */
  income: number[];
}

/**
 * Walks one strategy forward a year at a time. Costs in year t are charged on the value at the
 * start of the year; contributions land at the end of the year they are saved, so they earn
 * nothing until the next one.
 */
export function simulate(path: Path, t: Terms): Result {
  const A = ASSUMPTIONS;
  const n = path.sp500.length;
  const price = path.home[0];
  const fund = price * (t.downPct / 100);
  const loan = price - fund;
  const rate = t.ratePct + (t.scenario === "investor" ? A.investorRatePremium : 0);
  const pay = payment(loan, rate, A.termYears);
  const hoa = A.hoaPct[t.homeType] / 100;

  let assessed = price, side = 0, sp = fund, gold = fund;
  const r: Result = {
    fund, price, loan, monthlyPayment: pay,
    value: [price], loanBalance: [loan], equity: [fund], sidePot: [0], netWorth: [fund],
    netAfterSale: [fund - price * (A.sellingCostPct / 100)],
    sp500: [fund], gold: [fund], cost: [0], baseline: [0], income: [0],
  };

  for (let k = 1; k <= n; k++) {
    const v0 = path.home[k - 1], v1 = path.home[k];
    const bal0 = r.loanBalance[k - 1];
    const months = Math.min(12, Math.max(0, A.termYears * 12 - (k - 1) * 12));
    const bal1 = balanceAfter(bal0, rate, pay, months);

    const mortgage = pay * months;
    const insured = bal0 > 0.78 * price ? bal0 * (A.mortgageInsurancePct / 100) : 0;
    const tax = assessed * (t.taxRate / 100);
    const carry = mortgage + insured + tax + v0 * ((t.insurancePct + A.maintenancePct) / 100 + hoa);

    const marketRent = path.rent[k] * 12;
    let income = 0, management = 0, baseline = 0;
    if (t.scenario === "owner") {
      baseline = marketRent;
    } else if (t.scenario === "hack") {
      baseline = marketRent;
      income = marketRent * A.roomShare * A.roomsRented * (1 - A.vacancyPct / 100);
    } else {
      income = marketRent * (1 - A.vacancyPct / 100);
      management = income * (A.managementPct / 100);
    }
    const cost = carry + management - income;

    // Whoever spends less this year invests the difference.
    const gap = cost - baseline;
    sp = sp * (1 + path.sp500[k - 1] / 100) + Math.max(0, gap);
    gold = gold * (1 + path.gold[k - 1] / 100) + Math.max(0, gap);
    side = side * (1 + path.sp500[k - 1] / 100) + Math.max(0, -gap);

    const growth = v0 > 0 ? v1 / v0 - 1 : 0;
    assessed = t.taxCapPct === null
      ? v1
      : Math.min(v1, assessed * (1 + Math.min(growth, t.taxCapPct / 100)));

    r.value.push(v1);
    r.loanBalance.push(bal1);
    r.equity.push(v1 - bal1);
    r.sidePot.push(side);
    r.netWorth.push(v1 - bal1 + side);
    r.netAfterSale.push(v1 * (1 - A.sellingCostPct / 100) - bal1 + side);
    r.sp500.push(sp);
    r.gold.push(gold);
    r.cost.push(cost);
    r.baseline.push(baseline);
    r.income.push(income);
  }
  return r;
}

const cagr = (a: number, b: number, years: number) => (Math.pow(b / a, 1 / years) - 1) * 100;

/** Unlevered net operating income over price — how the investor picks a property, at purchase. */
export function capRate(price: number, monthlyRent: number, type: HomeType, m: Pick<Market, "taxRate" | "insurance">) {
  const A = ASSUMPTIONS;
  const collected = monthlyRent * 12 * (1 - A.vacancyPct / 100);
  const expenses = collected * (A.managementPct / 100)
    + price * ((m.taxRate + m.insurance + A.maintenancePct + A.hoaPct[type]) / 100);
  return ((collected - expenses) / price) * 100;
}

export interface Options {
  mode: "history" | "projection";
  real: boolean;
  /** projection only */
  years?: number;
  homeGrowth?: number | null;  // %/yr; null = the market's own 30-year history
  rentGrowth?: number | null;
  sp500?: number;
  gold?: number;
  ratePct?: number;
  inflation?: number;
}

type MarketTypes = { homes: Record<HomeType, number[]>; rents: { all: number[]; sfr: number[]; mfr: number[] } };

/** Market history as typed series, plus the derived starter rent. */
function seriesOf(m: Market): MarketTypes & { rentOf: Record<HomeType, number[]> } {
  const homes = m.homes as Record<HomeType, number[]>;
  const rents = m.rents as MarketTypes["rents"];
  const rentOf = Object.fromEntries(
    (Object.keys(HOME_TYPES) as HomeType[]).map((k) => [k, rentFor(k, homes, rents)]),
  ) as Record<HomeType, number[]>;
  return { homes, rents, rentOf };
}

export function historyDefaults() {
  const d = DATA, n = d.years.length - 1;
  const idx = (rets: number[]) => rets.reduce((a, x) => a * (1 + x / 100), 1);
  return {
    sp500: cagr(1, idx(d.sp500), n),
    gold: cagr(1, idx(d.gold), n),
    inflation: cagr(d.cpi[0], d.cpi[n], n),
    ratePct: d.now.mortgageRate,
  };
}

/** Run every scenario for every market. */
export function analyseHousing(o: Options) {
  const d = DATA;
  const hist = historyDefaults();
  const projection = o.mode === "projection";
  const horizon = projection ? Math.max(5, Math.min(40, o.years ?? 30)) : d.years.length - 1;
  const startYear = projection ? Number(d.now.mortgageRateAsOf.slice(0, 4)) : d.years[0];
  const years = Array.from({ length: horizon + 1 }, (_, k) => startYear + k);
  const limits = projection ? d.loanLimits["2026"] : d.loanLimits["1995"];
  const ratePct = projection ? (o.ratePct ?? d.now.mortgageRate) : d.mortgageRate[0];
  const inflation = projection ? (o.inflation ?? hist.inflation) : null;

  // Deflator to start-year dollars.
  const deflator = projection
    ? years.map((_, k) => Math.pow(1 + inflation! / 100, k))
    : d.cpi.map((c) => c / d.cpi[0]);

  const constant = (pct: number) => Array(horizon).fill(pct);
  const sp500 = projection ? constant(o.sp500 ?? hist.sp500) : d.sp500;
  const gold = projection ? constant(o.gold ?? hist.gold) : d.gold;

  const markets = d.markets.map((m) => {
    const s = seriesOf(m);
    const n = d.years.length - 1;

    // A type's path: history as recorded, or today's value grown at a constant rate.
    const pathOf = (type: HomeType): Path => {
      if (!projection) return { home: s.homes[type], rent: s.rentOf[type], sp500, gold };
      const hg = o.homeGrowth ?? cagr(s.homes[type][0], s.homes[type][n], n);
      const rg = o.rentGrowth ?? cagr(s.rentOf[type][0], s.rentOf[type][n], n);
      const homeNow = m.now.homes[type as keyof typeof m.now.homes];
      const rentNow = type === "starter"
        ? Math.round(m.now.rents.mfr * Math.pow(m.now.homes.starter / m.now.homes.condo, ASSUMPTIONS.starterRentElasticity))
        : m.now.rents[HOME_TYPES[type].rent as "all" | "sfr" | "mfr"];
      return {
        home: years.map((_, k) => homeNow * Math.pow(1 + hg / 100, k)),
        rent: years.map((_, k) => rentNow * Math.pow(1 + rg / 100, k)),
        sp500, gold,
      };
    };

    // The investor buys whichever home type has the best cap rate at the moment of purchase —
    // never with hindsight about how it went on to perform.
    const candidates = (Object.keys(HOME_TYPES) as HomeType[]).map((type) => {
      const p = pathOf(type);
      const rent = projection ? p.rent[0] : s.rentOf[type][0];
      return {
        type, label: HOME_TYPES[type].label, price: Math.round(p.home[0]), rent: Math.round(rent),
        grossYield: ((rent * 12) / p.home[0]) * 100,
        capRate: capRate(p.home[0], rent, type, m),
      };
    });
    const best = candidates.reduce((a, b) => (b.capRate > a.capRate ? b : a));

    const run = (scenario: Scenario, type: HomeType) => {
      const path = pathOf(type);
      const down = minimumDown(path.home[0], scenario, limits);
      const res = simulate(path, {
        scenario, homeType: type, ratePct, downPct: down.pct,
        taxRate: m.taxRate,
        taxCapPct: scenario === "investor" ? m.taxCapRental : m.taxCap,
        insurancePct: m.insurance,
      });
      const real = (a: number[]) => (o.real ? a.map((v, k) => v / deflator[k]) : a);
      const out = {
        scenario, homeType: type, homeLabel: HOME_TYPES[type].label,
        product: down.product, downPct: down.pct,
        rate: ratePct + (scenario === "investor" ? ASSUMPTIONS.investorRatePremium : 0),
        fund: res.fund, price: res.price, monthlyPayment: res.monthlyPayment,
        startRent: path.rent[projection ? 0 : 1],
        value: real(res.value), loanBalance: real(res.loanBalance), equity: real(res.equity),
        sidePot: real(res.sidePot), netWorth: real(res.netWorth), netAfterSale: real(res.netAfterSale),
        sp500: real(res.sp500), gold: real(res.gold),
        cost: real(res.cost), baseline: real(res.baseline), income: real(res.income),
      };
      const end = out.netAfterSale.length - 1;
      return {
        ...out,
        summary: {
          home: out.netAfterSale[end], sp500: out.sp500[end], gold: out.gold[end],
          homeCagr: cagr(res.fund, out.netAfterSale[end], horizon),
          sp500Cagr: cagr(res.fund, out.sp500[end], horizon),
          goldCagr: cagr(res.fund, out.gold[end], horizon),
          // the first year owning was cheaper than renting, if it ever was
          breakEvenYear: (() => {
            const k = res.cost.findIndex((c, i) => i > 0 && c < res.baseline[i]);
            return k > 0 ? years[k] : null;
          })(),
        },
      };
    };

    return {
      id: m.id, name: m.name, short: m.short, county: m.county,
      taxRate: m.taxRate, taxCap: m.taxCap, insurance: m.insurance,
      homeFrom: m.homeFrom, rentFrom: m.rentFrom, sources: m.sources,
      growth: {
        home: cagr(s.homes.starter[0], s.homes.starter[n], n),
        rent: cagr(s.rentOf.starter[0], s.rentOf.starter[n], n),
      },
      candidates: candidates.map((c) => ({ ...c, chosen: c.type === best.type })),
      scenarios: {
        owner: run("owner", "starter"),
        hack: run("hack", "starter"),
        investor: run("investor", best.type),
      },
    };
  });

  return {
    mode: o.mode, real: o.real, years, ratePct,
    assumptions: {
      ...ASSUMPTIONS,
      sp500: projection ? (o.sp500 ?? hist.sp500) : hist.sp500,
      gold: projection ? (o.gold ?? hist.gold) : hist.gold,
      inflation: projection ? inflation : hist.inflation,
      homeGrowth: o.homeGrowth ?? null,
      rentGrowth: o.rentGrowth ?? null,
      loanLimits: limits,
    },
    asOf: { home: d.markets[0].now.homeAsOf, rent: d.markets[0].now.rentAsOf, rate: d.now.mortgageRateAsOf },
    markets,
  };
}
