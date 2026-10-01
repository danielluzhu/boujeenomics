// Rent vs buy vs the S&P 500 vs gold. The model runs on the server (src/housing.ts); this file
// only draws it.
//
// Colour follows the asset and never changes with the strategy: the home is always slot 2, the
// S&P 500 slot 1, gold slot 4. Projections are dashed, because every number in them is modelled.

const SVG = "http://www.w3.org/2000/svg";
const COLOR = { home: "var(--s2)", sp500: "var(--s1)", gold: "var(--s4)" };
const PRESETS = {
  history: { home: null, rent: null, sp: null, gold: null, infl: null },
  cautious: { home: 3.5, rent: 3.5, sp: 7, gold: 4, infl: 2.5 },
};
const SCENARIO = {
  owner: { short: "Live in it", noun: "starter home" },
  hack: { short: "House hack", noun: "house hack" },
  investor: { short: "Rent it out", noun: "rental" },
};

const state = {
  market: "us", scenario: "owner", mode: "history", real: false, scale: "lin",
  closing: true, costView: "cash",
  preset: "history",
  p: { years: 30, home: null, rent: null, sp: null, gold: null, rate: null, infl: null },
  data: null, history: null,
};

const $ = (s) => document.querySelector(s);
const el = (t, a = {}) => {
  const n = document.createElementNS(SVG, t);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
  return n;
};
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (v) => (v < 0 ? "−" : "") + "$" + Math.round(Math.abs(v)).toLocaleString();
const compact = (v) => {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "k";
  return s + "$" + Math.round(a);
};
const pct = (v, d = 1) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + "%";
const multiple = (a, b) => {
  const x = b / a;
  return x >= 10 ? Math.round(x) + "×" : x.toFixed(1) + "×";
};

/* ---------------------------------------------------------------- fetching */
function query(mode, real) {
  const q = new URLSearchParams({ mode, real: real ? "1" : "0" });
  if (!state.closing) q.set("closing", "0");
  if (mode === "projection") {
    const p = state.p;
    q.set("years", p.years);
    for (const [k, v] of Object.entries({ home: p.home, rent: p.rent, sp: p.sp, gold: p.gold, rate: p.rate, infl: p.infl })) {
      if (v !== null && v !== "" && Number.isFinite(Number(v))) q.set(k, v);
    }
  }
  return "/api/housing?" + q;
}

async function load() {
  const r = await fetch(query(state.mode, state.real));
  state.data = await r.json();
  renderAll();
}

/* ------------------------------------------------------------------ chrome */
function seg(sel, fn) {
  const box = $(sel);
  box.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    [...box.children].forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    fn(b.dataset.v);
  };
}
const press = (sel, v) => { for (const b of $(sel).children) b.setAttribute("aria-pressed", String(b.dataset.v === v)); };

function applyTheme(v) {
  if (v === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", v);
  try { v === "system" ? localStorage.removeItem("boujee-theme") : localStorage.setItem("boujee-theme", v); } catch (e) {}
  writeUrl();
  drawAll();
}

const market = () => state.data.markets.find((m) => m.id === state.market) ?? state.data.markets[0];
const scen = () => market().scenarios[state.scenario];
const projecting = () => state.mode === "projection";
const dollars = () => (state.real ? `${state.data.years[0]} dollars` : "nominal dollars");

function labels(s) {
  const home = state.scenario === "owner" ? "Starter home"
    : state.scenario === "hack" ? "House hack"
    : `Rental (${s.homeLabel.toLowerCase()})`;
  const alt = state.scenario === "investor" ? "" : "Rent + ";
  return { home, sp500: `${alt}S&P 500`, gold: `${alt}gold` };
}

function renderMarketPicker() {
  const box = $("#marketPicker");
  box.innerHTML = state.data.markets.map((m) =>
    `<button type="button" class="chip" data-v="${m.id}" aria-pressed="${m.id === state.market}">${esc(m.short)}</button>`).join("");
  box.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.market = b.dataset.v;
    renderAll();
  };
}

/* ------------------------------------------------------------------- hero */
function renderHero() {
  const h = state.history;
  if (!h) return;
  const beat = (k, alt) => h.markets.filter((m) => m.scenarios[k].summary.home > m.scenarios[k].summary[alt]).length;
  const n = h.markets.length;
  const us = h.markets.find((m) => m.id === "us").scenarios.owner;
  $("#heroStats").innerHTML = [
    [`${beat("owner", "sp500")}<em> of ${n}</em>`, "markets where a starter home beat renting and putting the difference in the S&P 500"],
    [`${beat("hack", "sp500")}<em> of ${n}</em>`, "where a house hack did, after selling costs"],
    [`${beat("investor", "sp500")}<em> of ${n}</em>`, "where a rental property beat the same money in the index"],
    [`${money(us.fund)}`, `the cash a first-time buyer needed for a US starter home in 1995: 3% down on ${money(us.price)}, plus closing costs`],
  ].map(([f, c]) => `<div class="hstat"><div class="fig">${f}</div><div class="cap">${c}</div></div>`).join("");
}

/* ------------------------------------------------------------------ tiles */
function renderTiles() {
  const s = scen(), d = state.data, end = d.years.at(-1);
  const L = labels(s);
  const tile = (k, v, sub) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${sub}</div></div>`;
  const firstYear = d.years[projecting() ? 0 : 1];
  const rentLabel = state.scenario === "investor" ? "Rent it earns" : "Rent for the same home";
  $("#tiles").innerHTML = [
    tile("Starting fund", money(s.fund), s.closing > 0
      ? `${money(s.down)} down (${s.downPct}%) + ${money(s.closing)} closing · ${esc(s.product)}`
      : `${s.downPct}% down · ${esc(s.product)}`),
    tile(state.scenario === "investor" ? "Rental bought" : "Home price", money(s.price),
      `${esc(s.homeLabel)}, ${projecting() ? `today (${d.asOf.home.slice(0, 7)})` : `end of ${d.years[0]}`}`),
    tile("Mortgage", `${money(s.monthlyPayment)}<small>/mo</small>`, `${s.rate.toFixed(2)}% fixed, 30 years · principal + interest`),
    tile(rentLabel, `${money(s.startRent)}<small>/mo</small>`, `market rent in ${firstYear}`),
    tile(`Home value, ${end}`, compact(s.value.at(-1)),
      s.loanBalance.at(-1) > 1 ? `${compact(s.loanBalance.at(-1))} still owed` : "mortgage paid off"),
    tile(`${L.home}, ${end}`, compact(s.summary.home), `${multiple(s.fund, s.summary.home)} · ${pct(s.summary.homeCagr)}/yr`),
    tile(`${L.sp500}, ${end}`, compact(s.summary.sp500), `${multiple(s.fund, s.summary.sp500)} · ${pct(s.summary.sp500Cagr)}/yr`),
    tile(`${L.gold}, ${end}`, compact(s.summary.gold), `${multiple(s.fund, s.summary.gold)} · ${pct(s.summary.goldCagr)}/yr`),
  ].join("");
}

/* ------------------------------------------------------------- line chart */
function linTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) ?? mag * 10;
  const out = [];
  const start = Math.ceil(lo / step) * step;
  for (let i = 0; start + i * step <= hi + 1e-9; i++) out.push(start + i * step);
  return out;
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (v >= lo && v <= hi) out.push(v); }
  return out;
}

/**
 * series: [{ name, color, values, dash?, detail?(i) }]. `from` skips leading indices (the cost
 * chart has nothing at the purchase year). `bands` shades spans of years the data back-casts.
 */
function lineChart(svg, years, series, { log = false, from = 0, zero = false, bands = [], height = 360 } = {}) {
  svg.innerHTML = "";
  // Drawn at the width it is shown at, so text stays legible on a phone instead of shrinking.
  const W = Math.max(svg.clientWidth || 640, 320), narrow = W < 600, H = narrow ? Math.round(height * 0.8) : height;
  const m = { t: 14, r: narrow ? 68 : 128, b: 30, l: narrow ? 46 : 64 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const idx = years.map((_, i) => i).filter((i) => i >= from);
  const all = series.flatMap((s) => idx.map((i) => s.values[i]));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const useLog = log && lo > 0;
  const yMin = useLog ? lo * 0.85 : lo - (hi - lo) * 0.04;
  const yMax = useLog ? hi * 1.15 : hi + (hi - lo) * 0.06;
  const ty = (v) => (useLog ? Math.log10(Math.max(v, 1e-9)) : v);
  const y = (v) => m.t + ih - ((ty(v) - ty(yMin)) / (ty(yMax) - ty(yMin))) * ih;
  const x = (i) => m.l + ((i - from) / Math.max(1, years.length - 1 - from)) * iw;

  for (const b of bands) {
    const i0 = Math.max(from, years.indexOf(b.from)), i1 = years.indexOf(b.to);
    if (i0 < 0 || i1 <= i0) continue;
    svg.append(el("rect", { class: "band", x: x(i0), y: m.t, width: x(i1) - x(i0), height: ih }));
    const t = el("text", { class: "band-label", x: x(i0) + 6, y: m.t + 14 });
    t.textContent = b.label;
    svg.append(t);
  }

  for (const v of useLog ? logTicks(yMin, yMax) : linTicks(yMin, yMax, 5)) {
    svg.append(el("line", { class: v === 0 ? "axis-line" : "grid-line", x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }));
    const t = el("text", { class: "tick", x: m.l - 9, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = compact(v);
    svg.append(t);
  }
  svg.append(el("line", { class: "axis-line", x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));

  const last = years.length - 1;
  const step = Math.ceil((last - from + 1) / (narrow ? 4 : 8));
  const marks = [];
  for (let i = from; i < last; i += step) if (last - i >= step * 0.6) marks.push(i);
  marks.push(last);
  for (const i of marks) {
    const t = el("text", { class: "tick", x: x(i), y: H - 9, "text-anchor": "middle" });
    t.textContent = years[i];
    svg.append(t);
  }

  for (const s of series) {
    const d = idx.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(s.values[i]).toFixed(1)}`).join("");
    svg.append(el("path", { class: "series-line", d, stroke: s.color, ...(s.dash ? { "stroke-dasharray": s.dash } : {}) }));
  }

  // Direct end labels, nudged apart; text stays in ink, a swatch carries the hue.
  const placed = [];
  for (const s of [...series].sort((a, b) => b.values[last] - a.values[last])) {
    let yy = y(s.values[last]) + 4;
    while (placed.some((p) => Math.abs(p - yy) < 15)) yy += 15;
    placed.push(yy);
    svg.append(el("rect", { x: m.l + iw + 8, y: yy - 8, width: 8, height: 8, rx: 2, fill: s.color }));
    const t = el("text", { class: "end-label", x: m.l + iw + 21, y: yy });
    t.textContent = compact(s.values[last]);
    svg.append(t);
  }

  crosshair(svg, { series, years, x, y, m, ih, iw, from });
}

function crosshair(svg, { series, years, x, y, m, ih, iw, from }) {
  const line = el("line", { class: "crosshair", y1: m.t, y2: m.t + ih, opacity: 0 });
  svg.append(line);
  const dots = series.map((s) => {
    const c = el("circle", { r: 4.5, fill: s.color, stroke: "var(--surface-1)", "stroke-width": 2, opacity: 0 });
    svg.append(c);
    return c;
  });
  const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" });
  svg.append(hit);
  const tip = $("#tip");
  const span = years.length - 1 - from;
  const move = (clientX, clientY) => {
    const box = svg.getBoundingClientRect();
    const rel = ((clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
    const i = Math.max(from, Math.min(years.length - 1, from + Math.round(((rel - m.l) / iw) * span)));
    line.setAttribute("x1", x(i)); line.setAttribute("x2", x(i)); line.setAttribute("opacity", 1);
    series.forEach((s, k) => {
      dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(s.values[i])); dots[k].setAttribute("opacity", 1);
    });
    const rows = [...series].sort((a, b) => b.values[i] - a.values[i]).map((s) =>
      `<div class="row"><span class="nm" style="--c:${s.color}"><span class="sw"></span>${esc(s.name)}</span><b>${money(s.values[i])}</b></div>` +
      (s.detail ? `<div class="sub">${s.detail(i)}</div>` : "")).join("");
    tip.innerHTML = `<h4>${years[i]}</h4>${rows}`;
    tip.classList.add("on");
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(clientX + 16, innerWidth - w - 8) + "px";
    tip.style.top = Math.max(8, Math.min(clientY - h / 2, innerHeight - h - 8)) + "px";
  };
  const hide = () => {
    line.setAttribute("opacity", 0);
    dots.forEach((d) => d.setAttribute("opacity", 0));
    tip.classList.remove("on");
  };
  hit.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
  hit.addEventListener("mouseleave", hide);
  hit.addEventListener("touchstart", (e) => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  hit.addEventListener("touchmove", (e) => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  hit.addEventListener("touchend", hide);
}

const legend = (sel, series) => {
  $(sel).innerHTML = series.map((s) =>
    `<span style="--c:${s.color}"><i style="${s.dash ? "border-top-style:dashed" : ""}"></i>${esc(s.name)}</span>`).join("");
};

function drawGrowth() {
  const d = state.data, s = scen(), mk = market(), L = labels(s);
  const dash = projecting() ? "7 4" : "";
  const series = [
    { name: `${L.home} (after sale)`, color: COLOR.home, values: s.netAfterSale, dash,
      detail: (i) => `equity ${compact(s.equity[i])}${s.sidePot[i] > 0.5 ? ` + invested savings ${compact(s.sidePot[i])}` : ""}, less ${compact(s.value[i] * d.assumptions.sellingCostPct / 100)} to sell` },
    { name: L.sp500, color: COLOR.sp500, values: s.sp500, dash },
    { name: L.gold, color: COLOR.gold, values: s.gold, dash },
  ];
  const bands = projecting() || mk.homeFrom.starter <= d.years[0] ? []
    : [{ from: d.years[0], to: mk.homeFrom[s.homeType] ?? mk.homeFrom.starter, label: "back-cast" }];
  lineChart($("#growth"), d.years, series, { log: state.scale === "log", bands });
  legend("#growthLegend", series);

  $("#chartEyebrow").textContent = `${mk.name} · ${SCENARIO[state.scenario].short}`;
  $("#chartTitle").textContent = projecting()
    ? `What ${money(s.fund)} could become by ${d.years.at(-1)}`
    : `What ${money(s.fund)} became, ${d.years[0]}–${d.years.at(-1)}`;
  const what = state.scenario === "investor"
    ? `the down payment on a ${s.homeLabel.toLowerCase()} let out at market rent, against investing the same money — plus any cash the rental needed later — in the S&P 500 or in gold`
    : `the minimum down payment on a ${state.scenario === "hack" ? "starter home with two rooms let out" : "starter home"}, against renting the same kind of home and investing the down payment and any monthly savings instead`;
  $("#growthHint").textContent = `${projecting() ? "Modelled" : "Recorded"} path of ${what}. In ${dollars()}.` +
    (projecting() ? " Dashed because every number in a projection is an assumption." : "");
  const backcast = projecting() ? "" :
    `Home values before ${mk.homeFrom[s.homeType]} and rents before ${mk.rentFrom.all} are back-cast from the Case-Shiller and BLS rent indices, not Zillow's own figures. `;
  $("#growthNote").textContent = backcast + "Hover the chart for the split between home equity and the savings an owner invested.";
}

function drawCosts() {
  const d = state.data, s = scen();
  const dash = projecting() ? "7 4" : "";
  const monthly = (a) => a.map((v) => v / 12);
  let series;
  if (state.scenario === "investor") {
    series = [{ name: "Monthly cash flow from the rental", color: COLOR.home, values: monthly(s.cost.map((c) => -c)), dash,
      detail: (i) => `rent collected ${money(s.income[i] / 12)}, costs ${money((s.cost[i] + s.income[i]) / 12)}` }];
    $("#costTitle").textContent = "What the rental pays you, or costs you";
    $("#costHint").textContent = `Rent collected after ${state.data.assumptions.vacancyPct}% vacancy, minus mortgage, tax, insurance, maintenance, association dues and management, per month. Below zero, the investor tops it up from their own pocket — and the S&P 500 and gold lines get the same top-up.`;
  } else if (state.costView === "gone") {
    series = [
      { name: "Owning: money you don't get back", color: COLOR.home, values: monthly(s.unrecoverable), dash,
        detail: (i) => `excludes ${money(s.principal[i] / 12)}/mo of principal, which becomes equity` },
      { name: "Renting: rent", color: COLOR.sp500, values: monthly(s.rentPaid), dash },
    ];
    $("#costTitle").textContent = "Money you don't get back, month by month";
    $("#costHint").textContent = "Rent is entirely gone. Owning is partly gone — interest, property tax, insurance, maintenance, mortgage insurance and dues — and partly saved, because principal becomes equity. This is the fairer way to set the two side by side." +
      (state.scenario === "hack" ? " Room rent collected is subtracted from the owner's line." : "");
  } else {
    series = [
      { name: state.scenario === "hack" ? "Owning, after room rent" : "Owning", color: COLOR.home, values: monthly(s.cost), dash,
        detail: state.scenario === "hack" ? (i) => `room rent collected ${money(s.income[i] / 12)}` : null },
      { name: "Renting the same home", color: COLOR.sp500, values: monthly(s.baseline), dash },
    ];
    $("#costTitle").textContent = "Owning versus renting, month by month";
    $("#costHint").textContent = "Monthly cost of owning — mortgage, mortgage insurance, property tax, home insurance, maintenance and dues" +
      (state.scenario === "hack" ? ", minus the rent from two rooms" : "") +
      " — against market rent for the same kind of home. Whichever is cheaper that year, the difference is invested. The mortgage is fixed and rent is not, which is most of the story.";
  }
  $("#costSeg").hidden = state.scenario === "investor";
  lineChart($("#costs"), d.years, series, { from: 1, zero: true, height: 300 });
  legend("#costLegend", series);
}


/* ----------------------------------------------------------------- ledger */
function renderLedger() {
  const s = scen(), d = state.data, L = s.ledger, O = L.owner, R = L.renter, N = L.years;
  const inv = state.scenario === "investor", hack = state.scenario === "hack";
  const end = d.years.at(-1), sell = d.assumptions.sellingCostPct;
  const homeName = inv ? "Buying the rental" : hack ? "House hacking" : "Owning";
  const altName = inv ? "The S&P 500 instead" : "Renting + S&P 500";

  $("#ledgerTitle").textContent = `${homeName} vs ${inv ? "the S&P 500" : "renting + the S&P 500"}: where every dollar went`;
  $("#ledgerHint").textContent = `${d.years[0]}–${end}, ${market().name}, in ${dollars()}. Both sides spend exactly ` +
    `${money(O.totalOut)} over ${N} years — the up-front cash plus every month after it — because whichever is cheaper ` +
    `in a given year invests the difference. The only question is what that money bought.`;

  // Bars: coloured segments are money you keep; grey is money that is gone.
  const kept = (label, v, c) => ({ label, v, c, gone: false });
  const gone = (label, v) => ({ label, v, gone: true });
  const ownerSegs = [
    kept("Down payment", O.down, COLOR.home),
    kept("Principal paid (equity)", O.principal, COLOR.home),
    kept("Invested savings", O.invested, COLOR.sp500),
    gone("Closing costs", O.closing), gone("Interest", O.interest), gone("Mortgage insurance", O.mortgageInsurance),
    gone("Property tax", O.propertyTax), gone("Home insurance", O.homeInsurance), gone("Maintenance", O.maintenance),
    gone("Association dues", O.dues), gone("Management", O.management),
  ].filter((x) => x.v > 0.5);
  const renterSegs = [
    kept("Invested on day one", R.upfront, COLOR.sp500),
    kept("Invested monthly", R.invested, COLOR.sp500),
    gone("Rent", R.rent),
  ].filter((x) => x.v > 0.5);
  const bars = [
    { name: homeName, segs: ownerSegs },
    ...(O.income > 0 ? [{ name: "Rent collected", segs: [kept(hack ? "Room rent collected" : "Rent collected", O.income, "var(--s3)")] }] : []),
    { name: altName, segs: renterSegs },
  ];
  const max = Math.max(...bars.map((b) => b.segs.reduce((a, x) => a + x.v, 0)));
  $("#ledgerBars").innerHTML = bars.map((b) => {
    const tot = b.segs.reduce((a, x) => a + x.v, 0);
    let alt = false;
    return `<div class="lbar-row"><span class="nm">${esc(b.name)}</span><div class="lbar">${b.segs.map((x) => {
      alt = x.gone ? !alt : alt;
      return `<span class="${x.gone ? "gone" + (alt ? "" : " alt") : ""}" style="--c:${x.c ?? "var(--axis)"};width:${(x.v / max) * 100}%" data-tip="${esc(x.label)}: ${money(x.v)}${x.gone ? " — gone" : ""}"></span>`;
    }).join("")}</div><span class="tot">${compact(tot)}</span></div>`;
  }).join("");
  $("#ledgerLegend").innerHTML = [
    [COLOR.home, "Becomes home equity"], [COLOR.sp500, "Invested in the S&P 500"],
    ...(O.income > 0 ? [["var(--s3)", "Rent collected, which offsets costs"]] : []),
    ["var(--axis)", "Gone: interest, tax, insurance, upkeep, fees, rent"],
  ].map(([c, t]) => `<span style="--c:${c}"><i class="block"></i>${t}</span>`).join("");

  const row = (label, v, cls = "", note = "") =>
    `<tr class="${cls}"><td class="${cls === "" ? "sub" : ""}">${label}${note ? ` <span class="note">${note}</span>` : ""}</td><td class="num">${v}</td></tr>`;
  const sec = (t) => `<tr class="sec"><td colspan="2">${t}</td></tr>`;
  const neg = (v) => (v > 0.5 ? "−" + money(v) : money(0));
  const opt = (label, v, note) => (v > 0.5 ? row(label, money(v), "", note) : "");
  const winner = O.afterTax >= R.afterTax ? "home" : "alt";

  const ownerTable = `<h3><span class="swatch" style="--c:${COLOR.home}"></span>${esc(homeName)}</h3><table><tbody>
    ${sec("Up front")}
    ${row("Down payment", money(O.down), "", `${s.downPct}%`)}
    ${state.closing ? row("Closing costs", money(O.closing), "", "gone on day one") : row("Closing costs", "left out")}
    ${sec(`Over ${N} years`)}
    ${row("Principal", money(O.principal), "", "becomes equity")}
    ${row("Interest", money(O.interest), "", `${Math.round(O.firstYearInterestShare * 100)}% of year one's payments`)}
    ${opt("Mortgage insurance", O.mortgageInsurance, "until 22% equity")}
    ${row("Property tax", money(O.propertyTax))}
    ${row("Home insurance", money(O.homeInsurance))}
    ${row("Maintenance", money(O.maintenance), "", `${d.assumptions.maintenancePct}% of value a year`)}
    ${opt("Association dues", O.dues)}
    ${opt("Management", O.management)}
    ${O.income > 0 ? row(hack ? "Room rent collected" : "Rent collected", neg(O.income)) : ""}
    ${opt("Invested savings", O.invested, "in years owning cost less")}
    ${row("Total cash out", money(O.totalOut), "tot")}
    ${row("of which gone for good", money(O.unrecoverable), "", `incl. ${sell}% selling fees`)}
    ${sec(`At the end of ${end}`)}
    ${row("Home value", money(O.homeValue))}
    ${O.loanLeft > 1 ? row("Mortgage still owed", neg(O.loanLeft)) : ""}
    ${row("Agent and selling fees", neg(O.sellingCost), "", `${sell}%`)}
    ${opt("Invested savings, grown", O.sidePot)}
    ${row("Net worth", money(O.end), "tot")}
    ${row("Tax on the home sale", neg(O.homeTax), "", O.exclusion ? `first ${compact(O.exclusion)} of gain tax-free` : "no exclusion on a rental")}
    ${O.sideTax > 0.5 ? row("Tax on stock gains", neg(O.sideTax), "", `${d.assumptions.capitalGainsPct}%`) : ""}
    ${row(`After tax${winner === "home" ? " ▲" : ""}`, money(O.afterTax), "big")}
  </tbody></table>`;

  const renterTable = `<h3><span class="swatch" style="--c:${COLOR.sp500}"></span>${esc(altName)}</h3><table><tbody>
    ${sec("Up front")}
    ${row("Invested on day one", money(R.upfront), "", "the same cash the buyer spends")}
    ${sec(`Over ${N} years`)}
    ${inv ? "" : row("Rent", money(R.rent), "", `${money(s.startRent)}/mo at the start`)}
    ${row("Invested monthly", money(R.invested), "", inv ? "whatever the rental needed topping up" : "in years owning cost more")}
    ${row("Total cash out", money(R.totalOut), "tot")}
    ${row("of which gone for good", money(R.unrecoverable), "", inv ? "" : "all of the rent")}
    ${sec(`At the end of ${end}`)}
    ${row("Money put in", money(R.upfront + R.invested))}
    ${row("Market growth", money(R.growth), "", "no trading fees")}
    ${row("Net worth", money(R.end), "tot")}
    ${row("Tax on stock gains", neg(R.tax), "", `${d.assumptions.capitalGainsPct}% if all sold`)}
    ${row(`After tax${winner === "alt" ? " ▲" : ""}`, money(R.afterTax), "big")}
  </tbody></table>`;
  $("#ledgerTable").innerHTML = `<div>${ownerTable}</div><div>${renterTable}</div>`;

  renderProsCons();
}

function renderProsCons() {
  const box = $("#prosCons");
  if (state.scenario === "investor") { box.innerHTML = ""; return; }
  const s = scen(), d = state.data, O = s.ledger.owner, R = s.ledger.renter, N = s.ledger.years;
  const hack = state.scenario === "hack";
  const rentEnd = s.rentPaid.at(-1) / 12;
  const gain = O.homeValue - s.price;
  const li = (cls, html) => `<li class="${cls}">${html}</li>`;
  const owning = [
    li("con", `<b>A large sum up front.</b> ${money(s.fund)} on day one: ${money(O.down)} down${O.closing ? ` and ${money(O.closing)} in closing costs that never come back` : ""}.`),
    li("pro", `<b>The mortgage builds equity.</b> ${money(O.principal)} of principal over ${N} years, plus ${money(gain)} of price growth on the whole house — not just on the down payment.`),
    li("con", `<b>Early payments are mostly interest.</b> ${Math.round(O.firstYearInterestShare * 100)}% of year one's mortgage went to the bank; ${money(O.interest)} in interest over ${N} years.`),
    li("con", `<b>Taxes, insurance and maintenance never stop.</b> ${money(O.propertyTax + O.homeInsurance + O.maintenance + O.mortgageInsurance + O.dues)} over ${N} years, and they rise with the home's value.`),
    li("con", `<b>Agent fees to get out.</b> ${money(O.sellingCost)} at ${d.assumptions.sellingCostPct}% of the sale price.`),
    li("pro", `<b>A fixed payment.</b> Principal and interest stay ${money(s.monthlyPayment)}/mo for 30 years while rent for the same home went from ${money(s.startRent)} to ${money(rentEnd)}.`),
    li("pro", `<b>The first ${compact(O.exclusion)} of gain is tax-free</b> on a home you live in.`),
    ...(hack ? [li("pro", `<b>Tenants pay part of it.</b> ${money(O.income)} of room rent collected over ${N} years.`),
      li("con", `<b>You live with them.</b> Two rooms let to strangers, and the work of finding and keeping them.`)] : []),
    li("con", `<b>One house, in one city.</b> Undiversified, and slow and expensive to sell.`),
  ];
  const renting = [
    li("pro", `<b>Growing from day one.</b> The ${money(R.upfront)} goes straight into the index; on its own it became ${money(R.upfrontGrown)}.`),
    li("pro", `<b>No trading fees.</b> A broad index fund costs about 0.03% a year and nothing to buy or sell; not modelled.`),
    li("pro", `<b>Diversified and liquid.</b> Five hundred companies, sellable any day, in any amount.`),
    li("con", `<b>Rent builds no equity.</b> ${money(R.rent)} paid over ${N} years, none of it recoverable.`),
    li("con", `<b>Rent rises.</b> From ${money(s.startRent)} to ${money(rentEnd)} a month for the same home — ${multiple(s.startRent, rentEnd)}.`),
    li("con", `<b>Gains are taxed.</b> ${money(R.tax)} at ${d.assumptions.capitalGainsPct}% if it were all sold at the end.`),
    li("con", `<b>It only works if you invest the difference.</b> This model assumes the renter invests every dollar the owner would have spent. Most people don't, and the mortgage forces the owner to save.`),
  ];
  box.innerHTML = `<div><h4>Owning</h4><ul>${owning.join("")}</ul></div><div><h4>Renting + S&amp;P 500</h4><ul>${renting.join("")}</ul></div>`;
}

function wireLedgerTips() {
  const tip = $("#tip");
  $("#ledgerBars").addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tip.classList.remove("on"); return; }
    tip.innerHTML = `<div class="row">${esc(t.dataset.tip)}</div>`;
    tip.classList.add("on");
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = (e.clientY - tip.offsetHeight - 10) + "px";
  });
  $("#ledgerBars").addEventListener("mouseleave", () => tip.classList.remove("on"));
}

/* ---------------------------------------------------------------- tables */
function renderPull() {
  const s = scen(), mk = market(), L = labels(s), d = state.data;
  const best = [["home", s.summary.home], ["sp500", s.summary.sp500], ["gold", s.summary.gold]].sort((a, b) => b[1] - a[1])[0][0];
  const winner = { home: L.home.toLowerCase(), sp500: "the S&P 500", gold: "gold" }[best];
  const verb = projecting() ? "could turn" : "turned";
  $("#pullText").innerHTML = `In ${esc(mk.short === "US" ? "the average US market" : mk.short)}, the ${SCENARIO[state.scenario].noun} ${verb} ` +
    `${money(s.fund)} into <b>${compact(s.summary.home)}</b>. The same money in the S&amp;P 500 ${projecting() ? "could become" : "became"} ` +
    `${compact(s.summary.sp500)}${best === "home" ? "." : `, and ${winner} came out ahead.`}` +
    (s.summary.breakEvenYear && state.scenario !== "investor" ? ` Owning got cheaper than renting in ${s.summary.breakEvenYear}.` : "");
}

function renderMarkets() {
  const d = state.data, end = d.years.at(-1), L = labels(scen());
  $("#mktTitle").textContent = `${SCENARIO[state.scenario].short}: every market, ${d.years[0]}–${end}`;
  $("#mktHint").textContent = `Ending value in ${dollars()}, after selling costs. Click a row to chart that market.`;
  const rows = d.markets.map((m) => {
    const s = m.scenarios[state.scenario], x = s.summary;
    const best = Math.max(x.home, x.sp500, x.gold);
    const cell = (v, k) => `<td class="num${v === best ? " win" : ""}">${compact(v)}<span class="ref"> ${multiple(s.fund, v)}</span></td>`;
    return `<tr class="item-row" data-id="${m.id}" aria-selected="${m.id === state.market}">
      <td>${esc(m.name)}</td>
      <td class="num">${money(s.fund)}<span class="ref"> ${s.downPct}%</span></td>
      <td class="num">${compact(s.price)}${state.scenario === "investor" ? `<span class="ref"> ${esc(s.homeLabel.toLowerCase())}</span>` : ""}</td>
      ${cell(x.home, "home")}${cell(x.sp500, "sp500")}${cell(x.gold, "gold")}
      <td class="num">${x.breakEvenYear ?? "never"}</td>
    </tr>`;
  }).join("");
  $("#mktTable").innerHTML = `<thead><tr><th>Market</th><th>Down payment</th><th>Price</th>
    <th><span class="swatch" style="--c:${COLOR.home}"></span>${state.scenario === "investor" ? "Rental" : esc(L.home)}</th>
    <th><span class="swatch" style="--c:${COLOR.sp500}"></span>${esc(L.sp500)}</th>
    <th><span class="swatch" style="--c:${COLOR.gold}"></span>${esc(L.gold)}</th>
    <th>${state.scenario === "investor" ? "Cash-positive from" : "Owning cheaper from"}</th></tr></thead><tbody>${rows}</tbody>`;
  $("#mktTable").onclick = (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    state.market = tr.dataset.id;
    renderAll();
    $("#chart").scrollIntoView({ behavior: "smooth" });
  };
}

function renderPick() {
  const mk = market(), d = state.data;
  const chosen = mk.candidates.find((c) => c.chosen);
  $("#pickHint").textContent = `${mk.name}, ${d.years[0]}. The investor compares home types on cap rate: a year's rent, ` +
    `after vacancy, management, tax, insurance, maintenance and dues, as a share of the price. It is decided at the moment of ` +
    `purchase with the numbers available then, not with hindsight. Here that was the ${chosen.label.toLowerCase()}. ` +
    `Starter-home rent is modelled; the others are Zillow's rent for that kind of home.`;
  $("#pickTable").innerHTML = `<thead><tr><th>Home type</th><th>Price</th><th>Rent / month</th><th>Gross yield</th><th>Cap rate</th><th></th></tr></thead><tbody>` +
    mk.candidates.map((c) => `<tr${c.chosen ? ' class="chosen"' : ""}>
      <td>${esc(c.label)}${c.type === "starter" ? ' <span class="badge modelled">modelled rent</span>' : ""}</td>
      <td class="num">${money(c.price)}</td><td class="num">${money(c.rent)}</td>
      <td class="num">${c.grossYield.toFixed(1)}%</td><td class="num">${c.capRate.toFixed(1)}%</td>
      <td>${c.chosen ? '<span class="badge">bought</span>' : ""}</td></tr>`).join("") + "</tbody>";
}

function renderDefs() {
  const a = state.data.assumptions;
  const lim = a.loanLimits;
  $("#downRules").innerHTML = projecting()
    ? `<b>3%</b> with a Conventional 97 loan (Fannie Mae HomeReady / Freddie Mac Home Possible) for first-time buyers, when the loan fits under the ${money(lim.conformingBaseline)} conforming limit. Above it, <b>3.5%</b> with FHA, up to the ${money(lim.highCostCeiling)} high-cost ceiling. Above that a jumbo loan, typically <b>10%</b>. These are the 2026 limits. Both low-down loans carry mortgage insurance, modelled at ${a.mortgageInsurancePct}% a year until the balance falls to 78% of the price. Closing costs of about ${a.closingCostPct}% come on top${a.closingIncluded ? " and are counted in the starting fund" : "; they are switched off right now"}.`
    : `<b>3%</b>, with a 97% loan-to-value conventional mortgage, which Fannie Mae introduced for first-time buyers in 1994. Every 1995 starter home here falls under that year's ${money(lim.conformingBaseline)} conforming limit. The loan carries mortgage insurance, modelled at ${a.mortgageInsurancePct}% a year until the balance falls to 78% of the price. Closing costs of about ${a.closingCostPct}% come on top${a.closingIncluded ? " and are counted in the starting fund" : "; they are switched off right now"}.`;
  $("#roomShare").textContent = Math.round(a.roomShare * 100) + "%";
  $("#vacancy").textContent = a.vacancyPct + "%";
  $("#invDown").textContent = a.investorDownPct + "%";
  $("#invPrem").textContent = a.investorRatePremium.toFixed(3).replace(/0+$/, "");
  $("#mgmt").textContent = a.managementPct + "%";
  $("#sellCost").textContent = a.sellingCostPct + "%";
}

function renderProvenance() {
  const mk = market(), a = state.data.assumptions;
  const badge = (t) => `<span class="badge ${t === "sourced" ? "" : t === "modelled" ? "modelled" : "est"}">${t}</span>`;
  const rows = [
    ["sourced", "S&P 500", "Annual total return with dividends reinvested. Damodaran, NYU Stern, <i>Historical Returns on Stocks, Bonds, Bills, Real Estate and Gold</i>, January 2026 update."],
    ["sourced", "Gold", "Change in the year-end price per ounce, from the same Damodaran dataset. No storage or fund fees."],
    ["sourced", "Mortgage rates", "Freddie Mac Primary Mortgage Market Survey, 30-year fixed — the last reading of each December, the rate locked at purchase. No refinancing."],
    ["sourced", `${mk.short} home values, ${mk.homeFrom.starter}–${state.data.mode === "history" ? state.data.years.at(-1) : "today"}`, esc(mk.sources.home)],
    ["estimated", `${mk.short} home values before ${mk.homeFrom.starter}`, "Back-cast from Zillow's first month using the metro's Case-Shiller repeat-sales index (FHFA's for Dallas, which Case-Shiller only covers from 2000). These are shaded on the chart."],
    ["sourced", `${mk.short} rents, ${mk.rentFrom.all}–${state.data.mode === "history" ? state.data.years.at(-1) : "today"}`, esc(mk.sources.rent)],
    ["estimated", `${mk.short} rents before ${mk.rentFrom.all}`, "Zillow's first full year of rents, carried back by the BLS rent-of-primary-residence index for the metro. That index tracks every lease, not only new ones, so it moves more smoothly than asking rents did."],
    ["modelled", "Starter-home rent", `Zillow publishes no rent for the bottom third of homes. Starter rent = apartment rent × (starter value ÷ condo value)<sup>${a.starterRentElasticity}</sup>: apartments rent against condos, and rent rises more slowly than price.`],
    ["estimated", `${mk.short} costs`, `Property tax ${mk.taxRate}% of assessed value${mk.taxCap ? `, with assessment growth capped at ${mk.taxCap}% a year for owner-occupiers` : ""}; home insurance ${mk.insurance}% of value; maintenance ${a.maintenancePct}%; association dues 0–${a.hoaPct.condo}% depending on home type. Rounded county-level estimates.`],
    ["estimated", "Tax if you cash out", `Federal long-term capital gains at ${a.capitalGainsPct}% on stock gains and on home gains, after the ${money(a.homeSaleExclusion)} exclusion for a home you live in (single filer; $500,000 for a married couple). No state tax, no depreciation recapture on rentals. Shown in the ledger only; the charts are before tax.`],
    ["modelled", "House hack and rental income", `Rooms at ${Math.round(a.roomShare * 100)}% of whole-home rent each, ${a.vacancyPct}% vacancy, ${a.managementPct}% management on rentals. No income tax on rent, no depreciation.`],
  ];
  if (projecting()) {
    rows.push(["modelled", "The projection", `Every line grows at a constant rate from today's Zillow prices and rents. Home prices ${a.homeGrowth ?? "at each market's own 30-year rate"}${a.homeGrowth !== null ? "%/yr" : ""}, rents ${a.rentGrowth ?? "at each market's own 30-year rate"}${a.rentGrowth !== null ? "%/yr" : ""}, S&P 500 ${a.sp500.toFixed(1)}%, gold ${a.gold.toFixed(1)}%, inflation ${a.inflation.toFixed(1)}%. Real markets do not move in straight lines, and the order of good and bad years changes the result for anyone who buys, sells or contributes along the way.`]);
  }
  $("#prov").innerHTML = `<ul>${rows.map(([t, h, b]) => `<li>${badge(t)} <b>${h}.</b> ${b}</li>`).join("")}</ul>`;
}

function renderAssumptions() {
  const box = $("#assumptions");
  box.hidden = !projecting();
  if (!projecting()) return;
  const a = state.data.assumptions;
  const set = (id, v, ph) => { const i = $(id); if (document.activeElement !== i) i.value = v ?? ""; if (ph !== undefined) i.placeholder = ph; };
  set("#pYears", state.p.years);
  set("#pHome", state.p.home, market().growth.home.toFixed(1));
  set("#pRent", state.p.rent, market().growth.rent.toFixed(1));
  set("#pSp", state.p.sp ?? a.sp500.toFixed(1));
  set("#pGold", state.p.gold ?? a.gold.toFixed(1));
  set("#pRate", state.p.rate ?? state.data.ratePct);
  set("#pInfl", state.p.infl ?? a.inflation.toFixed(1));
  press("#presetSeg", state.preset);
  const asOf = state.data.asOf;
  $("#assumpNote").textContent = `Starts from Zillow prices and rents as of ${asOf.home.slice(0, 7)} and the ${asOf.rate} Freddie Mac rate. ` +
    `"Repeat the last 30 years" grows each line at its own 1995–2025 rate. Left blank, home prices and rents follow ${market().short}'s own 1995–2025 rates, shown greyed in the boxes.`;
}

/* ------------------------------------------------------------------- url */
function writeUrl() {
  const q = new URLSearchParams();
  if (state.market !== "us") q.set("m", state.market);
  if (state.scenario !== "owner") q.set("s", state.scenario);
  if (state.mode !== "history") q.set("view", state.mode);
  if (state.real) q.set("real", "1");
  if (state.scale !== "lin") q.set("scale", state.scale);
  if (!state.closing) q.set("closing", "0");
  if (state.costView !== "cash") q.set("cost", state.costView);
  if (projecting()) {
    if (state.p.years !== 30) q.set("years", state.p.years);
    for (const k of ["home", "rent", "sp", "gold", "rate", "infl"]) if (state.p[k] !== null) q.set(k, state.p[k]);
  }
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) q.set("theme", theme);
  const qs = q.toString();
  history.replaceState(null, "", qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get("m")) state.market = q.get("m");
  if (["owner", "hack", "investor"].includes(q.get("s"))) state.scenario = q.get("s");
  if (q.get("view") === "projection") state.mode = "projection";
  state.real = q.get("real") === "1";
  if (q.get("scale") === "log") state.scale = "log";
  if (q.get("closing") === "0") state.closing = false;
  if (q.get("cost") === "gone") state.costView = "gone";
  const n = Number(q.get("years"));
  if (q.has("years") && n >= 5 && n <= 40) state.p.years = Math.trunc(n);
  for (const k of ["home", "rent", "sp", "gold", "rate", "infl"]) {
    if (q.has(k) && q.get(k) !== "" && Number.isFinite(Number(q.get(k)))) state.p[k] = Number(q.get(k));
  }
  const cautious = PRESETS.cautious;
  if (["home", "rent", "sp", "gold", "infl"].every((k) => state.p[k] === cautious[k])) state.preset = "cautious";
  else if (["home", "rent", "sp", "gold", "infl"].some((k) => state.p[k] !== null)) state.preset = null;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 2200);
}

/* ------------------------------------------------------------------ wiring */
function drawAll() { if (state.data) { drawGrowth(); drawCosts(); } }

function renderAll() {
  if (!state.data.markets.some((m) => m.id === state.market)) state.market = "us";
  writeUrl();
  renderMarketPicker();
  renderAssumptions();
  renderTiles();
  drawAll();
  renderPull();
  renderLedger();
  renderMarkets();
  renderPick();
  renderDefs();
  renderProvenance();
}

function wire() {
  const stamped = document.documentElement.getAttribute("data-theme") || "system";
  press("#themeSeg", stamped);
  seg("#themeSeg", applyTheme);
  press("#scenarioSeg", state.scenario);
  press("#modeSeg", state.mode);
  press("#realSeg", state.real ? "1" : "0");
  press("#scaleSeg", state.scale);
  seg("#scenarioSeg", (v) => { state.scenario = v; renderAll(); });
  seg("#modeSeg", (v) => { state.mode = v; load(); });
  seg("#realSeg", (v) => { state.real = v === "1"; load(); });
  seg("#scaleSeg", (v) => { state.scale = v; writeUrl(); drawGrowth(); });
  press("#closingSeg", state.closing ? "1" : "0");
  press("#costSeg", state.costView);
  seg("#closingSeg", (v) => { state.closing = v === "1"; load(); });
  seg("#costSeg", (v) => { state.costView = v; writeUrl(); drawCosts(); });
  wireLedgerTips();
  seg("#presetSeg", (v) => {
    state.preset = v;
    Object.assign(state.p, PRESETS[v]);
    load();
  });

  let t;
  const fields = { "#pYears": "years", "#pHome": "home", "#pRent": "rent", "#pSp": "sp", "#pGold": "gold", "#pRate": "rate", "#pInfl": "infl" };
  for (const [sel, k] of Object.entries(fields)) {
    $(sel).addEventListener("input", (e) => {
      const raw = e.target.value.trim();
      const v = raw === "" ? null : Number(raw);
      if (raw !== "" && !Number.isFinite(v)) return;
      state.p[k] = k === "years" ? Math.max(5, Math.min(40, Math.trunc(v ?? 30))) : v;
      state.preset = null;
      press("#presetSeg", "");
      clearTimeout(t);
      t = setTimeout(load, 250);
    });
  }

  $("#shareBtn").onclick = async () => {
    writeUrl();
    try { await navigator.clipboard.writeText(location.href); toast("Link copied — it opens on this exact view"); }
    catch { toast("Copy failed — the link is in your address bar"); }
  };

  let r;
  addEventListener("resize", () => { clearTimeout(r); r = setTimeout(drawAll, 120); });
}

async function boot() {
  readUrl();
  wire();
  const [hist] = await Promise.all([fetch(query("history", false)).then((r) => r.json()), load()]);
  state.history = hist;
  renderHero();
}
boot();
