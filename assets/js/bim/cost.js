// 일괄 압쇄(general) vs 전면 분별해체(selective) 비용·공기 계산.
// 입력은 부재 목록(items)이며, 웹 편집기·IFC·Revit 어디서 왔든 같은 모양이다.
//   item = { id, category, area, tons: { 재료키: t }, work: [품 항목] | null, separable, hazard }
//   ctx  = { gfa: 연면적 ㎡, use: 폐기물 원단위 용도 }
// 같은 계산이 revit/ReClaim.extension/lib/reclaim_engine.py에도 있다. 바꾸면 둘 다 바꾸고
// scripts/test_engines.mjs로 결과가 같은지 확인한다.
import {
  MATERIALS, WORK_ITEMS, PRESETS, DEFAULT_PARAMS, SEPARABLE_MIN, WASTE_UNIT,
  METAL_PRICE_KEY, INERT_MATS, CRUSH_MATS, WORK_RULES,
} from "./catalog.js";

export const TRADE_KEYS = ["carpenter", "laborer", "roofer", "mason"];
const RECYCLABLE = ["wood", "resin"];

export function mergeParams(p = {}) {
  const base = PRESETS[p.preset] || DEFAULT_PARAMS;
  return {
    ...base, ...p,
    wage: { ...base.wage, ...(p.wage || {}) },
    disposal: { ...base.disposal, ...(p.disposal || {}) },
    revenue: { ...base.revenue, ...(p.revenue || {}) },
    equipment: { ...base.equipment, ...(p.equipment || {}) },
    haul: { ...base.haul, ...(p.haul || {}) },
    masonry: { ...base.masonry, ...(p.masonry || {}) },
  };
}

export function productivity(itemKey, method, p) {
  const item = WORK_ITEMS[itemKey];
  if (!item) return {};
  if (method === "general") return item.general;
  if (p.table4 === "aligned" && item.selectiveAligned) return item.selectiveAligned;
  return item.selective;
}

// 부재 종류와 재료로 해체 작업을 정한다 (WORK_RULES).
export function workFor(category, mats) {
  const keys = Object.keys(mats).filter((m) => mats[m] > 0);
  const out = [];
  const onlyHit = new Set();
  for (const r of WORK_RULES) {
    if (r.category !== category || !r.only) continue;
    if (keys.length && keys.every((m) => r.mats.includes(m))) { out.push(...r.work); onlyHit.add(r.category); }
  }
  for (const r of WORK_RULES) {
    if (r.category !== category || r.only) continue;
    if (r.any) { if (!onlyHit.has(category)) out.push(...r.work); continue; }
    if (r.mats.some((m) => keys.includes(m))) out.push(...r.work);
  }
  return [...new Set(out)];
}

export function isEligible(item) {
  if (item.hazard && item.hazard !== "none") return false;
  if (!(item.work || []).length) return false;
  return (Number(item.separable) || 4) >= SEPARABLE_MIN;
}

// 모델에 그리지 않은 혼합폐기물: 원단위 × 연면적 − 모델의 비재활용 내장재
export function residualMixedTons(items, ctx, p) {
  if (p.residualMixed === false) return 0;
  const unit = WASTE_UNIT[ctx.use]?.mixed;
  if (!unit) return 0;
  let modeled = 0;
  for (const it of items) for (const [m, t] of Object.entries(it.tons)) {
    const w = MATERIALS[m]?.waste;
    if (w === "glass" || w === "board" || w === "tile" || w === "wallpaper") modeled += t;
  }
  return Math.max(0, unit * (ctx.gfa || 0) - modeled);
}

// 부재 하나를 method("general" | "selective")로 처리할 때 인력·처리·수익
// scenario: 현장 전체 방식. 분별 현장에서는 남은 혼합폐기물도 가연성이 빠진 단가를 쓴다.
export function itemCost(item, method, scenario, p) {
  const r = { manDays: 0, labor: {}, laborCost: 0, disposal: {}, disposalCost: 0, revenue: {}, revenueTotal: 0 };
  const wf = p.wageFactor || 1;
  const addLabor = (trade, days) => {
    if (!(days > 0)) return;
    r.labor[trade] = (r.labor[trade] || 0) + days;
    r.manDays += days;
    r.laborCost += days * (p.wage[trade] || 0) * wf;
  };
  const lf = method === "selective" ? (p.selectiveLaborFactor || 1) : 1;
  for (const key of item.work || []) {
    for (const [trade, rate] of Object.entries(productivity(key, method, p))) addLabor(trade, rate * (item.area || 0) * lf);
  }
  // 조적벽 분리 (분별 해체만)
  if (method === "selective" && item.tons.brick > 0) {
    const vol = item.tons.brick / MATERIALS.brick.density;
    addLabor("mason", vol * p.masonry.mason * lf);
    addLabor("laborer", vol * p.masonry.laborer * lf);
  }
  const put = (stream, t, price) => {
    if (!(t > 0)) return;
    const s = (r.disposal[stream] ||= { t: 0, cost: 0 });
    s.t += t; s.cost += t * price; r.disposalCost += t * price;
  };
  const earn = (key, t, price) => {
    if (!(t > 0) || !price) return;
    r.revenue[key] = (r.revenue[key] || 0) + t * price;
    r.revenueTotal += t * price;
  };
  const mixedHere = scenario === "selective" ? p.disposal.mixedSelective : p.disposal.mixedGeneral;
  for (const [m, t] of Object.entries(item.tons)) {
    if (!(t > 0)) continue;
    const w = MATERIALS[m]?.waste || "mixed";
    if (w === "concrete") {
      if (INERT_MATS.includes(m)) put("inert", t, method === "selective" ? p.disposal.inert : p.disposal.concreteGeneral);
      else put("concrete", t, scenario === "selective" ? p.disposal.concreteSelective : p.disposal.concreteGeneral);
      continue;
    }
    if (w === "metal") {
      const key = METAL_PRICE_KEY[m] || "steel";
      const recovered = method === "selective" || p.generalRecovers.includes(key);
      // 금속은 떼어내면 거의 전량 회수된다고 보고 회수율을 적용하지 않는다
      if (recovered) earn(key, t, p.revenue[key]);
      else put("mixed", t, mixedHere);
      continue;
    }
    if (method === "general") { put("mixed", t, mixedHere); continue; }
    if (w === "tile") { put("inert", t, p.disposal.inert); continue; }
    if (RECYCLABLE.includes(w)) {
      put(w, t * p.recovery, p.disposal[w]);
      earn(w, t * p.recovery, p.revenue[w]);
      if (p.recovery < 1) put("mixed", t * (1 - p.recovery), mixedHere);
      continue;
    }
    put("mixed", t, mixedHere); // 유리·보드·벽지·기타
  }
  r.net = r.laborCost + r.disposalCost - r.revenueTotal;
  return r;
}

function addInto(res, c, p) {
  for (const [trade, days] of Object.entries(c.labor)) {
    const L = (res.labor[trade] ||= { days: 0, cost: 0 });
    L.days += days;
    L.cost += days * (p.wage[trade] || 0) * (p.wageFactor || 1);
  }
  res.laborCost += c.laborCost;
  res.interiorManDays += c.manDays;
  for (const [s, v] of Object.entries(c.disposal)) {
    const d = (res.disposal[s] ||= { t: 0, cost: 0 });
    d.t += v.t; d.cost += v.cost;
  }
  res.disposalCost += c.disposalCost;
  for (const [k, v] of Object.entries(c.revenue)) res.revenue[k] = (res.revenue[k] || 0) + v;
  res.revenueTotal += c.revenueTotal;
}

export function scenarioCost(items, ctx, params, scenario) {
  const p = mergeParams(params);
  const res = {
    scenario, labor: {}, laborCost: 0, interiorManDays: 0, disposal: {}, disposalCost: 0, revenue: {}, revenueTotal: 0,
    equip: {}, equipCost: 0, haulCost: 0, trips: 0, days: 0, interiorDays: 0, structDays: 0, indirect: 0, total: 0,
    perItem: {}, hazardItems: [],
  };
  let anySelective = false;
  for (const it of items) {
    if (it.hazard && it.hazard !== "none") { res.hazardItems.push(it.id); res.perItem[it.id] = { method: "hazard", net: 0 }; continue; }
    const method = scenario === "selective" && isEligible(it) ? "selective" : "general";
    if (method === "selective") anySelective = true;
    const c = itemCost(it, method, scenario, p);
    res.perItem[it.id] = { method, net: c.net, tons: it.tons };
    addInto(res, c, p);
  }
  // 분별 현장: 연면적 기준 선별·분리 반출 공정
  if (anySelective) {
    const c = itemCost({ id: "sorting", tons: {}, work: ["sorting"], area: ctx.gfa || 0 }, "selective", scenario, p);
    res.sorting = c;
    addInto(res, c, p);
  }
  // 모델 밖 혼합폐기물
  const rt = residualMixedTons(items, ctx, p);
  if (rt > 0) {
    const price = scenario === "selective" ? p.disposal.mixedSelective : p.disposal.mixedGeneral;
    const d = (res.disposal.residual ||= { t: 0, cost: 0 });
    d.t += rt; d.cost += rt * price;
    res.disposalCost += rt * price;
    res.residual = { t: rt, price };
  }
  res.interiorDays = res.interiorManDays / Math.max(1, p.crewSize);
  const H = p.hoursPerDay;
  // 구조체 압쇄 (두 방법 같음)
  if (p.includeStructure) {
    let vol = 0;
    for (const it of items) for (const m of CRUSH_MATS) if (it.tons[m] > 0 && !(it.hazard && it.hazard !== "none")) vol += it.tons[m] / MATERIALS[m].density;
    res.crushVolume = vol;
    res.structDays = vol / Math.max(0.1, p.crushProd * (p.crushFactor || 1));
    const ex = res.structDays * H * p.equipment.excavatorLarge * (p.equipFactor || 1);
    res.equip.excavatorLarge = ex;
    const crewDays = res.structDays * p.structCrew;
    const L = (res.labor.laborer ||= { days: 0, cost: 0 });
    L.days += crewDays;
    L.cost += crewDays * p.wage.laborer * (p.wageFactor || 1);
    res.laborCost += crewDays * p.wage.laborer * (p.wageFactor || 1);
  }
  // 분별 내장 공정 동안 소형 장비
  if (scenario === "selective" && anySelective && p.selectiveEquip) {
    res.equip.excavatorSmall = res.interiorDays * H * p.equipment.excavatorSmall * (p.equipFactor || 1);
    res.equip.cutter = res.interiorDays * H * p.equipment.cutter * (p.equipFactor || 1);
  }
  res.equipCost = Object.values(res.equip).reduce((s, v) => s + v, 0);
  // 반출 (처리장·매입처로 나가는 모든 톤)
  if (p.haul.on) {
    let t = 0;
    for (const d of Object.values(res.disposal)) t += d.t;
    for (const [k, won] of Object.entries(res.revenue)) {
      const price = p.revenue[k];
      if (price) t += won / price;
    }
    res.trips = t / Math.max(0.1, p.haul.truckLoad);
    res.haulCost = res.trips * p.haul.hoursPerTrip * p.equipment.dump * (p.equipFactor || 1);
  }
  res.days = res.interiorDays + res.structDays;
  res.indirect = res.days * (p.indirectPerDay || 0);
  res.total = res.laborCost + res.equipCost + res.disposalCost + res.haulCost + res.indirect - res.revenueTotal;
  return res;
}

export function compareItems(items, ctx, params) {
  return { general: scenarioCost(items, ctx, params, "general"), selective: scenarioCost(items, ctx, params, "selective") };
}

// 부재별 차이(분별 − 일괄): 인건비 + 처리비 − 수익. Revit 매개변수 RC_비용차에 쓴다.
export function itemDeltas(items, ctx, params) {
  const p = mergeParams(params);
  const out = {};
  for (const it of items) {
    if (it.hazard && it.hazard !== "none") { out[it.id] = { method: "hazard", delta: 0 }; continue; }
    const g = itemCost(it, "general", "general", p);
    const eligible = isEligible(it);
    const s = itemCost(it, eligible ? "selective" : "general", "selective", p);
    out[it.id] = { method: eligible ? "selective" : "general", delta: s.net - g.net };
  }
  return out;
}
