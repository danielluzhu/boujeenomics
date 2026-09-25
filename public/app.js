// Colour is bound to the asset, permanently — filtering the chart never repaints the survivors.
// Traditional assets take slots 1-4 solid; luxury takes slots 1-8 dashed, so the asset class is
// carried by a second channel rather than by hue alone.
// Hue is allocated, never generated: a series takes the lowest free slot of the eight
// validated ones when it goes on the chart and releases it when it comes off, so removing
// one line never repaints the others. There are more categories (13) and objects (1000+)
// than slots, which is exactly why only eight may be on screen at once.
//
// Line style carries the class, so a category and an object may share a hue unambiguously:
//   solid = traditional asset, dashed = luxury category, dotted = a specific object.
const DASH = { traditional: "", luxury: "7 4", object: "2 4" };
/** Two-hue encoding for places that show every category at once (bars, tables, chips). */
const classColor = (cls) => (cls === "traditional" ? "var(--s1)" : "var(--s2)");

const MAX_SERIES = 8;
const SVG = "http://www.w3.org/2000/svg";

const state = {
  from: 2005, to: 2024, real: false, amount: 10000, scale: "lin",
  picked: new Set(["sp500", "gold", "housing", "cash", "whisky", "watches"]),
  pickedItems: new Set(),
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
  // Re-fetched on every window change so the hero's counts match the window on screen.
  const q = new URLSearchParams({
    from: state.from, to: state.to,
    real: state.real ? "1" : "0", amount: state.amount,
  });
  const r = await fetch("/api/analysis?" + q);
  state.data = await r.json();
  renderAll();
}

/* ------------------------------------------------------------------ chrome */
/** A window change moves the hero counts and every item's span, so all three refetch. */
async function reload() {
  await Promise.all([fetchSummary(), load()]);
  renderHero();
  itemState.page = 0;
  itemState.selected = null;
  objCache.clear();          // cached series are window-scoped
  await Promise.all([...state.pickedItems].map(async (id) => {
    const it = await getItemDetail(id);
    if (!it || itemOverlap(it).years < 1) { state.pickedItems.delete(id); itemSlot.delete(id); }
  }));
  renderPicker(); drawGrowth();
  await refreshItems();
  ixState.page = 0;
  ixState.selected = null;
  await ixRefresh();          // spans and benchmarks are window-scoped
}

function buildYearSelects() {
  const from = $("#from"), to = $("#to");
  for (let y = 2005; y <= 2024; y++) from.append(new Option(y, y, false, y === state.from));
  for (let y = 2006; y <= 2025; y++) to.append(new Option(y === 2025 ? "2025 (provisional)" : y, y, false, y === state.to));
  $("#amount").value = state.amount;
  for (const b of $("#realSeg").children) b.setAttribute("aria-pressed", String((b.dataset.v === "1") === state.real));
  for (const b of $("#scaleSeg").children) b.setAttribute("aria-pressed", String(b.dataset.v === state.scale));
  from.onchange = () => { state.from = +from.value; if (state.to <= state.from) { state.to = state.from + 1; to.value = state.to; } reload(); };
  to.onchange = () => { state.to = +to.value; if (state.to <= state.from) { state.from = state.to - 1; from.value = state.from; } reload(); };
  $("#amount").onchange = (e) => { state.amount = Math.max(1, +e.target.value || 10000); load(); };
  seg("#realSeg", (v) => { state.real = v === "1"; reload(); });
  seg("#scaleSeg", (v) => { state.scale = v; drawGrowth(); writeUrl(); });
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
  writeUrl();
  drawGrowth(); drawBars(); // series colours are CSS vars resolved at draw time
  if (itemState.rows.length) renderItems();
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

function totalPicked() { return state.picked.size + state.pickedItems.size; }

function renderPicker() {
  const box = $("#picker");
  box.innerHTML = "";
  for (const a of state.data.assets) {
    const on = state.picked.has(a.id);
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    // An unselected chip holds no slot, so it shows the class colour rather than reserving a hue.
    b.style.setProperty("--c", on ? itemColor(a.id) : classColor(a.class));
    b.setAttribute("aria-pressed", String(on));
    b.disabled = !on && totalPicked() >= MAX_SERIES;
    b.innerHTML = `<span class="dot"></span>${esc(a.name)}`;
    b.onclick = () => {
      if (on) { if (totalPicked() > 1) { state.picked.delete(a.id); releaseSlot(a.id); } }
      else if (totalPicked() < MAX_SERIES) state.picked.add(a.id);
      renderPicker(); drawGrowth(); writeUrl();
    };
    box.append(b);
  }
  renderObjectPicker();
}

const itemSlot = new Map();
function slotFor(id) {
  if (itemSlot.has(id)) return itemSlot.get(id);
  const taken = new Set(itemSlot.values());
  for (let i = 1; i <= 8; i++) if (!taken.has(i)) { itemSlot.set(id, i); return i; }
  return 1;
}
const itemColor = (id) => `var(--s${slotFor(id)})`;
const releaseSlot = (id) => itemSlot.delete(id);

/** Years of this object that fall inside the current chart window. */
function itemOverlap(it) {
  const ys = state.data.years;
  const from = Math.max(ys[0], it.firstYear);
  const to = Math.min(ys[ys.length - 1], it.lastYear);
  return { from, to, years: to - from };
}

/* The catalogue is far too large for a dropdown, so objects are found by search and
   fetched one at a time. Only what is on the chart is ever held in memory. */
function wireObjectSearch() {
  const box = $("#objSearch"), results = $("#objResults");
  const close = () => { results.hidden = true; results.innerHTML = ""; };

  const run = debounce(async () => {
    const q = box.value.trim();
    if (q.length < 2) return close();
    const res = await (await fetch("/api/items?" + new URLSearchParams({
      q, from: state.from, to: state.to, limit: 10, sort: "name",
    }))).json();

    if (!res.items.length) {
      results.innerHTML = `<div class="r-none">Nothing matches “${esc(q)}”.</div>`;
      results.hidden = false;
      return;
    }
    results.innerHTML = res.items.map((i) =>
      `<button type="button" data-id="${esc(i.id)}">${esc(i.name)}
         <span class="r-ref">${esc(i.ref || i.categoryName)} · ${esc(i.kind)}</span></button>`).join("") +
      (res.total > res.items.length ? `<div class="r-none">${res.total - res.items.length} more — keep typing</div>` : "");
    results.hidden = false;
    results.querySelectorAll("button").forEach((b) => b.onclick = async () => {
      if (totalPicked() >= MAX_SERIES) { toast("Eight lines is the limit — remove one first"); return; }
      const item = await getItemDetail(b.dataset.id);
      if (!item) return;
      if (itemOverlap(item).years < 1) { toast(`${item.name} has no data inside ${state.from}–${state.to}`); return; }
      state.pickedItems.add(item.id);
      box.value = ""; close();
      renderPicker(); drawGrowth(); writeUrl();
    });
  }, 220);

  box.addEventListener("input", run);
  box.addEventListener("focus", run);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".combo")) close();
  });
}

function renderObjectPicker() {
  const box = $("#objPicked");
  box.innerHTML = "";
  for (const id of state.pickedItems) {
    const it = objCache.get(id);
    if (!it) continue;
    const b = document.createElement("button");
    b.className = "chip obj";
    b.type = "button";
    b.style.setProperty("--c", itemColor(id));
    b.setAttribute("aria-pressed", "true");
    b.title = `Remove ${itemLabel(it)} from the chart`;
    b.innerHTML = `<span class="dot"></span>${esc(it.name)}<span class="x">×</span>`;
    b.onclick = () => {
      state.pickedItems.delete(id);
      releaseSlot(id);              // free the hue for the next series
      renderPicker(); drawGrowth(); writeUrl();
    };
    box.append(b);
  }
}

/**
 * One drawable series per selected category or object, all aligned to the window's year
 * axis. An object that starts after the window does gets leading nulls rather than a
 * fabricated earlier value.
 */
function buildSeries() {
  const d = state.data;
  const out = d.assets.filter((a) => state.picked.has(a.id)).map((a) => ({
    id: a.id, name: a.name, color: itemColor(a.id), dash: DASH[a.class] ?? "",
    values: a.values, startIdx: 0, startYear: d.from, isItem: false,
  }));

  for (const id of state.pickedItems) {
    const it = objCache.get(id);
    if (!it) continue;
    const { from, years: span } = itemOverlap(it);
    if (span < 1) continue;

    const priceAt = new Map(it.annual.map((p) => [p.year, p.price]));
    const base = priceAt.get(from);
    if (!base) continue;
    const startIdx = d.years.indexOf(from);
    const cpiBase = d.cpiIndex[startIdx];

    const values = d.years.map((yr, i) => {
      const px = priceAt.get(yr);
      if (px === undefined) return null;
      const nominal = (px / base) * d.amount;
      // Deflate by the same CPI path the category series use, rebased to this line's start.
      return d.real ? nominal / (d.cpiIndex[i] / cpiBase) : nominal;
    });

    out.push({
      id, name: it.name, color: itemColor(id), dash: DASH.object,
      values, startIdx, startYear: from, isItem: true, kind: it.kind,
    });
  }
  return out;
}

/* ------------------------------------------------------- growth line chart */
function drawGrowth() {
  const svg = $("#growth");
  svg.innerHTML = "";
  const d = state.data;
  const series = buildSeries();
  if (!series.length) return;
  const vals = (sr) => sr.values.filter((v) => v !== null);

  const W = Math.max(svg.clientWidth || 640, 560), H = 360;
  const m = { t: 14, r: 88, b: 30, l: 60 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);

  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const years = d.years;
  const lo = Math.min(...series.flatMap(vals));
  const hi = Math.max(...series.flatMap(vals));
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
    let started = false;
    const dstr = s.values.map((v, i) => {
      if (v === null) return "";
      const cmd = started ? "L" : "M";
      started = true;
      return `${cmd}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    }).join("");
    if (!dstr) continue;
    svg.append(el("path", {
      class: "series-line", d: dstr, stroke: s.color,
      ...(s.dash ? { "stroke-dasharray": s.dash } : {}),
    }));
    // Mark where a late-starting line begins, so its shorter run is visible rather than implied.
    if (s.startIdx > 0) {
      svg.append(el("circle", {
        cx: x(s.startIdx), cy: y(s.values[s.startIdx]), r: 4,
        fill: "var(--surface-1)", stroke: s.color, "stroke-width": 2,
      }));
    }
  }

  // Direct end-labels when the field is small enough to stay legible; the legend and the
  // table below carry identity in every case.
  if (series.length <= 4) {
    const lastOf = (sr) => vals(sr).at(-1) ?? 0;
    const placed = [];
    for (const s of [...series].sort((a, b) => lastOf(b) - lastOf(a))) {
      let yy = y(lastOf(s)) + 4;
      while (placed.some((p) => Math.abs(p - yy) < 14)) yy += 14;
      placed.push(yy);
      const t = el("text", { class: "end-label", x: m.l + iw + 8, y: yy, fill: s.color });
      t.textContent = s.name.length > 16 ? s.name.slice(0, 15) + "…" : s.name;
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
    const c = el("circle", { r: 4.5, fill: s.color, stroke: "var(--surface-1)", "stroke-width": 2, opacity: 0 });
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
      const v = s.values[i];
      if (v === null) { dots[k].setAttribute("opacity", 0); return; }
      dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(v)); dots[k].setAttribute("opacity", 1);
    });
    const rows = [...series]
      .filter((s) => s.values[i] !== null)
      .sort((a, b) => b.values[i] - a.values[i])
      .map((s) => `<div class="row"><span class="nm" style="--c:${s.color}"><span class="sw"></span>${esc(s.name)}${
        s.startIdx > 0 ? ` <span style="color:var(--muted)">from ${s.startYear}</span>` : ""
      }</span><b>${money(s.values[i])}</b></div>`).join("");
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
  $("#growthLegend").innerHTML = series.map((s) => {
    const style = s.isItem ? "border-top-style:dotted;border-top-width:3px" : s.dash ? "border-top-style:dashed" : "";
    return `<span style="--c:${s.color}"><i style="${style}"></i>${esc(s.name)}${
      s.startIdx > 0 ? ` <span style="color:var(--muted)">(from ${s.startYear})</span>` : ""}</span>`;
  }).join("");
  const late = series.filter((s) => s.startIdx > 0);
  const note = $("#shortNote");
  if (note) note.remove();
  if (late.length) {
    const named = late.map((s) => `${s.name} from ${s.startYear}`);
    const list = named.length === 1 ? named[0]
      : named.slice(0, -1).join(", ") + " and " + named[named.length - 1];
    const p = document.createElement("p");
    p.id = "shortNote";
    p.className = "short-note";
    p.textContent = `${list} — ${late.length > 1 ? "those lines" : "that line"} ` +
      `start${late.length > 1 ? "" : "s"} where the record does, so ${late.length > 1 ? "they show" : "it shows"} ` +
      `${money(state.amount)} invested then, not in ${state.data.from}. ` +
      `Compare ${late.length > 1 ? "them" : "it"} against the others over the shared years only.`;
    $("#growthLegend").after(p);
  }
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

/** Luxury categories that beat the index over the selected window. */
function categoriesBeating(d) {
  const sp = d.assets.find((a) => a.id === "sp500");
  const lux = d.assets.filter((a) => a.class === "luxury");
  return { beat: lux.filter((a) => a.cagrPct > sp.cagrPct).length, of: lux.length, sp };
}

/** Named resale objects that beat the index — tracked series only, from the server. */
function objectsBeating() {
  const s = itemState.summary?.objects;
  return s ?? { beat: 0, of: 0 };
}

function renderHero() {
  const d = state.data;
  const cats = categoriesBeating(d);
  const objs = objectsBeating();
  const haveObjects = objs.of > 0;

  $("#heroEyebrow").textContent =
    `${d.from} — ${d.to}${d.real ? " · after inflation" : ""}${d.to >= d.provisionalFrom ? " · 2025 provisional" : ""}`;

  // The headline is the finding, so it has to follow the data rather than sit on top of it.
  const n = haveObjects ? objs.beat : cats.beat;
  const of = haveObjects ? objs.of : cats.of;
  const what = haveObjects ? "" : " luxury categories";  // objects need no noun; categories do
  $("#heroTitle").textContent =
    n === 0 ? `Not one of them beat the S&P 500.`
    : n === of ? `All ${of} of them beat the S&P 500.`
    : n === 1 ? `Only one of them${what} beat the S&P 500.`
    : `Only ${n} of ${of}${what} beat the S&P 500.`;

  $("#heroSub").textContent = haveObjects
    ? `Handbags, watches, Ferraris, Birkins — ${objs.of} named objects, each priced against the most boring ` +
      `thing you could have bought instead, over exactly the years its own record covers.` +
      (objs.beat === 0 ? " Every one of them lost." : "")
    : `Handbags, watches, jewellery and classic cars, priced against the most boring thing you could ` +
      `have bought instead.`;

  // The steepest retail climb: what the shop charges, against what money did.
  const retail = itemState.summary?.topRetail ?? null;

  const stats = [
    { fig: `${objs.beat}<em> of </em>${objs.of}`, cap: `named objects that beat the S&P 500 over their own years`,
      show: haveObjects },
    { fig: `${cats.beat}<em> of </em>${cats.of}`, cap: `luxury categories that beat it over ${d.from}–${d.to}`, show: true },
    retail ? {
      fig: `${retail.multiple.toFixed(1)}<em>×</em>`,
      cap: `what the price of a ${retail.name} did between ${retail.firstYear} and ${retail.lastYear}, ` +
           `while general prices rose ` +
           `${(Math.pow(1 + retail.benchmarkCagrPct / 100, retail.lastYear - retail.firstYear)).toFixed(1)}×`,
      show: true,
    } : null,
  ].filter((x) => x && x.show);

  $("#heroStats").innerHTML = stats.map((s) =>
    `<div class="hstat"><div class="fig">${s.fig}</div><div class="cap">${esc(s.cap)}</div></div>`).join("");

  // Pull quote: the sharpest single sentence available for the current window.
  const pull = $("#pullText");
  if (retail) {
    pull.innerHTML = `A ${esc(retail.name)} rose <b>${pct(retail.cagrPct)} a year</b> while inflation ran ` +
      `${pct(retail.benchmarkCagrPct)}. That is not a return — it is the price of admission going up.`;
  } else {
    pull.innerHTML = `The window you choose decides the answer more than the asset does.`;
  }

  const ranked = [...d.assets].sort((a, b) => b.cagrPct - a.cagrPct);
  const winner = ranked[0], loser = ranked.at(-1);
  $("#tiles").innerHTML = [
    ["Best category", winner.name, `${money(winner.values.at(-1))} from ${money(state.amount)}`],
    ["Worst category", loser.name, `${money(loser.values.at(-1))} from ${money(state.amount)}`],
    ["Steadiest", [...d.assets].sort((a, b) => a.volatilityPct - b.volatilityPct)[0].name, `lowest year-to-year swing`],
    ["Inflation", pct(d.cpi.cumulativePct, 0), `${pct(d.cpi.cagrPct)} a year`],
  ].map(([k, v, s]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="d">${esc(s)}</div></div>`).join("");
}

/* ------------------------------------------------------------------ table */
const cls = (v) => (Math.abs(v) < 0.05 ? "" : v > 0 ? "pos" : "neg");
const signed = (v, d = 1) => `<span class="${cls(v)}">${pct(v, d)}</span>`;
const signed2 = (v) => {
  if (Math.abs(v) < 0.5) return `<span class="">$0</span>`;
  return `<span class="${cls(v)}">${v > 0 ? "+" : "−"}${money(Math.abs(v))}</span>`;
};
const COLS = [
  { k: "name", t: "Asset", fmt: (r) => `<span class="swatch" style="--c:${classColor(r.class)}"></span>${esc(r.name)}`, num: false },
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
/* ============================================================== items view */
// Item fields can be user-supplied, so everything interpolated into markup is escaped.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ITEM_COLOR = { resale: "var(--s1)", retail: "var(--s2)" };
const PAGE = 25;
const TRACKED_COUNT_FALLBACK = 17;

const itemState = {
  kind: "resale", cat: "", query: "", sort: "edge", scope: "all",
  page: 0, total: 0, rows: [], selected: null, summary: null,
};

/** Full records (with series) for the objects currently on the growth chart. */
const objCache = new Map();

const CONF_LABEL = { high: "sourced", medium: "reported", estimated: "estimated", modelled: "modelled" };
const confClass = (c) => (c === "high" ? "" : c === "modelled" ? "modelled" : "est");

function itemLabel(it) { return it.ref ? `${it.name} (${it.ref})` : it.name; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ------------------------------------------------------------ data access */
async function fetchItems() {
  const q = new URLSearchParams({
    from: state.from, to: state.to, kind: itemState.kind, sort: itemState.sort,
    limit: PAGE, offset: itemState.page * PAGE,
  });
  if (itemState.query.trim()) q.set("q", itemState.query.trim());
  if (itemState.cat) q.set("category", itemState.cat);
  if (itemState.scope === "tracked") q.set("tracked", "1");
  const res = await (await fetch("/api/items?" + q)).json();
  itemState.rows = res.items;
  itemState.total = res.total;
}

async function fetchSummary() {
  const q = new URLSearchParams({ from: state.from, to: state.to, real: state.real ? "1" : "0" });
  itemState.summary = await (await fetch("/api/summary?" + q)).json();
}

/** A full record, cached — the list endpoint omits series at catalogue scale. */
async function getItemDetail(id) {
  if (objCache.has(id)) return objCache.get(id);
  const q = new URLSearchParams({ from: state.from, to: state.to });
  const res = await fetch(`/api/items/${encodeURIComponent(id)}?` + q);
  if (!res.ok) return null;
  const item = await res.json();
  objCache.set(id, item);
  return item;
}

/* -------------------------------------------------------------- rendering */
async function refreshItems() {
  await fetchItems();
  renderItems();
}

function renderItems() {
  const retail = itemState.kind === "retail";
  $("#itemHint").textContent = retail
    ? "What the boutique charges. A rising retail price is what the object costs you, not what you earn — so it is measured against inflation."
    : "What you could sell it for. This is the investment question, so it is measured against the S&P 500 over each item's own span.";

  const modelled = (itemState.summary?.catalogueCount ?? 0).toLocaleString();
  $("#scopeNote").innerHTML = itemState.scope === "tracked"
    ? `Showing only the models with a hand-sourced price series.`
    : `<b>${modelled}</b> generated models plus ${TRACKED_COUNT_FALLBACK} hand-sourced ones. A generated model's
       brand, variant and era are real; its price path is <b>derived</b> from its category index and badged
       <span class="badge modelled">modelled</span>. Those are excluded from the headline figures above.`;

  $("#itemLegend").innerHTML =
    `<span style="--c:${ITEM_COLOR[itemState.kind]}"><i style="border-top-width:0;width:11px;height:11px;border-radius:50%;background:var(--c)"></i>The object</span>` +
    `<span><i class="ring"></i>${retail ? "US inflation" : "S&amp;P 500"}, same years</span>` +
    `<span style="color:var(--muted)">Labels show the gap in percentage points per year.</span>`;

  drawDumbbell(itemState.rows);
  renderItemTable(itemState.rows);
  renderPager();
  renderItemDetail();
}

function renderPager() {
  const pages = Math.ceil(itemState.total / PAGE);
  const first = itemState.total ? itemState.page * PAGE + 1 : 0;
  const last = Math.min(itemState.total, (itemState.page + 1) * PAGE);
  $("#pager").innerHTML = itemState.total
    ? `<button type="button" id="prevPage"${itemState.page === 0 ? " disabled" : ""}>Previous</button>
       <button type="button" id="nextPage"${itemState.page >= pages - 1 ? " disabled" : ""}>Next</button>
       <span class="count">${first}–${last} of ${itemState.total.toLocaleString()}</span>`
    : "";
  const prev = $("#prevPage"), next = $("#nextPage");
  if (prev) prev.onclick = () => { itemState.page--; itemState.selected = null; refreshItems(); };
  if (next) next.onclick = () => { itemState.page++; itemState.selected = null; refreshItems(); };
}

function drawDumbbell(rows) {
  const svg = $("#dumbbell");
  svg.innerHTML = "";
  if (!rows.length) { svg.setAttribute("height", 0); return; }

  const W = Math.max(svg.clientWidth || 640, 620);
  const rowH = 32, m = { t: 10, r: 108, b: 26, l: 252 };
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
    const full = itemLabel(r);
    const lab = el("text", { class: "tick", x: m.l - 12, y: cy + 4, "text-anchor": "end", fill: "var(--text-secondary)" });
    lab.textContent = full.length > 36 ? full.slice(0, 35) + "…" : full;
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
      tip.innerHTML = `<h4>${esc(full)}</h4>
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
    hit.addEventListener("click", () => { itemState.selected = r.id; renderItemDetail(); });
    g.append(hit);
    svg.append(g);
  });
}

function renderItemTable(rows) {
  const t = $("#itemTable");
  if (!rows.length) {
    const q = itemState.query.trim();
    t.innerHTML = `<tbody><tr><td class="empty">${
      q ? `Nothing matches &ldquo;${esc(q)}&rdquo; in ${itemState.kind === "retail" ? "retail prices" : "resale values"}. Add it below and it stays in the database.`
        : "No models here. Add one below."}</td></tr></tbody>`;
    return;
  }
  const benchHead = itemState.kind === "retail" ? "Inflation" : "S&amp;P 500";
  t.innerHTML =
    `<thead><tr><th>Model</th><th>Years</th><th>Then</th><th>Now</th><th>Per year</th>
      <th>${benchHead}</th><th>Difference</th><th>Data</th></tr></thead><tbody>` +
    rows.map((r) => `
      <tr class="item-row" data-id="${esc(r.id)}" aria-selected="${itemState.selected === r.id}">
        <td><span class="swatch" style="--c:${ITEM_COLOR[r.kind]}"></span>${esc(r.name)}
            <div class="ref">${esc(r.ref || r.categoryName)}</div></td>
        <td class="num">${esc(r.firstYear)}–${esc(r.lastYear)}</td>
        <td class="num">${money(r.firstPrice)}</td>
        <td class="num">${money(r.lastPrice)}</td>
        <td class="num">${signed(r.cagrPct)}</td>
        <td class="num">${pct(r.benchmarkCagrPct)}</td>
        <td class="num">${signed(r.edgePct)}</td>
        <td><span class="badge ${confClass(r.confidence)}">${CONF_LABEL[r.confidence] ?? esc(r.confidence)}</span>
            ${r.origin === "user" ? `<span class="badge">added here</span>` : ""}</td>
      </tr>`).join("") + "</tbody>";
  t.querySelectorAll("tr.item-row").forEach((tr) => tr.onclick = () => {
    itemState.selected = itemState.selected === tr.dataset.id ? null : tr.dataset.id;
    renderItemDetail();
  });
}

async function renderItemDetail() {
  await renderDetailInto("#itemDetail", itemState.selected, () => { itemState.selected = null; renderItems(); });
}

/** The detail panel, shared by the objects view and the full index. */
async function renderDetailInto(sel, id, onRemoved) {
  const box = $(sel);
  if (!box) return;
  if (!id) { box.innerHTML = ""; return; }
  const r = await getItemDetail(id);
  if (!r) { box.innerHTML = ""; return; }

  const onChart = state.pickedItems.has(r.id);
  const pathId = `${sel.slice(1)}-path`;
  box.innerHTML = `<div class="detail">
      <h3>${esc(r.name)}</h3>
      <p class="meta">${esc(r.ref || "—")} · ${esc(r.categoryName)} · ${r.kind === "retail" ? "retail price" : "resale value"}
        · <span class="badge ${confClass(r.confidence)}">${CONF_LABEL[r.confidence] ?? esc(r.confidence)}</span></p>
      ${r.blurb ? `<p style="margin:0 0 12px">${esc(r.blurb)}</p>` : ""}
      <p style="margin:0 0 12px">
        <button class="chip" data-act="plot" type="button"${onChart ? " disabled" : ""}>${onChart ? "On the chart above" : "＋ Plot this on the chart"}</button>
        ${r.origin === "user" ? `<button class="delete-link" data-act="del" style="margin-left:14px">Remove this model</button>` : ""}</p>
      <div class="chart-scroll"><svg id="${pathId}" class="chart"></svg></div>
      <p class="caveat"><b>Source:</b> ${esc(r.source)}${r.caveat ? `<br><b>Caveat:</b> ${esc(r.caveat)}` : ""}</p>
    </div>`;
  drawItemPath(r, pathId);

  const plot = box.querySelector('[data-act="plot"]');
  if (plot) plot.onclick = () => {
    if (state.pickedItems.has(r.id)) return;
    if (totalPicked() >= MAX_SERIES) { toast("Eight lines is the limit — remove one first"); return; }
    state.pickedItems.add(r.id);
    renderPicker(); drawGrowth(); writeUrl();
    renderDetailInto(sel, id, onRemoved);
    $("#chart").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const del = box.querySelector('[data-act="del"]');
  if (del) del.onclick = async () => { await removeItem(r.id, r.name); onRemoved?.(); };
}

function drawItemPath(r, svgId = "itemPath") {
  const svg = document.getElementById(svgId);
  if (!svg || !r.points?.length) return;
  const W = Math.max(svg.clientWidth || 600, 560), H = 240;
  const m = { t: 16, r: 20, b: 30, l: 78 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const ys = r.points.map((p) => p.year), ps = r.points.map((p) => p.price);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const useLog = Math.max(...ps) / Math.min(...ps) > 40;
  const lo = Math.min(...ps) * 0.9, hi = Math.max(...ps) * 1.08;
  const ty = (v) => (useLog ? Math.log10(v) : v);
  const X = (yr) => m.l + ((yr - y0) / (y1 - y0 || 1)) * iw;
  const Y = (v) => m.t + ih - ((ty(v) - ty(lo)) / (ty(hi) - ty(lo))) * ih;

  for (const v of (useLog ? logTicks(lo, hi) : linTicks(lo, hi, 4))) {
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
  // A modelled series has a value for every year, so markers would imply anchors it does
  // not have; only a hand-sourced series has real priced years to mark.
  const showAnchors = r.confidence !== "modelled";
  for (const p of r.points) {
    if (showAnchors) {
      svg.append(el("circle", { class: "anchor-dot", cx: X(p.year), cy: Y(p.price), r: 5, stroke: ITEM_COLOR[r.kind] }));
    }
    const hit = el("circle", { cx: X(p.year), cy: Y(p.price), r: 12, fill: "transparent" });
    hit.addEventListener("mousemove", (ev) => {
      tip.innerHTML = `<h4>${esc(p.year)}</h4><div class="row"><span class="nm">Price</span><b>${money(p.price)}</b></div>`;
      tip.classList.add("on");
      tip.style.left = Math.min(ev.clientX + 16, innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = Math.max(8, ev.clientY - tip.offsetHeight / 2) + "px";
    });
    hit.addEventListener("mouseleave", () => tip.classList.remove("on"));
    svg.append(hit);
  }
  for (const yr of [y0, y1]) {
    const t = el("text", { class: "tick", x: X(yr), y: H - 9, "text-anchor": "middle" });
    t.textContent = yr;
    svg.append(t);
  }
  const note = el("text", { class: "tick", x: m.l, y: m.t - 4, fill: "var(--muted)" });
  note.textContent = showAnchors
    ? `${r.points.length} priced years · the line between them is interpolation`
    : `derived from the ${r.categoryName.toLowerCase()} category index — not a tracked price`;
  svg.append(note);
}

/* --------------------------------------------------------- item controls */
async function wireItemControls() {
  const prov = await (await fetch("/api/provenance")).json();
  LUXURY_CATS = prov.filter((a) => a.class === "luxury");
  $("#catSel").innerHTML = `<option value="">All categories</option>` +
    LUXURY_CATS.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

  const reset = () => { itemState.page = 0; itemState.selected = null; };
  $("#catSel").onchange = (e) => { itemState.cat = e.target.value; reset(); refreshItems(); };
  $("#sortSel").onchange = (e) => { itemState.sort = e.target.value; reset(); refreshItems(); };
  seg("#kindSeg", (v) => { itemState.kind = v; reset(); refreshItems(); });
  seg("#scopeSeg", (v) => { itemState.scope = v; reset(); refreshItems(); });
  $("#itemSearch").addEventListener("input", debounce((e) => {
    itemState.query = e.target.value; reset(); refreshItems();
  }, 200));
}

/* ------------------------------------------------- adding your own model */
let LUXURY_CATS = [];
let pointSeq = 0;

function pointRow(year = "", price = "") {
  const row = document.createElement("div");
  row.className = "point-row";
  // Unique names, or the browser autofills every row with the same remembered value —
  // which then trips the duplicate-year check on submit.
  const n = ++pointSeq;
  row.innerHTML =
    `<label>Year<input name="year-${n}" data-f="year" autocomplete="off" type="number" min="2005" max="2025" step="1" value="${esc(year)}" placeholder="2018"></label>
     <label class="price">Price (USD)<input name="price-${n}" data-f="price" autocomplete="off" type="number" min="0" step="any" value="${esc(price)}" placeholder="12000"></label>
     <button type="button" title="Remove this year">Remove</button>`;
  row.querySelector("button").onclick = () => {
    const rows = $("#pointRows");
    if (rows.children.length > 2) row.remove();
  };
  return row;
}

function wireAddForm() {
  const form = $("#addForm"), rows = $("#pointRows"), msg = $("#addMsg");
  const fillCats = () =>
    form.category.innerHTML = LUXURY_CATS.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  fillCats();

  for (let i = 0; i < 3; i++) rows.append(pointRow());
  $("#addPoint").onclick = () => rows.append(pointRow());

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    msg.className = ""; msg.textContent = "";
    const btn = $("#addSubmit");

    const points = {};
    for (const r of rows.children) {
      const y = r.querySelector('input[data-f="year"]').value.trim();
      const p = r.querySelector('input[data-f="price"]').value.trim();
      if (!y && !p) continue;                       // an untouched row is not an error
      if (!y || !p) { msg.className = "err"; msg.textContent = "Every row needs both a year and a price."; return; }
      points[y] = Number(p);
    }

    const body = {
      name: form.name.value, brand: form.brand.value, ref: form.ref.value,
      category: form.category.value, kind: form.kind.value, confidence: form.confidence.value,
      source: form.source.value, caveat: form.caveat.value, points,
    };

    btn.disabled = true;
    try {
      const res = await fetch("/api/items", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) { msg.className = "err"; msg.textContent = out.error ?? "Could not save that."; return; }

      msg.className = "ok";
      msg.textContent = `Saved. ${form.name.value} is in the database now.`;
      form.reset();
      rows.innerHTML = "";
      for (let i = 0; i < 3; i++) rows.append(pointRow());
      fillCats();

      // Move the browser to the thing that was just saved: a hand-entered model is tracked,
      // so the tracked-only view is where it will be.
      itemState.kind = body.kind;
      for (const b of $("#kindSeg").children) b.setAttribute("aria-pressed", String(b.dataset.v === body.kind));
      itemState.scope = "tracked";
      for (const b of $("#scopeSeg").children) b.setAttribute("aria-pressed", String(b.dataset.v === "tracked"));
      itemState.cat = ""; $("#catSel").value = "";
      itemState.query = ""; $("#itemSearch").value = "";
      itemState.page = 0;
      itemState.selected = out.id;
      objCache.delete(out.id);
      await fetchSummary();
      await refreshItems();
      renderHero();
      $("#itemDetail").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      msg.className = "err"; msg.textContent = "Could not reach the server.";
    } finally {
      btn.disabled = false;
    }
  });
}

async function removeItem(id, name) {
  if (!confirm(`Remove "${name}" from the database? This cannot be undone.`)) return;
  const res = await fetch(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return;
  itemState.selected = null;
  objCache.delete(id);
  state.pickedItems.delete(id);
  itemSlot.delete(id);
  await fetchSummary();
  await refreshItems();
  if (state.data) { renderHero(); renderPicker(); drawGrowth(); }
}


/* ============================================================ the full index */
// A plain, complete list of every model in the database — a different job from the
// analysis view above, which only ever shows one kind and one page of it.
const IX_PAGE = 50;
const ixState = {
  q: "", cat: "", brand: "", kind: "", conf: "", outcome: "", sort: "name",
  page: 0, total: 0, rows: [], selected: null, facets: null,
};

async function ixFetch() {
  const q = new URLSearchParams({
    from: state.from, to: state.to, sort: ixState.sort,
    limit: IX_PAGE, offset: ixState.page * IX_PAGE,
  });
  if (ixState.q.trim()) q.set("q", ixState.q.trim());
  if (ixState.cat) q.set("category", ixState.cat);
  if (ixState.brand) q.set("brand", ixState.brand);
  if (ixState.kind) q.set("kind", ixState.kind);
  if (ixState.conf === "tracked") q.set("tracked", "1");
  else if (ixState.conf) q.set("confidence", ixState.conf);
  if (ixState.outcome) q.set("outcome", ixState.outcome);

  const res = await (await fetch("/api/items?" + q)).json();
  ixState.rows = res.items;
  ixState.total = res.total;
}

/** Brands are re-listed when the category or kind narrows, so the menu never offers a
 *  brand that would return nothing. */
async function ixLoadBrands() {
  const q = new URLSearchParams();
  if (ixState.cat) q.set("category", ixState.cat);
  if (ixState.kind) q.set("kind", ixState.kind);
  const list = await (await fetch("/api/brands?" + q)).json();
  const sel = $("#ixBrand");
  const keep = list.some((b) => b.brand === ixState.brand) ? ixState.brand : "";
  if (keep !== ixState.brand) ixState.brand = "";
  sel.innerHTML = `<option value="">All brands</option>` +
    list.map((b) => `<option value="${esc(b.brand)}"${b.brand === keep ? " selected" : ""}>${esc(b.brand)} (${b.n})</option>`).join("");
}

async function ixRefresh() {
  await ixFetch();
  ixRender();
}

function ixRender() {
  const f = ixState.facets;
  ixRenderWarning();
  const what = ixState.outcome === "beat" ? " beat their benchmark"
             : ixState.outcome === "lost" ? " lost to their benchmark" : " match";
  $("#ixCount").innerHTML = ixState.total === (f?.total ?? -1)
    ? `All <b>${ixState.total.toLocaleString()}</b> items.`
    : `<b>${ixState.total.toLocaleString()}</b> of ${(f?.total ?? 0).toLocaleString()} items${what}.`;

  const t = $("#ixTable");
  if (!ixState.rows.length) {
    t.innerHTML = `<tbody><tr><td class="empty">Nothing matches those filters.</td></tr></tbody>`;
    $("#ixPager").innerHTML = "";
    return;
  }
  t.innerHTML =
    `<thead><tr><th>Model</th><th>Category</th><th>Measuring</th><th>Years</th>
      <th>Then</th><th>Now</th><th>Per year</th><th>vs benchmark</th><th>Data</th></tr></thead><tbody>` +
    ixState.rows.map((r) => `
      <tr class="item-row" data-id="${esc(r.id)}" aria-selected="${ixState.selected === r.id}">
        <td class="model"><span class="swatch" style="--c:${ITEM_COLOR[r.kind]}"></span>${esc(r.name)}
            ${r.ref ? `<div class="ref">${esc(r.ref)}</div>` : ""}</td>
        <td>${esc(r.categoryName)}</td>
        <td>${r.kind === "retail" ? "Retail" : "Resale"}</td>
        <td class="num">${esc(r.firstYear)}–${esc(r.lastYear)}</td>
        <td class="num">${money(r.firstPrice)}</td>
        <td class="num">${money(r.lastPrice)}</td>
        <td class="num">${signed(r.cagrPct)}</td>
        <td class="num">${signed(r.edgePct)}</td>
        <td><span class="badge ${confClass(r.confidence)}">${CONF_LABEL[r.confidence] ?? esc(r.confidence)}</span>
            ${r.origin === "user" ? `<span class="badge">added here</span>` : ""}</td>
      </tr>`).join("") + "</tbody>";

  t.querySelectorAll("tr.item-row").forEach((tr) => tr.onclick = () => {
    ixState.selected = ixState.selected === tr.dataset.id ? null : tr.dataset.id;
    ixRender();
  });

  ixRenderPager();
  renderDetailInto("#ixDetail", ixState.selected, () => { ixState.selected = null; ixRefresh(); });
}

/**
 * The winners list is the one view on this site that can mislead, because its members are
 * selected for having won. It says so, on the view itself, rather than in a footnote.
 */
function ixRenderWarning() {
  const box = $("#ixWarn");
  if (ixState.outcome !== "beat") { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = `
    <h4>Read this list the right way round</h4>
    <p>Everything here is here <b>because</b> it won. That is survivorship bias in its purest
      form — the same reasoning that sells people handbags as investments. For every object on
      this list there are thousands of near-identical ones that lost, and no way to have known
      in advance which was which.</p>
    <p>Look at <b>what kind of thing</b> wins: vintage, fixed-supply or one-of-a-kind. A closed
      distillery, forty bottles, 106 cars, a dial that was a factory mistake. Nothing you can
      walk into a boutique and buy is on the resale side of this list — and famous
      multi-baggers that people quote as proof, like a 1959 Les Paul or an F.P. Journe
      Chronomètre Bleu, still lose once you measure from their own start rather than from
      their best year.</p>
    <p>And watch the <b>Measuring</b> column, because the two halves mean opposite things. A
      <b>resale</b> row beating the S&amp;P 500 is a real return. A <b>retail</b> row beating
      inflation is not good news for you at all — it means the object got more expensive
      faster than money lost value. A Chanel Flap outrunning CPI is a price rise, not a
      profit, and you only capture it if you already owned one.</p>`;
}

function ixRenderPager() {
  const pages = Math.max(1, Math.ceil(ixState.total / IX_PAGE));
  const first = ixState.page * IX_PAGE + 1;
  const last = Math.min(ixState.total, (ixState.page + 1) * IX_PAGE);
  $("#ixPager").innerHTML =
    `<button type="button" data-go="first"${ixState.page === 0 ? " disabled" : ""}>« First</button>
     <button type="button" data-go="prev"${ixState.page === 0 ? " disabled" : ""}>Previous</button>
     <span class="jump">Page <input id="ixJump" type="number" min="1" max="${pages}" value="${ixState.page + 1}"> of ${pages}</span>
     <button type="button" data-go="next"${ixState.page >= pages - 1 ? " disabled" : ""}>Next</button>
     <button type="button" data-go="last"${ixState.page >= pages - 1 ? " disabled" : ""}>Last »</button>
     <span class="count">${first.toLocaleString()}–${last.toLocaleString()} of ${ixState.total.toLocaleString()}</span>`;

  const go = (p) => {
    ixState.page = Math.max(0, Math.min(pages - 1, p));
    ixState.selected = null;
    ixRefresh();
    $("#index").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("#ixPager").querySelectorAll("button[data-go]").forEach((b) => b.onclick = () => {
    const at = ixState.page;
    go(b.dataset.go === "first" ? 0 : b.dataset.go === "last" ? pages - 1
       : b.dataset.go === "prev" ? at - 1 : at + 1);
  });
  const jump = $("#ixJump");
  if (jump) jump.onchange = () => go((Number(jump.value) || 1) - 1);
}

async function wireIndex() {
  ixState.facets = await (await fetch("/api/facets")).json();
  $("#ixCat").innerHTML = `<option value="">All categories</option>` +
    ixState.facets.byCategory.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${c.n})</option>`).join("");
  await ixLoadBrands();

  $("#indexHint").innerHTML =
    `Every model in the database — <b>${ixState.facets.total.toLocaleString()}</b> of them, across
     ${ixState.facets.byCategory.length} categories. Click any row for its price history, or put it
     straight on the chart at the top.`;

  const reset = () => { ixState.page = 0; ixState.selected = null; };
  $("#ixCat").onchange = async (e) => { ixState.cat = e.target.value; reset(); await ixLoadBrands(); ixRefresh(); };
  $("#ixKind").onchange = async (e) => { ixState.kind = e.target.value; reset(); await ixLoadBrands(); ixRefresh(); };
  $("#ixBrand").onchange = (e) => { ixState.brand = e.target.value; reset(); ixRefresh(); };
  $("#ixConf").onchange = (e) => { ixState.conf = e.target.value; reset(); ixRefresh(); };
  $("#ixOutcome").onchange = (e) => { ixState.outcome = e.target.value; reset(); ixRefresh(); };
  $("#ixSort").onchange = (e) => { ixState.sort = e.target.value; reset(); ixRefresh(); };
  $("#ixSearch").addEventListener("input", debounce((e) => {
    ixState.q = e.target.value; reset(); ixRefresh();
  }, 200));

  await ixRefresh();
}

/* ------------------------------------------------------- shareable state */
// Everything that changes what you are looking at lives in the URL, so a link
// carries the exact comparison rather than just the site.

function writeUrl() {
  if (!state.data) return;
  const q = new URLSearchParams();
  if (state.from !== 2005) q.set("from", state.from);
  if (state.to !== 2024) q.set("to", state.to);
  if (state.amount !== 10000) q.set("amount", state.amount);
  if (state.real) q.set("real", "1");
  if (state.scale !== "lin") q.set("scale", state.scale);
  const defaults = ["sp500", "gold", "housing", "cash", "whisky", "watches"].sort().join(",");
  const picked = [...state.picked].sort().join(",");
  if (picked !== defaults) q.set("a", picked);
  if (state.pickedItems.size) q.set("o", [...state.pickedItems].join(","));
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) q.set("theme", theme);
  const qs = q.toString();
  history.replaceState(null, "", qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
}

/** Apply ?from=…&a=…&o=… before the first fetch, so the page opens on the shared view. */
function readUrl() {
  const q = new URLSearchParams(location.search);
  const int = (k, lo, hi, dflt) => {
    const n = Number(q.get(k));
    return q.has(k) && Number.isFinite(n) && n >= lo && n <= hi ? Math.trunc(n) : dflt;
  };
  state.from = int("from", 2005, 2024, 2005);
  state.to = int("to", 2006, 2025, 2024);
  if (state.to <= state.from) state.to = Math.min(2025, state.from + 1);
  state.amount = int("amount", 1, 1e9, 10000);
  state.real = q.get("real") === "1";
  state.scale = q.get("scale") === "log" ? "log" : "lin";
  if (q.has("a")) {
    const ids = q.get("a").split(",").filter(Boolean).slice(0, MAX_SERIES);
    if (ids.length) state.picked = new Set(ids);
  }
  if (q.has("o")) {
    // Validated against the catalogue once items load; unknown ids are dropped there.
    for (const id of q.get("o").split(",").filter(Boolean).slice(0, MAX_SERIES)) state.pickedItems.add(id);
  }
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 2200);
}

function wireShare() {
  $("#shareBtn").onclick = async () => {
    writeUrl();
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied — it opens on this exact comparison");
    } catch {
      // Clipboard is blocked without a user gesture in some browsers, and over plain http.
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select();
      try { document.execCommand("copy"); toast("Link copied"); }
      catch { toast("Copy failed — the link is in your address bar"); }
      ta.remove();
    }
  };
}

function renderAll() {
  writeUrl();
  renderHero(); renderPicker(); drawGrowth(); drawBars(); renderTable();
  $("#growthHint").textContent =
    `${state.real ? "Inflation-adjusted" : "Nominal"} value of ${money(state.amount)} invested at the start of ${state.data.from}. ` +
    `Solid lines are traditional assets, dashed are luxury categories, dotted are specific objects. ` +
    `Up to ${MAX_SERIES} lines at once.`;
}
let t;
addEventListener("resize", () => {
  clearTimeout(t);
  t = setTimeout(() => { drawGrowth(); drawBars(); if (itemState.all.length) renderItems(); }, 120);
});

/* -------------------------------------------------------------------- boot */
// Last in the file: the modules above declare consts that these calls reach, and a const
// is not initialised until its declaration is evaluated.
async function boot() {
  readUrl();
  buildYearSelects();
  wireShare();
  wireObjectSearch();
  renderProvenance();
  await wireItemControls();
  wireAddForm();

  // Objects named in a shared link have to be fetched before the chart can draw them.
  await Promise.all([...state.pickedItems].map(async (id) => {
    const it = await getItemDetail(id);
    if (!it) { state.pickedItems.delete(id); itemSlot.delete(id); }
  }));

  await Promise.all([fetchSummary(), load()]);
  renderHero();
  await refreshItems();
  await wireIndex();
}
boot();
