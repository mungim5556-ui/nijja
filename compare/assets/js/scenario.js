// 일괄 압쇄 vs 전면 분별해체 비용 엔진. DOM을 쓰지 않는 순수 함수만 둔다.
// 물량 q = { area_m2, floors(지상 층수), concrete_m3, rebarFromConcrete, t: { concrete, metal, wood, resin, glass, board, mixed, copper, aluminum },
//          site(대지 조건: SITES의 키), labor(분별 추가 품 계산: "paper" | "quantity") }
// 단가 p = { 키: 숫자 } (rates.json의 params에서 value만 뽑은 것)
import { serviceItems, serviceSalvage } from "./service-salvage.js?v=service-recovery-20261123";

export const STREAMS = ["concrete", "masonry", "metal", "wood", "resin", "glass", "tile", "board", "panel", "mixed", "copper", "aluminum"];
export const STREAM_LABEL = {
  concrete: "폐콘크리트", masonry: "폐벽돌·조적", metal: "철근·강재", wood: "폐목재", resin: "폐합성수지", glass: "폐유리", tile: "폐타일·도자기",
  board: "폐보드", panel: "폐샌드위치패널", mixed: "혼합·기타", copper: "구리", aluminum: "알루미늄",
  excluded: "제외 (집계 안 함)",
};
// 물량에 넣지 않는 부재 (IFC의 기타 객체: 가구·설비·조경 등). STREAMS에는 들어가지 않는다.
export const EXCLUDED = "excluded";
// 분별해체에서 따로 떼어 내는 성상 (나머지는 구조체와 함께 압쇄)
export const SEPARATED = new Set(["wood", "resin", "glass", "board", "copper", "aluminum"]);

// 대지 조건은 자동 장비 가정에 쓰고, 장비·양중 방식은 현장별로 지정할 수 있다.
export const SITES = { wide: "넉넉함", normal: "보통", tight: "협소·도심", restricted: "진입 제한" };
export const EQUIPMENT = { auto: "대지 조건으로 추정", mixed: "소형·대형 지상 굴착기 각 1대", large: "대형 지상 장비", small: "소형 지상 장비", mounted: "탑재 장비 + 크레인" };
export const equipmentMode = (q) => q.equipment && q.equipment !== "auto"
  ? q.equipment : q.site === "tight" || q.site === "restricted" ? (q.fixedComparison ? "small" : "mounted") : "large";
export const smallSite = (q) => equipmentMode(q) !== "large";
export const separation = (p) => ({
  wood: p.rec_sel, resin: p.rec_sel_resin ?? p.rec_sel,
  glass: p.rec_sel_glass ?? 0, board: p.rec_sel_board ?? 0,
});
// 분별 추가 품 계산 방식 (6.3의 3)
export const LABOR_METHODS = { paper: "논문 표 3·4의 차이 품 (현장 적용 가정)", quantity: "자재별 작업량과 일반해체 공수 차감" };

// 압쇄기로 허무는 구조체 부피(㎥): 콘크리트 + 조적
export const crushVolume = (q) => (q.concrete_m3 || 0) + (q.masonry_m3 || 0);

export function concreteCut(q, mode) {
  const input = q.concreteCut?.[mode] ?? {};
  if ("area" in input) {
    // 절단면적과 장비 시간은 공사 범위의 근거다. 기존 압쇄 부피와 전체 공기에서 비례 차감하지 않는다.
    const area = input.area ?? 0;
    const values = [area, input.hours, input.days, input.cost, input.liftingCost, input.avoidedHours];
    const active = values.some(value => value != null && value !== 0) || Boolean(input.liftingRequired || input.quoteIncomplete);
    const ready = !active || (area > 0 && values.every(value => value == null || (Number.isFinite(value) && value >= 0)));
    const liftingCost = input.liftingIncluded ? null : input.liftingCost ?? null;
    const scheduleInput = q.workSchedule?.[mode] ?? {};
    return {
      area,
      hours: input.hours ?? null,
      days: input.days ?? 0,
      daysMissing: active && input.days == null && scheduleInput.totalDays == null && scheduleInput.structureDays == null,
      cutCost: input.cost ?? null,
      liftingCost,
      liftingRequired: Boolean(input.liftingRequired),
      liftingIncluded: Boolean(input.liftingIncluded),
      cost: (input.cost ?? 0) + (liftingCost ?? 0),
      costBasis: input.costBasis ?? null,
      avoidedHours: input.avoidedHours ?? 0,
      active,
      ready,
      quoteMissing: active && (input.cost == null || Boolean(input.quoteIncomplete)
        || (Boolean(input.liftingRequired) && !input.liftingIncluded && liftingCost == null)),
    };
  }
  const volume = input.volume ?? 0;
  const cost = input.cost ?? 0;
  const days = input.days ?? 0;
  const active = volume > 0 || cost > 0 || days > 0;
  const ready = !active || (volume > 0 && volume <= (q.concrete_m3 ?? 0) && days > 0);
  return { volume, cost, days, active, ready, quoteMissing: active && input.cost == null };
}

function remainingCrushShare(q, mode) {
  const cut = concreteCut(q, mode);
  return cut.volume > 0 && cut.ready ? 1 - cut.volume / crushVolume(q) : 1;
}

// 구조체 해체 구간: 장비별 부피·하루 해체량·일수.
// 탑재 방식은 크레인으로 올린 장비가 위층을 허물고, 지상 장비가 닿는 하부 층은 대형 장비가 허문다
// (논현동 124-1 계획서 p.9·40·66·69: 탑재 R35Z 지붕~3층, 지상 DX-320 2~1층). 부피는 층수 비율로 나눈다.
export function crushSegments(q, p, method = "crush") {
  const share = remainingCrushShare(q, method);
  const volume = crushVolume(q) * share, mode = equipmentMode(q);
  if (mode === "mixed") return [
    { key: "small", label: "소형 지상 굴착기", days: q.smallHours * share / p.hours_per_day, price: q.smallPrice },
    { key: "large", label: "대형 지상 굴착기", days: q.largeHours * share / p.hours_per_day, price: q.largePrice },
  ];
  if (mode === "large") return [{ key: "large", label: "굴착기+압쇄기", volume, production: p.crush_m3_per_day, days: volume / p.crush_m3_per_day }];
  if (mode === "small") return [{ key: "small", label: "소형 굴착기+압쇄기", volume, production: p.crush_m3_per_day_small, days: volume / p.crush_m3_per_day_small }];
  const floors = Math.max(1, q.floors || 1);
  const ground = Math.min(floors, Math.max(0, q.groundFloors ?? p.mounted_ground_floors ?? 0));
  const lower = volume * ground / floors, upper = volume - lower;
  const production = q.fixedComparison
    ? ((q.mountedBucket != null ? q.mountedBucket > 0.3 : q.mountedLarge) ? p.crush_m3_per_day : p.crush_m3_per_day_small)
    : q.mountedProduction ?? p.crush_m3_per_day_small;
  return [
    { key: "mounted", label: "굴착기+압쇄기 (탑재 구간)", volume: upper, production, days: upper / production },
    { key: "ground", label: `굴착기+압쇄기 (지상 장비 구간, 하부 ${ground}개 층)`, volume: lower, production: p.crush_m3_per_day, days: lower / p.crush_m3_per_day },
  ].filter((segment) => segment.volume > 0 || segment.key === "mounted");
}

export function officeSalvage(q, p) {
  const pipeInstalled = q.pipeInstalled != null;
  const cableInstalled = q.cableInstalled != null;
  if (!q.officeRecovery && !pipeInstalled && !cableInstalled) return null;
  const pipeKg = pipeInstalled ? q.pipeInstalled * 1000 : q.officeRecovery ? q.area_m2 * p.office_pipe_kg_per_m2 : 0;
  const cableKg = cableInstalled ? q.cableInstalled * 1000 : q.officeRecovery ? q.area_m2 * p.office_cable_kg_per_m2 : 0;
  const recovery = (exposed, embedded) => exposed * p.office_exposed_recovery + (1 - exposed) * embedded;
  const pipeRate = recovery(p.office_pipe_exposed, p.office_pipe_embedded_recovery);
  const cableCrushRate = recovery(p.office_cable_exposed, p.office_cable_embedded_crush);
  const cableSelectiveRate = recovery(p.office_cable_exposed, p.office_cable_embedded_selective);
  const estimateCableCrush = cableKg > 0 && q.cableCommon == null && q.cableCrush == null;
  const estimateCableSelective = cableKg > 0 && q.cableCommon == null && q.cableSel == null;
  return {
    pipeKg, cableKg, pipeRate, cableCrushRate, cableSelectiveRate,
    pipeInstalled, cableInstalled,
    estimatePipe: pipeKg > 0 && q.copperPipeSold == null && (pipeInstalled || !(q.t?.copper > 0)),
    estimateCable: estimateCableCrush || estimateCableSelective,
    estimateCableCrush, estimateCableSelective,
  };
}

export function pvcFrameRecovery(q, selective) {
  if (q.pvcPrice == null) return 0;
  return q.windowMode ? 1 : ((selective ? q.pvcSel : q.pvcCrush) ?? 0) / 100;
}

export const paramValues = (rates) => Object.fromEntries(Object.entries(rates.params).map(([k, v]) => [k, v.value]));

const tons = (q) => Object.fromEntries(STREAMS.map((s) => [s, Number(q.t?.[s]) || 0]));

// IFC 콘크리트 톤수는 철근콘크리트 단위질량(2.4t/㎥, KDS 기준 24kN/㎥)으로 계산했으므로 철근 무게가 이미 들어 있다.
// 철근을 콘크리트 부피에서 따로 추정해 고철로 셀 때는 같은 무게를 폐콘크리트에서 빼야 이중 계상이 없다.
export const rebarTons = (q, kgPerM3) => ((q.concrete_m3 || 0) * (q.rebarKgPerM3 ?? kgPerM3)) / 1000;

// 물량 q의 성상별 톤수 (철근 분리 반영). 콘크리트에서 뺀 철근은 metal에 더한다.
// 모델에 철근을 그렸으면(q.rebarModeledTons) 그 무게는 이미 metal에 있으므로, 추정량 중 모자란 만큼만 더한다.
// 콘크리트 톤수에서는 철근 전체(추정량과 모델량 중 큰 값)를 뺀다 — 콘크리트 형상 부피는 철근을 빼지 않은 값이다.
export function streamTons(q, p) {
  const t = tons(q);
  if (q.copperPipeSold != null) t.copper = Math.max(t.copper, q.copperPipeSold);
  if (!q.rebarFromConcrete) return { t, rebar: 0, rebarAdded: 0 };
  const modeled = q.rebarModeledTons || 0;
  const rebar = Math.min(Math.max(rebarTons(q, p.rebar_kg_per_m3), modeled), t.concrete);
  const rebarAdded = Math.max(0, rebar - modeled);
  return { t: { ...t, concrete: t.concrete - rebar, metal: t.metal + rebarAdded }, rebar, rebarAdded };
}

// 폐콘크리트 성상 배분(순수 / 건설폐재류 / 가연물 5% 이하). 분별안이 더 깨끗하다는 배분은 출처가 없는 가정이므로
// 기본값은 두 공법에 같은 배분을 쓰고, 분별안 가정은 사용자가 고르거나 처리장 견적(cleanSel·cleanPrice)으로 넣는다.
export const DEFAULT_CONCRETE_CASE = "same";
export const CONCRETE_CASES = {
  same: { label: "양 공법 동일", shares: [0.66, 0.26, 0.08] },
  standard: { label: "분별 중간 가정", shares: [0.71, 0.26, 0.03] },
  good: { label: "분별 선별 양호 가정", shares: [0.80, 0.18, 0.02] },
};

// Benchmark is the 04 apartment IFC under the phase-2 finish takeoff.
const REFERENCE_FINISH_RATIO = 57.21156 / 7968.550875802546;

export function concreteGradeLink(q, p) {
  if (!q.finishTakeoff) return { status: "no-takeoff" };
  if (!(q.t.concrete > 0)) return { status: "no-concrete" };
  if (Object.values(q.finishTakeoff).some(item => item.unverified)) return { status: "missing-finish" };
  const removed = selective => {
    const split = finishSeparations(q, q.t, p, selective);
    const routes = finishMaterialRoutes(q, q.t, selective, split);
    return Object.values(routes).reduce((total, route) => total + route.separate + route.preRemovalMixed, 0);
  };
  const extraTons = Math.max(0, removed(true) - removed(false));
  const ratio = extraTons / q.t.concrete;
  return { status: "linked", extraTons, ratio, factor: Math.min(1, ratio / REFERENCE_FINISH_RATIO) };
}

export function concreteGrades(p, selective, concreteCase = DEFAULT_CONCRETE_CASE, q) {
  const baseline = CONCRETE_CASES.same.shares;
  const link = selective && concreteCase === "linked" && q ? concreteGradeLink(q, p) : null;
  const shares = link
    ? baseline.map((share, i) => share + (CONCRETE_CASES.good.shares[i] - share) * (link.factor ?? 0))
    : (selective ? CONCRETE_CASES[concreteCase]?.shares ?? baseline : baseline);
  return [
    { name: "순수 폐콘크리트", share: shares[0], fee: p.fee_pure_concrete },
    { name: "건설폐재류 (가연물 제거)", share: shares[1], fee: p.fee_concrete },
    { name: "건설폐재류 (가연물 5% 이하)", share: shares[2], fee: p.fee_mixed_mineral },
  ];
}

export function steelDismantling(q) {
  const active = q.steelWork || q.structure === "steel";
  const complete = q.cutCommon != null || (q.cutCrush != null && q.cutSel != null);
  return {
    excluded: Boolean(active && !complete),
    crush: active && complete ? q.cutCrush ?? q.cutCommon : 0,
    selective: active && complete ? q.cutSel ?? q.cutCommon : 0,
  };
}

export function selectiveEquipmentHoursPerDay(p) {
  return p.selective_equipment_hours_per_day ?? 0;
}

function scheduledEquipmentSegments(q, p, mode, input) {
  const segments = crushSegments(q, p, mode);
  if (equipmentMode(q) === "mixed" || input.excavatorHours == null) return segments;
  const estimatedDays = segments.reduce((sum, segment) => sum + segment.days, 0);
  const actualDays = input.excavatorHours / p.hours_per_day;
  return segments.map((segment, index) => ({ ...segment,
    days: estimatedDays > 0 ? actualDays * segment.days / estimatedDays : index === 0 ? actualDays : 0 }));
}

export function costScenario(q, p, mode) {
  const sel = mode === "selective";
  // IFC 모델에는 철근이 없으므로 콘크리트 부피에서 추정하고, 그만큼 폐콘크리트 톤수에서 뺀다
  const { t, rebar } = streamTons(q, p);
  const metal = t.metal;
  const rows = [];
  const add = (group, item, qty, unit, price, sign = 1) => {
    const amount = sign * qty * price;
    rows.push({ group, item, qty, unit, price, amount });
    return amount;
  };

  const extra = sel ? selExtra(q, p) : null;
  const issues = [];
  const unpricedDisposal = q.panelWeightMissing ? [{ item: "폐샌드위치패널 중량 미확인", tons: null }] : [];
  if (q.panelWeightMissing) issues.push("폐샌드위치패널이 감지되었습니다. 별도 처리비에 반영할 중량을 입력하세요.");
  if (q.structure === "other") issues.push("기타·복합 구조에 RC 공기와 장비식을 적용한 비교값입니다.");
  // 1. 인건비 — 공종별 일수 × 작업조 × 노임 (두 안 공통). 일수는 schedule()의 공기 규칙을 쓴다.
  const sched = schedule(q, p, mode), days = sched.total, crew = crews(q, p);
  const workInput = q.workSchedule?.[mode] ?? {};
  const cut = concreteCut(q, mode);
  const crushShare = remainingCrushShare(q, mode);
  const baseSegments = scheduledEquipmentSegments(q, p, mode, workInput);
  const baseExcavatorHours = baseSegments.reduce((sum, segment) => sum + segment.days * p.hours_per_day, 0);
  const estimateExcavator = workInput.equipmentQuote == null && workInput.excavatorHours == null && equipmentMode(q) !== "mixed";
  const avoidedHoursApplied = cut.ready && estimateExcavator ? Math.min(cut.avoidedHours ?? 0, baseExcavatorHours) : 0;
  const segments = avoidedHoursApplied > 0 ? baseSegments.map(segment => ({
    ...segment, days: segment.days * (1 - avoidedHoursApplied / baseExcavatorHours),
  })) : baseSegments;
  const excavatorHours = baseExcavatorHours - avoidedHoursApplied;
  const noOrdinaryCrushing = crushShare === 0 || (avoidedHoursApplied > 0 && excavatorHours === 0);
  const equipmentCrewDays = noOrdinaryCrushing ? 0 : q.equipmentCrewPeriod === "all" ? Math.max(0, days - sched.cutting)
    : segments.reduce((sum, segment) => sum + segment.days, 0) / crew.excavators;
  if (cut.ready && cut.avoidedHours > avoidedHoursApplied) {
    issues.push(estimateExcavator ? "압쇄 굴착기 차감 시간을 해당 공법의 가동시간 이내로 적용했습니다."
      : "공법별 기본 장비 견적 또는 직접 입력한 굴착기 가동시간을 적용했습니다. 절단에 따른 굴착기 시간 차감은 기본 장비 산정에만 적용합니다.");
  }
  if (sched.assumedPhasesExceedTotal.length) {
    issues.push(`입력한 전체 공기를 넘는 추정 공종 일수를 확인하세요 (${sched.assumedPhasesExceedTotal.join(", ")}).`);
  }
  let labor = add("인건비", "상시 작업유도·감시", crew.standing * days, "인·일", p.wage_laborer)
    + add("인건비", "가설 설치 비계공", crew.setup * sched.setup, "인·일", p.wage_scaffold ?? p.wage_carpenter)
    + add("인건비", "내부 철거 인부", crew.interior * sched.interior, "인·일", p.wage_laborer)
    + add("인건비", "굴착기 연동 살수·신호", crew.structure * equipmentCrewDays, "인·일", p.wage_laborer)
    + add("인건비", "마무리 인부", crew.finish * sched.finish, "인·일", p.wage_laborer);
  if (extra) {
    for (const r of extra.rows) labor += add("인건비", r.item, r.qty, "인·일", r.wage === "carpenter" ? p.wage_carpenter : p.wage_laborer);
    issues.push(...extra.issues);
  }

  let equipment = 0;
  if (workInput.equipmentQuote != null) {
    equipment += add("장비비", "구조체 기본 장비 패키지 (굴착기·크레인 견적)", 1, "식", workInput.equipmentQuote);
  } else {
    for (const segment of segments) {
      equipment += add("장비비", segment.label, segment.days * p.hours_per_day, "h", segment.price ?? p.excavator_per_h);
    }
  }
  if (workInput.equipmentQuote == null && equipmentMode(q) === "mounted") {
    // 크레인은 소형 장비를 올리고 내리는 탑재 구간에만 쓴다. 지상 장비 구간까지 세지 않는다.
    // 구조체 공기 중 탑재 구간이 차지하는 비율만큼 (구간 일수 비율)
    const segmentDays = baseSegments.reduce((sum, segment) => sum + segment.days, 0);
    const mountedShare = segmentDays > 0 ? (baseSegments.find((segment) => segment.key === "mounted")?.days ?? 0) / segmentDays : 1;
    const craneDays = q.craneDays == null ? sched.crushing * mountedShare : q.craneDays * crushShare;
    equipment += add("장비비", "이동식 크레인 (장비 탑재·양중)", craneDays, "일", p.crane_per_day);
    if (q.craneDays == null) issues.push(`크레인 사용 일수가 없어 탑재 구간 공정 ${craneDays.toFixed(1)}일을 적용했습니다.`);
  }

  if (sel && q.selectiveEquipmentQuote != null) {
    equipment += add("장비비", "분별 선철거·선별 추가 장비 (견적)", 1, "식", q.selectiveEquipmentQuote);
  } else if (sel) {
    const hours = q.selectiveEquipmentHours ?? sched.selective * selectiveEquipmentHoursPerDay(p);
    if (hours > 0) {
      const basis = q.selectiveEquipmentHours == null ? "추정" : "가동시간 입력";
      equipment += add("장비비", `분별 선철거·선별 소형 장비 (${basis})`, hours, "h", p.selective_equipment_per_h ?? 0);
    }
  }
  if (cut.active && cut.ready) {
    if (cut.area != null) {
      if (cut.cutCost != null) {
        const label = cut.costBasis === "reference" ? "콘크리트 특수절단 직접비 (공개 참고단가)"
          : cut.liftingIncluded ? "콘크리트 특수절단·인양 직접비 (견적)" : "콘크리트 특수절단 직접비 (견적)";
        equipment += add("장비비", label, 1, "식", cut.cutCost);
      }
      if (cut.liftingCost != null) equipment += add("장비비", "콘크리트 절단 부재 별도 인양비", 1, "식", cut.liftingCost);
    } else if (!cut.quoteMissing) {
      equipment += add("장비비", "콘크리트 절단·인양 도급비 (장비·인력 포함)", 1, "식", cut.cost);
    }
  }
  if (workInput.extraWorksCost != null) {
    equipment += add("장비비", "범위별 별도 공종 (인력·장비 포함 견적)", 1, "식", workInput.extraWorksCost);
  }

  if (q.steelWork || q.structure === "steel") {
    const steel = steelDismantling(q);
    if (!steel.excluded) equipment += add("장비비", "철골 절단·인양 도급비 (인력 포함)", 1, "식", sel ? steel.selective : steel.crush);
  }
  const rates = separation(p);
  const split = Object.fromEntries(Object.entries(rates).map(([key, rate]) => [key, sel ? t[key] * rate : 0]));
  split.board = t.board * (sel ? (q.boardSel ?? (p.rec_sel_board ?? 0) * 100) : (q.boardCrush ?? 0)) / 100;
  split.tile = t.tile * ((sel ? q.tileSel : q.tileCrush) ?? 0) / 100;
  const pvcFrame = q.pvcFrameTons ?? 0;
  const alFrame = q.alFrameTons ?? 0;
  const windowGlass = q.windowMode ? q.windowGlassTons ?? 0 : 0;
  if (q.windowMode) split.glass = sel ? Math.max(0, t.glass - windowGlass) * rates.glass : 0;
  const alRecovered = q.windowMode ? alFrame : alFrame * ((sel ? q.alSel : q.alCrush) ?? 0) / 100;
  const pvcRecovered = pvcFrame * pvcFrameRecovery(q, sel);
  split.resin = (sel ? Math.max(0, t.resin - pvcFrame) * rates.resin : 0) + pvcRecovered;
  if (q.finishTakeoff) Object.assign(split, finishSeparations(q, t, p, sel));
  const finishRoutes = finishMaterialRoutes(q, t, sel, split);
  const mix = mixedWaste({
    ...t, glass: t.glass - windowGlass,
    board: t.board - (finishRoutes?.board.concreteCarryover ?? 0),
    tile: t.tile - (finishRoutes?.tile.concreteCarryover ?? 0),
  }, split, p, q);
  const specified = t.concrete * (sel ? q.cleanSel ?? 0 : q.cleanCrush ?? 0) / 100;
  const quoted = q.cleanPrice == null ? 0 : specified;
  if (specified && !quoted) issues.push("콘크리트 별도 반입 견적이 없어 공법별 성상 비율을 적용했습니다.");
  let disposal = add("처리비", "혼합건설폐기물", mix.tons, "t", mix.fee);
  const finishCarryover = (finishRoutes?.board.concreteCarryover ?? 0) + (finishRoutes?.tile.concreteCarryover ?? 0);
  if (finishCarryover) disposal += add("처리비", "폐콘크리트 동반 반입 · 마감재", finishCarryover, "t", p.fee_concrete);
  if (windowGlass) disposal += add("처리비", "혼합 반출 창호 유리", windowGlass, "t", p.fee_mixed_unverified);
  for (const grade of concreteGrades(p, sel, q.concreteCase, q)) {
    disposal += add("처리비", grade.name, (t.concrete - quoted) * grade.share, "t", grade.fee);
  }
  if (t.masonry > 0) disposal += add("처리비", "폐벽돌·조적 (건설폐재류)", t.masonry, "t", p.fee_concrete);
  if (quoted) disposal += add("처리비","별도 반입 콘크리트 (현장 견적)",quoted,"t",q.cleanPrice);
  if (t.panel > 0) {
    if (p.fee_panel >= 0) disposal += add("처리비", STREAM_LABEL.panel, t.panel, "t", p.fee_panel);
    else unpricedDisposal.push({ item: STREAM_LABEL.panel, tons: t.panel });
  }
  if (mix.needsQuote) issues.push("혼합잔재에 프로젝트 기본 처리단가를 적용했습니다.");

  const nf = sel ? p.rec_nonferrous_sel : p.rec_nonferrous_crush;
  const copperRate = (sel ? p.rec_copper_sel : p.rec_copper_crush) ?? nf;
  const services = serviceSalvage(q, p);
  const pipe = services?.copperPipe;
  const cable = services?.cable;
  const soldPipe = pipe?.methods[mode];
  const soldCable = cable?.methods[mode];
  const copperSold = q.fixedComparison ? services ? (soldPipe.soldKg ?? 0) / 1000 : q.copperPipeSold ?? 0 : t.copper * copperRate;
  const quantityBasis = { ifc: "IFC 설치량·회수율 적용", input: "현장 설치량·회수율 적용", area: "연면적 추정" };
  const scrapRecovery = sel ? p.rec_scrap_sel : p.rec_scrap_crush;
  const structuralSteel = Math.min(Math.max(0, metal - rebar), q.structuralSteelTons ?? 0);
  const commonRecovery = p.rec_structural_steel ?? p.rec_scrap_sel;
  const sold = { metal: (metal - structuralSteel) * scrapRecovery + structuralSteel * commonRecovery, copper: copperSold, aluminum: Math.max(0, t.aluminum - alFrame) * nf + alRecovered };
  let revenue = -add("매각수익", "고철", sold.metal, "t", p.price_scrap, -1)
    - (q.fixedComparison
      ? add("매각수익", soldPipe && !soldPipe.confirmed ? `동관 (${quantityBasis[pipe.source]})` : "확인된 동관", sold.copper * 1000, "kg", p.price_copper_pipe, -1)
      : add("매각수익", "구리", sold.copper, "t", p.price_copper, -1))
    - add("매각수익", "알루미늄", sold.aluminum - alRecovered, "t", p.price_aluminum, -1);
  if (alRecovered) revenue -= add("매각수익", "알루미늄 창틀", alRecovered * 1000, "kg", q.alPrice ?? p.price_aluminum / 1000, -1);
  if (pvcRecovered) {
    if (q.pvcPrice > 0) revenue -= add("매각수익", "PVC 창틀", pvcRecovered * 1000, "kg", q.pvcPrice, -1);
    else disposal += add("처리비", q.pvcPrice === 0 ? "PVC 창틀 무상 인수" : "PVC 창틀 처리", pvcRecovered * 1000, "kg", -q.pvcPrice);
  }
  let estimatedPipeSold = 0;
  const cableResidue = (soldCable?.residueKg ?? 0) / 1000;
  if (services) {
    for (const [kind, label] of serviceItems) {
      if (services[kind].methods[mode].overInstalled) issues.push(`${label} 계근 매각량이 입력한 설치량을 초과합니다. 두 값의 범위를 확인하세요.`);
    }
    revenue -= add("매각수익", soldCable.confirmed ? "별도 계근 폐전선" : `피복 폐전선 (${quantityBasis[cable.source]})`,
      soldCable.soldKg ?? 0, "kg", cable.price, -1);
    disposal += add("처리비", "혼합 반출 · 미회수 피복 폐전선", cableResidue, "t", p.fee_mixed_unverified);
  } else {
    const cableSold = q[sel ? "cableSel" : "cableCrush"] ?? q.cableCommon ?? 0;
    const office = officeSalvage(q, p);
    const cablePrice = q.cablePrice ?? (q.fixedComparison || office ? p.price_waste_cable * 1000 : undefined);
    estimatedPipeSold = office?.estimatePipe ? office.pipeKg * office.pipeRate : 0;
    const estimateCable = sel ? office?.estimateCableSelective : office?.estimateCableCrush;
    const estimatedCableSold = estimateCable ? office.cableKg * (sel ? office.cableSelectiveRate : office.cableCrushRate) : 0;
    revenue -= add("매각수익", office?.pipeInstalled ? "동관 (현장 설치량 추정)" : "동관 (사무소 추정)", estimatedPipeSold, "kg", p.price_copper_pipe, -1);
    if (estimateCable) revenue -= add("매각수익", office.cableInstalled ? "피복 전선 (현장 설치량 추정)" : "피복 전선 (사무소 추정)", estimatedCableSold, "kg", cablePrice / 1000, -1);
    if (cableSold && cablePrice == null) issues.push("별도 계근 폐전선 인수 견적이 없어 수익에서 제외했습니다.");
    if (cablePrice != null) revenue -= add("매각수익", "별도 계근 폐전선", cableSold, "t", cablePrice, -1);
  }
  const embeddedRebar = rebar * (1 - scrapRecovery);
  if (embeddedRebar > 0) disposal += add("처리비", "폐콘크리트 동반 반입 · 미회수 철근", embeddedRebar, "t", p.fee_concrete);
  const unsoldSteel = Math.max(0, metal - rebar - structuralSteel) * (1 - scrapRecovery) + structuralSteel * (1 - commonRecovery);
  const unsoldAl = Math.max(0, t.aluminum - sold.aluminum);
  const unsoldCopper = q.fixedComparison && pipe?.treatmentKg != null
    ? Math.max(0, t.copper - pipe.model.kg / 1000) + soldPipe.residueKg / 1000
    : Math.max(0, t.copper - sold.copper - estimatedPipeSold / 1000);
  const unsoldMetal = unsoldSteel + unsoldCopper + unsoldAl;
  if (unsoldMetal > 0) {
    const metalFee = q.fixedComparison ? p.fee_mixed_unverified : q.metalFee ?? p.fee_unsold_metal;
    if (metalFee >= 0) disposal += add("처리비", q.fixedComparison ? "혼합 반출 미회수 기타 금속" : "미매각 금속", unsoldMetal, "t", metalFee);
    else {
      const components = [
        ["별도 철강재", unsoldSteel],
        ["구리", unsoldCopper],
        ["알루미늄", unsoldAl]
      ].filter(([, weight]) => weight > 0);
      unpricedDisposal.push({ item: "미매각 금속", tons: unsoldMetal, components });
    }
  }

  for (const [key, net] of [["wood", p.net_wood], ["resin", p.net_resin]]) {
    const weight = key === "resin" ? split.resin - pvcRecovered : split[key];
    if (net >= 0) revenue -= add("매각수익", STREAM_LABEL[key], weight, "t", net, -1);
    else disposal += add("처리비", `분리 ${STREAM_LABEL[key]}`, weight, "t", -net);
  }
  for (const [key, quote] of [["glass", p.fee_glass_separate], ["board", q.boardFee ?? p.fee_board_separate], ["tile", q.tileFee ?? -1]]) {
    const weight = split[key];
    if (!(weight > 0)) continue;
    if (quote >= 0) disposal += add("처리비", `분리 ${STREAM_LABEL[key]}`, weight, "t", quote);
    else unpricedDisposal.push({ item: `분리 ${STREAM_LABEL[key]}`, tons: weight });
  }

  const transportQuote = sel ? q.transportSel : q.transportCrush;
  const transport = q.transportCrush == null || q.transportSel == null ? 0 : add("운반비", "현장 수집·운반", 1, "식", transportQuote);

  // 5. 간접비
  const indirect = add("간접비", "현장 간접비", days, "일", p.indirect_per_day);

  const daysApplied = workInput.structureDays == null && workInput.totalDays == null ? sched.cutting : 0;
  return { mode, labor, equipment, disposal, transport, transportQuote, revenue, indirect, days, unpricedDisposal, equipmentCrewDays, excavatorHours, schedule: sched, cut: { ...cut, avoidedHoursApplied, daysApplied }, crews: crew, mixed: mix, finishRoutes, split, sold, embeddedRebar, concreteIntake: t.concrete + embeddedRebar + finishCarryover, unsoldMetal, services, cableResidue, issues, total: labor + equipment + disposal + transport + indirect - revenue, rows: rows.filter((r) => r.qty > 0) };
}

function finishSeparations(q, t, p, selective) {
  const boardRate = selective ? q.boardSel ?? (p.rec_sel_board ?? 0) * 100 : q.boardCrush ?? 0;
  const tileRate = (selective ? q.tileSel : q.tileCrush) ?? 0;
  const fraction = rate => Math.max(0, Math.min(1, rate / 100));
  return {
    board: (q.boardFee ?? p.fee_board_separate) >= 0 ? t.board * fraction(boardRate) : 0,
    tile: (q.tileFee ?? -1) >= 0 ? t.tile * fraction(tileRate) : 0,
  };
}

// Unknown pre-removal residue is priced as mixed until concrete co-loading is confirmed.
export function finishMaterialRoutes(q, t, selective, separated) {
  if (!q.finishTakeoff) return null;
  const mixRate = q.finishDemolitionMixedShare ?? 1;
  const routes = {};
  for (const key of ["board", "tile"]) {
    const total = t[key];
    const separate = separated[key];
    const removed = Math.max(separate, total * (selective ? 1 : q.finishBaseline[key]));
    const remaining = Math.max(0, total - removed);
    const demolitionMixed = remaining * mixRate;
    routes[key] = {
      total, separate, preRemovalMixed: removed - separate,
      demolitionMixed, concreteCarryover: remaining - demolitionMixed,
    };
  }
  return routes;
}

// 두 공법의 잔재에 같은 판정 규칙을 적용한다. 혼합·기타의 미확인 성상은 견적 대상으로 둔다.
export function mixedWaste(t, split, p, q = {}) {
  const wood = t.wood - split.wood, resin = t.resin - split.resin;
  const glass = t.glass - split.glass, tile = (t.tile ?? 0) - (split.tile ?? 0), board = t.board - split.board;
  const mineral = t.mixed * (q.mixedMineral ?? 0);
  const otherCombustible = t.mixed * (q.mixedCombustible ?? 0);
  const unknown = Math.max(0, t.mixed - mineral - otherCombustible);
  const combustible = wood + resin + otherCombustible;
  const tons = t.mixed + glass + tile + board + wood + resin;
  const share = tons > 0 ? combustible / tons : 0;
  const composition = [["mineral", mineral], ["glass", glass + tile], ["board", board]].sort((a, b) => b[1] - a[1]);
  const [main, mainTons] = composition[0];
  const unclassified = unknown > 1e-9 || mainTons === 0 || Math.abs(composition[1][1] - mainTons) < 1e-9;
  const over = share > p.mixed_combustible_limit + 1e-12;
  if (!tons) return { tons, share, main: "none", fee: 0, rule: "잔재 없음" };
  if (over || unclassified) {
    const quote = p.fee_mixed_quote;
    const rule = over ? "가연물 한도 초과" : "주성상 확인 필요";
    return { tons, share, main: unclassified ? "unknown" : main, unknown, fee: quote >= 0 ? quote : p.fee_mixed_unverified, rule, needsQuote: !(quote >= 0) };
  }
  const fees = {
    mineral: combustible > 0 ? [p.fee_mixed_mineral, "건설폐재류+가연물"] : [p.fee_concrete, "건설폐재류"],
    glass: [p.fee_mixed_inert, "불연성 중심 혼합잔재"],
    board: [p.fee_board_mixed, "보드·판넬 중심 혼합잔재"],
  };
  const [fee, rule] = fees[main];
  return { tons, share, main, unknown, fee, rule };
}

// 일반해체 내부 철거 공수 중 분별 작업과 겹치는 부분 (인·일) = 내부 철거 작업조 × 면적 비례 일수.
// 공정표의 최소 일수(sched_interior_min)는 작은 건물에도 하루를 잡는 일정 하한이지 실제 철거 작업량이 아니므로 빼지 않는다.
// (최소 1일치를 빼면 64㎡ 건물에서 6인·일이 빠져 분별 추가 공수가 항상 0이 된다.)
export function generalInteriorPd(q, p) {
  return p.crew_interior * p.sched_interior_per_1000m2 * q.area_m2 / 1000;
}

export const PRESS_FINISH_BASELINE = { board: 0.6, tile: 1 };

function boardTilePd(q, p, shares = { board: 1, tile: 1 }) {
  return shares.board * (q.finishAreas?.board ?? q.area_m2 * p.int_board_ratio) / p.int_board_m2_per_day
    + shares.tile * (q.finishAreas?.tile ?? q.area_m2 * p.int_tile_ratio) / p.int_tile_m2_per_day;
}

function sharedFinishPd(q, p) {
  if (q.finishBaseline) return boardTilePd(q, p, q.finishBaseline);
  return boardTilePd(q, p) * (q.sharedFinish ?? 0) / 100;
}

function windowPd(q, p) {
  const areas = q.finishAreas ?? {};
  const knownArea = (areas.pvc ?? 0) + (areas.aluminum ?? 0);
  const totalArea = q.windowArea ?? ((areas.pvc != null || areas.aluminum != null) ? knownArea : q.area_m2 * p.window_ratio);
  const framePd = (areas.pvc ?? 0) * p.window_pvc_pd_per_m2 + (areas.aluminum ?? 0) * p.window_al_pd_per_m2
    + Math.max(0, totalArea - knownArea) * p.window_frame_pd_per_m2;
  const glassPd = q.windowMode ? totalArea * (q.glassPdPerM2 ?? p.window_frame_pd_per_m2) : 0;
  return framePd + glassPd;
}

function commonFinishPd(q, p) {
  const windowWork = q.windowMode === "both" ? windowPd(q, p) : 0;
  return Math.max(sharedFinishPd(q, p) + windowWork, q.generalFinishPd ?? generalInteriorPd(q, p));
}

export function selExtra(q, p) {
  const A = q.area_m2;
  if (q.labor !== "quantity") {
    const baseCarpenter = A * p.sel_extra_carpenter;
    const baseLaborer = A * p.sel_extra_laborer;
    const total = baseCarpenter + baseLaborer;
    const commonWindow = q.windowMode === "both" ? Math.min(total, windowPd(q, p)) : 0;
    const remaining = total > 0 ? (total - commonWindow) / total : 0;
    const rows = [
      { item: "분별 추가 목공", qty: baseCarpenter * remaining, wage: "carpenter" },
      { item: "분별 추가 보통인부", qty: baseLaborer * remaining, wage: "laborer" },
    ];
    return { method: "paper", commonWindow, rows, persons: rows[0].qty + rows[1].qty,
      issues: ["표 3·4 차이 품의 현장 적용 및 천장 모르타르·바닥 타일 기재 의도는 확인이 필요합니다."] };
  }

  const areas = q.finishAreas ?? {};
  const hasFrameAreas = areas.pvc != null || areas.aluminum != null;
  const gross = boardTilePd(q, p) + windowPd(q, p);
  // 자재별 공수는 보드·타일·창틀을 "떼어 내는 총공수"다. 일반해체(두 안 공통)의 내부 철거 인부도 같은 범위를
  // 철거하므로, 그대로 더하면 분별안에서 같은 작업을 두 번 센다. 입력값이 없으면 두 안에 이미 들어간
  // 내부 철거 공수를 같은 범위의 일반해체 공수로 보고 뺀다 (0을 입력하면 차감하지 않는다).
  const interiorPd = generalInteriorPd(q, p);
  const baseline = commonFinishPd(q, p);
  const persons = Math.max(0, gross - baseline);
  const issues = [];
  // 창틀은 PVC·알루미늄 중 하나라도 확인되면 나머지를 0으로 보므로 추정이 아니다
  const estimated = [areas.board == null && "보드", areas.tile == null && "타일", !hasFrameAreas && "창틀"].filter(Boolean);
  if (estimated.length) issues.push(`${estimated.join("·")} 면적을 연면적 비율로 추정했습니다.`);
  if (q.generalFinishPd == null && !q.finishBaseline) issues.push(`같은 범위의 일반해체 공수가 없어 두 안 공통 내부 철거 공수 중 면적 비례분 ${interiorPd.toFixed(1)}인·일을 잠정 차감했습니다. 일반해체에서 보드·타일·창틀을 철거하지 않으면 0을 입력하세요.`);
  if (baseline > gross) issues.push("적용한 일반해체 공수가 분별 총공수보다 커서 추가 공수를 0으로 계산했습니다.");
  const carpenter = persons * (q.carpenterShare ?? 0) / 100;
  if (q.carpenterShare == null) issues.push("프로젝트 기본값인 보통인부 100%를 적용했습니다.");
  return { method: "quantity", interiorPd, rows: [
    { item: "분별 추가: 내장재·창틀 보통인부", qty: persons-carpenter, wage: "laborer" },
    { item: "분별 추가: 내장재·창틀 목공", qty: carpenter, wage: "carpenter" }],
    gross, baseline, persons, issues };
}

// 공기(작업일). 압쇄안은 해체계획서 4건의 예정공정표에서 뽑은 규칙:
//   가설 + 내부 철거 + 구조체 해체 + 마무리 (폐기물 반출은 구조체 해체와 겹쳐서 공기를 늘리지 않는다)
// 분별안은 계획서 자료가 없어서, 압쇄안 공기에 "분별로 늘어나는 인원 ÷ 작업조"를 더한다.
function modeledSchedule(q, p, mode) {
  const k = q.area_m2 / 1000;
  const floors = (q.scope === "below" ? q.basementFloors : q.floors) || 1;
  const setup = p.sched_setup_base + p.sched_setup_per_1000m2 * k;
  const commonPd = q.labor === "quantity"
    ? (q.windowMode ? commonFinishPd(q, p) : sharedFinishPd(q, p))
    : q.windowMode === "both" ? Math.max(generalInteriorPd(q, p), windowPd(q, p)) : 0;
  const interior = Math.max(p.sched_interior_min, p.sched_interior_per_1000m2 * k, commonPd / Math.max(1, p.crew_interior));
  const m2PerDay = p.sched_struct_m2_per_day;
  const parallel = excavators(q, p) > 1 ? (q.parallelGain ?? 0) : 0;
  const capacity = 1 + (excavators(q, p) - 1) * parallel;
  const cut = concreteCut(q, mode);
  const crushShare = remainingCrushShare(q, mode);
  const cutting = cut.ready ? cut.days : 0;
  const areaDays = (p.sched_struct_base + p.sched_struct_per_floor * floors + q.area_m2 / (m2PerDay * capacity)) * crushShare;
  const volumeDays = crushSegments(q, p, mode).reduce((sum, segment) => sum + segment.days, 0) / capacity;
  const crushing = equipmentMode(q) === "mixed"
    ? (q.smallHours + q.largeHours - (q.concurrentHours ?? 0)) * crushShare / p.hours_per_day
    : Math.max(volumeDays, areaDays * (q.structureFactor ?? 1));
  const structure = crushing + cutting;
  const finish = p.sched_finish_base + p.sched_finish_per_1000m2 * k;
  const selective = mode === "selective" ? selExtra(q, p).persons / p.crew_size : 0;
  const extension = selective * (1 - (q.overlap ?? 0));
  return { setup, interior, structure, crushing, cutting, areaDays, volumeDays, finish, selective, extension, total: setup + interior + structure + finish + extension };
}

const schedulePhases = { setup: "가설", interior: "내부 철거", structure: "구조체", finish: "마무리" };
const scheduleInputLabels = {
  totalDays: "전체 작업일", setupDays: "가설 작업일", interiorDays: "내부 철거 작업일",
  structureDays: "구조체 작업일", finishDays: "마무리 작업일", excavatorHours: "굴착기 총 가동시간",
  equipmentQuote: "구조체 기본 장비 견적", extraWorksCost: "범위별 별도 공종 견적",
};

export function workScheduleIssues(q) {
  const issues = [];
  for (const [mode, label] of [["crush", "압쇄"], ["selective", "분별"]]) {
    const input = q.workSchedule?.[mode];
    if (!input) continue;
    for (const [key, name] of Object.entries(scheduleInputLabels)) {
      if (input[key] != null && (!Number.isFinite(input[key]) || input[key] < 0 || (key === "totalDays" && input[key] === 0))) {
        issues.push(`${label} ${name} 값을 확인하세요.`);
      }
    }
    if (input.structureDays != null && (input.structureDays < concreteCut(q, mode).days || (input.structureDays === 0 && (crushVolume(q) > 0 || q.steelWork)))) {
      issues.push(`${label} 구조체 작업일에 범위 내 구조체 해체와 절단·인양 작업일을 포함하세요.`);
    }
    if (input.totalDays != null) {
      for (const [phase, name] of Object.entries(schedulePhases)) {
        if (input[phase + "Days"] > input.totalDays) issues.push(`${label} ${name} 작업일이 전체 작업일을 초과합니다.`);
      }
      if (concreteCut(q, mode).days > input.totalDays) issues.push(`${label} 절단·인양 작업일이 전체 작업일을 초과합니다.`);
    }
  }
  return issues;
}

export function schedule(q, p, mode) {
  const modeled = modeledSchedule(q, p, mode);
  const input = q.workSchedule?.[mode] ?? {};
  const reference = mode === "selective" ? q.workSchedule?.crush ?? {} : {};
  const before = reference.structureDays != null ? modeledSchedule(q, p, "crush") : null;
  const result = { ...modeled, sources: {}, modelTotal: modeled.total };
  for (const phase of Object.keys(schedulePhases)) {
    const entered = input[phase + "Days"], base = reference[phase + "Days"];
    const adjustment = phase === "structure" && before ? modeled.structure - before.structure : 0;
    result[phase] = entered ?? (base == null ? modeled[phase] : Math.max(phase === "structure" ? modeled.cutting : 0, base + adjustment));
    result.sources[phase] = entered != null ? "input" : base != null ? "crush-reference" : "estimate";
  }
  result.crushing = Math.max(0, result.structure - result.cutting);
  result.phaseDays = result.setup + result.interior + result.structure + result.finish + result.extension;
  if (input.totalDays != null) {
    result.total = input.totalDays;
    result.sources.total = "input";
  } else if (reference.totalDays != null) {
    const crush = schedule(q, p, "crush");
    result.total = Math.max(result.setup, result.interior, result.structure, result.finish, result.extension,
      reference.totalDays + result.phaseDays - crush.phaseDays);
    result.sources.total = "crush-reference";
  } else {
    result.total = result.phaseDays;
    result.sources.total = "estimate";
  }
  result.phaseDifference = result.phaseDays - result.total;
  result.assumedPhasesExceedTotal = Object.entries(schedulePhases)
    .filter(([phase]) => result.sources[phase] !== "input" && result[phase] > result.total)
    .map(([, label]) => label);
  return result;
}

// 굴착기 대수: 대지가 넉넉할 때만 큰 건물에 장비를 더 넣는다 (계획서: 965㎡ 1대, 4,515㎡ 학교 2대).
// 보통·협소·진입 제한 대지는 1대 (민서, 11/14 회의록)
export const excavators = (q, p) => equipmentMode(q) === "mixed" ? 2 : (q.site === "wide" && !smallSite(q) ? Math.max(1, Math.ceil(q.area_m2 / p.area_per_excavator)) : 1);

// 공종별 하루 작업조 인원. 살수공과 구조체 보조 인부는 굴착기 대수에 비례한다.
export function crews(q, p) {
  const n = excavators(q, p);
  return { excavators: n, standing: p.crew_standing, setup: q.scaffold === false ? 0 : p.crew_setup, interior: p.crew_interior, structure: p.crew_per_excavator * n, finish: p.crew_finish };
}

// 보드·타일 철거 공수의 비용과 효과가 짝이 맞는지 확인한다. 기본값에서는 떼어 낸 보드·타일을 따로 처리하지 않고
// (분리율 0, 별도 견적 없음) 콘크리트 성상 배분도 두 공법 동일이라, 철거 비용만 들어가고 효과는 0으로 잡힌다.
// 반환: 그 비용(인건비 + 늘어난 공기의 간접비·상시 인원)과, 같은 금액을 콘크리트 성상 개선으로 상쇄하려면
// 건설폐재류에서 순수 폐콘크리트로 옮겨야 하는 비율(%p). 해당 없으면 null.
export function unbenefitedFinishLabor(q, p) {
  if (q.labor !== "quantity") return null;
  const boardSeparated = (q.boardSel ?? (p.rec_sel_board ?? 0) * 100) > (q.boardCrush ?? 0) && q.t?.board > 0 && (q.boardFee ?? p.fee_board_separate) >= 0;
  const tileSeparated = (q.tileSel ?? 0) > (q.tileCrush ?? 0) && q.t?.tile > 0 && q.tileFee >= 0;
  const concreteBenefit = (q.concreteCase === "linked"
    ? concreteGradeLink(q, p).factor > 0
    : (q.concreteCase ?? DEFAULT_CONCRETE_CASE) !== "same") || (q.cleanSel ?? 0) > 0 && q.cleanPrice != null;
  if (boardSeparated || tileSeparated || concreteBenefit) return null;
  const without = { ...q, finishAreas: { ...q.finishAreas, board: 0, tile: 0 } };
  const cost = compare(q, p).delta - compare(without, p).delta;
  if (!(cost > 1)) return null;
  const concrete = streamTons(q, p).t.concrete, saving = p.fee_concrete - p.fee_pure_concrete;
  const sharePoints = concrete > 0 && saving > 0 ? (cost / (concrete * saving)) * 100 : null;
  return { cost, sharePoints };
}

export function compare(q, p) {
  const crush = costScenario(q, p, "crush"), selective = costScenario(q, p, "selective");
  const unpricedCuts = [crush, selective].filter(result => result.cut.quoteMissing).map(result => result.mode);
  const unscheduledCuts = [crush, selective].filter(result => result.cut.daysMissing).map(result => result.mode);
  const partialTransport = (crush.transportQuote == null) !== (selective.transportQuote == null);
  const hasUnpricedDisposal = crush.unpricedDisposal.length > 0 || selective.unpricedDisposal.length > 0;
  const a = crush.schedule, b = selective.schedule;
  const deltaDays = a.sources.total === "estimate" && b.sources.total === "estimate"
    ? b.extension + (b.structure - a.structure) + (b.setup - a.setup) + (b.interior - a.interior) + (b.finish - a.finish)
    : selective.days - crush.days;
  return { crush, selective, partialTransport, hasUnpricedDisposal, unpricedCuts, unscheduledCuts, delta: selective.total - crush.total, deltaDays };
}

// 면적 × 표준품셈 원단위로 물량을 추정 (IFC가 없을 때, 또는 모델 검산용)
export function quantitiesFromArea(area_m2, usage, rates) {
  const u = rates.wasteUnits[usage];
  const t = Object.fromEntries(STREAMS.map((k) => [k, (u[k] || 0) * area_m2]));
  return { area_m2, floors: 1, concrete_m3: t.concrete / rates.density.concrete, rebarFromConcrete: false, t, basis: "원단위" };
}

// 논문(박지선 외 2023) 계산을 그대로 따라 한다. 단위: 천원. 반올림 위치도 논문과 같다.
export function paperMode(c) {
  const A = c.area_m2, k = (won) => Math.round(won / 1000);
  const construction = ["general", "selective"].map((m) =>
    k(Math.round(A * c.productivity_per_m2[m].carpenter) * c.wage.carpenter) + k(Math.round(A * c.productivity_per_m2[m].laborer) * c.wage.laborer));
  const w = c.waste_t_per_m2, d = c.disposal_won_per_t;
  const common = k(A * w.concrete * d.concrete) + k(A * w.wood * d.wood) + k(A * w.resin * d.resin);
  const disposal = [common + k(A * w.mixed * d.mixed_general), common + k(A * w.mixed * d.mixed_selective)];
  const [sx, sy, sz] = c.revenue.wood.sheet_m;
  const sheets = Math.floor(Math.round(A * w.wood) / (sx * sy * sz * c.revenue.wood.density));
  const revenue = k(sheets * c.revenue.wood.won_per_sheet) + k(Math.round(A * w.resin) * c.revenue.resin.won_per_t);
  const delta = construction[1] - construction[0] - (disposal[0] - disposal[1]) - revenue;
  return { construction, disposal, revenue, sheets, delta };
}
