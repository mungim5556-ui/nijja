// 편집기 모델 → 부재 목록(items) → 일괄 압쇄 vs 전면 분별해체 비교.
// 비용 계산 자체는 cost.js에 있고, 여기서는 형상에서 물량을 내고 불확실성을 분석한다.
// 브라우저와 Node 양쪽에서 쓰도록 DOM에 의존하지 않는다.
import { WORK_ITEMS, ASSEMBLIES, MATERIALS, TYPES, WASTE_UNIT, PRESETS } from "./catalog.js";
import { mergeParams, compareItems, scenarioCost, itemDeltas, isEligible as itemEligible, residualMixedTons as residualItems, productivity, TRADE_KEYS } from "./cost.js";

export { mergeParams };

/* ---------------- 형상 → 물량 ---------------- */

export function levelOf(model, el) {
  return model.levels.find((l) => l.id === el.levelId) || model.levels[0];
}
export function lineLength(el) {
  return Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
}
export function openingsOf(model, wallId) {
  return model.elements.filter((e) => e.hostId === wallId);
}

const CATEGORY = { wall: "wall", partition: "wall", column: "column", beam: "beam", slab: "slab", ceiling: "ceiling", floorFinish: "floor", window: "window", door: "door" };

// 부재 하나의 면적·부피·재료별 톤·성상별 톤·해체 작업
export function takeoffElement(el, model) {
  // IFC·Revit에서 가져온 부재는 물량을 이미 갖고 있다
  if (el.source === "ifc") {
    const tons = {};
    for (const [m, t] of Object.entries(el.mats || {})) { const w = MATERIALS[m]?.waste || "mixed"; tons[w] = (tons[w] || 0) + t; }
    return { area: el.area || 0, volume: el.volume || 0, mats: { ...(el.mats || {}) }, tons, work: el.work || [] };
  }
  const asm = ASSEMBLIES[el.assembly];
  const type = TYPES[el.type];
  const level = levelOf(model, el);
  const mats = {};
  const add = (m, t) => { if (MATERIALS[m] && t > 0) mats[m] = (mats[m] || 0) + t; };
  let area = 0, volume = 0;
  if (!asm || !type) return { area, volume, mats, tons: {}, work: [] };

  if (type.kind === "line" && el.type !== "beam") {
    const len = lineLength(el);
    const h = Number(el.height) || level?.height || 3;
    const open = openingsOf(model, el.id).reduce((s, o) => s + (o.width || 0) * (o.height || 0), 0);
    const face = Math.max(0, len * h - open);
    area = face * (asm.faces || 1);
    const thickness = Number(el.thickness) || type.defaults.thickness;
    for (const L of asm.layers) {
      const v = L.core ? face * thickness : face * L.t * (L.faces || 1);
      volume += v;
      add(L.m, v * (L.fill ?? 1) * MATERIALS[L.m].density);
    }
  } else if (el.type === "beam") {
    const v = lineLength(el) * (Number(el.thickness) || 0.3) * (Number(el.depth) || 0.5);
    volume = v;
    for (const L of asm.layers) add(L.m, v * (L.fill ?? 1) * MATERIALS[L.m].density);
  } else if (type.kind === "point") {
    const h = Number(el.height) || level?.height || 3;
    const v = (Number(el.w) || 0.5) * (Number(el.d) || 0.5) * h;
    volume = v;
    for (const L of asm.layers) add(L.m, v * (L.fill ?? 1) * MATERIALS[L.m].density);
  } else if (type.kind === "rect") {
    area = Math.abs(el.w * el.d);
    for (const L of asm.layers) { const v = area * L.t; volume += v; add(L.m, v * MATERIALS[L.m].density); }
  } else if (type.kind === "opening") {
    area = (el.width || 0) * (el.height || 0);
    for (const L of asm.perArea || []) add(L.m, (area * L.kg) / 1000);
  }
  if (type.structural && el.type !== "wall") area = 0;
  const tons = {};
  for (const [m, t] of Object.entries(mats)) { const w = MATERIALS[m].waste; tons[w] = (tons[w] || 0) + t; }
  return { area, volume, mats, tons, work: asm.work || [] };
}

export function takeoff(model) {
  const out = {};
  for (const el of model.elements) out[el.id] = takeoffElement(el, model);
  return out;
}

export function grossFloorArea(model) {
  if (model.gfa) return Number(model.gfa);
  const sum = (t) => model.elements.filter((e) => e.type === t && e.source !== "ifc").reduce((s, e) => s + Math.abs(e.w * e.d), 0);
  return sum("slab") || sum("floorFinish") || model.elements.filter((e) => e.source === "ifc" && e.category === "slab").reduce((s, e) => s + (e.area || 0), 0);
}

// 계산 엔진 입력
export function toItems(model, q = takeoff(model)) {
  return model.elements.map((el) => ({
    id: el.id,
    category: el.source === "ifc" ? el.category : CATEGORY[el.type] || "other",
    area: q[el.id].area,
    tons: q[el.id].mats,
    work: q[el.id].work,
    separable: el.separable,
    hazard: el.hazard || "none",
  }));
}
const ctxOf = (model) => ({ gfa: grossFloorArea(model), use: model.use });

export function isEligible(el, model) {
  const q = takeoffElement(el, model || { levels: [], elements: [] });
  return itemEligible({ work: q.work, separable: el.separable, hazard: el.hazard });
}

export function residualMixedTons(model, params, q = takeoff(model)) {
  return residualItems(toItems(model, q), ctxOf(model), mergeParams(params));
}

export function compare(model, params) {
  const q = takeoff(model);
  const items = toItems(model, q);
  const ctx = ctxOf(model);
  const r = compareItems(items, ctx, params);
  return { q, items, ctx, ...r, deltas: itemDeltas(items, ctx, params) };
}

/* ---------------- 논문 방식: 면적 × 원단위 ---------------- */
// 논문 표 3·4의 품을 모두 공사면적에 곱하고, 표 6 원단위로 폐기물량을 낸다.
// 해체계획서만 있을 때의 간이 계산에도 쓴다: tonsOverride로 계획서의 성상별 물량을 넣을 수 있다.
export function paperCase(params = { preset: "paper2023" }, { area = 2400, use = "주거 공동주택", tonsOverride = null } = {}) {
  const p = mergeParams(params);
  const unit = WASTE_UNIT[use];
  const t = {
    concrete: tonsOverride?.concrete ?? unit.concrete * area,
    wood: tonsOverride?.wood ?? unit.wood * area,
    resin: tonsOverride?.resin ?? unit.resin * area,
    mixed: tonsOverride?.mixed ?? unit.mixed * area,
    metal: tonsOverride?.metal ?? unit.metal * area,
  };
  const side = (method) => {
    const labor = Object.fromEntries(TRADE_KEYS.map((k) => [k, { days: 0, cost: 0 }]));
    for (const key of Object.keys(WORK_ITEMS)) {
      for (const [trade, rate] of Object.entries(productivity(key, method, p))) {
        const days = rate * area;
        labor[trade].days += days;
        labor[trade].cost += days * (p.wage[trade] || 0);
      }
    }
    let laborCost = Object.values(labor).reduce((s, v) => s + v.cost, 0);
    const sel = method === "selective";
    const disposal = {
      concrete: { t: t.concrete, cost: t.concrete * (sel ? p.disposal.concreteSelective : p.disposal.concreteGeneral) },
      wood: { t: t.wood, cost: t.wood * p.disposal.wood },
      resin: { t: t.resin, cost: t.resin * p.disposal.resin },
      mixed: { t: t.mixed, cost: t.mixed * (sel ? p.disposal.mixedSelective : p.disposal.mixedGeneral) },
    };
    const disposalCost = Object.values(disposal).reduce((s, v) => s + v.cost, 0);
    const revenue = sel ? { wood: t.wood * p.recovery * p.revenue.wood, resin: t.resin * p.recovery * p.revenue.resin, steel: t.metal * p.recovery * p.revenue.steel }
      : { steel: p.generalRecovers.includes("steel") ? t.metal * p.revenue.steel : 0 };
    const revenueTotal = Object.values(revenue).reduce((s, v) => s + v, 0);
    // 팀 프리셋: 구조체 압쇄·반출·소형 장비
    let equipCost = 0, haulCost = 0, structDays = 0;
    if (p.includeStructure) {
      structDays = t.concrete / 2.4 / p.crushProd;
      equipCost += structDays * p.hoursPerDay * p.equipment.excavatorLarge;
      laborCost += structDays * p.structCrew * p.wage.laborer;
    }
    const interiorDays = Object.values(labor).reduce((s, v) => s + v.days, 0) / Math.max(1, p.crewSize);
    if (sel && p.selectiveEquip) equipCost += interiorDays * p.hoursPerDay * (p.equipment.excavatorSmall + p.equipment.cutter);
    if (p.haul.on) haulCost = ((t.concrete + t.wood + t.resin + t.mixed + t.metal) / p.haul.truckLoad) * p.haul.hoursPerTrip * p.equipment.dump;
    const days = interiorDays + structDays;
    const indirect = days * (p.indirectPerDay || 0);
    return { labor, laborCost, equipCost, haulCost, disposal, disposalCost, revenue, revenueTotal, days, indirect, total: laborCost + equipCost + haulCost + disposalCost + indirect - revenueTotal };
  };
  const general = side("general");
  const selective = side("selective");
  return {
    area, use, tons: t, general, selective,
    delta: {
      construction: selective.laborCost - general.laborCost,
      equipment: selective.equipCost + selective.haulCost - general.equipCost - general.haulCost,
      disposal: selective.disposalCost - general.disposalCost,
      revenue: general.revenueTotal - selective.revenueTotal,
      total: selective.total - general.total,
    },
  };
}

/* ---------------- 불확실성: 몬테카를로 ---------------- */

// 가정 범위 [최소, 최빈, 최대]
export const UNCERTAINTY = {
  mixedGeneral: { label: "일괄 압쇄 혼합폐기물 단가 (원/t)", range: [166193, 188715, 210000], apply: (p, v) => { p.disposal.mixedGeneral = v; } },
  concreteSelective: { label: "분별 후 폐콘크리트 단가 (원/t)", range: [31142, 31142, 49571], apply: (p, v) => { p.disposal.concreteSelective = v; } },
  selectiveLabor: { label: "분별 해체 품 배율", range: [0.9, 1.0, 1.29], apply: (p, v) => { p.selectiveLaborFactor = v; } },
  revenueResin: { label: "폐합성수지 매각가 (원/t)", range: [0, 100000, 850000], apply: (p, v) => { p.revenue.resin = v; } },
  revenueWood: { label: "폐목재 매각가 (원/t)", range: [0, 20000, 274348], apply: (p, v) => { p.revenue.wood = v; } },
  recovery: { label: "회수율", range: [0.6, 0.85, 1.0], apply: (p, v) => { p.recovery = v; } },
  wage: { label: "노임 배율", range: [0.95, 1.0, 1.1], apply: (p, v) => { p.wageFactor = v; } },
  equip: { label: "장비비 배율", range: [0.9, 1.0, 1.15], apply: (p, v) => { p.equipFactor = v; } },
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function triangular(u, [a, c, b]) {
  if (b <= a) return a;
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}
function withVars(params, vars) {
  const p = mergeParams(structuredClone(params || {}));
  for (const [k, v] of Object.entries(vars)) UNCERTAINTY[k].apply(p, v);
  return p;
}
function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function simulate(model, params, { n = 2000, seed = 20231 } = {}) {
  const items = toItems(model);
  const ctx = ctxOf(model);
  const rand = rng(seed);
  const keys = Object.keys(UNCERTAINTY);
  const d = [];
  const delta = (p) => scenarioCost(items, ctx, p, "selective").total - scenarioCost(items, ctx, p, "general").total;
  for (let i = 0; i < n; i++) {
    const vars = Object.fromEntries(keys.map((k) => [k, triangular(rand(), UNCERTAINTY[k].range)]));
    d.push(delta(withVars(params, vars)));
  }
  const s = [...d].sort((a, b) => a - b);
  const mid = Object.fromEntries(keys.map((k) => [k, UNCERTAINTY[k].range[1]]));
  const base = delta(withVars(params, mid));
  const tornado = keys.map((k) => {
    const [lo, , hi] = UNCERTAINTY[k].range;
    return { key: k, label: UNCERTAINTY[k].label, low: delta(withVars(params, { ...mid, [k]: lo })), high: delta(withVars(params, { ...mid, [k]: hi })) };
  }).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return {
    n, seed, base, tornado,
    selective: { values: d, pCheaper: d.filter((v) => v < 0).length / n, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) },
  };
}

// Δ(분별 − 일괄)가 0이 되는 단가. Δ는 단가에 대해 선형이다.
export function breakEven(model, params, key) {
  const items = toItems(model);
  const ctx = ctxOf(model);
  const at = (v) => {
    const p = withVars(params, { [key]: v });
    return scenarioCost(items, ctx, p, "selective").total - scenarioCost(items, ctx, p, "general").total;
  };
  const a = 0, b = 1e6;
  const da = at(a), db = at(b);
  if (Math.abs(da - db) < 1e-6) return null;
  const v = a - (da * (b - a)) / (db - da);
  return v;
}

export { PRESETS };
