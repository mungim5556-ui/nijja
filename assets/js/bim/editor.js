// ReClaim BIM 편집기: 부재를 그리고, 부재마다 해체 정보를 넣고, 완전 철거·분별 해체·최적 혼합안을 비교한다.
import {
  TYPES, ASSEMBLIES, DEFAULT_ASSEMBLY, WASTE, MATERIALS, WORK_ITEMS, TRADES, SEPARABLE, SEPARABLE_MIN,
  CONNECTIONS, HAZARD, WASTE_UNIT, DEFAULT_PARAMS, PAPER,
} from "./catalog.js";
import {
  compare, mergeParams, takeoff, grossFloorArea, lineLength, isEligible, paperCase, simulate,
  breakEven, UNCERTAINTY, residualMixedTons, PRESETS,
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
    .filter((e) => e.source !== "ifc" && e.levelId === ui.levelId && (ui.layers[e.type] ?? true))
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
      <button class="chip-toggle" type="button" data-color="decision" aria-pressed="${ui.color3d === "decision"}">처리 방식</button>
      <button class="chip-toggle" type="button" data-color="waste" aria-pressed="${ui.color3d === "waste"}">폐기물 성상</button>
      <button class="chip-toggle" type="button" data-only="1" aria-pressed="${!!ui.only3d}">현재 층만</button>
    </div>
    <div class="stage-hud" id="legend3d"></div>`;
  st.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => { ui.color3d = b.dataset.color; renderStage(); }));
  st.querySelector("[data-only]").addEventListener("click", () => { ui.only3d = !ui.only3d; threeView = null; renderStage(); });
  const legend = ui.color3d === "decision"
    ? [["#1baf7a", "분별 회수"], ["#b2aba1", "일괄 처리"], ["#9c9084", "구조체(압쇄)"], ["#b42318", "석면 별도"], ["#e8742a", "선택"]]
    : Object.values(WASTE).map((w) => [w.color, w.label]);
  $("#legend3d").innerHTML = legend.map(([c, l]) => `<span class="hud-chip"><span class="swatch" style="background:${c}"></span>${esc(l)}</span>`).join("");
  try {
    const { createModel3D } = await import("./view3d.js");
    if (ui.mode !== "3d") return;
    const r = results();
    three = createModel3D($("#three"), {
      model, q: r.q, result: r.selective, meshes: ui.ifcMeshes, colorBy: ui.color3d, levelId: ui.only3d ? ui.levelId : null, selectedId: ui.selectedId,
      onPick: (id) => { ui.selectedId = id; ui.tab = "props"; renderPanel(); renderStage(); },
    });
    three.setView(threeView);
    if (!ui.ifcMeshes && model.elements.some((e) => e.source === "ifc")) $("#legend3d").insertAdjacentHTML("afterbegin", '<span class="hud-chip">IFC 형상은 저장되지 않습니다. 3D로 보려면 IFC를 다시 불러오세요.</span>');
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
  if (e.source === "ifc") return ifcElementPanel(e);
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
  const per = r.selective.perItem[e.id];
  const eligible = isEligible(e, model);
  const delta = r.deltas[e.id]?.delta ?? 0;
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
      <div class="callout ${eligible ? (delta < 0 ? "ok" : "info") : ""}">
        ${!(ASSEMBLIES[e.assembly]?.work || []).length ? "해체 작업이 없는 구성입니다. 두 방법에 공통으로 처리합니다."
          : e.hazard !== "none" ? "유해물질이 있어 석면 해체 공정(두 방법 공통)으로 처리합니다."
          : !eligible ? `해체 시공성이 ${SEPARABLE_MIN}점 미만이라 분별 해체 대상에서 뺐습니다.`
          : `전면 분별해체에서 이 부재는 <b>분별 회수</b>합니다. 일괄 압쇄 대비 <b>${signed(kw(delta))}천원</b> (인건비 + 처리비 − 매각 수익, 장비·반출 제외)`}
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
  const ifcGroups = Object.entries(CAT_LABEL).map(([k, label]) => {
    const list = els.filter((e) => e.source === "ifc" && e.category === k);
    if (!list.length) return "";
    return `<details class="group"><summary>${esc(label)} ${list.length}개 (IFC)</summary><div class="items">${list.map((e) =>
      `<button class="list-btn" type="button" data-pick="${e.id}"><span>${esc(e.name || e.id)}</span></button>`).join("")}</div></details>`;
  }).join("");
  const groups = ifcGroups + Object.entries(TYPES).map(([k, t]) => {
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

const CAT_LABEL = { wall: "벽", floor: "바닥·슬래브", ceiling: "천장", roof: "지붕", column: "기둥", beam: "보", foundation: "기초", stair: "계단", railing: "난간", window: "창", door: "문", mep: "설비", other: "기타", slab: "슬래브" };

function ifcElementPanel(e) {
  const r = results();
  const q = r.q[e.id] || { tons: {}, mats: {}, area: 0, work: [] };
  const per = r.selective.perItem[e.id];
  const delta = r.deltas[e.id]?.delta ?? 0;
  const eligible = isEligible(e, model);
  const matRows = Object.entries(q.mats).filter(([, t]) => t > 0.0005).map(([m, t]) => {
    const w = MATERIALS[m].waste;
    return `<tr><td><span class="swatch" style="background:${WASTE[w].color}"></span>${esc(MATERIALS[m].label)}</td><td>${esc(WASTE[w].label)}</td><td class="r">${t < 0.1 ? r2(t * 1000) + " kg" : r2(t) + " t"}</td></tr>`;
  }).join("");
  const work = (q.work || []).map((k) => esc(WORK_ITEMS[k]?.label || k)).join(", ");
  return `
  <div class="section">
    <div class="sec-head"><h4>${esc(CAT_LABEL[e.category] || e.category)} · ${esc(e.name || "")}</h4><span class="badge badge-info">IFC</span></div>
    <dl class="kv">
      <dt>IFC 종류</dt><dd>${esc(e.ifcType || "")}</dd>
      <dt>Revit ElementId</dt><dd>${e.revitId ?? "–"}</dd>
      <dt>층</dt><dd>${esc(model.levels.find((l) => l.id === e.levelId)?.name || e.levelId)}</dd>
      ${q.area ? `<dt>해체 면적</dt><dd>${r1(q.area)} ㎡</dd>` : ""}
      <dt>부피</dt><dd>${r2(e.volume || 0)} ㎥</dd>
    </dl>
    <p class="sub">IFC 재료: ${esc((e.materialNames || []).join(" / ") || "없음")}${e.unknownVolume ? ` · 미분류 ${r2(e.unknownVolume)} ㎥ 제외` : ""}</p>
  </div>
  <div class="section">
    <h4>해체 정보</h4>
    <div class="field"><label>해체 시공성 (논문 표 1, 6점 척도)</label><select class="select" data-k="separable">${opt(Object.fromEntries(Object.entries(SEPARABLE).reverse().map(([k, v]) => [k, `${k}점 · ${v}`])), e.separable)}</select></div>
    <div class="field"><label>유해물질</label><select class="select" data-k="hazard">${opt(HAZARD, e.hazard)}</select></div>
    <div class="callout ${e.hazard !== "none" ? "" : eligible ? (delta < 0 ? "ok" : "info") : ""}">
      ${e.hazard !== "none" ? "유해물질이 있어 석면 해체 공정(두 방법 공통)으로 따로 처리합니다."
        : !work ? "해체 작업이 없는 부재(구조체 등)입니다. 두 방법 모두 압쇄합니다."
        : !eligible ? `해체 시공성이 ${SEPARABLE_MIN}점 미만이라 분별 대상에서 뺐습니다.`
        : `전면 분별해체에서 <b>${per?.method === "selective" ? "분별 회수" : "일괄 처리"}</b> · 일괄 압쇄 대비 <b>${signed(kw(delta))}천원</b>`}
    </div>
    ${work ? `<p class="sub">해체 작업: ${work}</p>` : ""}
  </div>
  <div class="section">
    <h4>재료별 물량</h4>
    ${matRows ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>재료</th><th>성상</th><th class="r">양</th></tr></thead><tbody>${matRows}</tbody></table></div>` : '<p class="note">물량이 없습니다.</p>'}
  </div>`;
}

function totalsByWaste(q) {
  const out = {};
  for (const t of Object.values(q)) for (const [w, v] of Object.entries(t.tons)) out[w] = (out[w] || 0) + v;
  return out;
}

const PLAN_KEYS = [["concrete", "폐콘크리트"], ["metal", "폐금속"], ["wood", "폐목재"], ["resin", "폐합성수지"], ["mixed", "혼합폐기물"]];

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
  // 해체계획서 비교
  const plan = model.plan || {};
  const mixedModel = residual + (tot.glass || 0) + (tot.board || 0) + (tot.tile || 0) + (tot.wallpaper || 0);
  const modelOf = { concrete: tot.concrete || 0, metal: tot.metal || 0, wood: tot.wood || 0, resin: tot.resin || 0, mixed: mixedModel };
  const planRows = PLAN_KEYS.map(([k, l]) => {
    const pv = Number(plan[k]);
    const err = pv > 0 ? ((modelOf[k] - pv) / pv) * 100 : null;
    const cls = err == null ? "" : Math.abs(err) <= 20 ? "badge-success" : "badge-warning";
    return `<tr><td>${l}</td><td><input class="input" type="number" min="0" step="0.1" data-plan="${k}" value="${plan[k] ?? ""}" placeholder="t"></td><td class="r">${r1(modelOf[k])}</td><td class="r">${err == null ? "–" : `<span class="badge ${cls}">${err > 0 ? "+" : ""}${err.toFixed(0)}%</span>`}</td></tr>`;
  }).join("");
  const ifcEls = model.elements.filter((e) => e.source === "ifc");
  const unknownVol = ifcEls.reduce((s, e) => s + (e.unknownVolume || 0), 0);
  return `
  <div class="section">
    <h4>폐기물 발생량</h4>
    <dl class="kv"><dt>연면적</dt><dd>${r1(gfa)} ㎡${model.gfa ? "" : " (슬래브 합)"}</dd><dt>층수</dt><dd>${model.levels.length}개 층</dd><dt>부재</dt><dd>${model.elements.length}개${ifcEls.length ? ` (IFC ${ifcEls.length})` : ""}</dd></dl>
    ${unknownVol ? `<div class="callout">재료 이름을 분류하지 못한 부피 <b>${r2(unknownVol)} ㎥</b>가 계산에서 빠졌습니다. IFC를 다시 불러올 때 재료를 지정하세요.</div>` : ""}
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>성상</th><th class="r">t</th><th class="r">t/㎡</th><th class="r">원단위</th></tr></thead><tbody>
      ${rows || '<tr><td colspan="4" class="muted">부재가 없습니다</td></tr>'}
      <tr><td><span class="swatch" style="background:${WASTE.mixed.color}"></span>모델 밖 혼합폐기물 (보정)</td><td class="r">${r1(residual)}</td><td class="r">${gfa ? (residual / gfa).toFixed(4) : "–"}</td><td class="r">${unit.mixed?.toFixed(4) ?? "–"}</td></tr>
    </tbody></table></div>
    <p class="note">원단위는 논문 표 6(국토교통부 2023 표준품셈, ${esc(model.use)})입니다. 모델의 t/㎡이 원단위와 크게 다르면 빠진 부재가 있는지 확인하세요.</p>
  </div>
  <div class="section">
    <h4>해체계획서와 비교</h4>
    <p class="note">같은 건물 해체계획서의 성상별 폐기물량을 넣으면 모델 물량과의 오차를 보여줍니다. 목표는 ±20% 이내입니다. 혼합폐기물은 모델의 유리·보드·타일·벽지와 모델 밖 보정분을 합친 값과 비교합니다.</p>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>성상</th><th>계획서 (t)</th><th class="r">모델 (t)</th><th class="r">오차</th></tr></thead><tbody>${planRows}</tbody></table></div>
  </div>
  <div class="section">
    <h4>부재 종류별</h4>
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>종류</th><th class="r">개수</th><th class="r">해체 면적</th><th class="r">t</th></tr></thead><tbody>${categoryRows(r)}</tbody></table></div>
    <p class="note">재료 밀도는 가정값입니다 (예: 철근콘크리트 2.45, 합판 0.6, 석고보드 0.8 t/㎥). KDS 41 10 15로 확인이 필요합니다.</p>
  </div>`;
}

function categoryRows(r) {
  const by = {};
  for (const it of r.items) {
    const b = (by[it.category] ||= { n: 0, area: 0, t: 0 });
    b.n++; b.area += it.area || 0; b.t += Object.values(it.tons).reduce((s, v) => s + v, 0);
  }
  return Object.entries(by).map(([k, b]) => `<tr><td>${esc(CAT_LABEL[k] || k)}</td><td class="r">${b.n}</td><td class="r">${b.area ? r1(b.area) + " ㎡" : ""}</td><td class="r">${r1(b.t)}</td></tr>`).join("");
}

const SCEN = [
  { key: "general", label: "일괄 압쇄", color: "var(--series-1)" },
  { key: "selective", label: "전면 분별해체", color: "var(--series-2)" },
];
const ITEMS = [
  ["인건비", (x) => x.laborCost],
  ["장비비", (x) => x.equipCost],
  ["반출비", (x) => x.haulCost],
  ["처리비", (x) => x.disposalCost],
  ["매각 수익", (x) => x.revenueTotal],
];

function comparePanel() {
  const r = results();
  const p = mergeParams(model.params);
  if (!model.elements.length) return planOnlyPanel(p);
  const g = r.general, s = r.selective;
  const d = s.total - g.total;
  const best = d < 0 ? SCEN[1] : SCEN[0];
  const items = [...ITEMS, ...(p.indirectPerDay ? [["공기 간접비", (x) => x.indirect]] : [])];
  const cards = SCEN.map((sc) => {
    const x = r[sc.key];
    return `<div class="scen-card ${sc.key === best.key ? "best" : ""}"><span class="label"><span class="swatch" style="background:${sc.color}"></span>${sc.label}</span>
      <span class="val">${mw(x.total)}</span><span class="d">공기 ${r1(x.days)}일${sc.key === "selective" ? ` · ${signed(mw(d))}` : ""}</span></div>`;
  }).join("");
  const chart = groupedBars({
    categories: items.map(([l, f]) => ({ label: l, values: SCEN.map((sc) => f(r[sc.key]) / 1e6) })),
    series: SCEN.map((sc) => ({ label: sc.label, color: sc.color })),
    unit: "백만원",
    fmt: (v) => (Math.round(v * 10) / 10).toLocaleString(),
  });
  const tableRows = items.map(([l, f]) => `<tr><td>${l}</td>${SCEN.map((sc) => { const v = f(r[sc.key]); return `<td class="r">${l === "매각 수익" && v > 0 ? "−" : ""}${mw(v)}</td>`; }).join("")}<td class="r">${signed(mw((l === "매각 수익" ? -1 : 1) * (f(s) - f(g))))}</td></tr>`).join("");
  const nSel = Object.values(s.perItem).filter((x) => x.method === "selective").length;
  const nHaz = s.hazardItems.length;
  const why = [
    ["인건비", s.laborCost - g.laborCost], ["장비비", s.equipCost - g.equipCost], ["처리비", s.disposalCost - g.disposalCost], ["매각 수익", -(s.revenueTotal - g.revenueTotal)],
  ].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return `
  <div class="verdict">
    <strong>이 모델에서는 ${best.label}이 ${mw(Math.abs(d))}백만원 더 경제적입니다</strong>
    <span>가장 큰 차이: ${why[0]} ${signed(mw(why[1]))}백만원 · 공기 ${r1(g.days)} → ${r1(s.days)}일</span>
  </div>
  <div class="section">
    <div class="sec-head"><h4>시나리오 총비용</h4><span class="sub">단위: 백만원 · ${esc(p.label || "")}</span></div>
    <div class="scen-cards" style="grid-template-columns:1fr 1fr">${cards}</div>
    <div class="legend">${SCEN.map((sc) => `<span><span class="swatch" style="background:${sc.color}"></span>${sc.label}</span>`).join("")}</div>
    ${chart}
    <div class="table-wrap"><table class="tbl compact"><thead><tr><th>항목</th>${SCEN.map((sc) => `<th class="r">${sc.label}</th>`).join("")}<th class="r">차이</th></tr></thead><tbody>
      ${tableRows}
      <tr><td><b>합계</b></td>${SCEN.map((sc) => `<td class="r"><b>${mw(r[sc.key].total)}</b></td>`).join("")}<td class="r"><b>${signed(mw(d))}</b></td></tr>
      <tr><td>공기 (내장 + 압쇄)</td>${SCEN.map((sc) => `<td class="r">${r1(r[sc.key].interiorDays)} + ${r1(r[sc.key].structDays)}일</td>`).join("")}<td class="r">${signed(r1(s.days - g.days))}일</td></tr>
    </tbody></table></div>
    <p class="note">전면 분별해체: 부재 ${nSel}개를 분별 회수합니다${nHaz ? ` (석면 표시 ${nHaz}개는 두 방법 공통으로 따로 처리)` : ""}. 분별 현장은 연면적 기준 선별·반출 공정(목공 0.1 + 보통인부 0.2 인/㎡)과 ${p.selectiveEquip ? "내장 공정 동안 소형 굴착기·절단기" : ""}가 붙고, 내장재를 먼저 걷어낸 폐콘크리트는 순수 폐콘크리트 단가(${p.disposal.concreteSelective.toLocaleString()}원/t, 일괄 ${p.disposal.concreteGeneral.toLocaleString()}원/t)로 처리한다고 가정합니다.</p>
    <div class="sec-head">
      <button class="btn btn-outline btn-sm" type="button" data-act="csv"><svg class="i"><use href="#i-download"/></svg>Revit용 CSV</button>
      <span class="sub">Revit에서 ReClaim 탭 → CSV 적용</span>
    </div>
  </div>
  ${planSection(p)}
  ${paramsSection(p)}
  ${mcSection()}
  <p class="note">기준: ${esc(p.basis || "")}. 품은 ${esc(PAPER.cite)}. 결과는 전문가 검토를 돕는 1차 스크리닝 자료입니다.</p>`;
}

// 해체계획서만 있을 때: 연면적 × 원단위(또는 계획서 물량)
function planSection(p) {
  const plan = model.plan || {};
  const area = Number(plan.area) || grossFloorArea(model) || 0;
  const tonsOverride = Object.fromEntries(PLAN_KEYS.filter(([k]) => Number(plan[k]) > 0).map(([k]) => [k, Number(plan[k])]));
  const pc = area ? paperCase(model.params, { area, use: model.use, tonsOverride }) : null;
  return `
  <details class="section group" ${model.elements.length ? "" : "open"}>
    <summary>해체계획서 간이 계산 (BIM 없이)</summary>
    <p class="note">연면적과 용도만으로(물량 탭에 계획서 물량을 넣었으면 그 값으로) 같은 단가를 써서 계산합니다. 품은 논문처럼 연면적 전체에 곱합니다.</p>
    <div class="fgrid">
      <div class="field"><label>연면적 (㎡)</label><input class="input" type="number" min="0" step="10" data-plan="area" value="${plan.area ?? ""}" placeholder="${r1(grossFloorArea(model))}"></div>
      <div class="field"><label>용도·구조</label><select class="select" data-mk="use">${opt(Object.fromEntries(Object.keys(WASTE_UNIT).map((k) => [k, k])), model.use)}</select></div>
    </div>
    ${pc ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th></th><th class="r">일괄 압쇄</th><th class="r">전면 분별해체</th></tr></thead><tbody>
      <tr><td>인건비</td><td class="r">${mw(pc.general.laborCost)}</td><td class="r">${mw(pc.selective.laborCost)}</td></tr>
      <tr><td>장비·반출비</td><td class="r">${mw(pc.general.equipCost + pc.general.haulCost)}</td><td class="r">${mw(pc.selective.equipCost + pc.selective.haulCost)}</td></tr>
      <tr><td>처리비</td><td class="r">${mw(pc.general.disposalCost)}</td><td class="r">${mw(pc.selective.disposalCost)}</td></tr>
      <tr><td>매각 수익</td><td class="r">−${mw(pc.general.revenueTotal)}</td><td class="r">−${mw(pc.selective.revenueTotal)}</td></tr>
      <tr><td><b>합계 (백만원)</b></td><td class="r"><b>${mw(pc.general.total)}</b></td><td class="r"><b>${mw(pc.selective.total)}</b></td></tr>
      <tr><td>공기</td><td class="r">${r1(pc.general.days)}일</td><td class="r">${r1(pc.selective.days)}일</td></tr>
    </tbody></table></div>
    <p class="note">${Object.keys(tonsOverride).length ? "계획서 물량 사용: " + Object.keys(tonsOverride).map((k) => PLAN_KEYS.find((x) => x[0] === k)[1]).join(", ") : "물량은 원단위로 추정"} · Δ ${signed(mw(pc.delta.total))}백만원</p>` : ""}
  </details>`;
}

function planOnlyPanel(p) {
  return `
  <div class="callout info">모델에 부재가 없습니다. 위의 <b>IFC 불러오기</b>로 Revit 모델을 넣거나, 해체계획서의 연면적·용도로 간이 계산을 하세요.</div>
  ${planSection(p)}
  ${paramsSection(p)}`;
}

function paramsSection(p) {
  const n = (path, val, step = 1000) => `<input class="input" type="number" step="${step}" min="0" data-p="${path}" value="${val}">`;
  return `
  <details class="section group">
    <summary>단가·가정 바꾸기</summary>
    <div class="field"><label>단가 기준</label><select class="select" data-p="preset">${opt(Object.fromEntries(Object.values(PRESETS).map((x) => [x.key, x.label])), p.key)}</select></div>
    <p class="sub">인건비·장비</p>
    <div class="fgrid">
      <div class="field"><label>목공 (원/인)</label>${n("wage.carpenter", p.wage.carpenter)}</div>
      <div class="field"><label>보통인부 (원/인)</label>${n("wage.laborer", p.wage.laborer)}</div>
      <div class="field"><label>조적공 (원/인)</label>${n("wage.mason", p.wage.mason)}</div>
      <div class="field"><label>하루 투입 인원</label>${n("crewSize", p.crewSize, 1)}</div>
      <div class="field"><label>대형 굴착기 (원/h)</label>${n("equipment.excavatorLarge", p.equipment.excavatorLarge)}</div>
      <div class="field"><label>소형 굴착기 (원/h)</label>${n("equipment.excavatorSmall", p.equipment.excavatorSmall)}</div>
      <div class="field"><label>절단기 (원/h)</label>${n("equipment.cutter", p.equipment.cutter)}</div>
      <div class="field"><label>덤프 24t (원/h)</label>${n("equipment.dump", p.equipment.dump)}</div>
      <div class="field"><label>압쇄 작업량 (㎥/일)</label>${n("crushProd", p.crushProd, 0.5)}</div>
      <div class="field"><label>덤프 실적재 (t/회)</label>${n("haul.truckLoad", p.haul.truckLoad, 1)}</div>
      <div class="field"><label>회당 시간 (h)</label>${n("haul.hoursPerTrip", p.haul.hoursPerTrip, 0.5)}</div>
      <div class="field"><label>공기 간접비 (원/일)</label>${n("indirectPerDay", p.indirectPerDay, 10000)}</div>
    </div>
    <p class="sub">처리비 (원/t)</p>
    <div class="fgrid">
      <div class="field"><label>콘크리트 · 일괄</label>${n("disposal.concreteGeneral", p.disposal.concreteGeneral)}</div>
      <div class="field"><label>콘크리트 · 분별 후</label>${n("disposal.concreteSelective", p.disposal.concreteSelective)}</div>
      <div class="field"><label>혼합 · 일괄 (불연성)</label>${n("disposal.mixedGeneral", p.disposal.mixedGeneral)}</div>
      <div class="field"><label>혼합 · 분별 (가연성)</label>${n("disposal.mixedSelective", p.disposal.mixedSelective)}</div>
      <div class="field"><label>폐목재</label>${n("disposal.wood", p.disposal.wood)}</div>
      <div class="field"><label>폐합성수지</label>${n("disposal.resin", p.disposal.resin)}</div>
    </div>
    <p class="sub">매각 수익 (원/t)</p>
    <div class="fgrid">
      <div class="field"><label>고철</label>${n("revenue.steel", p.revenue.steel)}</div>
      <div class="field"><label>알루미늄 샤시</label>${n("revenue.aluminum", p.revenue.aluminum)}</div>
      <div class="field"><label>동</label>${n("revenue.copper", p.revenue.copper)}</div>
      <div class="field"><label>폐목재</label>${n("revenue.wood", p.revenue.wood)}</div>
      <div class="field"><label>폐합성수지</label>${n("revenue.resin", p.revenue.resin)}</div>
      <div class="field"><label>회수율 (0~1)</label>${n("recovery", p.recovery, 0.05)}</div>
    </div>
    <div class="field"><label>분별 해체 품 (표 4)</label><select class="select" data-p="table4">${opt({ paper: "논문 표 4 그대로", aligned: "천장 모르타르·바닥 타일을 표 3과 같게" }, p.table4)}</select></div>
    <label class="check"><input type="checkbox" data-p="includeStructure" ${p.includeStructure ? "checked" : ""}> 구조체 압쇄(장비·인력·공기) 포함</label>
    <label class="check"><input type="checkbox" data-p="haul.on" ${p.haul.on ? "checked" : ""}> 반출(덤프) 포함</label>
    <label class="check"><input type="checkbox" data-p="selectiveEquip" ${p.selectiveEquip ? "checked" : ""}> 분별 내장 공정에 소형 굴착기·절단기</label>
    <label class="check"><input type="checkbox" data-p="residualMixed" ${p.residualMixed !== false ? "checked" : ""}> 모델 밖 혼합폐기물을 원단위로 보정</label>
    <p class="note">기준: ${esc(p.basis)}. 조적공 노임, 덤프 실적재·회당 시간, 소형 장비 투입은 가정값입니다.</p>
    <button class="btn btn-outline btn-sm" type="button" data-act="reset-params" style="justify-self:start">기본값으로</button>
  </details>`;
}

function mcSection() {
  const mc = ui.mc;
  const ranges = Object.values(UNCERTAINTY).map((u) => `<tr><td>${esc(u.label)}</td><td class="r">${u.range.map((v) => v >= 1000 ? Math.round(v).toLocaleString() : Math.round(v * 100) / 100).join(" / ")}</td></tr>`).join("");
  if (!mc) return `
  <div class="section">
    <h4>불확실성 분석</h4>
    <p class="note">단가·품·회수율을 범위 안에서 2,000번 바꿔 가며 계산해, 전면 분별해체가 더 경제적일 확률을 구합니다.</p>
    <button class="btn btn-secondary btn-sm" type="button" data-act="mc" style="justify-self:start"><svg class="i"><use href="#i-chart"/></svg>분석 실행</button>
    <details class="group"><summary>범위 (최소 / 최빈 / 최대, 가정값)</summary><div class="table-wrap"><table class="tbl compact"><tbody>${ranges}</tbody></table></div></details>
  </div>`;
  const s = mc.selective;
  const be = (v, unitWon) => v == null ? "–" : v < 0 ? "음수 (항상 불리)" : v > 5e7 ? "현실적으로 도달 불가" : `${Math.round(v / 1000).toLocaleString()}천원/t`;
  return `
  <div class="section">
    <div class="sec-head"><h4>불확실성 분석</h4><button class="btn btn-ghost btn-sm" type="button" data-act="mc">다시 실행</button></div>
    <div class="scen-cards" style="grid-template-columns:1fr 1fr">
      <div class="scen-card"><span class="label">분별해체가 더 저렴할 확률</span><span class="val">${(s.pCheaper * 100).toFixed(1)}%</span><span class="d">${mc.n.toLocaleString()}회</span></div>
      <div class="scen-card"><span class="label">Δ 중앙값 (분별 − 일괄)</span><span class="val">${signed(mw(s.p50))}</span><span class="d">P10 ${mw(s.p10)} · P90 ${mw(s.p90)}</span></div>
    </div>
    <p class="sub">전면 분별해체 − 일괄 압쇄 (Δ, 백만원) 분포</p>
    ${histogram(s.values.map((v) => v / 1e6), { fmt: (v) => (Math.round(v * 10) / 10).toLocaleString(), unit: "백만원", zeroLabel: "같음", color: "var(--series-2)" })}
    <p class="sub">어떤 가정이 결론을 가장 크게 흔드나 (한 변수만 최소↔최대, 검은 선 = 모든 변수 최빈값)</p>
    ${tornado(mc.tornado.map((t) => ({ label: t.label, low: t.low / 1e6, high: t.high / 1e6 })), { base: mc.base / 1e6, fmt: (v) => (Math.round(v * 10) / 10).toLocaleString(), unit: "백만원" })}
    <div class="callout info">손익분기 — 분별해체가 일괄 압쇄와 같아지려면: 일괄 혼합폐기물 단가 <b>${be(mc.beMixed)}</b> 이상, 또는 폐합성수지 매각가 <b>${be(mc.beResin)}</b> 이상.</div>
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
  if (t.dataset.plan) {
    mutate((m) => { m.plan ||= {}; m.plan[t.dataset.plan] = t.value === "" ? undefined : Number(t.value); });
    renderPanel();
    return;
  }
  if (t.dataset.p === "preset") { mutate((m) => { m.params = { preset: t.value }; }); renderPanel(); return; }
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
  if (act === "reset-params") { mutate((m) => { m.params = m.params?.preset ? { preset: m.params.preset } : {}; }); renderPanel(); }
  if (act === "csv") return exportCsv();
  if (act === "mc") {
    b.disabled = true; b.textContent = "계산 중…";
    setTimeout(() => {
      const res = simulate(model, model.params, { n: 2000 });
      res.beMixed = breakEven(model, model.params, "mixedGeneral");
      res.beResin = breakEven(model, model.params, "revenueResin");
      ui.mc = res;
      renderPanel();
    }, 30);
  }
});

// Revit "CSV 적용" 버튼이 읽는 형식 (revit/ReClaim.extension/lib/reclaim_io.py)
function exportCsv() {
  const r = results();
  const lines = ["element_id,ifc_guid,category,waste,tons,method,recyclable,delta_k"];
  for (const it of r.items) {
    const el = model.elements.find((e) => e.id === it.id);
    const byWaste = {};
    for (const [m, t] of Object.entries(it.tons)) { const w = MATERIALS[m]?.waste || "mixed"; byWaste[w] = (byWaste[w] || 0) + t; }
    const dom = Object.entries(byWaste).filter(([w]) => w !== "concrete").sort((a, b) => b[1] - a[1])[0]?.[0] || (byWaste.concrete ? "concrete" : "mixed");
    const tons = Object.values(it.tons).reduce((s, v) => s + v, 0);
    const method = r.deltas[it.id]?.method || "general";
    const cells = [el?.revitId ?? "", el?.ifcGuid ?? "", it.category, WASTE[dom]?.label || dom, tons.toFixed(3), method, method === "selective" ? 1 : 0, ((r.deltas[it.id]?.delta || 0) / 1000).toFixed(1)];
    lines.push(cells.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(","));
  }
  const blob = new Blob(["\ufeff" + lines.join("\n") + "\n"], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(model.name || "model").replace(/[\\/:*?"<>|]/g, "_")}.reclaim.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const MAP_KEY = "reclaim.materialMap";
function loadMap() { try { return JSON.parse(localStorage.getItem(MAP_KEY) || "{}"); } catch { return {}; } }
async function importIfcFile(file) {
  const btn = $("#ifc-label");
  const old = btn.innerHTML;
  btn.textContent = "IFC 읽는 중…";
  try {
    const { importIfcBuffer } = await import("./ifc-import.js");
    let mapping = loadMap();
    let res = await importIfcBuffer(await file.arrayBuffer(), { name: file.name.replace(/\.ifc$/i, ""), mapping, use: model.use });
    const unknown = Object.keys(res.unknown);
    if (unknown.length) {
      const keys = Object.keys(MATERIALS);
      const ask = unknown.slice(0, 12).map((n) => `${n}`).join("\n");
      const answer = prompt(`이름으로 분류하지 못한 재료가 ${unknown.length}개 있습니다:\n${ask}\n\n같은 순서로 재료 키를 쉼표로 적어 주세요 (비우면 건너뜀).\n사용 가능한 키: ${keys.join(", ")}`, "");
      if (answer) {
        answer.split(",").map((x) => x.trim()).forEach((k, i) => { if (k && MATERIALS[k] && unknown[i]) mapping[unknown[i]] = k; });
        try { localStorage.setItem(MAP_KEY, JSON.stringify(mapping)); } catch {}
        res = await importIfcBuffer(await file.arrayBuffer(), { name: file.name.replace(/\.ifc$/i, ""), mapping, use: model.use });
      }
    }
    mutate(() => {}); model = res.model; resetUi(); ui.ifcMeshes = res.meshes; save();
    ui.tab = "compare";
    renderAll();
    setMode("3d");
  } catch (err) {
    alert("IFC를 읽지 못했습니다: " + err.message);
  } finally { btn.innerHTML = old; }
}

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
$("#ifc").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importIfcFile(f); });
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("reclaim.theme", document.documentElement.dataset.theme); } catch {}
  if (ui.mode === "2d") drawPlan();
});

function resetUi() {
  ui.levelId = model.levels[0]?.id; ui.selectedId = null; ui.view = null; ui.draft = null; ui.cache = null; ui.mc = null; threeView = null; ui.ifcMeshes = null;
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
