// 계산 흐름: 화면 상태(입력값) → 분류 → 물량 → 비교 결과. 화면(app.js)과 서버(nijja Worker)가 같이 쓴다.
// DOM·fetch·localStorage를 쓰지 않는다. state는 app.js의 상태와 같은 모양의 보통 객체면 된다.
// 계산 방식을 바꿀 때는 이 파일을 고치면 화면과 서버 결과가 함께 바뀐다.
import { concreteCut, steelDismantling, compare, quantitiesFromArea, PRESS_FINISH_BASELINE, workScheduleIssues, streamTons } from "./scenario.js?v=service-recovery-20261123";
import { SCOPES, calibrateStructure } from "./calibration.js?v=service-recovery-20261123";
import { classify, quantitiesFromElements, connectFinishTakeoff, supplement, isStructuralSteelPart, isOpenSteelFrame, elementResults, reconcileElementResults } from "./classify.js?v=service-recovery-20261123";
import { num } from "./charts.js?v=cost-units-20261123";
import { ifcBuildingUse, ifcScopeElements } from "./ifc.js?v=scope-height-20261123";
import { identifyIfcServices, ifcServiceInventory, serviceSalvage } from "./service-salvage.js?v=service-recovery-20261123";
import { concreteCutCandidates } from "./concrete-cut.js?v=equipment-compare-20261123";
import { concreteCutInput, cutProjectFields } from "./cut-controls.js?v=concrete-cut-20261123";

export const WINDOW_ASSUMPTION = "가정: 압쇄 현장도 창틀 선철거·매각";
export const frameMaterials = [["al", "알루미늄", "aluminum"], ["pvc", "PVC", "resin"]];
export const frameFields = frameMaterials.flatMap(([key]) => ["Count","Kg","Crush","Sel","Price"].map(suffix => key + suffix));
export const disposalFields = ["boardWeight", "tileWeight", "boardCrush", "boardSel", "tileCrush", "tileSel", "boardFee", "tileFee", "metalFee"];
export const concreteCutModes = [["crush", "압쇄", "Crush"], ["selective", "분별", "Sel"]];
export const basementCapOwners = { above: "지상부에 귀속", below: "지하부에 귀속" };
export const heightSources = { field: "현장 입력", plan: "해체계획서", "ifc-geometry": "IFC 형상 추정" };
export const concreteCutFields = concreteCutModes.flatMap(([, , suffix]) => ["Volume", "Cost", "Days"].map(field => "rcCut" + field + suffix));
export const workScheduleFields = {
  totalDays: "전체 작업일",
  structureDays: "구조체 작업일",
  setupDays: "가설 작업일",
  interiorDays: "내부 철거 작업일",
  finishDays: "마무리 작업일",
  excavatorHours: "굴착기 합산 가동시간 (h)",
  equipmentQuote: "구조체 굴착기·크레인 견적 (원)",
  extraWorksCost: "별도 공종 견적 (원)",
};
export const workKey = (field, suffix) => "work" + field[0].toUpperCase() + field.slice(1) + suffix;
export const workFields = concreteCutModes.flatMap(([, , suffix]) => Object.keys(workScheduleFields).map(field => workKey(field, suffix)));
export const caseFields = ["scopeConfirmed", "basementCapOwner", "includeFoundation", "asbestosStatus", ...workFields, ...cutProjectFields, "selectiveEquipmentQuote", "selectiveEquipmentHours", "height", "equipment", "scope", "structure", "scaffold", "equipmentCrewPeriod", "craneDays", "parallelGain", "overlap", "mixedMineral", "mixedCombustible",
  "cleanCrush", "cleanSel", "cleanPrice", "transportCrush", "transportSel", "cableCrush", "cableSel", "cablePrice", "cableCommon", "copperPipeSold", "pipeInstalled", "cableInstalled", "officeMaterials", "estimateServiceArea", ...frameFields, ...disposalFields, "glassPdPerM2", "mountedBucket", "mountedLarge", "carpenterShare", "boardM2", "tileM2", "pvcM2", "alM2", "generalFinishPd", "panelTons", "groundFloors", "mountedProduction", "smallHours", "largeHours", "smallPrice", "largePrice", "concurrentHours", "cutSel", "cutCrush", "cutCommon", "steelTons", ...concreteCutFields, "openSteelCrushQuote", "openSteelSelectiveQuote", "openSteelCrushDays", "openSteelSelectiveDays"];
export const defaultSiteInputs = { equipment: "auto", scope: "unknown", structure: "rc", scaffold: "yes", site: "normal", equipmentCrewPeriod: "structure" };

export function usesBasement(scope, model) {
  return scope === "below" || (scope !== "above" && (model?.basementFloors ?? 0) > 0);
}

export function officeRecoveryEnabled(state) {
  return state.officeMaterials === true && !/^(단독|공동)주택$/.test(state.usage);
}

export function heightInput(state) {
  if (state.scope === "below") return {};
  if (Number.isFinite(state.height) && state.height > 0) return { height: state.height, heightBasis: "field" };
  const building = state.reference?.plan?.building;
  if (building?.floors_above !== 0 && Number.isFinite(building?.height_m) && building.height_m > 0) {
    return { height: building.height_m, heightBasis: "plan" };
  }
  if (!state.model?.basementOnlyCandidate && state.model?.aboveHeight_m > 0) {
    return { height: state.model.aboveHeight_m, heightBasis: state.model.aboveHeightBasis ?? "ifc-geometry" };
  }
  return {};
}

export function projectInputs(state) {
  return {
    area_m2: state.area, floors: state.floors, site: state.site, labor: state.labor, equipment: state.equipment,
    finishBaseline: state.labor === "quantity" ? PRESS_FINISH_BASELINE : undefined,
    scope: state.scope, structure: state.structure, ...heightInput(state), scaffold: state.scaffold === "yes", equipmentCrewPeriod: state.equipmentCrewPeriod,
    smallHours: state.smallHours, largeHours: state.largeHours, smallPrice: state.smallPrice, largePrice: state.largePrice, concurrentHours: state.concurrentHours, cutSel: state.cutSel, cutCrush: state.cutCrush, cutCommon: state.cutCommon,
    craneDays: state.craneDays, groundFloors: state.groundFloors, mountedProduction: state.mountedProduction, parallelGain: (state.parallelGain ?? 0) / 100, overlap: (state.overlap ?? 0) / 100,
    mixedMineral: (state.mixedMineral ?? 0) / 100, mixedCombustible: (state.mixedCombustible ?? 0) / 100,
    transportCrush: state.transportCrush, transportSel: state.transportSel,
    selectiveEquipmentQuote: state.selectiveEquipmentQuote, selectiveEquipmentHours: state.selectiveEquipmentHours,
    workSchedule: Object.fromEntries(concreteCutModes.map(([mode, , suffix]) => [mode,
      Object.fromEntries(Object.keys(workScheduleFields).map(field => [field, state[workKey(field, suffix)]])),
    ])),
    concreteCut: Object.fromEntries(concreteCutModes.map(([mode, , suffix]) => [mode, {
      volume: state["rcCutVolume" + suffix], cost: state["rcCutCost" + suffix], days: state["rcCutDays" + suffix],
    }])),
    cleanCrush: state.cleanCrush, cleanSel: state.cleanSel, cleanPrice: state.cleanPrice, cableCrush: state.cableCrush, cableSel: state.cableSel, cablePrice: state.cablePrice, cableCommon: state.cableCommon, copperPipeSold: state.copperPipeSold, pipeInstalled: state.pipeInstalled, cableInstalled: state.cableInstalled, ...Object.fromEntries([...frameFields, ...disposalFields, "glassPdPerM2", "mountedBucket", "mountedLarge"].map(key => [key, state[key]])), carpenterShare: state.carpenterShare,
    generalFinishPd: state.generalFinishPd, concreteCase: "good", caseId: state.caseId || state.plan?.source?.validation_id,
  };
}

export function derive(state, { rates, defaults }) {
  if (!state.source) return null;
  let classified = [], scopedServices = [], q, openSteelFrame = false;
  const basementCapOwner = state.basementCapOwner ?? state.reference?.basementCapOwner ?? "below";
  if (state.source === "ifc") {
    const scopeOptions = {
      basementCapOwner,
      includeFoundation: state.includeFoundation !== false,
    };
    const included = ifcScopeElements(state.elements, state.scope, scopeOptions);
    scopedServices = ifcScopeElements(state.model.services ?? [], state.scope, scopeOptions)
      .filter(entry => !["above", "below"].includes(state.scope) || entry.floor != null);
    classified = included.map((e) => classify(e, rates, state.overrides, /^(단독|공동)주택$/.test(state.usage) ? "resin" : "aluminum"));
    classified = identifyIfcServices(classified, scopedServices);
    const raw = quantitiesFromElements(classified.filter(el => el.serviceKind !== "cable"), state.area);
    openSteelFrame = isOpenSteelFrame(classified);
    q = state.supplement && !openSteelFrame ? supplement(raw, state.usage, rates) : { ...raw, t: { ...raw.t }, added: {} };
    q.raw = raw;
    q.supplemented = state.supplement && !openSteelFrame;
  } else q = { ...quantitiesFromArea(state.area, state.usage, rates), added: {} };
  Object.assign(q, projectInputs(state), { fixedComparison: true, officeRecovery: officeRecoveryEnabled(state) });
  if (state.model?.basementCapCount > 0) q.basementCapOwner = basementCapOwner;
  q.serviceInventory = ifcServiceInventory(scopedServices);
  const planBuilding = state.reference?.plan?.building;
  const planUse = ifcBuildingUse(`${planBuilding?.usage ?? ""} ${planBuilding?.name ?? ""}`, "", "");
  const serviceAreaExcluded = state.model?.serviceAreaExcluded || state.uploadedPlanScope?.serviceAreaExcluded || planUse.serviceAreaExcluded;
  if (state.estimateServiceArea !== false && !openSteelFrame && !serviceAreaExcluded && !["below", "partial"].includes(q.scope)) {
    q.serviceProfile = /^(단독|공동)주택$/.test(state.usage) ? "home" : "nonres";
  }
  const cutCandidates = state.source === "ifc" && !openSteelFrame ? concreteCutCandidates(classified, state.model, state.scope) : [];
  const cutPlan = concreteCutInput(state, state.source === "ifc" ? cutCandidates : null);
  const usesCutPlan = Boolean(state.cutRows?.length || state.cutScopeChecked);
  if (usesCutPlan) q.concreteCut = cutPlan.scenarios;
  const hasCut = concreteCutModes.some(([mode]) => concreteCut(q, mode).active);
  q.cutPlanningStatus = state.cutScopeChecked ? (hasCut ? "확인된 절단면" : "추가 절단 없음 확인")
    : usesCutPlan || cutCandidates.length > 0 || q.concrete_m3 > 0 ? "절단 범위 미확인" : null;
  const sourcePlan = state.reference?.plan;
  if (state.plan && q.equipment === "mounted" && !/탑재/.test(state.plan.demolition?.method ?? "")) q.equipment = "auto";
  q.basementIncluded = usesBasement(q.scope, state.model);
  q.basementFloors = state.model?.basementFloors ?? 0;
  q.asbestosStatus = state.asbestosStatus ?? "unknown";
  const hazard = sourcePlan?.hazards;
  q.knownAsbestos = hazard?.asbestos === true ? hazard : null;
  q.copperModeledTons = q.t.copper;
  if (q.copperPipeSold != null) q.t.copper = Math.max(q.t.copper, q.copperPipeSold);
  if (q.boardWeight != null) q.t.board = q.boardWeight;
  if (q.tileWeight != null) q.t.tile = q.tileWeight;
  q.steelWork = q.structure === "steel" || (state.source === "area" && /철골|SRC/.test(state.usage))
    || classified.some(el => ["beam", "column"].includes(el.category) && el.stream === "metal");
  if (state.steelTons != null && q.steelWork && state.source === "area") q.t.metal = state.steelTons;
  if (q.steelWork) {
    q.structuralSteelTons = state.source === "ifc"
      ? classified.reduce((weight, el) => weight + el.parts.reduce((sum, part) =>
        sum + (isStructuralSteelPart(el, part) ? part.tons : 0), 0), 0)
      : state.steelTons ?? (q.rebarFromConcrete ? 0 : q.t.metal);
  }
  q.windowMode = "both";
  if (state.source === "ifc") {
    const stairBodies = classified.filter(el => el.category === "stair" && el.bounds);
    q.overlappingTreads = classified.filter(el => el.guessedConcreteTread && el.bounds && stairBodies.some(stair =>
      stair.bounds.min.every((min, axis) => min <= el.bounds.min[axis] + 0.005
        && stair.bounds.max[axis] >= el.bounds.max[axis] - 0.005))).length;
    const windows = classified.filter(el => el.category === "window" || el.parts.some(part => part.windowAssembly));
    q.windowArea = windows.reduce((sum, el) => sum + el.area, 0);
    q.windowGlassTons = 0;
    q.alFrameTons = 0;
    q.pvcFrameTons = 0;
    for (const el of windows) for (const part of el.parts) {
      if (part.stream === "glass") q.windowGlassTons += part.tons;
      if (part.stream === "aluminum") q.alFrameTons += part.tons;
      if (part.stream === "resin") q.pvcFrameTons += part.tons;
    }
  } else {
    q.windowArea = state.alM2 != null || state.pvcM2 != null
      ? (state.alM2 ?? 0) + (state.pvcM2 ?? 0) : state.area * state.p.window_ratio;
    const residential = /^(단독|공동)주택$/.test(state.usage);
    q.pvcFrameTons = (state.pvcM2 ?? (state.alM2 == null && residential ? q.windowArea : 0)) * rates.perArea.window_frame;
    q.alFrameTons = (state.alM2 ?? (state.pvcM2 == null && !residential ? q.windowArea : 0)) * rates.perArea.window_frame;
    q.windowGlassTons = q.windowArea * rates.perArea.window_glass;
    q.t.glass = Math.max(q.t.glass, q.windowGlassTons);
    q.t.aluminum = Math.max(q.t.aluminum, q.alFrameTons);
    q.t.resin = Math.max(q.t.resin, q.pvcFrameTons);
  }
  const frameAdjustments = [];
  let frameLimit = "";
  for (const [key, label, stream] of frameMaterials) {
    const automaticFrame = Boolean(q.windowMode);
    const hasInput = automaticFrame ? state[key+"Count"] != null || state[key+"Kg"] != null : frameFields.some(field => field.startsWith(key) && state[field] != null);
    if (!hasInput) continue;
    const count = state[key+"Count"], kg = state[key+"Kg"];
    if (!Number.isInteger(count) || count < 1 || !(kg > 0) || (!automaticFrame && (state[key+"Crush"] == null || state[key+"Sel"] == null || state[key+"Price"] == null))) {
      frameLimit = label + (automaticFrame ? " 창틀의 개수와 세트당 순중량을 모두 입력하세요." : " 창틀의 개수, 세트당 순중량, 두 공법의 회수율과 인수단가를 확인하세요.");
      continue;
    }
    const tons = count * kg / 1000;
    const modeledFrames = classified.filter(el => (el.category === "window" || el.parts.some(part => part.windowAssembly)) && (key === "al" || el.layers.some(l => /pvc|vinyl|염화비닐/i.test(l.name))))
      .reduce((sum, el) => sum + el.parts.filter(part => part.stream === stream).reduce((a, part) => a + part.tons, 0), 0);
    const previousFrame = q[key+"FrameTons"] ?? modeledFrames;
    const other = Math.max(0, (q.raw?.t[stream] ?? q.t[stream]) - previousFrame);
    q.t[stream] = Math.max(q.t[stream] - previousFrame, other + tons);
    if (q.raw) {
      q.raw = { ...q.raw, t: { ...q.raw.t, [stream]: other + tons } };
      if (q.added[stream] != null) q.added[stream] = q.t[stream] - q.raw.t[stream];
    }
    q[key+"FrameTons"] = tons;
    const difference = tons - previousFrame;
    const pricePerTon = key === "al" ? (q.alPrice == null ? state.p.price_aluminum : q.alPrice * 1000) : (q.pvcPrice ?? 0) * 1000;
    if (difference !== 0) frameAdjustments.push({
      globalId: "", tag: "", category: "adjustment", floor: "", stream,
      method: label + " 창틀 수동 보정", tons: difference,
      disposal: difference * Math.max(0, -pricePerTon), revenue: difference * Math.max(0, pricePerTon),
    });
  }
  const manualAreas = { board: state.boardM2, tile: state.tileM2, pvc: state.pvcM2, aluminum: state.alM2 };
  if (state.plan?.rebar_kg_per_m3?.value && state.p.rebar_kg_per_m3 === defaults.rebar_kg_per_m3) q.rebarKgPerM3 = state.plan.rebar_kg_per_m3.value;
  q.finishAreas = { ...q.finishAreas, ...Object.fromEntries(Object.entries(manualAreas).filter(([, value]) => value != null)) };
  if (state.source === "ifc" && !openSteelFrame && q.labor === "quantity") {
    q.finishFallbackDisabled = Boolean(state.uploadedPlanScope?.finishFallbackDisabled) || q.scope === "below";
    if (q.knownAsbestos && q.asbestosStatus === "present" && state.scope === state.reference.scope) {
      const affected = q.knownAsbestos.affected_m2 ?? {};
      const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
      q.finishAreaExclusions = { board: positive(affected.ceiling) + positive(affected.wall), floor: positive(affected.floor) };
    }
    connectFinishTakeoff(q, q.raw, rates, state.p);
  }
  q.panelWeightMissing = state.panelTons == null && classified.some(el => el.parts.some(part => part.stream === "panel" && !(part.tons > 0)));
  q.t.panel = state.panelTons ?? q.t.panel;
  if (state.useCalibration) {
    const cal = calibrateStructure(state.cases, q, state.p, state.calibrationType);
    if (cal.ready) q.structureFactor = cal.factor;
  }
  const incompleteCut = concreteCutModes.find(([mode]) => !concreteCut(q, mode).ready);
  const partialArea = state.source === "ifc" ? state.uploadedPlanScope?.partialArea : undefined;
  const areaLimit = partialArea
    ? `계획서의 부분 해체 범위는 ${num(partialArea, 2)}㎡입니다. 대상 부재만 포함한 IFC를 올려 주세요.`
    : state.source === "ifc" && !openSteelFrame && state.areaBasis === "bbox" && !state.areaConfirmed
      ? "IFC의 외곽 치수로 면적을 추정했습니다. 모델 탭에서 해체 대상 면적을 확인해 입력하세요."
      : "";
  const scopeLimit = state.source === "ifc" && ["below", "partial"].includes(q.scope) && !state.scopeConfirmed
    ? "모델 탭에서 해체 대상 IFC 범위와 면적을 확인하세요." : "";
  const basementLimit = q.scope === "below" && concreteCutModes.some(([mode]) => q.workSchedule[mode].totalDays == null
      || q.workSchedule[mode].structureDays == null || q.workSchedule[mode].extraWorksCost == null
      || (q.workSchedule[mode].equipmentQuote == null && q.workSchedule[mode].excavatorHours == null && q.equipment !== "mixed"))
    ? "지하부는 양 공법의 전체·구조체 작업일, 구조체 장비비 또는 가동시간, 흙막이·되메우기 등 별도 공종 견적이 필요합니다." : "";
  const scheduleIssue = workScheduleIssues(q)[0];
  const comparisonLimit = frameLimit || state.planExample?.comparisonLimit || state.reference?.example?.comparisonLimit || areaLimit || scopeLimit
    || (state.source === "ifc" && !classified.length ? "선택한 범위에 계산할 IFC 부재가 없습니다." : "")
    || (q.scope === "below" && state.source === "ifc" && !(state.model.basementFloors > 0) ? "IFC에서 지하층을 식별할 수 없습니다. 대상 부재만 포함한 IFC는 부분해체를 선택해 범위를 확인하세요." : "")
    || basementLimit || cutPlan.issues[0] || scheduleIssue
    || (incompleteCut && (usesCutPlan ? `${incompleteCut[1]}안 절단면적과 견적의 입력 범위를 확인하세요.`
      : `${incompleteCut[1]}안 콘크리트 절단·인양 부피는 전체 콘크리트 부피 이하로 입력하고, 작업일수를 함께 입력하세요.`))
    || (q.structure === "unknown" && "현장 조건에서 계획서의 구조형식을 확인하세요.")
    || (q.equipment === "mixed" && (!(q.smallHours > 0 && q.largeHours > 0) || q.smallPrice == null || q.largePrice == null || (q.concurrentHours ?? 0) > Math.min(q.smallHours, q.largeHours)) && "두 굴착기의 가동시간과 시간당 단가를 입력하세요. 동시 작업시간은 짧은 쪽 가동시간 이하여야 합니다.");
  const cmp = openSteelFrame || comparisonLimit ? null : compare(q, state.p);
  const planReference = state.source === "ifc" ? state.uploadedPlanScope?.planReference : undefined;
  const finishUnverified = Object.values(q.finishTakeoff ?? {}).some(item => item.unverified);
  const includedCostResult = !cmp ? null : cmp.delta === 0 ? "tie" : cmp.delta < 0 ? "selective" : "crush";
  const scopeLabel = SCOPES[q.scope] ?? SCOPES.unknown;
  const comparisonScope = scopeLabel + " · " + num(q.area_m2, 2) + "㎡" + (state.scope !== "below" ? " · 지상 " + num(q.floors) + "층" : "");
  const review = [];
  const serviceEstimate = serviceSalvage(q, state.p);
  if (Object.values(serviceEstimate).some(item => item.source === "area" && Object.values(item.methods).some(result => !result.confirmed))) {
    review.push("동관·폐전선 매각에 연면적 원단위를 사용했습니다. 설치량과 인수 견적을 확인하세요.");
  } else if (Object.values(serviceEstimate).some(item => item.kg > 0 && Object.values(item.methods).some(result => !result.confirmed))) {
    review.push("동관·폐전선 매각량에 비교용 회수율을 적용했습니다. 회수에 드는 작업비와 계근량을 확인하세요.");
  }
  if (Object.values(serviceEstimate).some(item => item.model.unknownCount > 0 && item.source === "ifc")) {
    review.push("일부 IFC 배관·전선의 수량정보가 부족해 산출 가능한 부재만 집계했습니다.");
  }
  if (state.source === "ifc" && (!state.scopeConfirmed || q.scope === "unknown")) review.push("IFC에 포함된 부재가 실제 해체 범위와 일치하는지 확인이 필요합니다.");
  if (q.basementCapOwner && ["above", "below"].includes(q.scope) && !state.scopeConfirmed) {
    review.push(`경계 슬래브·지붕 후보를 ${q.basementCapOwner === "below" ? "지하부" : "지상부"}에 귀속했습니다. 해체계획서의 범위와 대조하세요.`);
  }
  if (state.source === "ifc" && !state.areaConfirmed) review.push("해체 면적은 IFC에서 산정한 값입니다. 계획서나 현장 면적과 대조하세요.");
  if (state.reference?.plan?.hazards?.other === true) review.push("계획서에 기타 유해물질이 기록되어 있습니다. 포함 공종과 견적을 확인하세요.");
  if (planReference) review.push("계획서의 바닥 슬래브, 석면 등 별도 공종을 포함한 견적이 필요합니다.");
  if (finishUnverified) review.push("일부 마감재의 물량 및 분별 작업이 미산정입니다.");
  if (steelDismantling(q).excluded) review.push("구조용 철골 절단·인양 도급비가 누락됐습니다.");
  if (q.steelWork && concreteCutModes.some(([mode]) => q.workSchedule[mode].totalDays == null)) review.push("철골 절단·인양 범위가 반영된 공법별 전체 작업일을 공정표에서 확인하세요.");
  if (cmp && (cmp.crush.transportQuote == null || cmp.selective.transportQuote == null)) review.push("공법별 운반 견적이 모두 입력되기 전까지 운반비는 양쪽 소계에서 제외됩니다.");
  if (q.cutPlanningStatus === "절단 범위 미확인") review.push("콘크리트 절단 대상 범위가 미확인입니다.");
  if (cmp?.unpricedCuts.length) review.push("콘크리트 절단 견적 또는 인양비 적용 조건이 미확정입니다.");
  if (concreteCutModes.some(([mode]) => concreteCut(q, mode).daysMissing)) review.push("절단·인양으로 늘어나는 작업일이 미확인입니다.");
  if (Object.values(cutPlan.groupCosts).some(group => group.reference)) review.push("콘크리트 절단에 교량 계약 참고단가를 적용했습니다. 건물의 현장 견적을 확인하세요.");
  if (cmp?.hasUnpricedDisposal) review.push("일부 폐기물의 처리비가 소계에서 빠졌습니다.");
  if (cmp && [cmp.crush, cmp.selective].some(result => result.mixed.needsQuote)) review.push("혼합잔재에 비교용 처리단가를 적용했습니다. 성상과 인수 견적을 확인하세요.");
  if (q.asbestosStatus === "unknown") review.push("석면 조사 결과를 확인하세요.");
  if (concreteCutModes.some(([mode]) => q.workSchedule[mode].extraWorksCost == null)) {
    if (q.asbestosStatus === "present") review.push("석면 제거·처리 등 별도 공종 견적이 필요합니다.");
    if (q.basementIncluded) review.push("지하부 흙막이·되메우기 등 별도 공종 견적이 필요합니다.");
  }
  if (state.source === "ifc" && q.scope !== "below" && !state.model.basementOnlyCandidate && q.height == null) {
    review.push("IFC의 지상 높이를 산정하지 못했습니다. 해체계획서나 현장 자료에서 높이를 확인해 입력하세요.");
  } else if (q.equipment === "auto" && q.height > 10 && concreteCutModes.some(([mode]) => q.workSchedule[mode].equipmentQuote == null)) {
    review.push("높이 10m 초과 건물의 장비 운용 방식과 견적을 해체계획서에서 확인하세요.");
  }
  if (q.basementIncluded && concreteCutModes.some(([mode]) => q.workSchedule[mode].totalDays == null || q.workSchedule[mode].structureDays == null)) {
    review.push("지하부가 포함된 공정은 공법별 전체·구조체 작업일을 입력해 대조하세요.");
  }
  for (const [mode, label] of concreteCutModes) {
    const result = cmp?.[mode], phases = result?.schedule;
    if (phases?.assumedPhasesExceedTotal?.length) review.push(label + "의 추정 공종 일수가 입력한 전체 작업일을 넘습니다. 공종별 작업일을 확인하세요.");
    else if (phases?.sources?.total !== "estimate" && phases?.phaseDifference > 0.01
        && ["setup","interior","structure","finish"].some(key => phases.sources[key] === "estimate")) {
      review.push(label + " 공정 일부는 기본 산식입니다. 전체 작업일과 겹치는 공정을 공정표에서 확인하세요.");
    }
  }
  const basis = cmp && review.length ? "포함 항목 기준" : null;
  const recommended = cmp && !review.length ? includedCostResult : null;
  return { classified, q, cutCandidates, cutPlan, openSteelFrame, comparisonLimit, comparisonScope, cmp, recommended, includedCostResult, review, basis, frameAdjustments, finishUnverified, planReference };
}


// 부재별 결과 (CSV·Revit 되쓰기용). mode: "selective" | "crush"
export function elementRows(d, p, mode = "selective") {
  const result = d.cmp[mode];
  const rows = elementResults(d.classified, p, result.mixed.fee, d.q, mode, result);
  const appliedTons = Object.values(streamTons(d.q, p).t).reduce((sum, weight) => sum + weight, 0)
    + (d.q.serviceInventory.cable.kg ?? 0) / 1000;
  return reconcileElementResults([...rows, ...d.frameAdjustments], appliedTons, result);
}

/* ---------------- 서버·일괄 처리용 입구 ---------------- */
// 물량 묶음 형식 이름. Revit 일괄 처리(nijja)가 이 형식으로 올리고, 서버가 computeQuantities로 계산한다.
export const QUANTITIES_SCHEMA = "reclaim-quantities/1";

// IFC를 화면에 처음 올렸을 때와 같은 기본 조건으로 계산한다 (계획서·저장된 입력 없음).
// model: ifc.js parseIfc()와 같은 모양 { elements, gross:{area,basis}, floors, aboveFloors, usage, basementFloors, ... }
// inputs: 화면 입력값 일부 { usage, area, scope, floors, site, equipment, structure, scopeConfirmed, ... }. 빠진 값은 화면 기본값.
// p: 단가 바꾼 값 (없으면 rates.json 기본값)
export function computeModel(model, inputs = {}, { rates, defaults, p = {} }) {
  const scope = inputs.scope ?? (model.basementOnlyCandidate ? "below" : "unknown");
  const detected = scope === "below" ? { area: model.basementArea, basis: model.basementBasis }
    : scope === "above" ? { area: model.aboveArea, basis: model.aboveBasis ?? model.gross?.basis }
      : model.gross ?? {};
  const state = {
    source: "ifc", model, elements: model.elements, fileName: model.name ?? "", overrides: {}, caseId: "",
    p: { ...defaults, ...p },
    ...Object.fromEntries(caseFields.map((key) => [key, undefined])),
    includeFoundation: true, asbestosStatus: "unknown", scopeConfirmed: false,
    areaBasis: inputs.area ? "plan" : detected.basis,
    areaConfirmed: Boolean(inputs.area),
    area: inputs.area || Math.round((detected.area || model.gross?.area || 0) * 100) / 100,
    floors: scope === "below" ? 0 : model.aboveFloors ?? model.floors,
    ...defaultSiteInputs, scope, usage: model.usage ?? "공동주택",
    labor: "quantity", supplement: false, useCalibration: false, calibrationType: "plan", cases: [],
    ...inputs,
  };
  const d = derive(state, { rates, defaults });
  return { ...d, state, elementRows: d.cmp ? elementRows(d, state.p) : [] };
}

// 물량 묶음 { schema, model, inputs, p } → 계산 결과 (서버용)
export function computeQuantities(bundle, { rates, defaults }) {
  if (bundle?.schema !== QUANTITIES_SCHEMA) throw new Error(`schema가 "${QUANTITIES_SCHEMA}"가 아닙니다`);
  if (!Array.isArray(bundle.model?.elements)) throw new Error("model.elements가 없습니다");
  return computeModel(bundle.model, bundle.inputs ?? {}, { rates, defaults, p: bundle.p ?? {} });
}
