// ReClaim BIM 편집기: 부재를 그리고, 부재마다 해체 정보를 넣고, 완전 철거·분별 해체·최적 혼합안을 비교한다.
import {
  TYPES, ASSEMBLIES, DEFAULT_ASSEMBLY, WASTE, MATERIALS, WORK_ITEMS, TRADES, SEPARABLE, SEPARABLE_MIN,
  CONNECTIONS, HAZARD, WASTE_UNIT, DEFAULT_PARAMS, PAPER,
} from "./catalog.js";
import {
  compare, mergeParams, takeoff, grossFloorArea, lineLength, isEligible, paperCase, simulate,
  breakEvenResin, UNCERTAINTY, residualMixedTons,
} from "./scenario.js";
import { demoModel, emptyModel, newElement, copyLevel, uid } from "./demo-model.js";
import { groupedBars, histogram, tornado, bindTips } from "./charts.js";

const STORE = "reclaim.bim.v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r1 = (v) => (Math.round(v * 10) / 10).toLocaleString();
const r2 = (v) => (Math.round(v * 100) / 100).toLocaleString();
const mw = (won) => (won / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }); // 백만원
const kw = (won) => Math.round(won / 1000).toLocaleString(); // 천원
const signed = (s) => (s.startsWith("-") ? "−" + s.slice(1) : "+" + s);

/* ---------------- 상태 ---------------- */

function load() {
  try { const raw = localStorage.getItem(STORE); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(model)); } catch {} }, 200);
}

let model = load() || demoModel();
const ui = {
  levelId: model.levels[0]?.id,
  tool: "select",
  selectedId: null,
  view: null, // {s, ox, oy}
  draft: null,
  drag: null,
  tab: "props",
  mode: "2d",
  layers: { slab: true, floorFinish: true, ceiling: false },
  color3d: "decision",
  mc: null,
  cache: null,
};
const history = [];

function snapshot() {
  history.push(JSON.stringify(model));
  if (history.length > 60) history.shift();
}
function mutate(fn, { keepMc = false } = {}) {
  snapshot();
  fn(model);
  ui.cache = null;
  if (!keepMc) ui.mc = null;
  save();
}
function undo() {
  const prev = history.pop();
  if (!prev) return;
  model = JSON.parse(prev);
  ui.cache = null; ui.mc = null;
  if (!model.levels.some((l) => l.id === ui.levelId)) ui.levelId = model.levels[0]?.id;
  if (!model.elements.some((e) => e.id === ui.selectedId)) ui.selectedId = null;
  save();
  renderAll();
}

function results() {
  if (!ui.cache) ui.cache = compare(model, model.params);
  return ui.cache;
}
const selected = () => model.elements.find((e) => e.id === ui.selectedId) || null;
const level = () => model.levels.find((l) => l.id === ui.levelId) || model.levels[0];

/* ---------------- 도구 ---------------- */

const ICONS = {
  select: '<path d="M4 3l7 17 2.5-7L21 10.5z"/>',
  wall: '<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M7 9v6M11 9v6M15 9v6M19 9v6"/>',
  partition: '<path d="M3 12h18"/><path d="M3 9h18M3 15h18" stroke-dasharray="2 2"/>',
  column: '<rect x="8" y="3" width="8" height="18" rx="1"/><path d="M8 7h8M8 17h8"/>',
  beam: '<path d="M2 9h20M2 15h20"/><path d="M2 9v6M22 9v6" />',
  slab: '<path d="M3 10l9-5 9 5-9 5z"/><path d="M3 10v3l9 5 9-5v-3"/>',
  ceiling: '<path d="M3 5h18"/><path d="M5 5v4M9 5v4M13 5v4M17 5v4M3 9h18"/>',
  floor: '<path d="M3 19h18"/><path d="M3 15h18M7 15v4M12 15v4M17 15v4"/>',
  window: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
  door: '<path d="M6 21V4a1 1 0 0 1 1-1h9v18"/><path d="M3 21h18"/><circle cx="13" cy="12" r="1"/>',
  pan: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
};
const TOOLS = [
  { key: "select", label: "선택", icon: "select", hint: "부재를 눌러 선택하고 끌어서 옮깁니다. 빈 곳을 끌면 화면이 움직입니다." },
  "sep",
  { key: "wall", label: "벽", icon: "wall", hint: "시작점과 끝점을 차례로 누릅니다. 이어서 그려지며, Esc나 두 번 눌러 끝냅니다." },
  { key: "partition", label: "칸막이", icon: "partition", hint: "시작점과 끝점을 차례로 누릅니다. Esc로 끝냅니다." },
  { key: "column", label: "기둥", icon: "column", hint: "기둥 중심을 누릅니다." },
  { key: "beam", label: "보", icon: "beam", hint: "보의 시작점과 끝점을 누릅니다." },
  { key: "slab", label: "슬래브", icon: "slab", hint: "두 모서리를 누르거나 끌어서 사각형을 그립니다." },
  { key: "ceiling", label: "천장", icon: "ceiling", hint: "두 모서리를 누르거나 끌어서 천장 영역을 그립니다." },
  { key: "floorFinish", label: "바닥", icon: "floor", hint: "두 모서리를 누르거나 끌어서 바닥 마감 영역을 그립니다." },
  { key: "window", label: "창", icon: "window", hint: "벽이나 칸막이 위를 눌러 창을 넣습니다." },
  { key: "door", label: "문", icon: "door", hint: "벽이나 칸막이 위를 눌러 문을 넣습니다." },
];

function renderTools() {
  $("#tools").innerHTML = TOOLS.map((t) => t === "sep" ? "<hr>" :
    `<button class="tool" type="button" data-tool="${t.key}" aria-pressed="${ui.tool === t.key}" title="${esc(t.hint)}"><svg viewBox="0 0 24 24">${ICONS[t.icon]}</svg>${t.label}</button>`).join("");
}
$("#tools").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tool]");
  if (!b) return;
  setTool(b.dataset.tool);
});
function setTool(t) {
  ui.tool = t;
  ui.draft = null;
  if (t in ui.layers) ui.layers[t] = true; // 그리는 종류는 화면에 보이게
  if (ui.mode === "3d" && t !== "select") setMode("2d");
  renderTools();
  renderStage();
}

/* ---------------- 평면 (2D) ---------------- */

const PALETTE = {
  wall: "var(--gray-800)",
  partition: "#B07A45",
  column: "#6B6560",
  beam: "#4A6FA5",
};
let svg = null;

function fitView() {
  const st = $("#stage");
  const w = st.clientWidth || 800, h = st.clientHeight || 600;
  const els = model.elements.filter((e) => e.levelId === ui.levelId);
  let minX = 0, minY = 0, maxX = 20, maxY = 12;
  if (els.length) {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const e of els) {
      const pts = e.x1 !== undefined ? [[e.x1, e.y1], [e.x2, e.y2]] : e.w !== undefined ? [[e.x, e.y], [e.x + e.w, e.y + e.d]] : [];
      for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 20; maxY = 12; }
  }
  const pad = 60;
  const s = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY));
  ui.view = { s: Math.max(4, Math.min(s, 200)), ox: (w - (maxX - minX) * s) / 2 - minX * s, oy: (h - (maxY - minY) * s) / 2 - minY * s };
}

const sx = (x) => ui.view.ox + x * ui.view.s;
const sy = (y) => ui.view.oy + y * ui.view.s;
const wx = (px) => (px - ui.view.ox) / ui.view.s;
const wy = (py) => (py - ui.view.oy) / ui.view.s;

function openingGeom(o) {
  const host = model.elements.find((e) => e.id === o.hostId);
  if (!host) return null;
  const len = lineLength(host);
  if (!len) return null;
  const ux = (host.x2 - host.x1) / len, uy = (host.y2 - host.y1) / len;
  const c = len * o.t, half = (o.width || 1) / 2;
  return {
    host, ux, uy,
    a: [host.x1 + ux * (c - half), host.y1 + uy * (c - half)],
    b: [host.x1 + ux * (c + half), host.y1 + uy * (c + half)],
    t: Number(host.thickness) || TYPES[host.type].defaults.thickness,
  };
}

function elementSvg(e, sel) {
  const s = ui.view.s;
  const selCls = sel ? " sel" : "";
  const stroke = sel ? "var(--color-primary)" : null;
  const common = `data-id="${e.id}" class="el${selCls}"`;
  switch (TYPES[e.type]?.kind) {
    case "line": {
      if (e.type === "beam") {
        return `<line ${common} x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${stroke || PALETTE.beam}" stroke-width="${Math.max(2, (Number(e.thickness) || 0.3) * s)}" stroke-dasharray="${6} ${4}" opacity=".55" stroke-linecap="butt"/>`;
      }
      const t = Number(e.thickness) || TYPES[e.type].defaults.thickness;
      const color = e.type === "wall" ? (ASSEMBLIES[e.assembly]?.layers?.length > 1 ? "var(--gray-600)" : PALETTE.wall) : (e.assembly === "partition.brick" ? "#B85C4A" : PALETTE.partition);
      return `<line ${common} x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${stroke || color}" stroke-width="${Math.max(3, t * s)}" stroke-linecap="square"/>`;
    }
    case "point":
      return `<rect ${common} x="${sx(e.x)}" y="${sy(e.y)}" width="${e.w * s}" height="${e.d * s}" fill="${stroke || PALETTE.column}"/>`;
    case "rect": {
      const x = Math.min(e.x, e.x + e.w), y = Math.min(e.y, e.y + e.d);
      const w = Math.abs(e.w) * s, h = Math.abs(e.d) * s;
      if (e.type === "slab") return `<rect ${common} x="${sx(x)}" y="${sy(y)}" width="${w}" height="${h}" fill="var(--surface)" stroke="${stroke || "var(--border)"}" stroke-width="${sel ? 3 : 1}"/>`;
      const waste = MATERIALS[ASSEMBLIES[e.assembly]?.layers?.slice(-1)[0]?.m]?.waste || "mixed";
      if (e.type === "floorFinish") return `<rect ${common} x="${sx(x)}" y="${sy(y)}" width="${w}" height="${h}" fill="${WASTE[waste].color}" fill-opacity=".18" stroke="${stroke || WASTE[waste].color}" stroke-opacity="${sel ? 1 : 0.5}" stroke-width="${sel ? 3 : 1}"/>`;
      return `<rect ${common} x="${sx(x) + 3}" y="${sy(y) + 3}" width="${Math.max(0, w - 6)}" height="${Math.max(0, h - 6)}" fill="none" stroke="${stroke || "var(--color-secondary)"}" stroke-width="${sel ? 3 : 1.5}" stroke-dasharray="8 5" pointer-events="stroke"/>`;
    }
    case "opening": {
      const g = openingGeom(e);
      if (!g) return "";
      const w = Math.max(4, g.t * s + 2);
      const color = stroke || (e.type === "window" ? "#7FB3D5" : "#E8742A");
      let out = `<g ${common}><line x1="${sx(g.a[0])}" y1="${sy(g.a[1])}" x2="${sx(g.b[0])}" y2="${sy(g.b[1])}" stroke="var(--bg)" stroke-width="${w}"/>`;
      out += `<line x1="${sx(g.a[0])}" y1="${sy(g.a[1])}" x2="${sx(g.b[0])}" y2="${sy(g.b[1])}" stroke="${color}" stroke-width="${e.type === "window" ? 3 : 2}"/>`;
      if (e.type === "door") {
        const nx = -g.uy, ny = g.ux, r = (e.width || 0.9) * s;
        out += `<path d="M${sx(g.a[0])},${sy(g.a[1])} l${nx * r},${ny * r} A${r},${r} 0 0 1 ${sx(g.b[0])},${sy(g.b[1])}" fill="none" stroke="${color}" stroke-width="1" opacity=".7"/>`;
      }
      out += `<line x1="${sx(g.a[0])}" y1="${sy(g.a[1])}" x2="${sx(g.b[0])}" y2="${sy(g.b[1])}" stroke="transparent" stroke-width="${w + 8}"/></g>`;
      return out;
    }
  }
  return "";
}

function gridSvg(w, h) {
  const s = ui.view.s;
  const step = s < 8 ? 5 : 1;
  const x0 = Math.floor(wx(0) / step) * step, x1 = wx(w), y0 = Math.floor(wy(0) / step) * step, y1 = wy(h);
  let out = "";
  for (let x = x0; x <= x1; x += step) out += `<line x1="${sx(x)}" y1="0" x2="${sx(x)}" y2="${h}" stroke="var(--border)" stroke-opacity="${x % 5 === 0 ? 0.9 : 0.4}"/>`;
  for (let y = y0; y <= y1; y += step) out += `<line x1="0" y1="${sy(y)}" x2="${w}" y2="${sy(y)}" stroke="var(--border)" stroke-opacity="${y % 5 === 0 ? 0.9 : 0.4}"/>`;
  return out;
}

const ORDER = { slab: 0, floorFinish: 1, ceiling: 2, beam: 3, partition: 4, wall: 5, column: 6, window: 7, door: 7 };

function drawPlan() {
  if (!svg) return;
  const st = $("#stage");
  const w = st.clientWidth, h = st.clientHeight;
  if (!ui.view) fitView();
  const els = model.elements
    .filter((e) => e.levelId === ui.levelId && (ui.layers[e.type] ?? true))
    .sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  let out = `<g class="grid">${gridSvg(w, h)}</g><g class="els">`;
  for (const e of els) out += elementSvg(e, e.id === ui.selectedId);
  out += "</g>";
  // 선택한 선형 부재의 끝점 손잡이
  const sel = selected();
  if (sel && sel.levelId === ui.levelId && sel.x1 !== undefined) {
    for (const [k, x, y] of [["1", sel.x1, sel.y1], ["2", sel.x2, sel.y2]]) {
      out += `<circle data-handle="${k}" cx="${sx(x)}" cy="${sy(y)}" r="7" fill="var(--surface)" stroke="var(--color-primary)" stroke-width="2" style="cursor:move"/>`;
    }
  }
  // 그리는 중인 부재 미리보기
  const d = ui.draft;
  if (d?.start && d.cur) {
    const [a, b] = [d.start, d.cur];
    if (TYPES[ui.tool]?.kind === "line") {
      const t = TYPES[ui.tool].defaults.thickness;
      out += `<line x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(b.x)}" y2="${sy(b.y)}" stroke="var(--color-primary)" stroke-opacity=".6" stroke-width="${Math.max(3, t * ui.view.s)}" stroke-linecap="square"/>`;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      out += `<text x="${(sx(a.x) + sx(b.x)) / 2 + 8}" y="${(sy(a.y) + sy(b.y)) / 2 - 8}" fill="var(--text)" font-size="12" font-weight="600">${r2(L)} m</text>`;
    } else if (TYPES[ui.tool]?.kind === "rect") {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), W = Math.abs(b.x - a.x), H = Math.abs(b.y - a.y);
      out += `<rect x="${sx(x)}" y="${sy(y)}" width="${W * ui.view.s}" height="${H * ui.view.s}" fill="var(--color-primary)" fill-opacity=".12" stroke="var(--color-primary)" stroke-dasharray="4 3"/>`;
      out += `<text x="${sx(x) + 6}" y="${sy(y) - 6}" fill="var(--text)" font-size="12" font-weight="600">${r2(W)} × ${r2(H)} m = ${r1(W * H)} ㎡</text>`;
    }
  }
  if (d?.cur) out += `<circle cx="${sx(d.cur.x)}" cy="${sy(d.cur.y)}" r="4" fill="var(--color-primary)"/>`;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = out;
  const hint = $("#hint");
  if (hint) hint.textContent = TOOLS.find((t) => t.key === ui.tool)?.hint || "";
}

function renderStage() {
  const st = $("#stage");
  disposeThree();
  if (ui.mode === "3d") return render3d();
  const lv = level();
  st.innerHTML = `
    <svg class="plan" id="plan" aria-label="${esc(lv?.name)} 평면"></svg>
    <div class="stage-layers">
      ${[["slab", "슬래브"], ["floorFinish", "바닥 마감"], ["ceiling", "천장"]].map(([k, l]) => `<button class="chip-toggle" type="button" data-layer="${k}" aria-pressed="${ui.layers[k]}">${l}</button>`).join("")}
    </div>
    ${ui.tool !== "select" ? `<div class="stage-hint" id="hint"></div>` : ""}
    <div class="stage-hud"><span class="hud-chip" id="coord">${esc(lv?.name)} · 높이 ${lv?.height} m</span></div>
    <div class="stage-zoom">
      <button class="icon-btn" type="button" data-zoom="in" aria-label="확대"><svg class="i"><use href="#i-plus"/></svg></button>
      <button class="icon-btn" type="button" data-zoom="out" aria-label="축소"><svg class="i"><path d="M5 12h14"/></svg></button>
      <button class="icon-btn" type="button" data-zoom="fit" aria-label="화면에 맞춤"><svg class="i"><use href="#i-box"/></svg></button>
    </div>`;
  svg = $("#plan");
  bindPlan(svg);
  st.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => { ui.layers[b.dataset.layer] = !ui.layers[b.dataset.layer]; renderStage(); }));
  st.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.zoom === "fit") { fitView(); return drawPlan(); }
    zoomAt(st.clientWidth / 2, st.clientHeight / 2, b.dataset.zoom === "in" ? 1.25 : 0.8);
  }));
  drawPlan();
}

function zoomAt(px, py, f) {
  const x = wx(px), y = wy(py);
  ui.view.s = Math.max(3, Math.min(400, ui.view.s * f));
  ui.view.ox = px - x * ui.view.s;
  ui.view.oy = py - y * ui.view.s;
  drawPlan();
}

// 스냅: 끝점·모서리(화면 10px 이내) → 0.1m 격자. 선형 도구는 수평·수직 고정.
function snapPoint(px, py, { from = null } = {}) {
  let x = wx(px), y = wy(py);
  const tol = 10 / ui.view.s;
  let best = null, bd = tol;
  for (const e of model.elements) {
    if (e.levelId !== ui.levelId) continue;
    const pts = e.x1 !== undefined ? [[e.x1, e.y1], [e.x2, e.y2]] : e.w !== undefined && e.type !== "column" ? [[e.x, e.y], [e.x + e.w, e.y], [e.x, e.y + e.d], [e.x + e.w, e.y + e.d]] : [];
    for (const [ex, ey] of pts) { const dd = Math.hypot(ex - x, ey - y); if (dd < bd) { bd = dd; best = { x: ex, y: ey }; } }
  }
  if (best) return { ...best, snapped: true };
  x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10;
  if (from) {
    const dx = x - from.x, dy = y - from.y;
    const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 90;
    if (ang < 8 || ang > 82) { if (Math.abs(dx) > Math.abs(dy)) y = from.y; else x = from.x; }
  }
  return { x, y };
}

function nearestLine(x, y, maxD = 0.6) {
  let best = null, bd = maxD;
  for (const e of model.elements) {
    if (e.levelId !== ui.levelId || (e.type !== "wall" && e.type !== "partition")) continue;
    const L = lineLength(e);
    if (!L) continue;
    const ux = (e.x2 - e.x1) / L, uy = (e.y2 - e.y1) / L;
    const t = Math.max(0, Math.min(L, (x - e.x1) * ux + (y - e.y1) * uy));
    const d = Math.hypot(e.x1 + ux * t - x, e.y1 + uy * t - y);
    if (d < bd) { bd = d; best = { e, t: t / L, L }; }
  }
  return best;
}

function bindPlan(el) {
  const pos = (ev) => { const r = el.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  el.addEventListener("wheel", (ev) => { ev.preventDefault(); const [px, py] = pos(ev); zoomAt(px, py, ev.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });

  el.addEventListener("pointerdown", (ev) => {
    const [px, py] = pos(ev);
    el.setPointerCapture(ev.pointerId);
    const tool = ui.tool;
    const kind = TYPES[tool]?.kind;
    // 가운데 버튼이나 Space 누른 상태는 항상 화면 이동
    if (ev.button === 1 || ev.button === 2 || spaceDown) { ui.drag = { pan: true, px, py, ox: ui.view.ox, oy: ui.view.oy }; return; }
    if (tool === "select") {
      const handle = ev.target.closest("[data-handle]");
      const target = ev.target.closest("[data-id]");
      if (handle && selected()) { snapshot(); ui.drag = { handle: handle.dataset.handle, moved: false }; return; }
      if (target) {
        const id = target.dataset.id;
        if (ui.selectedId !== id) { ui.selectedId = id; ui.tab = "props"; renderPanel(); drawPlan(); }
        const e = selected();
        snapshot();
        ui.drag = { move: true, start: { x: wx(px), y: wy(py) }, orig: JSON.parse(JSON.stringify(e)), moved: false };
        return;
      }
      if (ui.selectedId) { ui.selectedId = null; renderPanel(); }
      ui.drag = { pan: true, px, py, ox: ui.view.ox, oy: ui.view.oy };
      drawPlan();
      return;
    }
    if (kind === "line") {
      const p = snapPoint(px, py, { from: ui.draft?.start });
      if (!ui.draft?.start) { ui.draft = { start: p, cur: p }; drawPlan(); return; }
      if (Math.hypot(p.x - ui.draft.start.x, p.y - ui.draft.start.y) < 0.05) { ui.draft = null; drawPlan(); return; }
      const a = ui.draft.start;
      let id;
      mutate((m) => { const e = newElement(tool, ui.levelId, { x1: a.x, y1: a.y, x2: p.x, y2: p.y }); id = e.id; m.elements.push(e); });
      ui.selectedId = id;
      ui.draft = tool === "beam" ? null : { start: p, cur: p };
      renderPanel(); drawPlan();
      return;
    }
    if (kind === "rect") {
      const p = snapPoint(px, py);
      if (!ui.draft?.start) { ui.draft = { start: p, cur: p, down: true }; drawPlan(); return; }
      finishRect(p);
      return;
    }
    if (kind === "point") {
      const p = snapPoint(px, py);
      const { w, d } = TYPES[tool].defaults;
      let id;
      mutate((m) => { const e = newElement(tool, ui.levelId, { x: p.x - w / 2, y: p.y - d / 2, w, d }); id = e.id; m.elements.push(e); });
      ui.selectedId = id; renderPanel(); drawPlan();
      return;
    }
    if (kind === "opening") {
      const hit = nearestLine(wx(px), wy(py));
      if (!hit) { flash("벽이나 칸막이 위를 눌러 주세요."); return; }
      const def = TYPES[tool].defaults;
      const half = def.width / 2 / hit.L;
      const t = Math.max(half, Math.min(1 - half, hit.t));
      let id;
      mutate((m) => { const e = newElement(tool, ui.levelId, { hostId: hit.e.id, t }); id = e.id; m.elements.push(e); });
      ui.selectedId = id; renderPanel(); drawPlan();
    }
  });

  el.addEventListener("pointermove", (ev) => {
    const [px, py] = pos(ev);
    const c = $("#coord");
    if (c) c.textContent = `${level()?.name} · x ${r2(wx(px))} m, y ${r2(wy(py))} m`;
    const d = ui.drag;
    if (d?.pan) { ui.view.ox = d.ox + px - d.px; ui.view.oy = d.oy + py - d.py; drawPlan(); return; }
    if (d?.handle) {
      const e = selected();
      const other = d.handle === "1" ? { x: e.x2, y: e.y2 } : { x: e.x1, y: e.y1 };
      const p = snapPoint(px, py, { from: other });
      e["x" + d.handle] = p.x; e["y" + d.handle] = p.y;
      d.moved = true; ui.cache = null;
      drawPlan();
      return;
    }
    if (d?.move) {
      const e = selected();
      let dx = Math.round((wx(px) - d.start.x) * 10) / 10, dy = Math.round((wy(py) - d.start.y) * 10) / 10;
      if (!dx && !dy) return;
      d.moved = true;
      const o = d.orig;
      if (e.x1 !== undefined) Object.assign(e, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
      else if (e.x !== undefined) Object.assign(e, { x: o.x + dx, y: o.y + dy });
      else if (e.hostId) {
        const g = openingGeom(o);
        if (g) {
          const L = lineLength(g.host);
          const half = (e.width || 1) / 2 / L;
          e.t = Math.max(half, Math.min(1 - half, o.t + (dx * g.ux + dy * g.uy) / L));
        }
      }
      ui.cache = null;
      drawPlan();
      return;
    }
    if (ui.draft?.start || TYPES[ui.tool]) {
      const p = snapPoint(px, py, { from: TYPES[ui.tool]?.kind === "line" ? ui.draft?.start : null });
      ui.draft = { ...(ui.draft || {}), cur: p };
      drawPlan();
    }
  });

  el.addEventListener("pointerup", (ev) => {
    const d = ui.drag;
    ui.drag = null;
    if (d?.move || d?.handle) {
      if (!d.moved) history.pop(); // 실제로 움직이지 않았으면 되돌리기 기록을 지운다
      else { ui.mc = null; save(); renderPanel(); }
      return;
    }
    // 사각형: 끌어서 놓으면 바로 완성
    if (ui.draft?.down && TYPES[ui.tool]?.kind === "rect") {
      const [px, py] = pos(ev);
      const p = snapPoint(px, py);
      ui.draft.down = false;
      if (Math.abs(p.x - ui.draft.start.x) > 0.2 && Math.abs(p.y - ui.draft.start.y) > 0.2) finishRect(p);
    }
  });
  el.addEventListener("dblclick", () => { ui.draft = null; drawPlan(); });
  el.addEventListener("contextmenu", (ev) => ev.preventDefault());
}

function finishRect(p) {
  const a = ui.draft.start;
  const x = Math.min(a.x, p.x), y = Math.min(a.y, p.y), w = Math.abs(p.x - a.x), d = Math.abs(p.y - a.y);
  ui.draft = null;
  if (w < 0.1 || d < 0.1) { drawPlan(); return; }
  let id;
  mutate((m) => { const e = newElement(ui.tool, ui.levelId, { x, y, w, d }); id = e.id; m.elements.push(e); });
  ui.selectedId = id;
  renderPanel(); drawPlan();
}

let flashTimer = 0;
function flash(msg) {
  const h = $("#hint");
  if (!h) return;
  h.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => drawPlan(), 1800);
}

/* ---------------- 3D ---------------- */

let three = null, threeView = null;
function disposeThree() {
  if (three) { threeView = three.view(); three.dispose(); three = null; }
}
async function render3d() {
  const st = $("#stage");
  st.innerHTML = `<div class="three" id="three"></div>
    <div class="stage-layers">
      <button class="chip-toggle" type="button" data-color="decision" aria-pressed="${ui.color3d === "decision"}">최적안 결정</button>
      <button class="chip-toggle" type="button" data-color="waste" aria-pressed="${ui.color3d === "waste"}">폐기물 성상</button>
      <button class="chip-toggle" type="button" data-only="1" aria-pressed="${!!ui.only3d}">현재 층만</button>
    </div>
    <div class="stage-hud" id="legend3d"></div>`;
  st.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => { ui.color3d = b.dataset.color; renderStage(); }));
  st.querySelector("[data-only]").addEventListener("click", () => { ui.only3d = !ui.only3d; threeView = null; renderStage(); });
  const legend = ui.color3d === "decision"
    ? [["#1baf7a", "분별 해체"], ["#b2aba1", "일괄 철거"], ["#9c9084", "구조체(공통)"], ["#e8742a", "선택"]]
    : Object.values(WASTE).map((w) => [w.color, w.label]);
  $("#legend3d").innerHTML = legend.map(([c, l]) => `<span class="hud-chip"><span class="swatch" style="background:${c}"></span>${esc(l)}</span>`).join("");
  try {
    const { createModel3D } = await import("./view3d.js");
    if (ui.mode !== "3d") return;
    const r = results();
    three = createModel3D($("#three"), {
      model, q: r.q, result: r.optimal, colorBy: ui.color3d, levelId: ui.only3d ? ui.levelId : null, selectedId: ui.selectedId,
      onPick: (id) => { ui.selectedId = id; ui.tab = "props"; renderPanel(); renderStage(); },
    });
    three.setView(threeView);
  } catch (err) {
    $("#three").innerHTML = `<div class="callout" style="margin:16px">3D 화면을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. (${esc(err.message)})</div>`;
  }
}

function setMode(m) {
  ui.mode = m;
  if (m === "2d") threeView = null;
  $("#view-2d").setAttribute("aria-pressed", m === "2d");
  $("#view-3d").setAttribute("aria-pressed", m === "3d");
  renderStage();
}

/* ---------------- 오른쪽 패널 ---------------- */

const TABS = [["props", "속성"], ["qty", "물량"], ["compare", "공법 비교"]];
function renderTabs() {
  $("#tabs").innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${l}</button>`).join("");
}
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  ui.tab = b.dataset.tab;
  renderPanel();
});

function renderPanel() {
  renderTabs();
  const p = $("#panel");
  if (ui.tab === "props") p.innerHTML = selected() ? elementPanel(selected()) : modelPanel();
  else if (ui.tab === "qty") p.innerHTML = qtyPanel();
  else p.innerHTML = comparePanel();
  bindTips(p);
}

const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${String(k) === String(cur) ? "selected" : ""}>${esc(v)}</option>`).join("");
const num = (key, val, attrs = 'step="0.1"') => `<input class="input" type="number" data-k="${key}" value="${val ?? ""}" ${attrs}>`;

function elementPanel(e) {
  const type = TYPES[e.type];
  const r = results();
  const q = r.q[e.id] || { tons: {}, area: 0, volume: 0, work: [] };
  const asms = Object.fromEntries(Object.entries(ASSEMBLIES).filter(([, a]) => a.type === e.type).map(([k, a]) => [k, a.label]));
  const lvOpts = Object.fromEntries(model.levels.map((l) => [l.id, l.name]));
  let geom = "";
  if (type.kind === "line") {
    geom = `<div class="field"><label>시작 x (m)</label>${num("x1", e.x1)}</div><div class="field"><label>시작 y (m)</label>${num("y1", e.y1)}</div>
      <div class="field"><label>끝 x (m)</label>${num("x2", e.x2)}</div><div class="field"><label>끝 y (m)</label>${num("y2", e.y2)}</div>
      <div class="field"><label>${e.type === "beam" ? "폭" : "두께"} (m)</label>${num("thickness", e.thickness, 'step="0.01" min="0.01"')}</div>
      ${e.type === "beam" ? `<div class="field"><label>춤 (m)</label>${num("depth", e.depth, 'step="0.05" min="0.1"')}</div>` : `<div class="field"><label>높이 (m, 빈칸=층고)</label>${num("height", e.height, 'step="0.1" min="0.1"')}</div>`}
      <div class="full sub">길이 ${r2(lineLength(e))} m</div>`;
  } else if (type.kind === "rect" || type.kind === "point") {
    geom = `<div class="field"><label>x (m)</label>${num("x", e.x)}</div><div class="field"><label>y (m)</label>${num("y", e.y)}</div>
      <div class="field"><label>가로 (m)</label>${num("w", e.w, 'step="0.1" min="0.1"')}</div><div class="field"><label>세로 (m)</label>${num("d", e.d, 'step="0.1" min="0.1"')}</div>
      ${type.kind === "point" ? `<div class="field"><label>높이 (m, 빈칸=층고)</label>${num("height", e.height)}</div>` : ""}`;
  } else if (type.kind === "opening") {
    const g = openingGeom(e);
    const L = g ? lineLength(g.host) : 0;
    geom = `<div class="field"><label>폭 (m)</label>${num("width", e.width, 'step="0.1" min="0.3"')}</div><div class="field"><label>높이 (m)</label>${num("height", e.height, 'step="0.1" min="0.3"')}</div>
      <div class="field"><label>바닥에서 (m)</label>${num("sill", e.sill, 'step="0.1" min="0"')}</div><div class="field"><label>벽 시작점에서 (m)</label><input class="input" type="number" step="0.1" data-k="tpos" value="${r2(e.t * L)}"></div>
      <div class="full sub">${g ? `${esc(TYPES[g.host.type].label)} 위 (길이 ${r2(L)} m)` : "벽이 지워졌습니다"}</div>`;
  }
  const per = r.optimal.perElement[e.id];
  const g = r.full.perElement[e.id], s = r.selective.perElement[e.id];
  const eligible = isEligible(e);
  const delta = eligible && g && s ? s.net - g.net : null;
  const tonsRows = Object.entries(q.tons).filter(([, t]) => t > 0.0005).map(([w, t]) => `<tr><td><span class="swatch" style="background:${WASTE[w].color}"></span>${esc(WASTE[w].label)}</td><td class="r">${t < 0.1 ? r2(t * 1000) + " kg" : r2(t) + " t"}</td></tr>`).join("");
  const work = (q.work || []).map((k) => {
    const it = WORK_ITEMS[k];
    const fmt = (p) => Object.entries(p).map(([t, v]) => `${TRADES[t]} ${v}`).join(", ") || "없음";
    return `<tr><td>${esc(it.label)}</td><td>${fmt(it.general)}</td><td>${fmt(it.selective)}</td></tr>`;
  }).join("");
  return `
  <div class="section">
    <div class="sec-head"><h4>${esc(type.label)}</h4><button class="btn btn-ghost btn-sm" type="button" data-act="delete"><svg class="i"><use href="#i-trash"/></svg>삭제</button></div>
    <div class="field"><label>구성</label><select class="select" data-k="assembly">${opt(asms, e.assembly)}</select></div>
    <div class="fgrid">${geom}<div class="field full"><label>층</label><select class="select" data-k="levelId">${opt(lvOpts, e.levelId)}</select></div></div>
  </div>
  <div class="section">
    <h4>해체 정보</h4>
    <div class="field"><label>해체 시공성 (논문 표 1, 6점 척도)</label><select class="select" data-k="separable">${opt(Object.fromEntries(Object.entries(SEPARABLE).reverse().map(([k, v]) => [k, `${k}점 · ${v}`])), e.separable)}</select></div>
    <div class="fgrid">
      <div class="field"><label>접합 방식</label><select class="select" data-k="connection">${opt(CONNECTIONS, e.connection)}</select></div>
      <div class="field"><label>유해물질</label><select class="select" data-k="hazard">${opt(HAZARD, e.hazard)}</select></div>
    </div>
    <div class="field"><label>메모</label><input class="input" data-k="note" value="${esc(e.note)}" placeholder="현장 확인 사항"></div>
    ${!type.structural || (ASSEMBLIES[e.assembly]?.work || []).length ? `
      <div class="callout ${eligible ? (per?.method === "selective" ? "ok" : "info") : ""}">
        ${!(ASSEMBLIES[e.assembly]?.work || []).length ? "해체 작업이 없는 구성입니다. 두 방법에 공통으로 처리합니다."
          : e.hazard !== "none" ? "유해물질이 있어 석면 해체 공정(두 방법 공통)으로 처리합니다."
          : !eligible ? `해체 시공성이 ${SEPARABLE_MIN}점 미만이라 분별 해체 대상에서 뺐습니다.`
          : `분별 해체하면 이 부재만으로 <b>${signed(kw(delta))}천원</b> (인건비 + 처리비 − 재활용 수익). 최적 혼합안: <b>${per?.method === "selective" ? "분별 해체" : "일괄 철거"}</b>`}
      </div>` : ""}
  </div>
  <div class="section">
    <h4>물량</h4>
    <dl class="kv">
      ${q.area ? `<dt>해체 면적</dt><dd>${r1(q.area)} ㎡</dd>` : ""}
      ${q.volume ? `<dt>부피</dt><dd>${r2(q.volume)} ㎥</dd>` : ""}
    </dl>
    ${tonsRows ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>성상</th><th class="r">양</th></tr></thead><tbody>${tonsRows}</tbody></table></div>` : ""}
    ${work ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>해체 작업</th><th>일반 (인/㎡)</th><th>분별 (인/㎡)</th></tr></thead><tbody>${work}</tbody></table></div>` : ""}
  </div>`;
}

function modelPanel() {
  const lvRows = model.levels.map((l) => `
    <tr><td><input class="input" data-level="${l.id}" data-lk="name" value="${esc(l.name)}" style="min-width:64px"></td>
    <td><input class="input" type="number" step="0.1" data-level="${l.id}" data-lk="elevation" value="${l.elevation}"></td>
    <td><input class="input" type="number" step="0.1" data-level="${l.id}" data-lk="height" value="${l.height}"></td>
    <td class="r">${model.elements.filter((e) => e.levelId === l.id).length}</td></tr>`).join("");
  const els = model.elements.filter((e) => e.levelId === ui.levelId);
  const groups = Object.entries(TYPES).map(([k, t]) => {
    const list = els.filter((e) => e.type === k);
    if (!list.length) return "";
    return `<details class="group"><summary>${esc(t.label)} ${list.length}개</summary><div class="items">${list.map((e, i) =>
      `<button class="list-btn" type="button" data-pick="${e.id}"><span>${esc(t.label)} ${i + 1} · ${esc(ASSEMBLIES[e.assembly]?.label || "")}</span></button>`).join("")}</div></details>`;
  }).join("");
  return `
  <div class="section">
    <h4>모델</h4>
    <div class="field"><label>이름</label><input class="input" data-mk="name" value="${esc(model.name)}"></div>
    <div class="field"><label>용도·구조 (폐기물 원단위 기준)</label><select class="select" data-mk="use">${opt(Object.fromEntries(Object.keys(WASTE_UNIT).map((k) => [k, k])), model.use)}</select></div>
    <p class="note">부재를 누르면 이 자리에 부재 속성이 나옵니다. 왼쪽 도구로 벽·칸막이·천장·바닥·창·문을 그려 보세요.</p>
  </div>
  <div class="section">
    <div class="sec-head"><h4>층</h4><button class="btn btn-ghost btn-sm" type="button" data-act="add-level"><svg class="i"><use href="#i-plus"/></svg>빈 층</button></div>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>이름</th><th>바닥 높이</th><th>층고</th><th class="r">부재</th></tr></thead><tbody>${lvRows}</tbody></table></div>
    <div class="fgrid">
      <div class="field"><label>현재 층(${esc(level()?.name)})을 위로 복사</label><input class="input" type="number" min="1" max="50" value="1" id="copy-n"></div>
      <div class="field" style="justify-content:flex-end"><button class="btn btn-outline btn-sm" type="button" data-act="copy-level">기준층 복사</button></div>
    </div>
    ${model.levels.length > 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-act="del-level" style="justify-self:start"><svg class="i"><use href="#i-trash"/></svg>현재 층 삭제</button>` : ""}
  </div>
  <div class="section"><h4>${esc(level()?.name)} 부재 ${els.length}개</h4>${groups || '<p class="note">아직 부재가 없습니다.</p>'}</div>`;
}

function totalsByWaste(q) {
  const out = {};
  for (const t of Object.values(q)) for (const [w, v] of Object.entries(t.tons)) out[w] = (out[w] || 0) + v;
  return out;
}

function qtyPanel() {
  const r = results();
  const gfa = grossFloorArea(model);
  const tot = totalsByWaste(r.q);
  const unit = WASTE_UNIT[model.use] || {};
  const residual = residualMixedTons(model, model.params, r.q);
  const rows = Object.entries(WASTE).filter(([k]) => k !== "mixed" && tot[k] > 0).map(([k, w]) => {
    const pu = unit[k];
    const mine = gfa ? tot[k] / gfa : 0;
    const flag = pu && (mine < pu * 0.5 || mine > pu * 1.5);
    return `<tr><td><span class="swatch" style="background:${w.color}"></span>${esc(w.label)}</td><td class="r">${r1(tot[k])}</td><td class="r">${mine.toFixed(4)}</td><td class="r">${pu ? pu.toFixed(4) : "–"}${flag ? ' <span class="badge badge-warning" title="원단위와 50% 넘게 다름">차이</span>' : ""}</td></tr>`;
  }).join("");
  const byType = Object.entries(TYPES).map(([k, t]) => {
    const list = model.elements.filter((e) => e.type === k);
    if (!list.length) return "";
    const area = list.reduce((s, e) => s + (r.q[e.id]?.area || 0), 0);
    const len = TYPES[k].kind === "line" ? list.reduce((s, e) => s + lineLength(e), 0) : 0;
    return `<tr><td>${esc(t.label)}</td><td class="r">${list.length}</td><td class="r">${len ? r1(len) + " m" : ""}</td><td class="r">${area ? r1(area) + " ㎡" : ""}</td></tr>`;
  }).join("");
  return `
  <div class="section">
    <h4>폐기물 발생량</h4>
    <dl class="kv"><dt>연면적 (슬래브 합)</dt><dd>${r1(gfa)} ㎡</dd><dt>층수</dt><dd>${model.levels.length}개 층</dd></dl>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>성상</th><th class="r">t</th><th class="r">t/㎡</th><th class="r">원단위</th></tr></thead><tbody>
      ${rows || '<tr><td colspan="4" class="muted">부재가 없습니다</td></tr>'}
      <tr><td><span class="swatch" style="background:${WASTE.mixed.color}"></span>모델 밖 혼합폐기물 (보정)</td><td class="r">${r1(residual)}</td><td class="r">${gfa ? (residual / gfa).toFixed(4) : "–"}</td><td class="r">${unit.mixed?.toFixed(4) ?? "–"}</td></tr>
    </tbody></table></div>
    <p class="note">원단위는 논문 표 6(국토교통부 2023 표준품셈, ${esc(model.use)})입니다. 모델의 t/㎡이 원단위와 크게 다르면 빠진 부재가 있는지 확인하세요. 기초·계단·설비는 아직 그릴 수 없어 폐콘크리트가 원단위보다 적게 나옵니다.</p>
  </div>
  <div class="section">
    <h4>부재 종류별</h4>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>종류</th><th class="r">개수</th><th class="r">길이</th><th class="r">해체 면적</th></tr></thead><tbody>${byType}</tbody></table></div>
    <p class="note">재료 밀도는 가정값입니다 (예: 철근콘크리트 2.45, 합판 0.6, 석고보드 0.8 t/㎥). KDS 41 10 15로 확인이 필요합니다.</p>
  </div>`;
}

const SCEN = [
  { key: "full", label: "완전 철거", color: "var(--series-1)" },
  { key: "selective", label: "분별 해체", color: "var(--series-2)" },
  { key: "optimal", label: "최적 혼합안", color: "var(--series-3)" },
];

function comparePanel() {
  const r = results();
  const p = mergeParams(model.params);
  const best = SCEN.reduce((a, b) => (r[b.key].total < r[a.key].total ? b : a));
  const base = r.full.total;
  const cards = SCEN.map((s) => {
    const t = r[s.key].total;
    return `<div class="scen-card ${s.key === best.key ? "best" : ""}"><span class="label"><span class="swatch" style="background:${s.color}"></span>${s.label}</span>
      <span class="val">${mw(t)}</span><span class="d">${s.key === "full" ? "기준" : signed(mw(t - base))} · ${r1(r[s.key].days)}일</span></div>`;
  }).join("");
  const items = [
    ["시공비 (인건비)", (x) => x.laborCost],
    ["처리비", (x) => x.disposalCost],
    ["재활용 수익", (x) => x.revenueTotal],
    ...(p.indirectPerDay ? [["공기 간접비", (x) => x.indirect]] : []),
  ];
  const chart = groupedBars({
    categories: items.map(([l, f]) => ({ label: l, values: SCEN.map((s) => f(r[s.key]) / 1e6) })),
    series: SCEN.map((s) => ({ label: s.label, color: s.color })),
    unit: "백만원",
    fmt: (v) => (Math.round(v * 10) / 10).toLocaleString(),
  });
  const tableRows = items.map(([l, f]) => `<tr><td>${l}</td>${SCEN.map((s) => { const v = f(r[s.key]); return `<td class="r">${l === "재활용 수익" && v > 0 ? "−" : ""}${mw(v)}</td>`; }).join("")}</tr>`).join("");
  const pickN = r.optimalSet.size, eligN = r.eligible.size;
  const sortCost = r.selective.sorting?.laborCost || 0;
  const pc = paperCase(model.params, { area: grossFloorArea(model) || 2400, use: model.use });

  // 왜 분별이 불리/유리한지 한 줄 설명
  const dSel = r.selective.total - base;
  const dLabor = r.selective.laborCost - r.full.laborCost;
  const dDisp = r.selective.disposalCost - r.full.disposalCost;
  const dRev = r.selective.revenueTotal;
  return `
  <div class="verdict">
    <strong>이 모델에서는 ${best.label}이 가장 경제적입니다</strong>
    <span>분별 해체 전체: 시공비 ${signed(mw(dLabor))} · 처리비 ${signed(mw(dDisp))} · 재활용 수익 −${mw(dRev)} → <b style="color:#fff">${signed(mw(dSel))}백만원</b></span>
  </div>
  <div class="section">
    <div class="sec-head"><h4>시나리오 총비용</h4><span class="sub">단위: 백만원</span></div>
    <div class="scen-cards">${cards}</div>
    <div class="legend">${SCEN.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`).join("")}</div>
    ${chart}
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>항목</th>${SCEN.map((s) => `<th class="r">${s.label}</th>`).join("")}</tr></thead><tbody>
      ${tableRows}
      <tr><td><b>합계</b></td>${SCEN.map((s) => `<td class="r"><b>${mw(r[s.key].total)}</b></td>`).join("")}</tr>
      <tr><td>공기 (${p.crewSize}인/일)</td>${SCEN.map((s) => `<td class="r">${r1(r[s.key].days)}일</td>`).join("")}</tr>
    </tbody></table></div>
    <p class="note">최적 혼합안: 분별 가능한 부재 ${eligN}개 중 <b>${pickN}개</b>를 분별합니다${pickN ? "" : " (분별할수록 손해라 완전 철거와 같아졌습니다)"}. 분별을 하나라도 하면 연면적 기준 선별·반출 공정(목공 0.1 + 보통인부 0.2 인/㎡, 논문 표 4)이 붙어 <b>${mw(sortCost)}백만원</b>이 고정으로 듭니다. 대신 모델 밖 혼합폐기물 ${r1(r.full.residual?.t || 0)}t의 단가가 ${(p.disposal.mixedGeneral).toLocaleString()} → ${(p.disposal.mixedSelective).toLocaleString()}원/t으로 내려갑니다.</p>
  </div>
  <div class="section">
    <h4>논문 방식과 비교</h4>
    <p class="note">같은 연면적(${r1(pc.area)}㎡)을 논문처럼 <b>모든 품 × 연면적, 원단위 × 연면적</b>으로 계산하면:</p>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Δ (분별 − 일반)</th><th class="r">논문 방식</th><th class="r">이 모델</th></tr></thead><tbody>
      <tr><td>시공비</td><td class="r">${signed(kw(pc.delta.construction))}</td><td class="r">${signed(kw(dLabor))}</td></tr>
      <tr><td>처리비</td><td class="r">${signed(kw(pc.delta.disposal))}</td><td class="r">${signed(kw(dDisp))}</td></tr>
      <tr><td>재활용 수익</td><td class="r">${signed(kw(pc.delta.revenue))}</td><td class="r">${signed(kw(-dRev))}</td></tr>
      <tr><td><b>합계</b></td><td class="r"><b>${signed(kw(pc.delta.total))}</b></td><td class="r"><b>${signed(kw(dSel))}</b></td></tr>
    </tbody></table></div>
    <p class="note">단위: 천원. 2,400㎡·공동주택이면 논문 방식은 논문 결과(−34,727천원)를 재현합니다. 논문은 바닥 타일(0.20→0.02)·천장 모르타르(0.12→0) 같은 품 감소를 <b>건물 전체 면적</b>에 곱해 시공비 증가를 상쇄했습니다. 이 모델은 실제로 그린 부재 면적에만 품을 곱하므로 결과가 다를 수 있습니다.</p>
  </div>
  ${paramsSection(p)}
  ${mcSection()}
  <p class="note">기준: ${esc(PAPER.cite)}. 결과는 전문가 검토를 돕는 1차 스크리닝 자료입니다.</p>`;
}

function paramsSection(p) {
  const n = (path, val, step = 1000) => `<input class="input" type="number" step="${step}" min="0" data-p="${path}" value="${val}">`;
  return `
  <details class="section group">
    <summary>단가·가정 바꾸기</summary>
    <div class="fgrid">
      <div class="field"><label>목공 노임 (원/인)</label>${n("wage.carpenter", p.wage.carpenter)}</div>
      <div class="field"><label>보통인부 노임 (원/인)</label>${n("wage.laborer", p.wage.laborer)}</div>
      <div class="field"><label>혼합폐기물 일반 (원/t)</label>${n("disposal.mixedGeneral", p.disposal.mixedGeneral)}</div>
      <div class="field"><label>혼합폐기물 분별 (원/t)</label>${n("disposal.mixedSelective", p.disposal.mixedSelective)}</div>
      <div class="field"><label>건설폐재류 (원/t)</label>${n("disposal.concrete", p.disposal.concrete)}</div>
      <div class="field"><label>폐목재 처리 (원/t)</label>${n("disposal.wood", p.disposal.wood)}</div>
      <div class="field"><label>폐합성수지 처리 (원/t)</label>${n("disposal.resin", p.disposal.resin)}</div>
      <div class="field"><label>폐목재 수익 (원/t)</label>${n("revenue.wood", p.revenue.wood)}</div>
      <div class="field"><label>폐합성수지 수익 (원/t)</label>${n("revenue.resin", p.revenue.resin)}</div>
      <div class="field"><label>회수율 (0~1)</label>${n("recovery", p.recovery, 0.05)}</div>
      <div class="field"><label>하루 투입 인원</label>${n("crewSize", p.crewSize, 1)}</div>
      <div class="field"><label>공기 간접비 (원/일)</label>${n("indirectPerDay", p.indirectPerDay, 10000)}</div>
      <div class="field full"><label>분별 해체 품 (표 4)</label><select class="select" data-p="table4">${opt({ paper: "논문 표 4 그대로", aligned: "천장 모르타르·바닥 타일을 표 3과 같게" }, p.table4)}</select></div>
      <label class="check full"><input type="checkbox" data-p="residualMixed" ${p.residualMixed !== false ? "checked" : ""}> 모델 밖 혼합폐기물을 원단위로 보정</label>
    </div>
    <p class="note">기본값: 노임·품은 논문 표 3~5, 처리단가는 한국건설자원협회 2023(논문 표 7), 재활용 수익은 논문의 제품 판매가(합판 4,000원/장, 그래뉼 850천원/t)입니다. 공기 간접비는 논문에 없는 항목이라 0으로 둡니다.</p>
    <button class="btn btn-outline btn-sm" type="button" data-act="reset-params" style="justify-self:start">기본값으로</button>
  </details>`;
}

function mcSection() {
  const mc = ui.mc;
  const ranges = Object.values(UNCERTAINTY).map((u) => `<tr><td>${esc(u.label)}</td><td class="r">${u.range.map((v) => v >= 1000 ? v.toLocaleString() : v).join(" / ")}</td></tr>`).join("");
  if (!mc) return `
  <div class="section">
    <h4>불확실성 분석</h4>
    <p class="note">단가와 품을 범위 안에서 2,000번 바꿔 가며 계산해, 분별 해체가 더 경제적일 확률을 구합니다.</p>
    <button class="btn btn-secondary btn-sm" type="button" data-act="mc" style="justify-self:start"><svg class="i"><use href="#i-chart"/></svg>분석 실행</button>
    <details class="group"><summary>범위 (최소 / 최빈 / 최대, 가정값)</summary><div class="table-wrap"><table class="tbl compact"><tbody>${ranges}</tbody></table></div></details>
  </div>`;
  const s = mc.selective, o = mc.optimal;
  const be = mc.breakEven;
  return `
  <div class="section">
    <div class="sec-head"><h4>불확실성 분석</h4><button class="btn btn-ghost btn-sm" type="button" data-act="mc">다시 실행</button></div>
    <div class="scen-cards" style="grid-template-columns:1fr 1fr">
      <div class="scen-card"><span class="label">분별 해체가 더 저렴할 확률</span><span class="val">${(s.pCheaper * 100).toFixed(1)}%</span><span class="d">중앙값 ${signed(mw(s.p50))}백만원</span></div>
      <div class="scen-card"><span class="label">최적안이 더 저렴할 확률</span><span class="val">${(o.pCheaper * 100).toFixed(1)}%</span><span class="d">${o.pCheaper ? `중앙값 ${signed(mw(o.p50))}백만원` : "모든 경우 분별 0개 (= 완전 철거)"}</span></div>
    </div>
    <p class="sub">분별 해체 − 완전 철거 (Δ, 백만원) 분포 · ${mc.n.toLocaleString()}회</p>
    ${histogram(s.values.map((v) => v / 1e6), { fmt: (v) => (Math.round(v * 10) / 10).toLocaleString(), unit: "백만원", zeroLabel: "같음", color: "var(--series-2)" })}
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th></th><th class="r">P10</th><th class="r">P50</th><th class="r">P90</th></tr></thead><tbody>
      <tr><td>분별 해체</td><td class="r">${mw(s.p10)}</td><td class="r">${mw(s.p50)}</td><td class="r">${mw(s.p90)}</td></tr>
      <tr><td>최적 혼합안</td><td class="r">${mw(o.p10)}</td><td class="r">${mw(o.p50)}</td><td class="r">${mw(o.p90)}</td></tr>
    </tbody></table></div>
    <p class="sub">어떤 가정이 결론을 가장 크게 흔드나 (한 변수만 최소↔최대, 검은 선 = 모든 변수 최빈값)</p>
    ${tornado(mc.tornado.map((t) => ({ label: t.label, low: t.low / 1e6, high: t.high / 1e6 })), { base: mc.base / 1e6, fmt: (v) => (Math.round(v * 10) / 10).toLocaleString(), unit: "백만원" })}
    <div class="callout info">손익분기: 폐합성수지를 <b>${be == null ? "–" : be > 5e6 ? "현실적으로 도달 불가 (" + mw(be) + "백만원/t)" : Math.round(be / 1000).toLocaleString() + "천원/t"}</b> 이상에 팔아야 분별 해체 전체가 완전 철거와 같아집니다 (현재 가정 ${Math.round(mergeParams(model.params).revenue.resin / 1000).toLocaleString()}천원/t).</div>
    <details class="group"><summary>범위 (최소 / 최빈 / 최대, 가정값)</summary><div class="table-wrap"><table class="tbl compact"><tbody>${ranges}</tbody></table></div></details>
  </div>`;
}

/* 패널 입력 처리 */
$("#panel").addEventListener("change", (ev) => {
  const t = ev.target;
  const e = selected();
  if (t.dataset.k && e) {
    const k = t.dataset.k;
    let v = t.type === "number" ? (t.value === "" ? undefined : Number(t.value)) : t.value;
    mutate(() => {
      if (k === "tpos") {
        const g = openingGeom(e);
        if (g) { const L = lineLength(g.host); const half = (e.width || 1) / 2 / L; e.t = Math.max(half, Math.min(1 - half, v / L)); }
      } else if (k === "separable") e.separable = Number(v);
      else e[k] = v;
      if (k === "levelId" && e.type !== "window" && e.type !== "door") {
        for (const o of model.elements.filter((x) => x.hostId === e.id)) o.levelId = v;
      }
    });
    renderPanel(); renderStage();
    return;
  }
  if (t.dataset.mk) { mutate((m) => { m[t.dataset.mk] = t.value; }); $("#model-name").textContent = model.name; renderPanel(); return; }
  if (t.dataset.level) {
    mutate((m) => { const l = m.levels.find((x) => x.id === t.dataset.level); l[t.dataset.lk] = t.type === "number" ? Number(t.value) : t.value; });
    renderLevels(); renderPanel(); renderStage();
    return;
  }
  if (t.dataset.p) {
    const path = t.dataset.p.split(".");
    const v = t.type === "checkbox" ? t.checked : t.tagName === "SELECT" ? t.value : Number(t.value);
    mutate((m) => {
      m.params ||= {};
      let o = m.params;
      for (const k of path.slice(0, -1)) o = (o[k] ||= {});
      o[path.at(-1)] = v;
    });
    renderPanel();
  }
});

$("#panel").addEventListener("click", (ev) => {
  const pick = ev.target.closest("[data-pick]");
  if (pick) { ui.selectedId = pick.dataset.pick; renderPanel(); renderStage(); return; }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "delete") return deleteSelected();
  if (act === "add-level") {
    const top = model.levels.reduce((a, l) => (l.elevation > a.elevation ? l : a), model.levels[0]);
    const id = uid("L");
    mutate((m) => m.levels.push({ id, name: `${m.levels.length + 1}층`, elevation: Math.round((top.elevation + top.height) * 100) / 100, height: top.height }));
    ui.levelId = id; renderLevels(); renderPanel(); renderStage();
  }
  if (act === "copy-level") {
    const n = Math.max(1, Math.min(50, Number($("#copy-n")?.value) || 1));
    const src = level();
    mutate((m) => {
      let top = m.levels.reduce((a, l) => (l.elevation > a.elevation ? l : a), m.levels[0]);
      for (let i = 0; i < n; i++) {
        const id = uid("L");
        const lv = { id, name: `${m.levels.length + 1}층`, elevation: Math.round((top.elevation + top.height) * 100) / 100, height: src.height };
        m.levels.push(lv);
        m.elements.push(...copyLevel(m, src.id, id));
        top = lv;
      }
    });
    renderLevels(); renderPanel();
  }
  if (act === "del-level") {
    if (!confirm(`${level().name}과 그 층의 부재를 모두 지울까요?`)) return;
    const id = ui.levelId;
    mutate((m) => { m.levels = m.levels.filter((l) => l.id !== id); m.elements = m.elements.filter((e) => e.levelId !== id); });
    ui.levelId = model.levels[0].id; ui.view = null; renderLevels(); renderPanel(); renderStage();
  }
  if (act === "reset-params") { mutate((m) => { m.params = {}; }); renderPanel(); }
  if (act === "mc") {
    b.disabled = true; b.textContent = "계산 중…";
    setTimeout(() => {
      const res = simulate(model, model.params, { n: 2000 });
      res.breakEven = breakEvenResin(model, model.params);
      ui.mc = res;
      renderPanel();
    }, 30);
  }
});

function deleteSelected() {
  const e = selected();
  if (!e) return;
  mutate((m) => { m.elements = m.elements.filter((x) => x.id !== e.id && x.hostId !== e.id); });
  ui.selectedId = null;
  renderPanel(); renderStage();
}

/* ---------------- 상단 바 ---------------- */

function renderLevels() {
  const sel = $("#level");
  const sorted = [...model.levels].sort((a, b) => b.elevation - a.elevation);
  sel.innerHTML = sorted.map((l) => `<option value="${l.id}" ${l.id === ui.levelId ? "selected" : ""}>${esc(l.name)}</option>`).join("");
  $("#model-name").textContent = model.name;
}
$("#level").addEventListener("change", (e) => { ui.levelId = e.target.value; ui.selectedId = null; ui.draft = null; renderPanel(); renderStage(); });
$("#view-2d").addEventListener("click", () => setMode("2d"));
$("#view-3d").addEventListener("click", () => { ui.tool = "select"; ui.draft = null; renderTools(); setMode("3d"); });
$("#undo").addEventListener("click", undo);
$("#demo").addEventListener("click", () => {
  if (model.elements.length && !confirm("지금 모델을 예시 모델로 바꿀까요? (실행 취소로 되돌릴 수 있습니다)")) return;
  mutate(() => {}); model = demoModel(); resetUi(); save(); renderAll();
});
$("#new").addEventListener("click", () => {
  if (model.elements.length && !confirm("빈 모델로 새로 시작할까요? (실행 취소로 되돌릴 수 있습니다)")) return;
  mutate(() => {}); model = emptyModel(); resetUi(); save(); renderAll();
});
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(model.name || "model").replace(/[\\/:*?"<>|]/g, "_")}.reclaim.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#import").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const m = JSON.parse(await f.text());
    if (!Array.isArray(m.levels) || !Array.isArray(m.elements)) throw new Error("levels·elements가 없습니다");
    mutate(() => {}); model = { params: {}, use: "주거 공동주택", ...m }; resetUi(); save(); renderAll();
  } catch (err) { alert("모델 파일을 읽지 못했습니다: " + err.message); }
});
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("reclaim.theme", document.documentElement.dataset.theme); } catch {}
  if (ui.mode === "2d") drawPlan();
});

function resetUi() {
  ui.levelId = model.levels[0]?.id; ui.selectedId = null; ui.view = null; ui.draft = null; ui.cache = null; ui.mc = null; threeView = null;
}

/* ---------------- 키보드 ---------------- */

let spaceDown = false;
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea")) return;
  if (e.key === " ") { spaceDown = true; e.preventDefault(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
  if (e.key === "Escape") { if (ui.draft) { ui.draft = null; drawPlan(); } else setTool("select"); return; }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
  const keys = { v: "select", w: "wall", p: "partition", c: "column", b: "beam", s: "slab", e: "ceiling", f: "floorFinish", n: "window", d: "door" };
  const t = keys[e.key.toLowerCase()];
  if (t && !e.ctrlKey && !e.metaKey && !e.altKey) setTool(t);
});
document.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });

let resizeRaf = 0;
new ResizeObserver(() => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(() => { if (ui.mode === "2d") drawPlan(); }); }).observe($("#stage"));

function renderAll() {
  renderLevels();
  renderTools();
  renderPanel();
  renderStage();
}
renderAll();
