// 완전 철거 / 분별 해체 / 최적 혼합안 비용 계산 엔진.
// 비교 구조는 논문(2023)의 Δ = 시공비 증가 − 처리비 감소 − 재활용 수익을 따른다.
// 브라우저와 Node 양쪽에서 쓰도록 DOM에 의존하지 않는다.
import { WORK_ITEMS, ASSEMBLIES, MATERIALS, TYPES, DEFAULT_PARAMS, SEPARABLE_MIN, WASTE_UNIT } from "./catalog.js";

const TRADE_KEYS = ["carpenter", "laborer", "roofer", "mason"];
const RECYCLABLE = ["wood", "resin"]; // 논문이 재활용 수익을 계산한 성상

export function mergeParams(p = {}) {
  const d = DEFAULT_PARAMS;
  return {
    ...d, ...p,
    wage: { ...d.wage, ...(p.wage || {}) },
    disposal: { ...d.disposal, ...(p.disposal || {}) },
    revenue: { ...d.revenue, ...(p.revenue || {}) },
  };
}

function productivity(itemKey, method, params) {
  const item = WORK_ITEMS[itemKey];
  if (!item) return {};
  if (method === "general") return item.general;
  if (params.table4 === "aligned" && item.selectiveAligned) return item.selectiveAligned;
  return item.selective;
}

/* ---------------- 물량 산출 ---------------- */

export function levelOf(model, el) {
  return model.levels.find((l) => l.id === el.levelId) || model.levels[0];
}

export function lineLength(el) {
  return Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
}

export function openingsOf(model, wallId) {
  return model.elements.filter((e) => e.hostId === wallId);
}

// 부재 하나의 면적·부피·성상별 톤·해체 작업
export function takeoffElement(el, model) {
  const asm = ASSEMBLIES[el.assembly];
  const type = TYPES[el.type];
  const level = levelOf(model, el);
  const tons = {};
  const add = (mat, t) => {
    const w = MATERIALS[mat]?.waste;
    if (!w || !(t > 0)) return;
    tons[w] = (tons[w] || 0) + t;
  };
  let area = 0; // 해체 품을 곱할 면적
  let volume = 0;

  if (!asm || !type) return { area, volume, tons, work: [] };

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
      add(L.m, v * MATERIALS[L.m].density);
    }
  } else if (el.type === "beam") {
    const len = lineLength(el);
    const v = len * (Number(el.thickness) || 0.3) * (Number(el.depth) || 0.5);
    volume = v;
    for (const L of asm.layers) add(L.m, v * (L.fill ?? 1) * MATERIALS[L.m].density);
  } else if (type.kind === "point") {
    const h = Number(el.height) || level?.height || 3;
    const v = (Number(el.w) || 0.5) * (Number(el.d) || 0.5) * h;
    volume = v;
    for (const L of asm.layers) add(L.m, v * (L.fill ?? 1) * MATERIALS[L.m].density);
  } else if (type.kind === "rect") {
    area = Math.abs(el.w * el.d);
    for (const L of asm.layers) {
      const v = area * L.t;
      volume += v;
      add(L.m, v * MATERIALS[L.m].density);
    }
  } else if (type.kind === "opening") {
    area = (el.width || 0) * (el.height || 0);
    for (const L of asm.perArea || []) add(L.m, (area * L.kg) / 1000);
  }
  if (type.structural && el.type !== "wall") area = 0;
  return { area, volume, tons, work: asm.work || [] };
}

export function takeoff(model) {
  const out = {};
  for (const el of model.elements) out[el.id] = takeoffElement(el, model);
  return out;
}

// 연면적: 슬래브 면적의 합 (슬래브가 없으면 바닥 마감 면적)
export function grossFloorArea(model) {
  const sum = (t) => model.elements.filter((e) => e.type === t).reduce((s, e) => s + Math.abs(e.w * e.d), 0);
  return sum("slab") || sum("floorFinish");
}

/* ---------------- 시나리오 계산 ---------------- */

// 모델에 그리지 않은 혼합폐기물(생활폐기물, 설비 잔재, 소형 자재 등).
// 논문 표 6의 혼합폐기물 원단위 × 연면적에서, 모델에 이미 있는 비재활용 내장재(유리·보드·타일·벽지)를 뺀다.
// 논문은 이 흐름의 단가가 분별해체로 166,193 → 67,377원/t으로 내려가는 것을 처리비 절감으로 계산했다.
export function residualMixedTons(model, params, q = takeoff(model)) {
  const p = mergeParams(params);
  if (p.residualMixed === false) return 0;
  const unit = WASTE_UNIT[model.use]?.mixed;
  if (!unit) return 0;
  let modeled = 0;
  for (const t of Object.values(q)) for (const w of ["glass", "board", "tile", "wallpaper"]) modeled += t.tons[w] || 0;
  return Math.max(0, unit * grossFloorArea(model) - modeled);
}

// 분별해체 가능 여부: 해체 시공성 점수와 유해물질
export function isEligible(el) {
  const asm = ASSEMBLIES[el.assembly];
  if (!asm || !(asm.work || []).length) return false; // 구조체는 두 방법이 같음
  if (el.hazard && el.hazard !== "none") return false; // 석면은 별도 공정(두 방법 공통)
  return (Number(el.separable) || 4) >= SEPARABLE_MIN;
}

function emptyResult() {
  return {
    labor: Object.fromEntries(TRADE_KEYS.map((k) => [k, { days: 0, cost: 0 }])),
    disposal: {},
    revenue: {},
    laborCost: 0, disposalCost: 0, revenueTotal: 0,
    days: 0, indirect: 0, total: 0,
    perElement: {},
  };
}

// 부재 하나를 일반/분별로 처리할 때의 인력·처리·수익
function elementCost(el, q, method, p) {
  const r = { manDays: 0, labor: {}, laborCost: 0, disposal: {}, disposalCost: 0, revenue: {}, revenueTotal: 0 };
  for (const key of q.work) {
    const prod = productivity(key, method, p);
    for (const [trade, rate] of Object.entries(prod)) {
      const days = rate * q.area * (method === "selective" ? (p.selectiveLaborFactor || 1) : 1);
      r.labor[trade] = (r.labor[trade] || 0) + days;
      r.manDays += days;
      r.laborCost += days * (p.wage[trade] || 0) * (p.wageFactor || 1);
    }
  }
  const put = (stream, t, price) => {
    if (!(t > 0)) return;
    const s = (r.disposal[stream] ||= { t: 0, cost: 0 });
    s.t += t; s.cost += t * price; r.disposalCost += t * price;
  };
  for (const [w, t] of Object.entries(q.tons)) {
    if (w === "concrete") { put("concrete", t, p.disposal.concrete); continue; }
    if (w === "metal") {
      put("metal", t, p.disposal.metal);
      if (p.revenue.metal) { r.revenue.metal = (r.revenue.metal || 0) + t * p.revenue.metal; r.revenueTotal += t * p.revenue.metal; }
      continue;
    }
    if (method === "general") { put("mixed", t, p.disposal.mixedGeneral); continue; }
    if (w === "wallpaper") { put("mixed", t, p.disposal.mixedSelective); continue; }
    const rec = RECYCLABLE.includes(w) ? p.recovery : 1;
    put(w, t * rec, p.disposal[w] ?? p.disposal.mixedSelective);
    if (rec < 1) put("mixed", t * (1 - rec), p.disposal.mixedSelective);
    if (RECYCLABLE.includes(w)) {
      const won = t * rec * (p.revenue[w] || 0);
      r.revenue[w] = (r.revenue[w] || 0) + won;
      r.revenueTotal += won;
    }
  }
  r.net = r.laborCost + r.disposalCost - r.revenueTotal;
  return r;
}

// selected: 분별해체할 부재 id 집합
export function evaluate(model, params, selected = new Set(), q = takeoff(model)) {
  const p = mergeParams(params);
  const res = emptyResult();
  const acc = (c) => {
    for (const [trade, days] of Object.entries(c.labor)) {
      res.labor[trade].days += days;
      res.labor[trade].cost += days * (p.wage[trade] || 0) * (p.wageFactor || 1);
    }
    res.laborCost += c.laborCost;
    for (const [s, v] of Object.entries(c.disposal)) {
      const d = (res.disposal[s] ||= { t: 0, cost: 0 });
      d.t += v.t; d.cost += v.cost;
    }
    res.disposalCost += c.disposalCost;
    for (const [s, v] of Object.entries(c.revenue)) res.revenue[s] = (res.revenue[s] || 0) + v;
    res.revenueTotal += c.revenueTotal;
    res.days += c.manDays;
  };
  for (const el of model.elements) {
    const method = selected.has(el.id) && isEligible(el) ? "selective" : "general";
    const c = elementCost(el, q[el.id], method, p);
    res.perElement[el.id] = { method, ...c };
    acc(c);
  }
  // 분별해체를 하나라도 하면 연면적 기준 선별·반출 공정이 붙고, 잔여 혼합폐기물 단가가 내려간다
  res.gfa = grossFloorArea(model);
  const sorted = [...selected].some((id) => res.perElement[id]?.method === "selective");
  if (sorted) {
    const c = elementCost({}, { work: ["sorting"], area: res.gfa, tons: {} }, "selective", p);
    res.sorting = c;
    acc(c);
  }
  const rt = residualMixedTons(model, p, q);
  if (rt > 0) {
    const price = sorted ? p.disposal.mixedSelective : p.disposal.mixedGeneral;
    const d = (res.disposal.residual ||= { t: 0, cost: 0 });
    d.t += rt; d.cost += rt * price;
    res.disposalCost += rt * price;
    res.residual = { t: rt, price };
  }
  res.days = res.days / Math.max(1, p.crewSize); // 인·일 → 공기(일)
  res.indirect = res.days * (p.indirectPerDay || 0);
  res.total = res.laborCost + res.disposalCost - res.revenueTotal + res.indirect;
  return res;
}

// 부재마다 분별이 이득인지 보고 고른다. 선별 공정은 고정비라 마지막에 한 번 더 따진다.
export function chooseOptimal(model, params, q = takeoff(model)) {
  const p = mergeParams(params);
  const perDay = (p.indirectPerDay || 0) / Math.max(1, p.crewSize);
  const picks = [];
  let gain = 0;
  for (const el of model.elements) {
    if (!isEligible(el)) continue;
    const g = elementCost(el, q[el.id], "general", p);
    const s = elementCost(el, q[el.id], "selective", p);
    const delta = (s.net + s.manDays * perDay) - (g.net + g.manDays * perDay);
    if (delta < 0) { picks.push(el.id); gain += delta; }
  }
  const sort = elementCost({}, { work: ["sorting"], area: grossFloorArea(model), tons: {} }, "selective", p);
  const residualSaving = residualMixedTons(model, p, q) * (p.disposal.mixedGeneral - p.disposal.mixedSelective);
  const fixed = sort.net + sort.manDays * perDay - residualSaving;
  return gain + fixed < 0 ? new Set(picks) : new Set();
}

export function compare(model, params) {
  const q = takeoff(model);
  const eligible = new Set(model.elements.filter(isEligible).map((e) => e.id));
  const optimalSet = chooseOptimal(model, params, q);
  const full = evaluate(model, params, new Set(), q);
  const selective = evaluate(model, params, eligible, q);
  const optimal = evaluate(model, params, optimalSet, q);
  return { q, full, selective, optimal, optimalSet, eligible };
}

/* ---------------- 논문 방식: 면적 × 원단위 ---------------- */

// 논문 표 3·4의 품을 모두 공사면적에 곱하고, 표 6 원단위로 폐기물량을 낸다.
export function paperCase(params = {}, { area = 2400, use = "주거 공동주택" } = {}) {
  const p = mergeParams(params);
  const unit = WASTE_UNIT[use];
  const side = (method) => {
    const labor = Object.fromEntries(TRADE_KEYS.map((k) => [k, { days: 0, cost: 0 }]));
    for (const key of Object.keys(WORK_ITEMS)) {
      for (const [trade, rate] of Object.entries(productivity(key, method, p))) {
        const days = rate * area;
        labor[trade].days += days;
        labor[trade].cost += days * (p.wage[trade] || 0);
      }
    }
    const laborCost = Object.values(labor).reduce((s, v) => s + v.cost, 0);
    const t = { concrete: unit.concrete * area, wood: unit.wood * area, resin: unit.resin * area, mixed: unit.mixed * area };
    const mixedPrice = method === "general" ? p.disposal.mixedGeneral : p.disposal.mixedSelective;
    const disposal = {
      concrete: { t: t.concrete, cost: t.concrete * p.disposal.concrete },
      wood: { t: t.wood, cost: t.wood * p.disposal.wood },
      resin: { t: t.resin, cost: t.resin * p.disposal.resin },
      mixed: { t: t.mixed, cost: t.mixed * mixedPrice },
    };
    const disposalCost = Object.values(disposal).reduce((s, v) => s + v.cost, 0);
    const revenue = method === "selective"
      ? { wood: t.wood * p.recovery * p.revenue.wood, resin: t.resin * p.recovery * p.revenue.resin }
      : {};
    const revenueTotal = Object.values(revenue).reduce((s, v) => s + v, 0);
    return { labor, laborCost, disposal, disposalCost, revenue, revenueTotal, total: laborCost + disposalCost - revenueTotal };
  };
  const general = side("general");
  const selective = side("selective");
  return {
    area, use, general, selective,
    delta: {
      construction: selective.laborCost - general.laborCost,
      disposal: selective.disposalCost - general.disposalCost,
      revenue: -selective.revenueTotal,
      total: selective.total - general.total,
    },
  };
}

/* ---------------- 불확실성: 몬테카를로 ---------------- */

// 가정 범위 [최소, 최빈, 최대]. 논문 값은 최빈 또는 최대에 둔다.
export const UNCERTAINTY = {
  revenueResin: { label: "폐합성수지 재활용 수익 (원/t)", range: [0, 300000, 850000], apply: (p, v) => { p.revenue.resin = v; } },
  revenueWood: { label: "폐목재 재활용 수익 (원/t)", range: [0, 60000, 274348], apply: (p, v) => { p.revenue.wood = v; } },
  recovery: { label: "회수율", range: [0.5, 0.8, 1.0], apply: (p, v) => { p.recovery = v; } },
  mixedGeneral: { label: "일반 해체 혼합폐기물 단가 (원/t)", range: [120000, 166193, 190000], apply: (p, v) => { p.disposal.mixedGeneral = v; } },
  selectiveLabor: { label: "분별 해체 품 배율", range: [0.9, 1.0, 1.29], apply: (p, v) => { p.selectiveLaborFactor = v; } },
  wage: { label: "노임 배율", range: [0.95, 1.0, 1.1], apply: (p, v) => { p.wageFactor = v; } },
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
  const q = takeoff(model);
  const eligible = new Set(model.elements.filter(isEligible).map((e) => e.id));
  const rand = rng(seed);
  const keys = Object.keys(UNCERTAINTY);
  const dSel = [], dOpt = [];
  for (let i = 0; i < n; i++) {
    const vars = Object.fromEntries(keys.map((k) => [k, triangular(rand(), UNCERTAINTY[k].range)]));
    const p = withVars(params, vars);
    const full = evaluate(model, p, new Set(), q).total;
    dSel.push(evaluate(model, p, eligible, q).total - full);
    dOpt.push(evaluate(model, p, chooseOptimal(model, p, q), q).total - full);
  }
  const summary = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return { pCheaper: arr.filter((v) => v < 0).length / arr.length, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9), values: arr };
  };
  // 토네이도: 한 변수만 최소·최대로 바꾸고 나머지는 최빈값
  const mid = Object.fromEntries(keys.map((k) => [k, UNCERTAINTY[k].range[1]]));
  const deltaAt = (vars) => {
    const p = withVars(params, vars);
    return evaluate(model, p, eligible, q).total - evaluate(model, p, new Set(), q).total;
  };
  const base = deltaAt(mid);
  const tornado = keys.map((k) => {
    const [lo, , hi] = UNCERTAINTY[k].range;
    return { key: k, label: UNCERTAINTY[k].label, low: deltaAt({ ...mid, [k]: lo }), high: deltaAt({ ...mid, [k]: hi }) };
  }).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return { n, seed, selective: summary(dSel), optimal: summary(dOpt), base, tornado };
}

// 분별해체(전체)가 완전철거와 같아지는 폐합성수지 수익(원/t). Δ가 수익에 대해 선형이라는 점을 이용한다.
export function breakEvenResin(model, params) {
  const q = takeoff(model);
  const eligible = new Set(model.elements.filter(isEligible).map((e) => e.id));
  const at = (v) => {
    const p = mergeParams(structuredClone(params || {}));
    p.revenue.resin = v;
    return evaluate(model, p, eligible, q).total - evaluate(model, p, new Set(), q).total;
  };
  const d0 = at(0), d1 = at(1000000);
  if (d0 === d1) return null;
  return (-d0 / (d1 - d0)) * 1000000;
}
