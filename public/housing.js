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
    [`${money(us.fund)}`, `the national minimum down payment on a starter home in 1995 — ${money(us.price)} at 3% down`],
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
    tile("Starting fund", money(s.fund), `${s.downPct}% down · ${esc(s.product)}`),
    tile(state.scenario === "investor" ? "Rental bought" : "Home price", money(s.price),
      `${esc(s.homeLabel)}, end of ${d.years[0]}`),
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
  lineChart($("#costs"), d.years, series, { from: 1, zero: true, height: 300 });
  legend("#costLegend", series);
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
    ? `<b>3%</b> with a Conventional 97 loan (Fannie Mae HomeReady / Freddie Mac Home Possible) for first-time buyers, when the loan fits under the ${money(lim.conformingBaseline)} conforming limit. Above it, <b>3.5%</b> with FHA, up to the ${money(lim.highCostCeiling)} high-cost ceiling. Above that a jumbo loan, typically <b>10%</b>. These are the 2026 limits. Both low-down loans carry mortgage insurance, modelled at ${a.mortgageInsurancePct}% a year until the balance falls to 78% of the price.`
    : `<b>3%</b>, with a 97% loan-to-value conventional mortgage, which Fannie Mae introduced for first-time buyers in 1994. Every 1995 starter home here falls under that year's ${money(lim.conformingBaseline)} conforming limit. The loan carries mortgage insurance, modelled at ${a.mortgageInsurancePct}% a year until the balance falls to 78% of the price. Closing costs come on top and are not included.`;
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
