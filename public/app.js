// Colour is bound to the asset, permanently — filtering the chart never repaints the survivors.
// Traditional assets take slots 1-4 solid; luxury takes slots 1-8 dashed, so the asset class is
// carried by a second channel rather than by hue alone.
const STYLE = {
  sp500:     { c: "var(--s1)", dash: "" },
  housing:   { c: "var(--s2)", dash: "" },
  gold:      { c: "var(--s3)", dash: "" },
  cash:      { c: "var(--s4)", dash: "" },
  watches:   { c: "var(--s1)", dash: "7 4" },
  handbags:  { c: "var(--s2)", dash: "7 4" },
  jewellery: { c: "var(--s3)", dash: "7 4" },
  cars:      { c: "var(--s4)", dash: "7 4" },
  art:       { c: "var(--s5)", dash: "7 4" },
  wine:      { c: "var(--s6)", dash: "7 4" },
  whisky:    { c: "var(--s7)", dash: "7 4" },
  diamonds:  { c: "var(--s8)", dash: "7 4" },
};
const MAX_SERIES = 8;
const SVG = "http://www.w3.org/2000/svg";

const state = {
  from: 2005, to: 2024, real: false, amount: 10000, scale: "lin",
  picked: new Set(["sp500", "gold", "housing", "cash", "whisky", "watches"]),
  sort: { key: "cagrPct", dir: -1 },
  data: null,
};

const $ = (s) => document.querySelector(s);
const el = (t, a = {}) => {
  const n = document.createElementNS(SVG, t);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
  return n;
};
const money = (v) =>
  v >= 1000 ? "$" + Math.round(v).toLocaleString() : "$" + v.toFixed(0);
const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return "$" + Math.round(v / 1e3) + "k";
  return "$" + Math.round(v);
};
const pct = (v, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";

/* ---------------------------------------------------------------- fetching */
async function load() {
  const q = new URLSearchParams({
    from: state.from, to: state.to,
    real: state.real ? "1" : "0", amount: state.amount,
  });
  const r = await fetch("/api/analysis?" + q);
  state.data = await r.json();
  renderAll();
}

/* ------------------------------------------------------------------ chrome */
function buildYearSelects() {
  const from = $("#from"), to = $("#to");
  for (let y = 2005; y <= 2024; y++) from.append(new Option(y, y, false, y === state.from));
  for (let y = 2006; y <= 2025; y++) to.append(new Option(y === 2025 ? "2025 (provisional)" : y, y, false, y === state.to));
  from.onchange = () => { state.from = +from.value; if (state.to <= state.from) { state.to = state.from + 1; to.value = state.to; } load(); };
  to.onchange = () => { state.to = +to.value; if (state.to <= state.from) { state.from = state.to - 1; from.value = state.from; } load(); };
  $("#amount").onchange = (e) => { state.amount = Math.max(1, +e.target.value || 10000); load(); };
  seg("#realSeg", (v) => { state.real = v === "1"; load(); });
  seg("#scaleSeg", (v) => { state.scale = v; drawGrowth(); });
  seg("#themeSeg", applyTheme);

  // Reflect the theme already stamped by the pre-paint script.
  const stamped = document.documentElement.getAttribute("data-theme") || "system";
  for (const b of $("#themeSeg").children) b.setAttribute("aria-pressed", String(b.dataset.v === stamped));
}
function applyTheme(v) {
  if (v === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", v);
  // Storage can throw in a private window; the theme still applies for this page view.
  try { v === "system" ? localStorage.removeItem("boujee-theme") : localStorage.setItem("boujee-theme", v); } catch (e) {}
  drawGrowth(); drawBars(); // series colours are CSS vars resolved at draw time
  if (itemState.all.length) renderItems();
}

function seg(sel, fn) {
  const box = $(sel);
  box.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    [...box.children].forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    fn(b.dataset.v);
  };
}

function renderPicker() {
  const box = $("#picker");
  box.innerHTML = "";
  for (const a of state.data.assets) {
    const on = state.picked.has(a.id);
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.style.setProperty("--c", STYLE[a.id].c);
    b.setAttribute("aria-pressed", String(on));
    b.disabled = !on && state.picked.size >= MAX_SERIES;
    b.innerHTML = `<span class="dot"></span>${a.name}`;
    b.onclick = () => {
      if (on) { if (state.picked.size > 1) state.picked.delete(a.id); }
      else if (state.picked.size < MAX_SERIES) state.picked.add(a.id);
      renderPicker(); drawGrowth();
    };
    box.append(b);
  }
}

/* ------------------------------------------------------- growth line chart */
function drawGrowth() {
  const svg = $("#growth");
  svg.innerHTML = "";
  const d = state.data;
  const series = d.assets.filter((a) => state.picked.has(a.id));
  if (!series.length) return;

  const W = Math.max(svg.clientWidth || 640, 560), H = 360;
  const m = { t: 14, r: 88, b: 30, l: 60 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);

  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const years = d.years;
  const lo = Math.min(...series.flatMap((s) => s.values));
  const hi = Math.max(...series.flatMap((s) => s.values));
  const logMode = state.scale === "log";

  const yMin = logMode ? Math.max(lo * 0.85, 1) : Math.min(lo * 0.9, state.amount * 0.9);
  const yMax = hi * 1.06;
  const ty = (v) => (logMode ? Math.log10(Math.max(v, 1)) : v);
  const y = (v) => m.t + ih - ((ty(v) - ty(yMin)) / (ty(yMax) - ty(yMin))) * ih;
  const x = (i) => m.l + (years.length === 1 ? 0 : (i / (years.length - 1)) * iw);

  // gridlines + y ticks
  const ticks = logMode ? logTicks(yMin, yMax) : linTicks(yMin, yMax, 5);
  for (const v of ticks) {
    svg.append(el("line", { class: "grid-line", x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }));
    const t = el("text", { class: "tick", x: m.l - 9, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = compact(v);
    svg.append(t);
  }
  svg.append(el("line", { class: "axis-line", x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));

  // x ticks — thin them out so labels never collide
  const step = Math.ceil(years.length / 10);
  const last = years.length - 1;
  // Label every `step`-th year plus the final one, dropping any regular tick that would
  // crowd the final label.
  const marks = [];
  for (let i = 0; i < last; i += step) if (last - i >= step) marks.push(i);
  marks.push(last);
  for (const i of marks) {
    const t = el("text", { class: "tick", x: x(i), y: H - 9, "text-anchor": "middle" });
    t.textContent = years[i];
    svg.append(t);
  }

  // lines
  for (const s of series) {
    const dstr = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    svg.append(el("path", {
      class: "series-line", d: dstr, stroke: STYLE[s.id].c,
      ...(STYLE[s.id].dash ? { "stroke-dasharray": STYLE[s.id].dash } : {}),
    }));
  }

  // Direct end-labels when the field is small enough to stay legible; the legend and the
  // table below carry identity in every case.
  if (series.length <= 4) {
    const placed = [];
    for (const s of [...series].sort((a, b) => b.values.at(-1) - a.values.at(-1))) {
      let yy = y(s.values.at(-1)) + 4;
      while (placed.some((p) => Math.abs(p - yy) < 14)) yy += 14;
      placed.push(yy);
      const t = el("text", { class: "end-label", x: m.l + iw + 8, y: yy, fill: STYLE[s.id].c });
      t.textContent = s.name;
      svg.append(t);
    }
  }

  attachCrosshair(svg, { series, years, x, y, m, ih, W, iw });
  renderLegend(series);
}

function linTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) ?? mag * 10;
  const out = [];
  // Float steps accumulate error, so index off the start rather than adding repeatedly.
  const start = Math.ceil(lo / step) * step;
  for (let i = 0; start + i * step <= hi + 1e-9; i++) out.push(start + i * step);
  // A 2.5 step printed at zero decimals reads "0,3,5,8,10" — carry the step's own precision.
  out.step = step;
  out.decimals = step >= 1 && Math.abs(step % 1) < 1e-9 ? 0 : 1;
  return out;
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const k of [1, 2, 5]) {
      const v = k * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  return out;
}

function attachCrosshair(svg, ctx) {
  const { series, years, x, y, m, ih, iw } = ctx;
  const line = el("line", { class: "crosshair", y1: m.t, y2: m.t + ih, opacity: 0 });
  svg.append(line);
  const dots = series.map((s) => {
    const c = el("circle", { r: 4.5, fill: STYLE[s.id].c, stroke: "var(--surface-1)", "stroke-width": 2, opacity: 0 });
    svg.append(c);
    return c;
  });
  const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" });
  svg.append(hit);
  const tip = $("#tip");

  hit.addEventListener("mousemove", (ev) => {
    const box = svg.getBoundingClientRect();
    const rel = ((ev.clientX - box.left) / box.width) * (svg.viewBox.baseVal.width || box.width);
    const i = Math.max(0, Math.min(years.length - 1, Math.round(((rel - m.l) / iw) * (years.length - 1))));
    line.setAttribute("x1", x(i)); line.setAttribute("x2", x(i)); line.setAttribute("opacity", 1);
    series.forEach((s, k) => {
      dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(s.values[i])); dots[k].setAttribute("opacity", 1);
    });
    const rows = [...series].sort((a, b) => b.values[i] - a.values[i]).map((s) =>
      `<div class="row"><span class="nm" style="--c:${STYLE[s.id].c}"><span class="sw"></span>${s.name}</span><b>${money(s.values[i])}</b></div>`).join("");
    tip.innerHTML = `<h4>${years[i]}${years[i] >= state.data.provisionalFrom ? " · provisional" : ""}</h4>${rows}`;
    tip.classList.add("on");
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(ev.clientX + 16, innerWidth - w - 8) + "px";
    tip.style.top = Math.max(8, Math.min(ev.clientY - h / 2, innerHeight - h - 8)) + "px";
  });
  hit.addEventListener("mouseleave", () => {
    line.setAttribute("opacity", 0);
    dots.forEach((d) => d.setAttribute("opacity", 0));
    tip.classList.remove("on");
  });
}

function renderLegend(series) {
  $("#growthLegend").innerHTML = series.map((s) =>
    `<span style="--c:${STYLE[s.id].c}"><i style="${STYLE[s.id].dash ? "border-top-style:dashed" : ""}"></i>${s.name}</span>`).join("");
}

/* --------------------------------------------------------- CAGR bar chart */
function drawBars() {
  const svg = $("#bars");
  svg.innerHTML = "";
  const rows = [...state.data.assets].sort((a, b) => b.cagrPct - a.cagrPct);
  const W = Math.max(svg.clientWidth || 640, 560);
  const rowH = 28, m = { t: 8, r: 64, b: 24, l: 132 };
  const H = m.t + rows.length * rowH + m.b;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  const iw = W - m.l - m.r;

  const lo = Math.min(0, ...rows.map((r) => r.cagrPct));
  const hi = Math.max(0, ...rows.map((r) => r.cagrPct));
  const x = (v) => m.l + ((v - lo) / (hi - lo || 1)) * iw;
  const zero = x(0);

  const bticks = linTicks(lo, hi, 5);
  for (const v of bticks) {
    svg.append(el("line", { class: "grid-line", x1: x(v), x2: x(v), y1: m.t, y2: m.t + rows.length * rowH }));
    const t = el("text", { class: "tick", x: x(v), y: H - 8, "text-anchor": "middle" });
    t.textContent = v.toFixed(bticks.decimals) + "%";
    svg.append(t);
  }
  svg.append(el("line", { class: "axis-line", x1: zero, x2: zero, y1: m.t, y2: m.t + rows.length * rowH }));

  const tip = $("#tip");
  rows.forEach((r, i) => {
    const bh = rowH - 10; // leaves a 2px+ surface gap between adjacent bars
    const top = m.t + i * rowH + 5;
    const g = el("g", { style: "cursor:default" });
    const lab = el("text", { class: "tick", x: m.l - 10, y: top + bh / 2 + 4, "text-anchor": "end", fill: "var(--text-secondary)" });
    lab.textContent = r.name;
    g.append(lab);
    const col = r.class === "traditional" ? "var(--s1)" : "var(--s2)";
    g.append(el("path", { d: barPath(zero, x(r.cagrPct), top, bh, 4), fill: col }));
    const val = el("text", {
      class: "end-label", y: top + bh / 2 + 4,
      x: r.cagrPct >= 0 ? x(r.cagrPct) + 8 : x(r.cagrPct) - 8,
      "text-anchor": r.cagrPct >= 0 ? "start" : "end",
    });
    val.textContent = pct(r.cagrPct);
    g.append(val);
    const hit = el("rect", { x: 0, y: m.t + i * rowH, width: W, height: rowH, fill: "transparent" });
    g.append(hit);
    hit.addEventListener("mousemove", (ev) => {
      tip.innerHTML = `<h4>${r.name} · ${r.class}</h4>
        <div class="row"><span class="nm">Annualised</span><b>${pct(r.cagrPct)}</b></div>
        <div class="row"><span class="nm">${money(state.amount)} becomes</span><b>${money(r.values.at(-1))}</b></div>
        <div class="row"><span class="nm">Max drawdown</span><b>${r.maxDrawdownPct.toFixed(1)}%</b></div>
        <div class="row"><span class="nm">vs. cash</span><b>${(r.vsCash >= 0 ? "+" : "−") + money(Math.abs(r.vsCash))}</b></div>`;
      tip.classList.add("on");
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(ev.clientX + 16, innerWidth - w - 8) + "px";
      tip.style.top = Math.max(8, Math.min(ev.clientY - h / 2, innerHeight - h - 8)) + "px";
    });
    hit.addEventListener("mouseleave", () => tip.classList.remove("on"));
    svg.append(g);
  });
}

/** Bar with the data end rounded and the baseline end square. */
function barPath(x0, x1, y, h, r) {
  const w = Math.abs(x1 - x0);
  const rr = Math.min(r, w);
  if (w < 0.5) return `M${x0},${y}L${x0},${y + h}`;
  return x1 >= x0
    ? `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 - rr},${y + h}H${x0}Z`
    : `M${x0},${y}H${x1 + rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 + rr},${y + h}H${x0}Z`;
}

/* ------------------------------------------------------------ hero + tiles */
function renderHero() {
  const d = state.data;
  const ranked = [...d.assets].sort((a, b) => b.cagrPct - a.cagrPct);
  const lux = ranked.filter((a) => a.class === "luxury");
  const sp = d.assets.find((a) => a.id === "sp500");
  const topLux = lux[0];
  const beat = lux.filter((a) => a.cagrPct > sp.cagrPct).length;

  $("#heroFig").textContent = `${beat} of ${lux.length}`;
  $("#heroCap").innerHTML =
    `luxury categories beat the S&P 500 over ${d.from}–${d.to}${state.real ? ", after inflation" : ""}. ` +
    `The best was <b>${topLux.name}</b> at ${pct(topLux.cagrPct)} a year; the S&P managed ${pct(sp.cagrPct)}.`;

  const winner = ranked[0], loser = ranked.at(-1);
  $("#tiles").innerHTML = [
    ["Best overall", winner.name, `${money(winner.values.at(-1))} from ${money(state.amount)}`],
    ["Worst overall", loser.name, `${money(loser.values.at(-1))} from ${money(state.amount)}`],
    ["Steadiest", [...d.assets].sort((a, b) => a.volatilityPct - b.volatilityPct)[0].name,
      `lowest year-to-year swing`],
    [state.real ? "Inflation" : "Inflation over window", pct(d.cpi.cumulativePct, 0),
      `${pct(d.cpi.cagrPct)} a year`],
  ].map(([k, v, s]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${s}</div></div>`).join("");
}

/* ------------------------------------------------------------------ table */
const cls = (v) => (Math.abs(v) < 0.05 ? "" : v > 0 ? "pos" : "neg");
const signed = (v, d = 1) => `<span class="${cls(v)}">${pct(v, d)}</span>`;
const signed2 = (v) => {
  if (Math.abs(v) < 0.5) return `<span class="">$0</span>`;
  return `<span class="${cls(v)}">${v > 0 ? "+" : "−"}${money(Math.abs(v))}</span>`;
};
const COLS = [
  { k: "name", t: "Asset", fmt: (r) => `<span class="swatch" style="--c:${STYLE[r.id].c}"></span>${r.name}`, num: false },
  { k: "cagrPct", t: "Per year", fmt: (r) => signed(r.cagrPct) },
  { k: "totalReturnPct", t: "Total", fmt: (r) => signed(r.totalReturnPct, 0) },
  { k: "endValue", t: "Ending value", fmt: (r) => money(r.values.at(-1)) },
  { k: "vsCash", t: "vs. cash", fmt: (r) => signed2(r.vsCash) },
  { k: "volatilityPct", t: "Volatility", fmt: (r) => r.volatilityPct.toFixed(1) },
  { k: "maxDrawdownPct", t: "Max drawdown", fmt: (r) => r.maxDrawdownPct.toFixed(1) + "%" },
  { k: "bestYear", t: "Best year", fmt: (r) => `${r.bestYear.year} ${signed(r.bestYear.pct, 0)}` },
  { k: "worstYear", t: "Worst year", fmt: (r) => `${r.worstYear.year} ${signed(r.worstYear.pct, 0)}` },
];
const sortVal = (r, k) =>
  k === "endValue" ? r.values.at(-1) : k === "bestYear" ? r.bestYear.pct : k === "worstYear" ? r.worstYear.pct : r[k];

function renderTable() {
  const t = $("#table");
  const rows = [...state.data.assets].sort((a, b) => {
    const { key, dir } = state.sort;
    if (key === "name") return a.name.localeCompare(b.name) * dir;
    return (sortVal(a, key) - sortVal(b, key)) * dir;
  });
  t.innerHTML =
    `<thead><tr>${COLS.map((c) => {
      const on = state.sort.key === c.k;
      return `<th data-k="${c.k}" style="cursor:pointer" aria-sort="${on ? (state.sort.dir < 0 ? "descending" : "ascending") : "none"}">${c.t}${on ? (state.sort.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
    }).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) =>
      `<tr>${COLS.map((c) => `<td class="${c.num === false ? "" : "num"}">${c.fmt(r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  t.querySelectorAll("th").forEach((th) => th.onclick = () => {
    const k = th.dataset.k;
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === "name" ? 1 : -1 };
    renderTable();
  });
}

/* ------------------------------------------------------------- provenance */
async function renderProvenance() {
  const rows = await (await fetch("/api/provenance")).json();
  $("#prov").innerHTML =
    `<p style="color:var(--text-secondary);margin-top:0">The traditional series are real published data.
      The luxury series are <b>reconstructions</b> — they track the shape and the long-run magnitude of
      published luxury indices, but the individual annual figures are estimates, not sourced values.
      Treat the luxury lines as a well-informed sketch, not a price feed. Every number lives in
      <code>data/assets.json</code>; correct one and re-seed.</p>
     <ul style="padding-left:18px">${rows.map((r) => `
      <li><b>${r.name}</b> <span class="badge ${r.confidence === "estimated" ? "est" : ""}">${r.confidence === "estimated" ? "estimated" : "sourced"}</span><br>
        ${r.blurb ? r.blurb + " " : ""}<em>${r.source}.</em>
        ${r.caveat ? `<br><span style="color:var(--muted)">${r.caveat}</span>` : ""}</li>`).join("")}</ul>`;
}

/* -------------------------------------------------------------------- boot */
function renderAll() {
  renderHero(); renderPicker(); drawGrowth(); drawBars(); renderTable();
  $("#growthHint").textContent =
    `${state.real ? "Inflation-adjusted" : "Nominal"} value of ${money(state.amount)} invested at the start of ${state.data.from}. ` +
    `Solid lines are traditional assets, dashed are luxury. Pick up to ${MAX_SERIES}.`;
}
let t;
addEventListener("resize", () => {
  clearTimeout(t);
  t = setTimeout(() => { drawGrowth(); drawBars(); if (itemState.all.length) renderItems(); }, 120);
});

/* ============================================================== items view */
// Item fields can be user-supplied, so everything interpolated into markup is escaped.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ITEM_COLOR = { resale: "var(--s1)", retail: "var(--s2)" };
const itemState = { kind: "resale", cat: "", query: "", selected: null, all: [] };

async function loadItems() {
  itemState.all = await (await fetch("/api/items")).json();
  const sel = $("#catSel");
  const cats = [...new Map(itemState.all.map((i) => [i.category, i.categoryName])).entries()];
  sel.innerHTML = `<option value="">All categories</option>` +
    cats.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join("");
  sel.onchange = () => { itemState.cat = sel.value; renderItems(); };
  seg("#kindSeg", (v) => { itemState.kind = v; itemState.selected = null; renderItems(); });
  renderItems();
}

function visibleItems() {
  const q = itemState.query.trim().toLowerCase();
  return itemState.all
    .filter((i) => i.kind === itemState.kind)
    .filter((i) => !itemState.cat || i.category === itemState.cat)
    .filter((i) => !q || [i.name, i.brand, i.ref, i.categoryName].join(" ").toLowerCase().includes(q))
    .sort((a, b) => b.edgePct - a.edgePct);
}

function renderItems() {
  const rows = visibleItems();
  const retail = itemState.kind === "retail";
  $("#itemHint").textContent = retail
    ? "What the boutique charges. A rising retail price is what the object costs you, not what you earn — so it is measured against inflation."
    : "What you could sell it for. This is the investment question, so it is measured against the S&P 500 over each item's own span.";
  $("#itemLegend").innerHTML =
    `<span style="--c:${ITEM_COLOR[itemState.kind]}"><i style="border-top-width:0;width:11px;height:11px;border-radius:50%;background:var(--c)"></i>The object</span>` +
    `<span><i class="ring"></i>${retail ? "US inflation" : "S&amp;P 500"}, same years</span>` +
    `<span style="color:var(--muted)">Labels show the gap in percentage points per year.</span>`;
  drawDumbbell(rows);
  renderItemTable(rows);
  renderItemDetail();
}

function drawDumbbell(rows) {
  const svg = $("#dumbbell");
  svg.innerHTML = "";
  if (!rows.length) { svg.setAttribute("height", 0); return; }

  const W = Math.max(svg.clientWidth || 640, 620);
  const rowH = 34, m = { t: 10, r: 108, b: 26, l: 210 };
  const H = m.t + rows.length * rowH + m.b;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  const iw = W - m.l - m.r;

  const vals = rows.flatMap((r) => [r.cagrPct, r.benchmarkCagrPct]);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.04;
  const x = (v) => m.l + ((v - lo) / (hi - lo || 1)) * iw;

  const ticks = linTicks(lo, hi, 5);
  for (const v of ticks) {
    svg.append(el("line", { class: "grid-line", x1: x(v), x2: x(v), y1: m.t, y2: m.t + rows.length * rowH }));
    const t = el("text", { class: "tick", x: x(v), y: H - 8, "text-anchor": "middle" });
    t.textContent = v.toFixed(ticks.decimals) + "%";
    svg.append(t);
  }

  const tip = $("#tip");
  rows.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    const g = el("g");
    const lab = el("text", { class: "tick", x: m.l - 12, y: cy + 4, "text-anchor": "end", fill: "var(--text-secondary)" });
    lab.textContent = r.name.length > 26 ? r.name.slice(0, 25) + "…" : r.name;
    g.append(lab);

    g.append(el("line", { class: "dumbbell-link", x1: x(r.benchmarkCagrPct), x2: x(r.cagrPct), y1: cy, y2: cy }));
    g.append(el("circle", { class: "bench-dot", cx: x(r.benchmarkCagrPct), cy, r: 5 }));
    g.append(el("circle", { cx: x(r.cagrPct), cy, r: 5.5, fill: ITEM_COLOR[r.kind], stroke: "var(--surface-1)", "stroke-width": 2 }));

    const right = Math.max(x(r.cagrPct), x(r.benchmarkCagrPct)) + 10;
    const v = el("text", { class: "end-label", x: right, y: cy + 4 });
    v.textContent = `${r.edgePct >= 0 ? "+" : "−"}${Math.abs(r.edgePct).toFixed(1)} pp`;
    v.setAttribute("fill", Math.abs(r.edgePct) < 0.05 ? "var(--text-primary)" : r.edgePct > 0 ? "var(--good)" : "var(--bad)");
    g.append(v);

    const hit = el("rect", { x: 0, y: m.t + i * rowH, width: W, height: rowH, fill: "transparent", style: "cursor:pointer" });
    hit.addEventListener("mousemove", (ev) => {
      tip.innerHTML = `<h4>${esc(r.brand)} ${esc(r.name)}</h4>
        <div class="row"><span class="nm">${esc(r.firstYear)}–${esc(r.lastYear)}</span><b>${money(r.firstPrice)} → ${money(r.lastPrice)}</b></div>
        <div class="row"><span class="nm">The object</span><b>${pct(r.cagrPct)}/yr</b></div>
        <div class="row"><span class="nm">${esc(r.benchmarkName)}</span><b>${pct(r.benchmarkCagrPct)}/yr</b></div>
        <div class="row"><span class="nm">Difference</span><b>${r.edgePct >= 0 ? "+" : ""}${r.edgePct.toFixed(1)} pp/yr</b></div>`;
      tip.classList.add("on");
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(ev.clientX + 16, innerWidth - w - 8) + "px";
      tip.style.top = Math.max(8, Math.min(ev.clientY - h / 2, innerHeight - h - 8)) + "px";
    });
    hit.addEventListener("mouseleave", () => tip.classList.remove("on"));
    hit.addEventListener("click", () => { itemState.selected = r.id; renderItems(); });
    g.append(hit);
    svg.append(g);
  });
}

const CONF_LABEL = { high: "sourced", medium: "reported", estimated: "estimated" };

function renderItemTable(rows) {
  const t = $("#itemTable");
  if (!rows.length) {
    t.innerHTML = `<tbody><tr><td class="empty">No models match. Add one below.</td></tr></tbody>`;
    return;
  }
  const benchHead = itemState.kind === "retail" ? "Inflation" : "S&amp;P 500";
  t.innerHTML =
    `<thead><tr><th>Model</th><th>Years</th><th>Then</th><th>Now</th><th>Per year</th>
      <th>${benchHead}</th><th>Difference</th><th>Data</th></tr></thead><tbody>` +
    rows.map((r) => `
      <tr class="item-row" data-id="${esc(r.id)}" aria-selected="${itemState.selected === r.id}">
        <td><span class="swatch" style="--c:${ITEM_COLOR[r.kind]}"></span>${esc(r.name)}
            <div class="ref">${esc(r.ref)}</div></td>
        <td class="num">${esc(r.firstYear)}–${esc(r.lastYear)}</td>
        <td class="num">${money(r.firstPrice)}</td>
        <td class="num">${money(r.lastPrice)}</td>
        <td class="num">${signed(r.cagrPct)}</td>
        <td class="num">${pct(r.benchmarkCagrPct)}</td>
        <td class="num">${signed(r.edgePct)}</td>
        <td><span class="badge ${r.confidence === "high" ? "" : "est"}">${CONF_LABEL[r.confidence] ?? esc(r.confidence)}</span>
            ${r.origin === "user" ? `<span class="badge">added here</span>` : ""}</td>
      </tr>`).join("") + "</tbody>";
  t.querySelectorAll("tr.item-row").forEach((tr) => tr.onclick = () => {
    itemState.selected = itemState.selected === tr.dataset.id ? null : tr.dataset.id;
    renderItems();
  });
}

function renderItemDetail() {
  const box = $("#itemDetail");
  const r = itemState.all.find((i) => i.id === itemState.selected);
  if (!r) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="detail">
      <h3>${esc(r.name)}</h3>
      <p class="meta">${esc(r.ref)} · ${esc(r.categoryName)} · ${r.kind === "retail" ? "retail price" : "resale value"}
        · <span class="badge ${r.confidence === "high" ? "" : "est"}">${CONF_LABEL[r.confidence] ?? esc(r.confidence)}</span></p>
      ${r.blurb ? `<p style="margin:0 0 12px">${esc(r.blurb)}</p>` : ""}
      <div class="chart-scroll"><svg id="itemPath" class="chart"></svg></div>
      <p class="caveat"><b>Source:</b> ${esc(r.source)}${r.caveat ? `<br><b>Caveat:</b> ${esc(r.caveat)}` : ""}</p>
    </div>`;
  drawItemPath(r);
}

function drawItemPath(r) {
  const svg = $("#itemPath");
  const W = Math.max(svg.clientWidth || 600, 560), H = 240;
  const m = { t: 16, r: 20, b: 30, l: 72 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const ys = r.points.map((p) => p.year), ps = r.points.map((p) => p.price);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  // Prices here span four orders of magnitude across items; a wide range needs a log axis.
  const useLog = Math.max(...ps) / Math.min(...ps) > 40;
  const lo = Math.min(...ps) * 0.9, hi = Math.max(...ps) * 1.08;
  const ty = (v) => (useLog ? Math.log10(v) : v);
  const X = (yr) => m.l + ((yr - y0) / (y1 - y0 || 1)) * iw;
  const Y = (v) => m.t + ih - ((ty(v) - ty(lo)) / (ty(hi) - ty(lo))) * ih;

  const ticks = useLog ? logTicks(lo, hi) : linTicks(lo, hi, 4);
  for (const v of ticks) {
    svg.append(el("line", { class: "grid-line", x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v) }));
    const t = el("text", { class: "tick", x: m.l - 9, y: Y(v) + 4, "text-anchor": "end" });
    t.textContent = compact(v);
    svg.append(t);
  }
  svg.append(el("line", { class: "axis-line", x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));

  svg.append(el("path", {
    class: "series-line", stroke: ITEM_COLOR[r.kind],
    d: r.points.map((p, i) => `${i ? "L" : "M"}${X(p.year).toFixed(1)},${Y(p.price).toFixed(1)}`).join(""),
  }));

  const tip = $("#tip");
  for (const p of r.points) {
    const c = el("circle", { class: "anchor-dot", cx: X(p.year), cy: Y(p.price), r: 5, stroke: ITEM_COLOR[r.kind] });
    const hit = el("circle", { cx: X(p.year), cy: Y(p.price), r: 13, fill: "transparent" });
    hit.addEventListener("mousemove", (ev) => {
      tip.innerHTML = `<h4>${esc(p.year)}</h4><div class="row"><span class="nm">Price</span><b>${money(p.price)}</b></div>`;
      tip.classList.add("on");
      tip.style.left = Math.min(ev.clientX + 16, innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = Math.max(8, ev.clientY - tip.offsetHeight / 2) + "px";
    });
    hit.addEventListener("mouseleave", () => tip.classList.remove("on"));
    svg.append(c); svg.append(hit);
  }
  for (const yr of [y0, y1]) {
    const t = el("text", { class: "tick", x: X(yr), y: H - 9, "text-anchor": "middle" });
    t.textContent = yr;
    svg.append(t);
  }
  const note = el("text", { class: "tick", x: m.l, y: m.t - 4, fill: "var(--muted)" });
  note.textContent = `${r.points.length} priced years · the line between them is interpolation`;
  svg.append(note);
}

/* -------------------------------------------------------------------- boot */
// Last in the file: the items module below declares consts that these calls reach,
// and a const is not initialised until its declaration is evaluated.
buildYearSelects();
renderProvenance();
loadItems();
load();
