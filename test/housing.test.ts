import { describe, expect, test } from "bun:test";
import { ASSUMPTIONS, DATA, analyseHousing, capRate, minimumDown, rentFor, simulate } from "../src/housing";

const flat = (n: number, v: number) => Array(n).fill(v);
const terms = {
  scenario: "owner" as const, homeType: "sfr" as const, ratePct: 6, downPct: 3,
  taxRate: 1, taxCapPct: null, insurancePct: 0.5,
};

describe("data", () => {
  test("covers three decades for every market and every series", () => {
    expect(DATA.years[0]).toBe(1995);
    expect(DATA.years.length).toBe(31);
    expect(DATA.sp500.length).toBe(30);
    expect(DATA.gold.length).toBe(30);
    for (const m of DATA.markets) {
      for (const s of Object.values(m.homes)) expect(s.length).toBe(31);
      for (const s of Object.values(m.rents)) expect(s.length).toBe(31);
    }
  });

  test("includes the five requested markets", () => {
    const ids = DATA.markets.map((m) => m.id);
    for (const id of ["us", "sf", "nyc", "sea", "la"]) expect(ids).toContain(id);
  });

  test("S&P 500 and gold land near their known 30-year records", () => {
    const g = (r: number[]) => (Math.pow(r.reduce((a, x) => a * (1 + x / 100), 1), 1 / r.length) - 1) * 100;
    expect(g(DATA.sp500)).toBeGreaterThan(9.5);
    expect(g(DATA.sp500)).toBeLessThan(11.5);
    // gold went from ~$387 at the end of 1995 to ~$4,300 at the end of 2025
    expect(g(DATA.gold)).toBeGreaterThan(7.5);
    expect(g(DATA.gold)).toBeLessThan(9.5);
  });
});

describe("minimum down payment", () => {
  const limits = DATA.loanLimits["2026"];
  test("conventional 97 at or under the conforming baseline", () => {
    expect(minimumDown(500_000, "owner", limits)).toMatchObject({ pct: 3 });
    expect(minimumDown(858_500, "owner", limits)).toMatchObject({ pct: 3 }); // loan 832,745
  });
  test("FHA above the baseline, up to the high-cost ceiling", () => {
    expect(minimumDown(900_000, "owner", limits)).toMatchObject({ pct: 3.5, product: "FHA" });
  });
  test("jumbo above the ceiling", () => {
    expect(minimumDown(1_400_000, "owner", limits)).toMatchObject({ pct: 10 });
  });
  test("investors have no low-down option", () => {
    expect(minimumDown(200_000, "investor", limits).pct).toBe(ASSUMPTIONS.investorDownPct);
  });
});

describe("simulate", () => {
  const path = { home: flat(31, 300_000), rent: flat(31, 1_500), sp500: flat(30, 0), gold: flat(30, 0) };

  test("the fund is the down payment and every strategy starts with it", () => {
    const r = simulate(path, terms);
    expect(r.fund).toBeCloseTo(9_000, 6);
    expect(r.netWorth[0]).toBeCloseTo(9_000, 6);
    expect(r.sp500[0]).toBeCloseTo(9_000, 6);
    expect(r.gold[0]).toBeCloseTo(9_000, 6);
  });

  test("a 30-year loan is fully paid off after 30 years", () => {
    const r = simulate(path, terms);
    expect(r.loanBalance.at(-1)).toBeCloseTo(0, 2);
    expect(r.equity.at(-1)).toBeCloseTo(300_000, 2);
  });

  test("budget matching: the gap goes to exactly one side each year", () => {
    const r = simulate(path, terms);
    for (let k = 1; k < r.cost.length; k++) {
      const gap = r.cost[k] - r.baseline[k];
      const spIn = r.sp500[k] - r.sp500[k - 1];
      const sideIn = r.sidePot[k] - r.sidePot[k - 1];
      expect(spIn).toBeCloseTo(Math.max(0, gap), 6);
      expect(sideIn).toBeCloseTo(Math.max(0, -gap), 6);
    }
  });

  test("mortgage insurance stops once the balance reaches 78% of the price", () => {
    const r = simulate(path, terms);
    const k = r.loanBalance.findIndex((b) => b <= 0.78 * 300_000);
    // the year after crossing costs less than the year before it by at least the insurance
    expect(r.cost[k + 1]).toBeLessThan(r.cost[k]);
  });

  test("a Prop 13 style cap holds the assessed value down when prices rise fast", () => {
    const rising = { ...path, home: Array.from({ length: 31 }, (_, k) => 300_000 * Math.pow(1.08, k)) };
    const capped = simulate(rising, { ...terms, taxCapPct: 2 });
    const uncapped = simulate(rising, terms);
    expect(capped.cost.at(-1)!).toBeLessThan(uncapped.cost.at(-1)!);
  });

  test("a house hacker's room income lowers their cost", () => {
    const owner = simulate(path, terms);
    const hack = simulate(path, { ...terms, scenario: "hack" });
    expect(hack.cost[1]).toBeCloseTo(
      owner.cost[1] - 1_500 * 12 * ASSUMPTIONS.roomShare * ASSUMPTIONS.roomsRented * (1 - ASSUMPTIONS.vacancyPct / 100), 6);
  });

  test("an investor compares against doing nothing, and pays a rate premium", () => {
    const inv = simulate(path, { ...terms, scenario: "investor", downPct: 15 });
    expect(inv.baseline.slice(1).every((b) => b === 0)).toBe(true);
    const own = simulate(path, { ...terms, downPct: 15 });
    expect(inv.monthlyPayment).toBeGreaterThan(own.monthlyPayment);
  });
});

describe("starter rent", () => {
  test("scales apartment rent by relative value, and never exceeds it when the starter is cheaper", () => {
    const homes = { starter: [100], typical: [200], sfr: [210], condo: [150] };
    const rents = { all: [1200], sfr: [1400], mfr: [1000] };
    const r = rentFor("starter", homes, rents)[0];
    expect(r).toBe(Math.round(1000 * Math.sqrt(100 / 150)));
    expect(rentFor("sfr", homes, rents)[0]).toBe(1400);
    expect(rentFor("condo", homes, rents)[0]).toBe(1000);
  });
});

describe("analyseHousing", () => {
  const hist = analyseHousing({ mode: "history", real: false });

  test("history runs end of 1995 to end of 2025", () => {
    expect(hist.years[0]).toBe(1995);
    expect(hist.years.at(-1)).toBe(2025);
  });

  test("every market has all three scenarios", () => {
    for (const m of hist.markets) {
      expect(Object.keys(m.scenarios).sort()).toEqual(["hack", "investor", "owner"]);
      expect(m.scenarios.owner.netWorth.length).toBe(31);
    }
  });

  test("the investor buys the best cap rate at purchase, not with hindsight", () => {
    for (const m of hist.markets) {
      const chosen = m.candidates.find((c) => c.chosen)!;
      expect(m.scenarios.investor.homeType).toBe(chosen.type);
      for (const c of m.candidates) expect(chosen.capRate).toBeGreaterThanOrEqual(c.capRate);
    }
  });

  test("cap rate is net of expenses, so it sits below gross yield", () => {
    const m = DATA.markets[0];
    expect(capRate(200_000, 1_500, "sfr", m)).toBeLessThan((1_500 * 12 / 200_000) * 100);
  });

  test("real mode deflates every dollar figure", () => {
    const real = analyseHousing({ mode: "history", real: true });
    const n = hist.markets[0].scenarios.owner.sp500.length - 1;
    expect(real.markets[0].scenarios.owner.sp500[n]).toBeLessThan(hist.markets[0].scenarios.owner.sp500[n]);
    expect(real.markets[0].scenarios.owner.sp500[0]).toBeCloseTo(hist.markets[0].scenarios.owner.sp500[0], 6);
  });

  test("projection starts from today's prices and honours its horizon", () => {
    const p = analyseHousing({ mode: "projection", real: false, years: 20, sp500: 7, gold: 4, homeGrowth: 3, rentGrowth: 3 });
    expect(p.years.length).toBe(21);
    const us = p.markets.find((m) => m.id === "us")!;
    expect(us.scenarios.owner.price).toBe(DATA.markets.find((m) => m.id === "us")!.now.homes.starter);
    // a constant 7% with no contributions would be fund × 1.07^20; contributions only add to it
    expect(us.scenarios.owner.sp500.at(-1)!).toBeGreaterThanOrEqual(us.scenarios.owner.fund * Math.pow(1.07, 20) - 1e-6);
  });
});
