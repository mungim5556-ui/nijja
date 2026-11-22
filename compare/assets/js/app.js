// 화면과 상태. 계산은 scenario.js / sensitivity.js / classify.js가 한다.
import { selectiveEquipmentHoursPerDay, costScenario, concreteCut, officeSalvage, steelDismantling, compare, paramValues, quantitiesFromArea, paperMode, schedule, STREAMS, STREAM_LABEL, SEPARATED, SITES, LABOR_METHODS, EQUIPMENT, equipmentMode, selExtra, CONCRETE_CASES, concreteGrades, concreteGradeLink, streamTons, PRESS_FINISH_BASELINE } from "./scenario.js?v=ifc-equipment-days-1";
import { VALIDATION_SCHEMA, MIN_CASES, SCOPES, PERIOD_UNITS, BENCHMARKS, validationCases, comparableCases, calibrateStructure, benchmark } from "./calibration.js";
import { variables, tornado, breakEven, simulate, histogram } from "./sensitivity.js?v=ifc-equipment-days-1";
import { classify, quantitiesFromElements, connectFinishTakeoff, supplement, checkAgainstUnits, elementResults, isStructuralSteelPart, reconcileElementResults, toCsv, groupKey, CATEGORY_LABEL, isOpenSteelFrame } from "./classify.js?v=ifc-finish-flow-1";
import { stackedBars, tornadoChart, histChart, legend, mil, num } from "./charts.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const json = async (f) => (await fetch(`assets/data/${f}`)).json();
const [rates, paper, validationDoc, kalisCases] = await Promise.all([
  json("rates.json?v=ifc-finish-flow-1"), json("paper2023_case.json"), json("plan-validation.json"),
  json("plans/kalis/index.json").then(d => d.items ?? []).catch(() => []),
]);
const sampleCases = validationCases(validationDoc);
const defaults = paramValues(rates);

const TABS = [["model", "모델"], ["rates", "단가"], ["compare", "비교"], ["validation", "검증·보정"], ["export", "내보내기"]];
const STREAM_COLOR = { masonry: "#aa7259", concrete: "#9c9084", metal: "#4a6fa5", wood: "#b0783c", resin: "#c05a9a", glass: "#58b8d8", tile: "#9180a6", panel: "#ad9c5a", board: "#d9b23a", mixed: "#6f747d", copper: "#c8642a", aluminum: "#b8c4d0", excluded: "#d6d3ce" };
const METHOD_COLOR = { 분별: "#1baf7a", 압쇄: "#9c9084" };

const saved = (() => { try { return JSON.parse(localStorage.getItem("rc.state")) || {}; } catch { return {}; } })();
const oldDefaults = { crew_size: 20, window_frame_pd_per_m2: 0.0229, indirect_per_day: 500000, crew_standing: 3, crew_per_excavator: 1 };
const loadedParams = Object.fromEntries(Object.entries(saved.p || {}).filter(([k, v]) => (
  Object.hasOwn(defaults, k) && Number.isFinite(v) && !rates.params[k].locked
  && (saved.rateRevision >= 2 || oldDefaults[k] !== v)
)));
let personalRates = { ...defaults, ...loadedParams };
const caseMap = new Map(sampleCases.map((row) => [row.id, row]));
const localCases = new Map();
try {
  const local = JSON.parse(localStorage.getItem("rc.validation") || "null");
  if (local) for (const row of validationCases(local)) {
    const oldSample = local.revision !== 2 && caseMap.has(row.id)
      && (!row.verified || row.source === "논현동 124-1 해체계획서 p.9·19·40·118");
    if (!oldSample) localCases.set(row.id, row);
  }
} catch { /* 손상된 브라우저 데이터는 기본 목록으로 복구한다. */ }
const allCases = () => [...new Map([...caseMap, ...localCases]).values()];
const WINDOW_ASSUMPTION = "가정: 압쇄 현장도 창틀 선철거·매각";
const frameMaterials = [["al", "알루미늄", "aluminum"], ["pvc", "PVC", "resin"]];
const frameFields = frameMaterials.flatMap(([key]) => ["Count","Kg","Crush","Sel","Price"].map(suffix => key + suffix));
const disposalFields = ["boardWeight", "tileWeight", "boardCrush", "boardSel", "tileCrush", "tileSel", "boardFee", "tileFee", "metalFee"];
const concreteCutModes = [["crush", "압쇄", "Crush"], ["selective", "분별", "Sel"]];
const concreteCutFields = concreteCutModes.flatMap(([, , suffix]) => ["Volume", "Cost", "Days"].map(field => "rcCut" + field + suffix));
const caseFields = ["selectiveEquipmentQuote", "height", "equipment", "scope", "structure", "scaffold", "equipmentCrewPeriod", "craneDays", "parallelGain", "overlap", "mixedMineral", "mixedCombustible",
  "cleanCrush", "cleanSel", "cleanPrice", "transportCrush", "transportSel", "cableCrush", "cableSel", "cablePrice", "cableCommon", "copperPipeSold", "pipeInstalled", "cableInstalled", "officeMaterials", ...frameFields, ...disposalFields, "glassPdPerM2", "mountedBucket", "mountedLarge", "carpenterShare", "boardM2", "tileM2", "pvcM2", "alM2", "generalFinishPd", "panelTons", "concreteCase", "groundFloors", "mountedProduction", "smallHours", "largeHours", "smallPrice", "largePrice", "concurrentHours", "cutSel", "cutCrush", "cutCommon", "steelTons", ...concreteCutFields, "openSteelCrushQuote", "openSteelSelectiveQuote", "openSteelCrushDays", "openSteelSelectiveDays"];
const defaultSiteInputs = { equipment: "auto", scope: "unknown", structure: "rc", scaffold: "yes", site: "normal", equipmentCrewPeriod: "structure" };
const settings = ["area", "floors", "usage", "site", "labor", ...caseFields];
const projectFields = [...settings, "overrides", "supplement", "seed", "caseId", "useCalibration", "calibrationType"];
const state = {
  tab: "model", source: null, fileName: "", model: null, elements: [], overrides: {},
  area: saved.area || 2400, floors: saved.floors || 5, usage: saved.usage || "공동주택", supplement: false,
  site: saved.site in SITES ? saved.site : "normal", labor: saved.labor in LABOR_METHODS ? saved.labor : "paper",
  equipment: "auto", scope: "unknown", structure: "rc", scaffold: "yes", equipmentCrewPeriod: "structure",
  ...Object.fromEntries(caseFields.filter((key) => saved[key] != null).map((key) => [key, saved[key]])),
  p: personalRates, seed: 1, colorMode: "stream", busy: "", error: "",
  cases: allCases(), caseMessage: "", calibrationType: "plan", useCalibration: false,
};
let viewer = null, sim = null;
const uploadedIfc = () => state.source === "ifc" && !state.plan;
const save = () => {
  if (uploadedIfc()) return;
  const values = Object.fromEntries(settings.map((key) => [key, state[key]]));
  personalRates = state.p;
  const p = Object.fromEntries(Object.entries(personalRates).filter(([key, value]) => value !== defaults[key]));
  try {
    if (state.plan && state.fileKey) {
      const project = { ...Object.fromEntries(projectFields.map(k => [k, state[k]])), supplementSelected: true, planApplied: true, planEquipmentRevision: 2, planConditionsRevision: 1 };
      localStorage.setItem(state.fileKey, JSON.stringify(project));
    }
    localStorage.setItem("rc.state", JSON.stringify({ ...values, p, rateRevision: 3 })); }
  catch { /* 저장 불가여도 계산은 된다 */ }
};

// Exact uploads from the plan validation set. Partial scopes require a scoped IFC.
const uploadedPlanScopes = {
  "5149423472c717fc72e4db992187cc7a3f9650164a097389a0d8adfb8a45fea9": { usage: "비주거 RC" }, // 서대신동 474-47
  "932494c18be9ca9681ac97b101b9a1c172f1efd7a976a5d73d68dc77e49d986a": { usage: "단독주택" }, // 01-house.json
  "de0ee7556962d356f80a317b79999a7ba21808488b606bf5769ffde48df54e0e": { usage: "비주거 RC" }, // 02-shops.json
  "9955b8c35f7769961e315c49ceb6fc3d808df810237e2d744d312a93e91c9f51": { usage: "공동주택" }, // 03-multifamily-transfer.json
  "7183f1414672ee0c8bb7f3aad2f07ca4fe31f00c722099531d36b45868cd25ce": { usage: "공동주택" }, // 04-apartment.json
  "751394708fd409fd752605514aabf4e49b1eac1b3a337d3a71aa8cdf334dcc97": { usage: "비주거 SRC" }, // 05-office-above.json
  "38391477cec44a75adc05399b68c22e76cea1ab49a35f5a340804cc42d0081cc": { usage: "비주거 RC" }, // 06-office-below.json
  "3978b62f946ea890f42872a89f95d2a280da1473ebf45aaa013174f756022fc3": { area: 102.3, scope: "above", usage: "비주거 RC" }, // 노량진 지상 해체 범위
  db1384a717b94437e38e4d544447fc94f7dd76d0835ea30d19ba6d3e6aba3073: { area: 23191.57, usage: "비주거 철골", finishFallbackDisabled: true,
    planReference: {
      wasteTons: { concrete: 25000, mixed: 100, wood: 150, resin: 10 },
      wasteScope: "주1동·부속동 포함 범위 미확인",
      wastePage: 17,
      asbestosArea: { roof: 26752, ceiling: 18750 },
      asbestosPage: 147,
    },
  },
  "5082779404a13f81a1a1cf5a12d0bdb8074e2e43adcdeb8155cbb31a75f6f8a8": { area: 965.04, scope: "above", equipment: "mounted", site: "tight" },
  "1018a28b042f0d3f92c5c9c4e3ca688c7f3dfd68f9d639c000a72c3ea5d2ce16": { partialArea: 350 },
  e3f77ea809a0dcb4b5fe738638fbdf54919a8eb00e14718f1213d7a8d9bdb513: { partialArea: 266.08 },
};

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

function validRate(key, value) {
  const meta = rates.params[key];
  const signed = key === "net_wood" || key === "net_resin";
  const nonzero = /per_day$|per_1000m2$/.test(key) && !key.startsWith("sched_") && key !== "indirect_per_day" && key !== "crane_per_day"
    || ["crew_size", "area_per_excavator", "hours_per_day", "crush_m3_per_day_small", "sched_struct_m2_per_day"].includes(key);
  return Number.isFinite(value) && (signed || value >= 0) && (!nonzero || value > 0) && (meta.unit !== "비율" || value <= 1);
}

const opts = (options, value) => Object.entries(options).map(([key, label]) =>
  `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`).join("");
const numeric = (key, label, { max = "", placeholder = "미입력" } = {}) =>
  `<label class="field">${label}<input class="input" type="number" ${key === "pvcPrice" ? "" : 'min="0"'} ${max === "" ? "" : `max="${max}"`} step="any" placeholder="${placeholder}" data-set="${key}" value="${state[key] ?? ""}"></label>`;
function projectInputs() {
  return {
    area_m2: state.area, floors: state.floors, site: state.site, labor: state.labor, equipment: state.equipment,
    finishBaseline: state.labor === "quantity" ? PRESS_FINISH_BASELINE : undefined,
    scope: state.scope, structure: state.structure, height: state.height, scaffold: state.scaffold === "yes", equipmentCrewPeriod: state.equipmentCrewPeriod,
    smallHours: state.smallHours, largeHours: state.largeHours, smallPrice: state.smallPrice, largePrice: state.largePrice, concurrentHours: state.concurrentHours, cutSel: state.cutSel, cutCrush: state.cutCrush, cutCommon: state.cutCommon,
    craneDays: state.craneDays, groundFloors: state.groundFloors, mountedProduction: state.mountedProduction, parallelGain: (state.parallelGain ?? 0) / 100, overlap: (state.overlap ?? 0) / 100,
    mixedMineral: (state.mixedMineral ?? 0) / 100, mixedCombustible: (state.mixedCombustible ?? 0) / 100,
    transportCrush: state.transportCrush, transportSel: state.transportSel,
    selectiveEquipmentQuote: state.selectiveEquipmentQuote,
    concreteCut: Object.fromEntries(concreteCutModes.map(([mode, , suffix]) => [mode, {
      volume: state["rcCutVolume" + suffix], cost: state["rcCutCost" + suffix], days: state["rcCutDays" + suffix],
    }])),
    cleanCrush: state.cleanCrush, cleanSel: state.cleanSel, cleanPrice: state.cleanPrice, cableCrush: state.cableCrush, cableSel: state.cableSel, cablePrice: state.cablePrice, cableCommon: state.cableCommon, copperPipeSold: state.copperPipeSold, pipeInstalled: state.pipeInstalled, cableInstalled: state.cableInstalled, ...Object.fromEntries([...frameFields, ...disposalFields, "glassPdPerM2", "mountedBucket", "mountedLarge"].map(key => [key, state[key]])), carpenterShare: state.carpenterShare,
    generalFinishPd: state.generalFinishPd, concreteCase: "good", caseId: state.caseId || state.plan?.source?.validation_id,
  };
}

function derive() {
  if (!state.source) return null;
  let classified = [], q, openSteelFrame = false;
  if (state.source === "ifc") {
    const included = state.scope === "above" ? state.elements.filter(e => !e.basement && e.category !== "footing") : state.elements;
    classified = included.map((e) => classify(e, rates, state.overrides, /^(단독|공동)주택$/.test(state.usage) ? "resin" : "aluminum"));
    const raw = quantitiesFromElements(classified, state.area);
    openSteelFrame = isOpenSteelFrame(classified);
    q = state.supplement && !openSteelFrame ? supplement(raw, state.usage, rates) : { ...raw, t: { ...raw.t }, added: {} };
    q.raw = raw;
    q.supplemented = state.supplement && !openSteelFrame;
  } else q = { ...quantitiesFromArea(state.area, state.usage, rates), added: {} };
  Object.assign(q, projectInputs(), { fixedComparison: true, officeRecovery: officeRecoveryEnabled() });
  if (state.plan && q.equipment === "mounted" && !/탑재/.test(state.plan.demolition?.method ?? "")) q.equipment = "auto";
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
    q.finishFallbackDisabled = Boolean(state.uploadedPlanScope?.finishFallbackDisabled);
    connectFinishTakeoff(q, q.raw, rates, state.p);
    q.concreteCase = "linked";
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
    : state.source === "ifc" && !openSteelFrame && state.model.gross.basis === "bbox" && !state.areaConfirmed
      ? "IFC의 외곽 치수로 면적을 추정했습니다. 모델 탭에서 해체 대상 면적을 확인해 입력하세요."
      : "";
  const comparisonLimit = frameLimit || state.planExample?.comparisonLimit || areaLimit
    || (incompleteCut && `${incompleteCut[1]}안 콘크리트 절단·인양 부피는 전체 콘크리트 부피 이하로 입력하고, 작업일수를 함께 입력하세요.`)
    || (q.structure === "unknown" && "현장 조건에서 계획서의 구조형식을 확인하세요.")
    || (q.equipment === "mixed" && (!(q.smallHours > 0 && q.largeHours > 0) || q.smallPrice == null || q.largePrice == null || (q.concurrentHours ?? 0) > Math.min(q.smallHours, q.largeHours)) && "두 굴착기의 가동시간과 시간당 단가를 입력하세요. 동시 작업시간은 짧은 쪽 가동시간 이하여야 합니다.");
  const cmp = openSteelFrame || comparisonLimit ? null : compare(q, state.p);
  const planReference = state.source === "ifc" ? state.uploadedPlanScope?.planReference : undefined;
  const finishUnverified = Object.values(q.finishTakeoff ?? {}).some(item => item.unverified);
  const recommended = !cmp || cmp.unpricedCuts.length
    ? null : cmp.delta === 0 ? "tie" : cmp.delta < 0 ? "selective" : "crush";
  const basis = cmp && (cmp.unpricedCuts.length || cmp.hasUnpricedDisposal || finishUnverified
    || planReference || steelDismantling(q).excluded || cmp.crush.transportQuote == null || cmp.selective.transportQuote == null)
    ? "포함 항목 기준" : null;
  return { classified, q, openSteelFrame, comparisonLimit, cmp, recommended, basis, frameAdjustments, finishUnverified, planReference };
}

/* ---------------- 모델 ---------------- */
// 해체계획서 데이터(JSON) → 구조체 IFC를 만들어 그대로 읽어 들인다
async function loadPlan(plan, name, planExample = null) {
  try {
    if (plan.schema !== "reclaim-plan/1") throw new Error('schema가 "reclaim-plan/1"이 아닙니다');
    const { planToIfc, planConditions } = await import("./plan.js");
    const b = plan.building || {};
    const conditions = planConditions(plan, { sites: SITES, equipments: EQUIPMENT });
    Object.assign(conditions.values, planExample?.inputs);
    if (!/탑재/.test(plan.demolition?.method ?? "") && conditions.values.equipment === "mounted") delete conditions.values.equipment;
    await loadIfc(new TextEncoder().encode(planToIfc(plan)).buffer, `${name} → 자동 생성 구조체 모델`, b.demolition_area_m2 || b.area_m2, plan, conditions, planExample);
  } catch (e) {
    state.error = `계획서 데이터를 읽지 못했습니다: ${e.message}`; render();
  }
}

let loadVersion = 0;
function inferIfcUsage(modelUsage, filename) {
  if (modelUsage) return modelUsage;
  if (/공동주택|다가구|다세대|연립|아파트|빌라/.test(filename)) return "공동주택";
  if (/관사|단독/.test(filename)) return "단독주택";
  if (/학교|교사동|어린이집|상가|업무시설|사무실|사무동|사무용/.test(filename)) return "비주거 RC";
  return /주택/.test(filename) ? "단독주택" : "공동주택";
}

async function loadIfc(buffer, name, area, plan = null, conditions = null, planExample = null) {
  const version = ++loadVersion;
  state.busy = "IFC를 읽는 중입니다…"; state.error = ""; state.formError = ""; render();
  try {
    const { parseIfc } = await import("./ifc.js");
    const model = await parseIfc(buffer);
    if (!model.elements.some(e => e.category !== "other" && e.volume > 0)) throw new Error("비용 산정에 사용할 건축 부재 물량을 찾지 못했습니다.");
    const b = plan?.building;
    const digest = globalThis.crypto?.subtle ? await sha256(buffer) : null;
    const uploadedPlanScope = !plan && digest ? uploadedPlanScopes[digest] : undefined;
    const fileKey = plan && digest ? "rc.ifc." + digest + JSON.stringify(plan.building) : null;
    if (version !== loadVersion) return;
    let previous;
    if (fileKey) {
      try { previous = JSON.parse(localStorage.getItem(fileKey)); } catch {}
    }
    if (previous && !previous.supplementSelected) previous.supplement = false;
    if (previous && previous.planEquipmentRevision !== 2 && /탑재|크레인/.test(plan?.demolition?.method || "")) {
      if (previous.equipment === "mounted") delete previous.equipment;
      if (previous.site === "tight" && !plan.demolition.site) delete previous.site;
    }
    const previousInputs = Object.fromEntries(projectFields.filter(key => previous?.[key] != null).map(key => [key, previous[key]]));
    Object.assign(state, { fileKey, plan, planExample, source: "ifc", model, elements: model.elements, fileName: name, overrides: {}, caseId: "",
      p: plan ? personalRates : { ...defaults },
      ...Object.fromEntries(caseFields.map((key) => [key, undefined])),
      uploadedPlanScope,
      areaConfirmed: Boolean(area || uploadedPlanScope?.area),
      area: area || uploadedPlanScope?.area || Math.round(model.gross.area * 100) / 100,
      floors: b?.floors_above ?? (model.aboveFloors || model.floors) });
    Object.assign(state, { ...defaultSiteInputs, structure: plan ? "unknown" : defaultSiteInputs.structure, height: b?.height_m, usage: b?.wasteUnit in rates.wasteUnits ? b.wasteUnit : inferIfcUsage(model.usage, name),
      labor: "quantity", supplement: false, seed: 1, useCalibration: false, calibrationType: "plan" },
      // 계획서의 현장·장비 조건은, 이 기능 이전에 저장된 값(기본값 "보통")보다 우선한다. 이후 사용자가 고친 값은 유지한다.
      conditions?.values, previousInputs,
      Object.fromEntries(["usage", "scope", "equipment", "site"].filter(key => uploadedPlanScope?.[key] != null).map(key => [key, uploadedPlanScope[key]])));
    if (conditions && !previous?.planApplied) Object.assign(state, conditions.values);
    if (previous && !previous.planConditionsRevision) {
      for (const key of ["structure", "scope"]) {
        if (previous[key] === defaultSiteInputs[key]) state[key] = conditions?.values[key] ?? "unknown";
      }
    }
    state.needsMountedProduction = conditions?.needsMountedProduction ?? false;
    state.planNotes = conditions?.notes ?? [];
    state.tab = "compare"; state.colorMode = "method";
  } catch (e) {
    if (version !== loadVersion) return;
    state.tab = "model";
    state.error = `IFC를 읽지 못했습니다: ${e.message}`;
  }
  state.busy = ""; sim = null; save(); render();
}

function modelTab(d) {
  const input = `
    <section class="card">
      <h2>1. 물량 입력</h2>
      <div class="drop" id="drop">
        <p><strong>Revit에서 내보낸 IFC 파일</strong>을 여기에 끌어 놓거나 고르세요. (Revit: 파일 › 내보내기 › IFC)</p>
        <div class="row no-print">
          <label class="btn btn-primary">IFC 파일 고르기<input type="file" id="file" accept=".ifc" hidden></label>
          <button class="btn btn-outline" data-act="sample">예시 모델 불러오기</button>
          <button class="btn btn-outline" data-act="area">IFC 없이 면적만으로 계산</button>
        </div>
        <p style="margin-top:8px"><strong>Revit 모델이 없으면</strong> 해체계획서의 구조도면을 옮긴 데이터(JSON)로 구조체 모델을 자동 생성합니다.</p>
        <div class="row no-print">
          <label class="btn btn-outline">계획서 데이터(JSON) 고르기<input type="file" id="planfile" accept=".json" hidden></label>
          <button class="btn btn-outline" data-act="plan-sample">계획서 예시 (가상 건물)</button>
          ${kalisCases.length ? `<select class="select" id="plancase" aria-label="국토안전관리원 해체계획서 사례">
            <option value="">국토안전관리원 사례 ${kalisCases.length}건</option>
            ${kalisCases.map(c => `<option value="${esc(c.file)}">${esc(c.label)} · ${esc(c.floors)} · ${num(c.area_m2)}㎡</option>`).join("")}
          </select>` : ""}
        </div>
        ${state.busy ? `<p class="badge badge-info">${esc(state.busy)}</p>` : ""}
        ${state.error ? `<p class="badge badge-danger">${esc(state.error)}</p>` : ""}
        <p class="caption muted">IFC 파일을 열 때마다 사이트 공통 기본값으로 계산합니다. 직접 수정한 값은 현재 분석에 적용됩니다.</p>
        ${state.source ? `<p class="caption muted">현재: ${state.source === "ifc" ? `IFC · ${esc(state.fileName)} · 부재 ${num(state.elements.length)}개 · ${state.model.floors}개 층` : "면적 × 표준품셈 원단위 (간이 계산)"}</p>` : ""}
      </div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field"><label>해체 대상 면적 (㎡)</label><input class="input" type="number" min="1" step="any" data-set="area" value="${state.area}">${state.source === "ifc" && !d?.openSteelFrame && state.model.gross.basis === "bbox" && !state.areaConfirmed ? '<button class="btn" data-act="confirm-area">현재 면적 확인</button>' : ""}</div>
        <div class="field"><label>지상 층수 (공기 계산용)</label><input class="input" type="number" min="1" step="1" data-set="floors" value="${state.floors}"></div>
        <div class="field"><label>용도·구조 (원단위 기준)</label><select class="select" data-set="usage">${Object.keys(rates.wasteUnits).map((u) => `<option ${u === state.usage ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        <div class="field"><label>대지 조건 (장비 구성)</label><select class="select" data-set="site">${Object.entries(SITES).map(([k, v]) => `<option value="${k}" ${k === state.site ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        ${state.source === "ifc" ? `<div class="field"><label>모델에 없는 내장재</label><label class="row"><input type="checkbox" data-set="supplement" ${d?.openSteelFrame ? "disabled" : state.supplement ? "checked" : ""}> ${d?.openSteelFrame ? "개방형 철골 · 보충 생략" : "원단위로 보충한다"}</label></div>` : ""}
      </div>
      <details id="site-details" style="margin-top:14px"><summary>현장 조건·자재 면적 입력</summary>
        <div class="field"><label>분별 추가 품 계산</label><select class="select" data-set="labor">${Object.entries(LABOR_METHODS).map(([k, v]) => `<option value="${k}" ${k === state.labor ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <p>기본 집계 대상은 파일의 전체 건축 부재입니다. 지상부를 선택하면 기초와 층 이름에서 식별된 지하 부재를 제외합니다. 부분 철거는 대상 부재만 내보낸 IFC를 사용하세요.</p>
        <div class="form-grid" style="margin-top:12px">
          ${numeric("height", "건물 높이 (m)")}
          <label class="field">구조체 <select class="select" data-set="structure">${opts({ unknown: "미확인", steel: "철골·철골 혼합 (절단·인양)", rc: "철근콘크리트", other: "기타·복합 구조" }, state.structure)}</select></label>
          <label class="field">해체 범위 <select class="select" data-set="scope">${opts(SCOPES, state.scope)}</select></label>
          <label class="field">장비 운용 방식 <select class="select" data-set="equipment">${opts(EQUIPMENT, state.equipment)}</select></label>
          <label class="field">가설 비계 <select class="select" data-set="scaffold">${opts({ yes: "비계공 투입", no: "비계공 0명" }, state.scaffold)}</select></label>
          <label class="field">굴착기 연동 살수·신호 배치 기간 <select class="select" data-set="equipmentCrewPeriod">${opts({ structure: "굴착기 가동시간 기준 (기본값)", all: "전체 작업일" }, state.equipmentCrewPeriod)}</select></label>
          ${state.equipment === "mixed" ? numeric("smallHours", "소형 1대 가동시간 (h)") + numeric("smallPrice", "소형 시간당 단가 (원/h)") + numeric("largeHours", "대형 1대 가동시간 (h)") + numeric("largePrice", "대형 시간당 단가 (원/h)") + numeric("concurrentHours", "확인된 동시 가동시간 (h, 기본 0)") : ""}
          ${(d?.q.steelWork || state.structure === "steel") ? (state.source === "area" ? numeric("steelTons", "확인된 구조용 강재 중량 (t, 원단위 강재 대체)") : "") + numeric("cutCommon", "양 공법 공통 철골 절단·인양 견적 (원)") + numeric("cutCrush", "압쇄안 개별 철골 견적 (원, 공통 견적 대체)") + numeric("cutSel", "분별안 개별 철골 견적 (원, 공통 견적 대체)") + `<p>공통 견적 한 건을 양쪽에 적용합니다. 공통 견적 없이 개별 견적을 넣을 때는 두 공법의 견적이 모두 있어야 반영합니다.</p>` : ""}
          <fieldset><legend>콘크리트 절단·인양 (와이어쏘 등)</legend>
          <p>해체계획이나 견적에 절단·인양이 있는 공법의 해당 콘크리트 부피를 입력하세요. 도급비에는 절단·인양 장비와 작업 인력을 포함합니다. 부피와 작업일수만 입력하면 손익분기 도급비를 계산합니다.</p>
          <p class="caption muted">전체 압쇄 물량(콘크리트+조적)에서 절단 물량이 차지하는 비율만큼 기존 굴착기 시간과 압쇄 공기를 차감합니다. 장비별 시간과 탑재 크레인 일수는 차감 전 값을 입력하세요. 절단·인양 일수는 순차 작업으로 더합니다.</p>
          ${concreteCutModes.map(([, label, suffix]) => `<h3>${label}안</h3><div class="form-grid">${numeric("rcCutVolume" + suffix, "절단·인양 콘크리트 (㎥)", { max: d?.q.concrete_m3 ?? "" })}${numeric("rcCutCost" + suffix, "절단·인양 도급 견적 (원)")}${numeric("rcCutDays" + suffix, "절단·인양 작업일수")}</div>`).join("")}
          </fieldset>
          ${numeric("craneDays", "탑재 해체 크레인 사용 일수")}
          ${numeric("groundFloors", "탑재 방식 · 지상 장비로 해체하는 하부 층수", { placeholder: `기본 ${state.p.mounted_ground_floors}개 층` })}
          ${numeric("mountedBucket", "탑재 굴착기 버킷 용량 (㎥)", { placeholder: "미입력 시 소형 장비 가정" })}
          ${numeric("parallelGain", "추가 굴착기 1대당 병렬 효율 (%)", { max: 100, placeholder: "기본 0%" })}
          ${numeric("overlap", "분별 추가 작업의 타 공정 병행률 (%)", { max: 100, placeholder: "기본 0%" })}
          ${numeric("mixedMineral", "혼합·기타 중 확인된 건설폐재류 (%)", { max: 100 })}
          ${numeric("mixedCombustible", "혼합·기타 중 확인된 가연물 (%)", { max: 100 })}
          <p>별도 반입 콘크리트에만 처리장 견적을 적용합니다. 나머지 폐콘크리트에만 공법별 배분을 적용합니다. 조적은 건설폐재류 단가를 적용합니다.</p>
          ${numeric("cleanCrush","압쇄 · 별도 반입 콘크리트 (%)",{max:100})}
          ${numeric("cleanSel","분별 · 별도 반입 콘크리트 (%)",{max:100})}
          ${numeric("cleanPrice","동일 반입 조건 처리장 견적 (원/t)")}
          <fieldset><legend>동관·폐전선 매각</legend>
          <p>매각이 확인된 중량을 입력하세요. 동관은 IFC에 이미 잡힌 구리량에 중복으로 더하지 않습니다. 전선은 피복을 포함한 별도 계근 중량을 입력합니다.</p>
          <div class="form-grid">${numeric("copperPipeSold", "동관 · 양 공법 공통 매각 (t)")}
          ${numeric("cableCommon", "폐전선 · 양 공법 공통 매각 (t)")}
          ${numeric("cablePrice", "폐전선 · 순매입 견적 (원/t)", { placeholder: num(state.p.price_waste_cable * 1000) })}</div>
          <details><summary>두 공법의 폐전선 매각량이 다른 경우</summary><div class="form-grid">${numeric("cableCrush", "압쇄 매각 (t, 공통값 대체)")}${numeric("cableSel", "분별 매각 (t, 공통값 대체)")}</div></details>
          <details><summary>설치 중량으로 매각량 추정</summary>
          <p>설비 도면이나 내역서로 확인한 설치 중량을 입력하면 단가 탭의 회수율 가정을 적용합니다. 매각량을 입력한 품목은 그 값을 우선 사용합니다.</p>
          <div class="form-grid">${numeric("pipeInstalled", "동관 설치 중량 (t)")}
          ${numeric("cableInstalled", "폐전선 설치 중량 (t, 피복 포함)")}</div>
          <label><input type="checkbox" data-set="officeMaterials" ${officeRecoveryEnabled() ? "checked" : ""}> 사무소 시나리오 · 입력이 없는 품목을 면적으로 추정</label>
          </details>
          </fieldset>
          ${numeric("selectiveEquipmentQuote", "분별 선철거·선별 추가 장비 견적 (원)", { placeholder: "별도 견적이 있을 때 입력" })}
          ${numeric("transportCrush", "일괄 압쇄 수집·운반 견적 (원, VAT 별도)")}
          ${numeric("transportSel", "전면 분별 수집·운반 견적 (원, VAT 별도)")}
          <p class="caption muted">현장에서 처리장까지 별도로 지불하는 수집·운반비만 입력하세요. 처리 견적에 포함된 운반비는 0원을 입력하고, 비용 자체를 모르면 비워두세요.</p>
          <fieldset><legend>창틀 회수 · 현장 확인값</legend>
          ${d?.q.windowMode ? `<p>${WINDOW_ASSUMPTION}. 주택의 재질 미확인 창틀은 PVC, 그 외는 알루미늄으로 추정합니다. 창호 유리는 혼합 반출합니다.</p>${numeric("glassPdPerM2","유리 철거 공수 (인·일/㎡)",{placeholder:"미입력 시 프로젝트 기본 창틀 품"})}` : ""}
          <p>유리·보강철을 제외한 프레임 중량을 입력하세요. 규격이 여러 개면 전체 순중량을 총 세트 수로 나눈 값을 사용하세요. 계근한 전체 중량은 1묶음으로 입력할 수 있습니다. 공법별 회수율이 같으면 같은 %를 입력하세요.</p>
          ${frameMaterials.map(([key,label]) => `<h3>${label} 창틀</h3><div class="form-grid">${numeric(key+"Count","세트 수")}${numeric(key+"Kg","세트당 순중량 (kg)")}${d?.q.windowMode ? (key === "al" ? "<p>알루미늄 창틀은 양 공법에서 전량 매각합니다.</p>" : "<p>PVC 창틀은 인수단가 입력 시 양 공법에 전량 적용합니다.</p>") : numeric(key+"Crush","압쇄 회수율 (%)",{max:100}) + numeric(key+"Sel","분별 회수율 (%)",{max:100})}${numeric(key+"Price",key === "pvc" ? "인수단가 (원/kg, 매각 + · 무상 0 · 처리비 −)" : "매입단가 (원/kg)", key === "al" && state.source === "ifc" ? {placeholder: "미입력 시 단가 탭 알루미늄 단가"} : key === "pvc" ? { placeholder: "문헌 참고 " + num(state.p.price_pvc_reference) + "원/kg" } : {})}</div>`).join("")}
          <p>현장 물량은 식별된 IFC 창틀 물량을 대체합니다. 원단위 추정량에는 확인한 창틀이 포함된 것으로 계산합니다. 철거 공수는 작업량 방식의 창틀 면적과 일반해체 공수로 계산합니다.</p></fieldset>
          ${numeric("panelTons", "폐샌드위치패널 확인 중량 (t)")}
          ${(state.source === "ifc" || state.labor === "quantity") ? [
            numeric("boardM2", "보드 면적 (㎡)", { placeholder: "IFC 또는 면적비" }),
            numeric("tileM2", "타일 면적 (㎡)", { placeholder: "IFC 또는 면적비" }),
            numeric("pvcM2", "PVC 창틀 면적 (㎡)", { placeholder: "IFC 또는 면적비" }),
            numeric("alM2", "알루미늄 창틀 면적 (㎡)", { placeholder: "IFC 또는 면적비" }),
            numeric("carpenterShare","추가 공수 중 목공 (%)",{max:100}),
            numeric("generalFinishPd", "동일 범위의 일반해체 공수 (인·일)", { placeholder: "기본: 내부 철거 공수 차감" }),
          ].join("") : ""}
        </div>
        <p class="caption muted" style="margin-top:8px">비율 합계에서 남는 혼합·기타 물량은 성상 미확인으로 계산합니다. 높이는 비교 기록에 쓰입니다. 장비 방식은 현장 조건에 맞춰 지정하세요. 작업량 방식의 공란 면적은 식별된 IFC 물량 또는 면적비를 사용합니다.</p>
      </details>
      ${state.formError ? `<p class="badge badge-danger">${esc(state.formError)}</p>` : ""}
      ${state.source === "ifc" ? `<p class="caption muted" style="margin-top:8px">연면적과 층수는 모델에서 읽어 넣어 두었습니다. 연면적은 ${state.model?.gross?.basis === "slab" ? "바닥 슬래브 면적의 합" : "모델에 바닥 슬래브가 없어 외곽 크기 × 층수로 잡은 값(실제보다 클 수 있음)"}, 층수는 층 이름에서 식별한 지하·옥상 레벨을 제외해 추정합니다. 실제 값과 다르면 고치세요.${state.model?.lengthScale && state.model.lengthScale !== 1 ? ` 이 파일의 길이 단위는 ${state.model.lengthScale === 0.001 ? "mm" : `${state.model.lengthScale} m`}이며 m로 바꿔 계산했습니다.` : ""}</p>` : ""}
      ${state.planNotes?.length ? `<p class="caption muted">계획서에서 가져온 현장 조건: ${esc(state.planNotes.map(note => note.replace(/\.+$/, "")).join(" · "))}. 실제와 다르면 현장 조건·자재 면적 입력에서 고치세요.</p>` : ""}
      ${state.source === "ifc" && state.model?.volumeCheck ? (({ qto, mesh, medianDiff, over10 }) => `<p class="caption muted">부재 부피: IFC 수량(Qto) ${num(qto)}개 · 형상 계산 ${num(mesh)}개.${qto && medianDiff != null ? ` Qto와 형상 부피 차이 중앙값 ${num(medianDiff * 100, 1)}%${over10 ? `, 10% 넘게 다른 부재 ${num(over10)}개 (Qto 값을 사용)` : ""}.` : ""}${!qto ? " Revit 내보내기에서 \"기본 수량 내보내기(Export base quantities)\"를 켜면 Revit이 계산한 부피를 씁니다." : ""}</p>`)(state.model.volumeCheck) : ""}
    </section>`;
  if (!d) return input;

  const { q, classified } = d;
  const total = STREAMS.reduce((s, k) => s + q.t[k], 0);
  // 비교 계산과 같은 기준: 콘크리트 톤수에서 추정 철근을 빼서 철근·강재 행에 넣는다
  const { t: shown, rebar, rebarAdded } = streamTons(q, state.p);
  const units = rates.wasteUnits[state.usage];
  const check = state.source === "ifc" && !d.openSteelFrame
    ? checkAgainstUnits({ ...q.raw, rebarKgPerM3: q.rebarKgPerM3 }, state.usage, rates, state.p.rebar_kg_per_m3) : [];
  const off = check.filter(c => !c.estimatedRebarTons && (c.ratio < 0.5 || c.ratio > 2));
  const estimatedMetal = check.find(c => c.estimatedRebarTons > 0);
  const streamRows = STREAMS.filter((s) => shown[s] > 0).map((s) => {
    const added = q.added[s] || 0, u = units[s];
    const label = s === "metal" && rebarAdded > 0 ? `${STREAM_LABEL[s]} <span class="muted">(철근 추정 ${num(rebarAdded, 1)}t 포함)</span>` : s === "concrete" && rebar > 0 ? `${STREAM_LABEL[s]} <span class="muted">(철근 제외)</span>` : STREAM_LABEL[s];
    return `<tr><td><i class="dot" style="background:${STREAM_COLOR[s]}"></i> ${label}</td>
      <td class="r">${num(shown[s] - added, 1)}</td><td class="r">${added ? num(added, 1) : "–"}</td><td class="r">${num(shown[s], 1)}</td>
      <td class="r">${num(shown[s] / q.area_m2, 4)}</td><td class="r">${u != null ? num(u, 4) : s === "masonry" ? "별도 원단위 없음" : "–"}</td>
      <td>${SEPARATED.has(s) ? '<span class="badge badge-success">분별 대상</span>' : ""}</td></tr>`;
  }).join("");

  let groups = "";
  if (state.source === "ifc") {
    const g = new Map();
    for (const el of classified) {
      const k = groupKey(el), x = g.get(k) || { el, n: 0, tons: 0, guessed: false };
      x.n++; x.tons += el.tons; x.guessed ||= el.guessed;
      x.missingWeight ||= el.parts.some(part => part.stream === "panel" && !(part.tons > 0));
      g.set(k, x);
    }
    groups = `<section class="card"><h2>부재 그룹별 성상</h2>
      <p class="lead" style="margin-bottom:12px">재료 이름으로 성상을 자동 분류했습니다. 틀린 곳은 직접 고치세요. <span class="badge badge-warning">추정</span>은 재료 이름으로 알 수 없어 부재 종류로 정한 것입니다.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>부재</th><th>재료 (IFC)</th><th class="r">개수</th><th class="r">톤</th><th>성상</th></tr></thead><tbody>
      ${[...g].sort((a, b) => b[1].tons - a[1].tons).map(([k, x]) => `<tr><td>${CATEGORY_LABEL[x.el.category]}</td><td>${esc(x.el.layers.map((l) => l.name).join(" + ") || "(재료 없음)")} ${x.guessed ? `<span class="badge badge-warning">${x.el.guessedConcreteTread ? "콘크리트 추정" : x.el.category === "window" ? "창틀 기본 재질 적용" : "추정"}</span>` : ""}</td>
        <td class="r">${num(x.n)}</td><td class="r">${x.missingWeight ? `${x.tons > 0 ? num(x.tons, 2) + " + " : ""}중량 미확인` : num(x.tons, 2)}</td>
        <td><select class="select sm" data-override="${esc(k)}"><option value="">자동 (${x.el.parts.length > 1 && !state.overrides[k] ? "층별" : STREAM_LABEL[x.el.stream]})</option>${[...STREAMS, "excluded"].map((s) => `<option value="${s}" ${state.overrides[k] === s ? "selected" : ""}>${STREAM_LABEL[s]}</option>`).join("")}</select></td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  return `${input}
    <section class="kpis">
      <div class="card kpi"><div class="v">${num(total)} t</div><div class="l">예상 폐기물·자재 총량</div></div>
      <div class="card kpi"><div class="v">${num(total / q.area_m2, 3)}</div><div class="l">t/㎡ (원단위 합계 ${num(Object.values(units).reduce((a, b) => a + b, 0), 3)})</div></div>
      <div class="card kpi"><div class="v">${num(q.concrete_m3)} ㎥</div><div class="l">구조체 콘크리트 부피</div></div>
      <div class="card kpi"><div class="v">${num(STREAMS.filter((s) => SEPARATED.has(s)).reduce((s, k) => s + q.t[k], 0), 1)} t</div><div class="l">분별 대상 물량</div></div>
    </section>
    ${off.length ? `<div class="disclaimer"><div><strong>원단위 검산:</strong> ${off.map((c) => `${STREAM_LABEL[c.stream]} ${num(c.ratio * 100)}%`).join(", ")} — 모델 물량이 표준품셈 원단위와 2배 이상 차이 납니다. 모델에 해당 자재가 빠졌거나 분류가 틀렸을 수 있습니다.${state.supplement ? " 목재·합성수지·혼합폐기물의 부족분은 원단위로 채웠습니다." : ""}</div></div>` : ""}
    ${estimatedMetal ? `<p class="caption muted">철근·강재 원단위 검산은 철근 추정분 ${num(estimatedMetal.estimatedRebarTons, 2)}t을 포함한 참고값입니다. ${num(estimatedMetal.model, 4)}t/㎡ · 원단위 ${num(estimatedMetal.unit, 4)}t/㎡.</p>` : ""}
    ${(() => { const ex = classified.filter((e) => e.stream === "excluded"); return ex.length ? `<p class="caption muted">기타 객체 ${num(ex.length)}개(가구·가전·위생기구·조경 등, 모델 값 ${num(ex.reduce((a, e) => a + e.tons, 0))} t)는 건물 부재가 아니고 부피를 믿기 어려워 물량에서 뺐습니다. 넣으려면 아래 부재 그룹 표에서 성상을 고르세요.</p>` : ""; })()}
    ${planCard(q)}
    ${state.source === "ifc" ? `<section class="card"><h2>3D 모델</h2>${viewerBox()}</section>` : ""}
    <section class="card"><h2>성상별 물량</h2>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>성상</th><th class="r">${state.source === "ifc" ? "모델 (t)" : "원단위 (t)"}</th><th class="r">보충 (t)</th><th class="r">합계 (t)</th><th class="r">t/㎡</th><th class="r">표준품셈 원단위</th><th></th></tr></thead>
      <tbody>${streamRows}</tbody><tfoot><tr><td>합계</td><td></td><td></td><td class="r">${num(total, 1)}</td><td class="r">${num(total / q.area_m2, 4)}</td><td></td><td></td></tr></tfoot></table></div>
      ${q.rebarFromConcrete ? `<p class="caption muted" style="margin-top:8px">${q.rebarModeledTons > 0 ? `모델에 그린 철근 ${num(q.rebarModeledTons, 1)}t을 쓰고, 콘크리트 1㎥당 ${num(q.rebarKgPerM3 ?? state.p.rebar_kg_per_m3)}kg 기준 추정량에 모자란 ${num(rebarAdded, 1)}t만 더합니다.` : `철근은 모델에 없어 콘크리트 1㎥당 ${num(q.rebarKgPerM3 ?? state.p.rebar_kg_per_m3)}kg으로 추정해 고철 수익에 넣습니다 (약 ${num(rebar, 1)} t).`} 콘크리트 톤수는 철근콘크리트 단위질량 2.4t/㎥로 계산했으므로, 같은 무게를 폐콘크리트에서 빼고 처리비를 계산합니다.${q.masonry_m3 > 0 ? ` 조적 ${num(q.masonry_m3, 1)}㎥도 압쇄 장비 시간과 구조체 공기에 넣습니다.` : ""}</p>` : ""}
    </section>
    ${groups}`;
}

// 계획서에서 만든 모델이면 계획서 내용과 검산 결과를 보여준다
function planCard(q) {
  const plan = state.plan;
  if (!plan || state.source !== "ifc") return "";
  const b = plan.building, d = plan.demolition || {}, model = (q.raw || q).t.concrete, want = plan.check?.waste_concrete_t;
  const assumed = Object.entries(plan.sections).filter(([, s]) => s.assumed).map(([k]) => k);
  return `<section class="card"><h2>해체계획서에서 읽은 정보</h2>
    ${planExampleNotice()}
    <div class="table-wrap"><table class="tbl"><tbody>
      <tr><th>건물</th><td>${esc(b.name)} · ${esc(b.usage)} · ${esc(b.structure)}${b.built ? ` · ${esc(b.built)}년` : ""} · 지하 ${esc(b.floors_below)} / 지상 ${esc(b.floors_above)}층</td></tr>
      <tr><th>면적</th><td>연면적 ${num(b.area_m2, 1)}㎡ · 해체 연면적 ${num(b.demolition_area_m2, 2)}㎡</td></tr>
      <tr><th>해체</th><td>${esc(d.scope || "–")} · ${esc(d.method || "–")}${d.period ? ` · ${esc(d.period.join(" ~ "))}` : ""}</td></tr>
      <tr><th>재료</th><td>콘크리트 ${esc(plan.materials?.concrete_fck_MPa ?? "–")}MPa · 철근 ${esc(plan.materials?.rebar_fy_MPa ?? "–")}MPa · 철근량 ${esc(plan.rebar_kg_per_m3?.value ?? "–")}kg/㎥ ${esc(plan.rebar_kg_per_m3?.note)}</td></tr>
      <tr><th>유해물질</th><td>석면 ${plan.hazards?.asbestos === true ? "검출" : plan.hazards?.asbestos === false ? "자료상 미검출" : "미확인"} ${esc(plan.hazards?.note)}</td></tr>
      <tr><th>부재</th><td class="mono">${esc(Object.entries(plan.sections).map(([k, s]) => `${k} ${s.t ? "T" + s.t : s.b + "×" + s.h}${s.material ? " " + s.material : ""}`).join(" · "))}</td></tr>
      ${plan.source?.document ? `<tr><th>출처</th><td>${esc(plan.source.document)} ${esc(plan.source.pages)}</td></tr>` : ""}
    </tbody></table></div>
    ${want ? `<p style="margin-top:12px"><strong>검산:</strong> 생성한 모델의 콘크리트 ${num(model)}t ÷ 계획서 폐콘크리트 약 ${num(want)}t = <strong>${num((model / want) * 100)}%</strong>. 물량 비교에는 부재 포함 범위와 산출 기준의 차이가 있을 수 있습니다.</p>` : ""}
    <p class="caption muted" style="margin-top:8px">계획서 데이터에 입력된 부재의 물량을 집계합니다. 원단위 보충을 켜면 모델에 빠진 일부 폐기물량을 추정합니다.${assumed.length ? ` 치수를 가정한 부재: ${esc(assumed.join(", "))}.` : ""} ${esc(plan.source?.note || "")}</p>
  </section>`;
}

function viewerBox() {
  const items = state.colorMode === "stream" ? STREAMS.map((s) => [STREAM_LABEL[s], STREAM_COLOR[s]]) : [["분별해체 대상", METHOD_COLOR.분별], ["구조체와 함께 압쇄 (반투명)", METHOD_COLOR.압쇄]];
  return `<div class="viewer" id="viewer"><div class="modes no-print">
      <button class="btn btn-sm ${state.colorMode === "stream" ? "btn-secondary" : "btn-outline"}" data-color="stream">성상별</button>
      <button class="btn btn-sm ${state.colorMode === "method" ? "btn-secondary" : "btn-outline"}" data-color="method">분별 / 압쇄</button>
    </div><div class="pick" id="pick">부재를 누르면 정보가 나옵니다. 끌어서 돌리고, 휠로 확대합니다.</div></div>${legend(items)}`;
}

async function mountViewer(d) {
  viewer?.dispose(); viewer = null;
  const box = $("#viewer");
  if (!box || !state.model) return;
  const byId = new Map(d.classified.map((e) => [e.expressID, e]));
  const color = (id) => { const e = byId.get(id); if (!e) return null; if (state.colorMode === "stream") return STREAM_COLOR[e.stream]; return SEPARATED.has(e.stream) ? METHOD_COLOR.분별 : [METHOD_COLOR.압쇄, 0.06]; }; // 압쇄 대상은 비쳐 보이게 해서 안쪽 내장재가 드러난다
  const { createViewer } = await import("./viewer3d.js");
  viewer = createViewer(box, state.model, color, (id) => {
    const e = byId.get(id);
    $("#pick").innerHTML = e ? `<strong>${CATEGORY_LABEL[e.category]}</strong> ${esc(e.name)} · ${e.floor}층 · ${num(e.tons, 3)} t · ${STREAM_LABEL[e.stream]} · ${SEPARATED.has(e.stream) ? "분별" : "압쇄"}<br><span class="muted">${esc(e.layers.map((l) => l.name).join(" + ") || "재료 없음")} · Revit ID ${esc(e.tag || "–")}</span>` : "부재를 누르면 정보가 나옵니다.";
  });
}

/* ---------------- 단가 ---------------- */
function ratesTab() {
  const r = paperMode(paper), ok = r.delta === paper.expected.delta;
  let last = "", rows = "";
  for (const [k, v] of Object.entries(rates.params)) {
    if (v.legacy) continue;
    if (v.group !== last) { rows += `<tr class="grp"><td colspan="5">${v.group}</td></tr>`; last = v.group; }
    const changed = state.p[k] !== v.value;
    const shown = v.optional && state.p[k] < 0 ? "" : state.p[k];
    rows += `<tr><td>${esc(v.label)} ${v.assumed ? '<span class="badge badge-warning">가정</span>' : ""} ${changed ? '<span class="badge badge-info">수정됨</span>' : ""}</td>
      <td class="r"><input class="input sm" type="number" step="any" data-p="${k}" value="${shown}" ${v.locked ? "disabled" : ""} ${v.optional ? 'placeholder="미확인"' : ""}></td><td>${v.unit}</td>
      <td class="muted">${v.min != null ? `${num(v.min, v.min < 1 ? 5 : v.min < 10 ? 2 : 0)} ~ ${num(v.max, v.min < 1 ? 5 : v.min < 10 ? 2 : 0)}${v.sample === false ? " (대안 비교용)" : ""}` : "–"}</td>
      <td class="muted">${esc(rates.sources[v.source] || "프로젝트 기본값")}${v.date ? ` · ${v.date}` : ""}${v.ref ? `<br><small>${esc(v.ref)}</small>` : ""}</td></tr>`;
  }
  return `<section class="card"><div class="row" style="justify-content:space-between"><h2>단가·품·회수율</h2><button class="btn btn-outline btn-sm no-print" data-act="reset">기본값으로 되돌리기</button></div>
      <p class="lead" style="margin-bottom:12px">값을 고치면 비교 결과가 바로 다시 계산됩니다. 확률 분석은 계산 범위가 있는 항목을 변화시킵니다. 대안 비교용 값과 서로 다른 조건의 공고 단가는 별도로 비교합니다.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="r">값</th><th>단위</th><th>범위 (최소 ~ 최대)</th><th>출처 · 기준</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    <section class="card"><h2>엔진 검증: 기준 논문 재현 <span class="badge ${ok ? "badge-success" : "badge-danger"}">${ok ? "일치" : "불일치"}</span></h2>
      <p class="lead" style="margin-bottom:12px">${esc(rates.sources.paper)}의 5층 공동주택 2,400㎡ 사례를 같은 식으로 계산한 결과입니다 (단위: 천원).</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="r">일반 해체</th><th class="r">분별 해체</th><th class="r">논문 값</th></tr></thead><tbody>
        <tr><td>시공비</td><td class="r">${num(r.construction[0])}</td><td class="r">${num(r.construction[1])}</td><td class="r">${paper.expected.construction.map((x) => num(x)).join(" / ")}</td></tr>
        <tr><td>폐기물 처리비</td><td class="r">${num(r.disposal[0])}</td><td class="r">${num(r.disposal[1])}</td><td class="r">${paper.expected.disposal.map((x) => num(x)).join(" / ")}</td></tr>
        <tr><td>재활용 수익</td><td class="r">–</td><td class="r">${num(r.revenue)}</td><td class="r">${num(paper.expected.revenue)}</td></tr>
        </tbody><tfoot><tr><td>Δ (분별 − 일반)</td><td></td><td class="r">${num(r.delta)}</td><td class="r">${num(paper.expected.delta)}</td></tr></tfoot></table></div>
      <p class="caption muted" style="margin-top:8px">논문은 재활용 수익을 제품 판매가(합판 4,000원/장, 그래뉼 850천원/t)로 잡았습니다. 이 프로그램의 비교는 폐자재 매각가를 기본으로 씁니다.</p>
    </section>`;
}

/* ---------------- 비교 ---------------- */
function planExampleNotice() {
  if (!state.planExample) return "";
  const scope = state.plan.demolition?.scope;
  return `<div class="disclaimer"><div><strong>도면 기반 추정 모델</strong> · ${esc(scope)}
    <br>도면에서 판독하거나 가정한 치수를 사용했습니다. 실측 물량과 공사비를 확인하려면 별도 자료가 필요합니다.
    ${state.planExample.costNote ? `<br>${esc(state.planExample.costNote)}` : ""}
    ${state.plan.hazards?.asbestos === true ? "<br>계획서에 석면이 기록되어 있습니다. 석면 조사·제거·처리 비용은 비교 합계에서 제외됩니다." : ""}
  </div></div>`;
}

function planLimitNotice(d) {
  return `<section class="card"><h2>경제성 산정 보류</h2><p>${esc(state.fileName)}</p>
    ${planExampleNotice()}<p>${esc(d.comparisonLimit)}</p>
    <button class="btn btn-outline" data-tab="model">현장 조건·모델 물량 보기</button></section>`;
}

function openSteelNotice(d) {
  const { openSteelCrushQuote: crush, openSteelSelectiveQuote: selective, openSteelCrushDays: crushDays, openSteelSelectiveDays: selectiveDays } = state;
  const ready = crush != null && selective != null;
  const delta = ready ? selective - crush : null;
  const p = state.p;
  const crushMaterials = costScenario(d.q, p, "crush").rows.filter(row => row.group === "처리비" || row.group === "매각수익");
  const concreteNames = new Set([...concreteGrades(p, false, d.q.concreteCase).map(grade => grade.name), "별도 반입 콘크리트 (현장 견적)"]);
  const selectiveConcrete = costScenario(d.q, p, "selective").rows.filter(row => row.group === "처리비" && concreteNames.has(row.item));
  const selectiveMaterials = [...crushMaterials.filter(row => row.group !== "처리비" || !concreteNames.has(row.item)), ...selectiveConcrete];
  const byItem = rows => new Map(rows.map(row => [row.item, row]));
  const crushRows = byItem(crushMaterials), selectiveRows = byItem(selectiveMaterials);
  const names = new Set([...crushRows.keys(), ...selectiveRows.keys()]);
  const amountCell = value => '<td class="r">' + num(value) + '원</td>';
  const materialCell = row => row ? '<td class="r">' + num(row.qty, 2) + ' ' + row.unit + ' · ' + num(row.amount) + '원</td>' : '<td class="r">–</td>';
  const net = rows => rows.reduce((sum, row) => sum + row.amount, 0);
  return `<section class="card"><h2>개방형 철골 · IFC 비용 비교</h2>
    <p>${esc(state.fileName)} · IFC 강재 ${num(d.q.t.metal, 2)}t · 콘크리트 ${num(d.q.t.concrete, 2)}t · 합성수지 ${num(d.q.t.resin, 2)}t</p>
    ${d.q.panelWeightMissing ? '<p class="caption muted">부속 샌드위치패널 중량 미확인 · 견적에 철거와 처리 범위를 확인하세요.</p>' : ""}
    <p class="verdict">IFC 물량 기준으로 폐콘크리트 처리비와 매각수익을 비교합니다.</p>
    <p class="caption muted">폐콘크리트 성상은 압쇄 ${concreteGradeLabel(d.q, p, false)}%, 분별 ${concreteGradeLabel(d.q, p, true)}%를 적용합니다. 구조용 철골 회수율은 공통입니다. 고철 수익에는 기초 콘크리트에서 추정한 철근 회수분도 포함합니다. 철골 절단·인양비, 현장 인건비와 운반비는 아래 현장 순견적에 포함해 비교할 수 있습니다.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>IFC 물량 기준</th><th class="r">일반해체</th><th class="r">분별해체</th></tr></thead><tbody>
    ${[...names].map(name => "<tr><td>" + esc(name) + "</td>" + materialCell(crushRows.get(name)) + materialCell(selectiveRows.get(name)) + "</tr>").join("")}
    </tbody><tfoot><tr><td>처리비 − 매각수익</td>${amountCell(net(crushMaterials))}${amountCell(net(selectiveMaterials))}</tr></tfoot></table></div>
    <details ${crush != null || selective != null || crushDays != null || selectiveDays != null ? "open" : ""}><summary>현장 순견적과 작업일 비교</summary>
    <p>철골 절단·인양, 마감재 철거, 반출·처리까지 같은 범위의 총견적에서 고철 매각대금을 뺀 금액을 입력하세요.</p>
    <div class="form-grid">
      ${numeric("openSteelCrushQuote", "일반해체 순견적 (원)")}
      ${numeric("openSteelSelectiveQuote", "분별해체 순견적 (원)")}
      ${numeric("openSteelCrushDays", "일반해체 작업일수 (선택)")}
      ${numeric("openSteelSelectiveDays", "분별해체 작업일수 (선택)")}
    </div>
    ${state.formError ? `<p class="badge badge-danger">${esc(state.formError)}</p>` : ""}
    ${ready ? `<p class="verdict">${delta === 0 ? "두 해체안의 순견적이 같습니다." : (delta < 0 ? "분별해체" : "일반해체") + " 순견적이 " + num(Math.abs(delta)) + "원 낮습니다."}</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="r">일반해체</th><th class="r">분별해체</th></tr></thead><tbody>
      <tr><td>순견적</td><td class="r">${num(crush)}원</td><td class="r">${num(selective)}원</td></tr>
      <tr><td>예정 작업일수</td><td class="r">${crushDays == null ? "미입력" : num(crushDays, 1) + "일"}</td><td class="r">${selectiveDays == null ? "미입력" : num(selectiveDays, 1) + "일"}</td></tr>
      </tbody></table></div>` : '<p class="caption muted">두 순견적을 입력하면 전체 공사비 차이가 표시됩니다.</p>'}
    </details>
    <button class="btn btn-outline" data-tab="model">IFC 물량 보기</button></section>`;
}


function concreteGradeLabel(q, p, selective) {
  return concreteGrades(p, selective, q.concreteCase, q)
    .map(grade => num(grade.share * 100, 1)).join(" / ");
}

function concreteGradeBasis(q, p) {
  if (q.concreteCase !== "linked") return "고정 성상 가정";
  const link = concreteGradeLink(q, p);
  if (link.status === "missing-finish") return "마감 물량 미확인 · 추가 성상 개선 미반영";
  if (link.status === "no-concrete") return "적용할 폐콘크리트 물량 없음";
  return `04 아파트 보정 모델 · 현장 자료 미검증 · 추가 선철거 ${num(link.extraTons, 2)}t · 기준 대비 개선 ${num(link.factor * 100, 1)}%`;
}

function estimateAssumptions(q, p) {
  const office = officeSalvage(q, p);
  const rows = [
    ["미회수 철근", `폐콘크리트와 함께 반출 · ${num(p.fee_concrete)}원/t`],
    ["동관 매각", `${num((office?.estimatePipe ? office.pipeKg * office.pipeRate / 1000 : q.copperPipeSold) ?? 0, 3)}t ${office?.estimatePipe ? "(추정) " : ""}· 양 공법 공통 · ${num(p.price_copper_pipe)}원/kg. IFC 구리 집계 ${num(q.copperModeledTons ?? 0, 3)}t`],
    ["폐전선 매각", `압쇄 ${num((office?.estimateCable ? office.cableKg * office.cableCrushRate / 1000 : q.cableCrush ?? q.cableCommon) ?? 0, 3)}t · 분별 ${num((office?.estimateCable ? office.cableKg * office.cableSelectiveRate / 1000 : q.cableSel ?? q.cableCommon) ?? 0, 3)}t ${office?.estimateCable ? "(추정)" : ""} · 피복 포함 ${num(q.cablePrice == null ? p.price_waste_cable : q.cablePrice / 1000)}원/kg`],
    ["미회수 기타 금속", `혼합 반출 · ${num(p.fee_mixed_unverified)}원/t`],
    ["폐콘크리트 성상 배분", `${concreteGradeBasis(q, p)} · 압쇄 ${concreteGradeLabel(q, p, false)}% · 분별 ${concreteGradeLabel(q, p, true)}% (순수 / 가연물 제거 / 가연물 5% 이하). 별도 반입 견적 적용분은 이 배분에서 제외.`],
    ["보드·타일 공통 선철거", q.labor === "quantity" ? "보드 60%, 타일 100%" : "논문 차이 품 적용"],
    ["운반비", q.transportCrush == null || q.transportSel == null ? "두 공법 0원 가정" : "현장 견적 적용"],
    ["탑재 장비", equipmentMode(q) === "mounted"
      ? `${num((q.mountedBucket != null ? q.mountedBucket > 0.3 : q.mountedLarge) ? p.crush_m3_per_day : p.crush_m3_per_day_small, 1)}㎥/일${q.mountedBucket == null ? (q.mountedLarge ? " (32톤급, 대형 가정)" : " (프로젝트 기본 소형 장비)") : ` (버킷 ${q.mountedBucket}㎥)`}`
      : "지상 장비 적용"],
  ];
  if (q.finishTakeoff) {
    rows.push(["보드·타일 면적 및 중량", Object.entries(q.finishTakeoff).map(([key, item]) =>
      `${STREAM_LABEL[key]} ${item.unverified ? "확인된 면적·중량 미입력" : `${num(item.area, 1)}㎡${item.estimatedArea ? " (환산·추정)" : ""} / ${num(item.tons, 2)}t${item.estimatedWeight ? " (면적·가정 두께·밀도 추정)" : ""}`}`).join(" · ")]);
    rows.push(["마감재 반출", `분리 견적 미입력분과 콘크리트 동반량 미확인분은 혼합 반출(프로젝트 가정). 기존 미분류 혼합잔재 중 ${num(q.finishMixedReallocated, 2)}t를 마감재로 재분류.`]);
  }
  if (office?.estimatePipe || office?.estimateCable) rows.push(["설비 회수 추정", "프로젝트 가정. 미회수분 반출 경로 미확인으로 별도 처리비 미산정. 전선 인발·선별 추가 공수 미산정."]);
  if (!concreteCutModes.some(([mode]) => concreteCut(q, mode).active)) rows.push(["골조 해체 장비", "분별안은 내·외장재 선철거 후 압쇄안과 같은 굴착기·압쇄기를 사용한다고 가정"]);
  for (const [mode, label] of concreteCutModes) {
    const cut = concreteCut(q, mode);
    if (cut.active && cut.ready) rows.push([`${label}안 콘크리트 절단·인양`,
      `${num(cut.volume, 2)}㎥ 압쇄 대체 · ${cut.quoteMissing ? "도급 견적 미입력" : "도급비 " + num(cut.cost) + "원"} · 순차 작업 ${num(cut.days, 1)}일`]);
  }
  if (q.steelWork) {
    const steel = steelDismantling(q);
    rows.push(["철골 절단·인양", steel.excluded ? "공통 철골비 별도 · 비용 차이 산정에서 제외" : `압쇄 ${num(steel.crush)}원 · 분별 ${num(steel.selective)}원`],
      ["구조용 철골 회수율", `${num(p.rec_structural_steel * 100, 1)}% · 양 공법 공통, RC 내부 철근은 공법별 회수율`],
      ["철골 작업 기간", "철골 절단·인양 기간 제외"]);
  }
  if (!q.steelWork && (q.cutCrush != null || q.cutSel != null)) rows.push(["철골 견적 반영", "철골 작업 조건이 적용되지 않아 입력 견적은 양쪽 0원 반영"]);
  if (q.overlappingTreads) rows.push(["계단 형상 중복 가능", `디딤판 ${q.overlappingTreads}개가 계단 본체 경계 안에 있습니다. 수량을 확인하세요.`]);
  if (q.windowMode) rows.push(
    ["창틀", WINDOW_ASSUMPTION + ` · 공통 공수 적용, 알루미늄 ${num(q.alPrice == null ? p.price_aluminum : q.alPrice * 1000)}원/t 전량 매각`],
    ["창틀 기본 재질", "단독·공동주택은 PVC, 그 외는 알루미늄. IFC 재질 정보 우선"],
    ["PVC 창틀", q.pvcPrice == null ? `혼합 반출 · 문헌 인수 참고가 ${num(p.price_pvc_reference)}원/kg` : `인수 견적 ${num(q.pvcPrice)}원/kg`],
    ["창호 유리", `함께 선철거 후 혼합 반출 · ${num(p.fee_mixed_unverified)}원/t, 유리 공수 ${num(q.glassPdPerM2 ?? p.window_frame_pd_per_m2, 5)}인·일/㎡${q.glassPdPerM2 == null ? " (창틀 품 준용 가정)" : ""}`],
    ["재료 없는 계단 디딤판", "콘크리트 추정 · 2.4t/㎥"],
  );
  return rows;
}

function breakEvenBoardShare(q, p) {
  if (q.labor !== "quantity") return null;
  const delta = board => compare({ ...q, finishBaseline: { ...PRESS_FINISH_BASELINE, board } }, p).delta;
  let low = 0, high = 1;
  const initial = delta(low), final = delta(high);
  if (Math.abs(initial - final) < 0.01 || initial * final > 0) return null;
  if (initial === 0) return low;
  if (final === 0) return high;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (Math.sign(delta(middle)) === Math.sign(initial)) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function officeRecoveryEnabled() {
  return state.officeMaterials === true;
}

function officeSalvageReference(q, p) {
  const recovery = officeSalvage(q, p);
  if (!recovery) return null;
  const { pipeKg, cableKg } = recovery;
  const cablePrice = q.cablePrice == null ? p.price_waste_cable : q.cablePrice / 1000;
  return { ...recovery, pipe_kg: pipeKg, cable_kg: cableKg, pipe_won: pipeKg * p.price_copper_pipe, cable_won: cableKg * cablePrice };
}

function officeSalvageCard(q, p, delta) {
  const reference = officeSalvageReference(q, p);
  if (!reference) return "";
  const { pipe_kg, cable_kg, pipe_won, cable_won } = reference;
  return `<section class="card"><h2>동관·폐전선 회수 가정</h2>
    <p>설치량과 전량 매각 참고액입니다. 견적 내역에는 회수율을 적용한 매각량을 사용합니다.</p>
    <p class="caption muted">동관 ${reference.estimatePipe ? num(reference.pipeRate * 100, 1) + "% 공통 회수" : q.copperPipeSold != null ? "확인된 매각량 적용" : "매각량 미확인"} · 피복 전선 ${reference.estimateCable ? "압쇄 " + num(reference.cableCrushRate * 100, 1) + "%, 분별 " + num(reference.cableSelectiveRate * 100, 1) + "%" : q.cableCommon != null || q.cableCrush != null || q.cableSel != null ? "확인된 매각량 적용" : "매각량 미확인"}</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>품목</th><th>설치량 근거</th><th class="r">설치 중량</th><th class="r">참고 금액</th></tr></thead><tbody>
      <tr><td>동관</td><td>${reference.pipeInstalled ? "현장 설치 중량 입력" : q.officeRecovery ? ` ${num(p.office_pipe_kg_per_m2, 2)}kg/㎡ · <a href="https://www.pankowfoundation.org/site/assets/files/2034/4lcaofmechanicalelectricalandplumbinginofficebuildingsfinalreport.pdf">미국 CLF(2019), 표 7</a>` : "미입력"}</td><td class="r">${num(pipe_kg, 1)}kg</td><td class="r">${mil(pipe_won, 2)}백만원</td></tr>
      <tr><td>폐전선</td><td>${reference.cableInstalled ? "현장 설치 중량 입력 (피복 포함)" : q.officeRecovery ? num(p.office_cable_kg_per_m2, 2) + "kg/㎡ · 피복 포함 예시 가정" : "미입력"}</td><td class="r">${num(cable_kg, 1)}kg</td><td class="r">${mil(cable_won, 2)}백만원</td></tr>
    </tbody></table></div>
    ${delta > 0 && p.price_copper_pipe > 0 ? `<p class="caption muted">매각대금만 기준으로 분별이 손익분기에 이르려면 동관을 약 ${num(Math.ceil(delta / p.price_copper_pipe))}kg 더 팔아야 합니다.</p>` : ""}
  </section>`;
}

function concreteCutBreakEven(q, cmp) {
  const [mode] = cmp.unpricedCuts.length ? cmp.unpricedCuts : ["selective", "crush"].filter(key => concreteCut(q, key).active);
  if (!mode) return "";
  if (cmp.unpricedCuts.length === 2) {
    return cmp.delta === 0 ? "양쪽 절단·인양 도급비가 같으면 두 공법의 순비용이 같습니다."
      : ` ${cmp.delta > 0 ? "압쇄안" : "분별안"}의 절단·인양 도급비가 상대 공법보다 ${num(Math.abs(cmp.delta))}원 높으면 두 공법의 순비용이 같습니다.`.trim();
  }
  const label = mode === "selective" ? "분별안" : "압쇄안";
  const limit = concreteCut(q, mode).cost + (mode === "selective" ? -cmp.delta : cmp.delta);
  return limit < 0 ? ` ${label}은 절단·인양 도급비가 0원이어도 상대 공법보다 ${num(-limit)}원 비쌉니다.`.trim()
    : ` ${label}의 절단·인양 도급비가 ${num(limit)}원이면 두 공법의 순비용이 같습니다.`.trim();
}


function extraLaborBreakEven(q, p, cmp, work) {
  if (cmp.unpricedCuts.length) return null;
  const crew = cmp.selective.crews;
  const carpenterShare = work.persons > 0
    ? work.rows.filter(row => row.wage === "carpenter").reduce((sum, row) => sum + row.qty, 0) / work.persons
    : q.labor === "quantity" ? (q.carpenterShare ?? 0) / 100
      : p.sel_extra_carpenter / (p.sel_extra_carpenter + p.sel_extra_laborer || 1);
  const extendedDaysPerPd = (1 - q.overlap) / p.crew_size;
  const excavatorCrew = q.equipmentCrewPeriod === "all"
    && cmp.selective.equipmentCrewDays > 0 ? crew.structure : 0;
  const equipmentPerPd = q.selectiveEquipmentQuote == null
    ? selectiveEquipmentHoursPerDay(p) * (p.selective_equipment_per_h ?? 0) / p.crew_size : 0;
  const costPerPd = equipmentPerPd + p.wage_laborer * (1 - carpenterShare) + p.wage_carpenter * carpenterShare
    + extendedDaysPerPd * (p.indirect_per_day + p.wage_laborer * (crew.standing + excavatorCrew));
  const deltaWithoutExtra = cmp.delta - work.persons * costPerPd;
  return { limit: costPerPd > 0 ? -deltaWithoutExtra / costPerPd : null, deltaWithoutExtra };
}

function wasteHauls(q, p, cmp) {
  const { t } = streamTons(q, p);
  const capacity = 24;
  const groups = [
    ["콘크리트", result => result.concreteIntake],
    ["폐벽돌·조적", () => t.masonry],
    ["혼합잔재·혼합 반출 유리", result => result.mixed.tons + (q.windowMode ? q.windowGlassTons ?? 0 : 0)],
    ["미회수 기타 금속", result => result.unsoldMetal],
    ["샌드위치패널", () => t.panel],
    ...["board", "tile", "glass", "wood"].map(key => [STREAM_LABEL[key] + " 분리 반출", result => result.split[key] ?? 0]),
    ["폐합성수지 분리 반출", result => Math.max(0, result.split.resin - (q.windowMode && q.pvcPrice > 0 ? q.pvcFrameTons ?? 0 : 0))],
  ];
  const rows = groups.map(([label, weight]) => ({
    label,
    crush: weight(cmp.crush),
    selective: weight(cmp.selective),
  })).filter(row => row.crush > 0 || row.selective > 0);
  const trips = weight => Math.ceil(weight / capacity);
  return { capacity, rows, trips, totals: ["crush", "selective"].map(key => rows.reduce((sum, row) => sum + trips(row[key]), 0)) };
}

function comparisonThresholds(q, p, cmp, work) {
  const labor = extraLaborBreakEven(q, p, cmp, work);
  const { capacity, rows, trips, totals } = wasteHauls(q, p, cmp);
  const displayCell = weight => weight ? num(weight, 2) + "t · " + num(trips(weight)) + "회" : "–";
  let laborNote = "절단·인양 견적이 입력되면 추가 공수의 손익분기를 계산합니다.";
  if (labor) {
    if (labor.deltaWithoutExtra > 0.005) {
      laborNote = "추가 공수가 0인·일이어도 압쇄가 " + num(labor.deltaWithoutExtra) + "원 저렴합니다.";
    } else if (labor.limit == null) {
      laborNote = "현재 적용한 비용에서는 추가 공수에 따른 비용 차이가 없습니다.";
    } else {
      laborNote = "분별 추가 공수 " + num(work.persons, 2) + "인·일 · 손익분기 " + num(Math.max(0, labor.limit), 2) + "인·일";
    }
  }
  return `<details class="card"><summary>분별 추가 공수 손익분기와 예상 반출 횟수</summary>
    <h3>분별 추가 공수</h3><p>${laborNote}</p>
    <p class="caption muted">현재 비교에 포함된 비용을 기준으로, 추가 인건비, 보조 장비비와 공기 연장 비용을 함께 계산합니다.</p>
    <h3>예상 반출 횟수</h3>
    <p class="caption muted">반출 그룹별 1회 ${capacity}t 만재를 가정한 중량 기준 참고치입니다. 콘크리트는 한 그룹으로 합산하고 고철·비철 매각품의 수거 차량은 별도입니다. 부피 제한·운반 거리에 따라 실제 횟수와 비용은 달라집니다.${q.panelWeightMissing ? " 중량 미확인 패널은 집계하지 않았습니다." : ""}</p>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>반출 그룹</th><th class="r">압쇄</th><th class="r">분별</th></tr></thead>
      <tbody>${rows.map(row => `<tr><td>${esc(row.label)}</td><td class="r">${displayCell(row.crush)}</td><td class="r">${displayCell(row.selective)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>예상 합계</td><td class="r">${num(totals[0])}회</td><td class="r">${num(totals[1])}회</td></tr></tfoot>
    </table></div>
    <p class="caption muted">운반비는 현장 조건의 양쪽 운반 견적으로 반영합니다.</p>
  </details>`;
}

function extraEquipmentAllowance(q, cmp) {
  if (q.selectiveEquipmentQuote != null || cmp.unpricedCuts.length) return "";
  const estimate = cmp.selective.rows.find(row => row.item === "분별 선철거·선별 소형 장비 (추정)")?.amount ?? 0;
  const remaining = estimate - cmp.delta;
  const result = remaining > 0.005
    ? "분별의 추가 장비비가 " + num(remaining) + "원이면 두 안의 순비용이 같습니다."
    : "분별 보조 장비비를 0원으로 두어도 추가 비용 여유가 없습니다.";
  return '<p class="caption muted">현재 반영된 비용 기준 · ' + result + '</p>';
}

function compareTab(d) {
  if (!d) return empty();
  if (d.comparisonLimit) return planLimitNotice(d);
  if (d.openSteelFrame) return openSteelNotice(d);
  const { q, cmp } = d, { crush, selective, delta, unpricedCuts } = cmp, p = state.p;
  const cutBreakEven = concreteCutBreakEven(q, cmp);
  const vars = variables(rates);
  sim ||= simulate(q, p, vars, { n: 5000, seed: state.seed });
  const better = delta < 0 ? "전면 분별해체" : "일괄 압쇄";
  const issues = [...new Set([...crush.issues, ...selective.issues])];
  const equality = delta === 0;
  const { hasUnpricedDisposal } = cmp;
  const steel = steelDismantling(q);
  const boardBreakEven = breakEvenBoardShare(q,p);
  const simulationScope = q.labor === "quantity" ? "보드 60%·타일 100% 공통 선철거율 고정" : "논문 공수 방식 · 선철거율을 변동하지 않음";
  const withSupplement = enabled => {
    const t = { ...q.t, wood: q.raw.t.wood, resin: q.raw.t.resin, mixed: q.raw.t.mixed };
    const alternative = { ...q, ...Object.fromEntries(
      ["mixedMineral", "mixedCombustible"].map(key => [key, (state[key] ?? 0) / 100])),
      t: enabled ? supplement({ ...q, t }, state.usage, rates).t : t,
    };
    if (q.finishTakeoff) connectFinishTakeoff(alternative, q.raw, rates, p);
    return compare(alternative, p);
  };
  const rawComparison = q.supplemented ? withSupplement(false) : null;
  const supplementedComparison = state.plan && !q.supplemented ? withSupplement(true) : null;
  const work = selExtra(q, p);
  const indirect = rates.params.indirect_per_day;
  const crewOnWholeJob = q.equipmentCrewPeriod === "all";
  const alternatePrices = [
    ["폐목재 유상 처리 사례 (운반·선별·VAT 포함)", { net_wood: -80000 }],
    ["폐합성수지 유상 처리 사례 (소각, 운반 별도)", { net_resin: -220000 }],
    ["폐합성수지 매각 사례 (소형가전 파쇄물)", { net_resin: 258000 }],
  ];
  const resinSwitch = breakEven(q, p, "net_resin", -1000000, 5000000);
  const paperAlt = q.labor === "paper" ? compare(q, { ...p, sel_extra_laborer: 0.325 }) : null;
  const mixLabel = { mineral: "건설폐재류", glass: "유리·타일", board: "보드", unknown: "미확인", none: "해당 없음" };
  const torn = tornado(q, p, vars).filter((t) => t.span > 1).slice(0, 10);

  const be = vars.map((v) => {
    const x = breakEven(q, p, v.key, v.min, v.max); // 범위 밖에서만 뒤집히는 변수는 뺀다
    if (x == null) return "";
    const up = compare(q, { ...p, [v.key]: x + Math.max(1e-9, (v.max - v.min) * 1e-6) }).delta < 0;
    const f = (n) => num(n, v.unit === "비율" ? 2 : v.unit === "인·일/㎡" ? 5 : 0);
    return `<li><strong>${esc(v.label)}</strong>: <strong>${f(x)} ${v.unit === "비율" ? "" : v.unit}</strong> ${up ? "이상" : "이하"}이면 분별해체가 유리 <span class="muted">(현재 ${f(p[v.key])}, 범위 ${f(v.min)} ~ ${f(v.max)})</span></li>`;
  }).filter(Boolean).join("");

  // 내역: 두 안의 같은 항목을 한 줄에
  const ORDER = ["인건비", "장비비", "처리비", "운반비", "간접비", "매각수익"];
  const keys = [...new Set([...crush.rows, ...selective.rows].map((r) => `${r.group}|${r.item}`))]
    .sort((a, b) => ORDER.indexOf(a.split("|")[0]) - ORDER.indexOf(b.split("|")[0]));
  const find = (s, k) => s.rows.find((r) => `${r.group}|${r.item}` === k);
  let last = "", detail = "";
  for (const k of keys) {
    const a = find(crush, k), b = find(selective, k), r = a || b;
    if (r.group !== last) { detail += `<tr class="grp"><td colspan="7">${r.group}</td></tr>`; last = r.group; }
    const cell = (x) => x ? `<td class="r">${num(x.qty, x.item.endsWith("추정)") ? 1 : x.qty < 100 ? 1 : 0)} ${x.unit}</td><td class="r">${mil(x.amount, 2)}</td>` : `<td class="r">–</td><td class="r">–</td>`;
    detail += `<tr><td>${esc(r.item)}</td><td class="r">${a && b && a.price !== b.price ? `${num(a.price)} / ${num(b.price)}` : num(r.price)}</td>${cell(a)}${cell(b)}<td class="r">${mil((b?.amount || 0) - (a?.amount || 0), 2)}</td></tr>`;
  }

  return `<section class="card">
      ${state.source === "ifc" ? `<p>${esc(state.fileName)} · 산정 면적 ${num(q.area_m2,2)}㎡ · ${num(q.floors)}층 · 집계 ${num(d.classified.length)}개 부재</p><p class="caption muted">범위 ${q.scope === "above" ? "식별된 지하·기초 제외" : "입력 모델 전체"} · 원단위 ${esc(state.usage)}${state.supplement ? " 적용" : " 보충 꺼짐"} · 용도·현장 조건 미확인 시 기본 가정을 사용합니다. <button class="btn" data-tab="model">입력 근거 확인</button></p>` : ""}
      ${planExampleNotice()}
      ${q.windowMode === "both" ? `<p class="caption muted">${WINDOW_ASSUMPTION}</p>` : ""}
      <p class="verdict">${hasUnpricedDisposal ? "일부 처리비 제외 · " : ""}${d.finishUnverified ? "마감재 미산정 · 포함 항목 기준 · " : ""}${steel.excluded ? "철골 절단·인양비 제외 기준 · " : ""}${unpricedCuts.length ? `절단·인양 견적 미입력 · 확인된 비용 차이 (분별 − 압쇄) ${mil(delta, 2)}백만원` : equality ? "두 공법의 순비용이 같습니다." : `<strong>${better}</strong>의 순비용이 ${mil(Math.abs(delta))}백만원 저렴합니다.`}</p>
      ${(crush.total < 0 || selective.total < 0) && (d.planReference || steel.excluded || hasUnpricedDisposal) ? '<p class="caption muted">음수 순비용은 고철 등 매각수익이 현재 포함된 비용보다 크다는 뜻입니다. 별도 공사비를 반영하면 전체 순비용은 달라집니다.</p>' : ""}
      ${d.planReference ? `<p class="caption muted">포함 항목 기준 · 바닥 슬래브 해체 공기·장비비 미포함 · 석면 해체비 별도 (지붕 슬레이트 ${num(d.planReference.asbestosArea.roof)}㎡ · 천장 약 ${num(d.planReference.asbestosArea.ceiling)}㎡, 계획서 p.${d.planReference.asbestosPage})</p>
      <p class="caption muted">계획서 폐기물량 참고 (p.${d.planReference.wastePage}) · ${Object.entries(d.planReference.wasteTons).map(([key, tons]) => `${STREAM_LABEL[key]} ${num(tons)}t`).join(" · ")} · ${esc(d.planReference.wasteScope)}로 처리비 미반영. 처리비는 IFC 물량 기준입니다.</p>` : ""}
      <p class="caption muted">공수 기준 ${q.labor === "quantity" ? "자재별 작업량" : "논문의 면적당 차이 품"} · 폐콘크리트 성상 압쇄 ${concreteGradeLabel(q, p, false)}% · 분별 ${concreteGradeLabel(q, p, true)}% · ${concreteGradeBasis(q, p)}${q.transportCrush == null || q.transportSel == null ? " · 운반비 비교 미반영" : ""}</p>
      ${(crush.transportQuote == null || selective.transportQuote == null) && delta !== 0 ? `<p class="caption muted">다른 비용이 같다면 ${delta > 0 ? "분별" : "압쇄"} 운반비가 상대 공법보다 ${num(Math.abs(delta))}원 적을 때 두 순비용이 같아집니다.</p>` : ""}
      <details id="finish-settlement"><summary>현장 중량·처리 견적</summary>
        <div class="form-grid">
        ${[["board","보드"],["tile","타일"]].map(([key,label]) => `<fieldset><legend>${label} · 현재 ${num(q.t[key],2)}t</legend>
        ${numeric(key+"Weight","확인 중량 (t, 기존 물량 대체)")}${numeric(key+"Crush","압쇄안 별도 반출 (%)",{max:100})}
        ${numeric(key+"Sel","분별안 별도 반출 (%)",{max:100})}${numeric(key+"Fee","별도 반출 처리 견적 (원/t)")}</fieldset>`).join("")}
        </div>
        <p>공통 선철거 공수는 양쪽 내부 철거 인력·기간에 반영합니다. 별도 반출량만큼 혼합잔재에서 빼고 해당 처리비를 적용합니다.</p></details>
      ${hasUnpricedDisposal ? `<details><summary>별도 견적이 필요한 항목</summary><div class="disclaimer"><div><strong>처리비가 합계에서 빠진 항목</strong><p>폐콘크리트와 함께 반입되는 미회수 철근은 압쇄 ${num(crush.embeddedRebar, 2)}t, 분별 ${num(selective.embeddedRebar, 2)}t이며 처리비에 반영했습니다.</p><ul>${[["압쇄", crush], ["분별", selective]].flatMap(([label, result]) => result.unpricedDisposal.map(({item, tons, components}) => `<li>${label} · ${esc(item)}${tons == null ? "" : ` ${num(tons, 2)}t`}${components ? " (" + components.map(([label, weight]) => esc(label) + " " + num(weight, 2) + "t").join(" + ") + ")" : ""}</li>`)).join("")}</ul><p>실제 무상 처리라면 단가에 0원을 입력하세요.</p></div></div></details>` : ""}
      ${issues.length ? `<ul class="caption muted">${issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>` : ""}

      <p class="caption muted">포함 항목 기준 5,000회 비교의 ${num(sim.pSelective * 100, 1)}%에서 분별 순비용이 더 낮았습니다. ${simulationScope}. 결과는 설정한 탐색 범위와 삼각분포에 따릅니다.</p>
    </section>
    <section class="kpis">
      <div class="card kpi"><div class="v">${mil(crush.total)}</div><div class="l">일괄 압쇄 순비용 (백만원)${steel.excluded ? " · 철골비 별도" : ""}</div><div class="s">공기 ${num(crush.days)}일</div></div>
      <div class="card kpi"><div class="v">${mil(selective.total)}</div><div class="l">전면 분별해체 순비용 (백만원)${steel.excluded ? " · 철골비 별도" : ""}</div><div class="s">공기 ${num(selective.days)}일 (${cmp.deltaDays >= 0 ? "+" : ""}${num(cmp.deltaDays, 1)}일)</div></div>
      <div class="card kpi"><div class="v">${delta > 0 ? "+" : delta < 0 ? "−" : ""}${mil(Math.abs(delta))}</div><div class="l">Δ = 분별 − 압쇄 (백만원)</div><div class="s">${d.basis ? esc(d.basis) + " · " : ""}음수면 분별이 유리</div></div>
      <div class="card kpi"><div class="v">${num(sim.pSelective * 100, 1)}%</div><div class="l">분별 순비용이 낮은 시행 비율</div><div class="s">${num(sim.n)}회 · ${simulationScope}</div></div>
    </section>
    <section class="card"><h2>비용 구성</h2>
      <p><strong>장비비</strong> · 압쇄 ${num(crush.equipment)}원 / 분별 ${num(selective.equipment)}원</p>
      ${q.selectiveEquipmentQuote == null && selective.schedule.selective > 0 ? `<p class="caption muted">분별 보조 장비 · 추가 작업 ${num(selective.schedule.selective, 2)}일 × 하루 ${num(selectiveEquipmentHoursPerDay(p), 1)}시간 × ${num(p.selective_equipment_per_h ?? 0)}원/h (추정)</p>` : ""}
      ${q.selectiveEquipmentQuote == null && selective.schedule.selective === 0 ? '<p class="caption muted">추가 분별 공수가 0인·일이면 공통 장비비를 적용합니다.</p>' : ""}
      ${extraEquipmentAllowance(q, cmp)}
      <p>공기 ${num(crush.days, 1)}일 → ${num(selective.days, 1)}일 · 간접비 차이 ${mil(selective.indirect - crush.indirect, 2)}백만원</p>
      <p>분별 추가 매각수익 ${mil(selective.revenue-crush.revenue,2)}백만원 · 처리비 절감 ${mil(crush.disposal-selective.disposal,2)}백만원 · 추가 인건비 ${mil(selective.labor-crush.labor,2)}백만원</p>${stackedBars([{ ...crush, name: "일괄 압쇄" }, { ...selective, name: "전면 분별" }])}</section>
    ${comparisonThresholds(q, p, cmp, work)}
    ${officeSalvageCard(q, p, delta)}
    <section class="card"><h2>혼합잔재 처리비</h2>
      ${crush.mixed.tons > 0 && Math.abs(crush.mixed.tons - selective.mixed.tons) < 0.000001 ? '<p class="caption muted">두 공법의 혼합 반출량이 같아 물량 절감액은 0원입니다. 폐콘크리트 성상에 따른 처리비 차이는 별도로 계산합니다.</p>' : ""}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>공법</th><th class="r">잔재량</th><th class="r">가연물 비율</th><th class="r">단가</th><th>적용 근거</th></tr></thead><tbody>
      ${[["압쇄", crush.mixed], ["분별", selective.mixed]].map(([label, mix]) => `<tr><td>${label}</td><td class="r">${num(mix.tons, 2)}t</td><td class="r">${num(mix.share * 100, 1)}%</td><td class="r">${mix.tons > 0 ? num(mix.fee) + "원/t" : "–"}</td><td>${esc(mix.rule)}${mix.needsQuote ? " · 비교용 단가" : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="caption muted">분별 절감액 ${mil(crush.mixed.tons * crush.mixed.fee - selective.mixed.tons * selective.mixed.fee, 2)}백만원 · 물량 효과 ${mil((crush.mixed.tons - selective.mixed.tons) * crush.mixed.fee, 2)}백만원 · 단가 효과 ${mil(selective.mixed.tons * (crush.mixed.fee - selective.mixed.fee), 2)}백만원</p>
    </section>
    <section class="card"><h2>산정 기준</h2>
      <details><summary>폐콘크리트 성상 가정을 바꾸면?</summary>
        <p class="caption muted">분별안의 성상만 바꿔 계산한 가정입니다. 비용 차이의 기준은 분별 − 압쇄입니다.</p>
        <ul>${["same", "standard", "good"].map(key => {
          const alternative = compare({ ...q, concreteCase: key }, p);
          const shares = CONCRETE_CASES[key].shares.map(value => num(value * 100)).join(" / ");
          return `<li>분별 ${shares}% · 비용 차이 ${mil(alternative.delta, 2)}백만원</li>`;
        }).join("")}</ul>
      </details>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th>적용 기준</th></tr></thead><tbody>
        ${estimateAssumptions(q,p).map(([item,basis]) => `<tr><td>${esc(item)}</td><td>${esc(basis)}</td></tr>`).join("")}
      </tbody></table></div>
      ${boardBreakEven == null ? "" : `<p>다른 조건을 고정하면 보드 공통 선철거율 약 ${num(boardBreakEven * 100, 1)}%에서 두 공법의 순비용이 같습니다.</p>`}
      ${rawComparison ? `<p>보충을 끈 경우 압쇄 ${mil(rawComparison.crush.total, 2)}백만원 · 분별 ${mil(rawComparison.selective.total, 2)}백만원입니다. 현재 결과에는 원단위 보충량 ${num(Object.values(q.added).reduce((sum, value) => sum + value, 0), 1)}t을 포함합니다.</p>` : ""}
      ${supplementedComparison ? `<p>현재 추정은 보충을 끈 상태입니다. 목재·합성수지·혼합폐기물을 원단위로 보충하면 압쇄 ${mil(supplementedComparison.crush.total, 2)}백만원 · 분별 ${mil(supplementedComparison.selective.total, 2)}백만원입니다.</p>` : ""}
    </section>
    <section class="card"><h2>견적 내역</h2>
      ${[crush, selective].some(result => result.rows.some(row => row.item.endsWith("추정)"))) ? `<p class="caption muted">동관·피복 전선 추정 매각대금 반영 · 전선 인발·선별 추가 공수와 미회수분의 별도 처리비 미산정</p>` : ""}
      ${q.steelWork ? `<p class="caption muted">표시 공기는 철골 절단·인양 기간을 제외합니다.${steel.excluded && (q.cutCrush != null || q.cutSel != null) ? " 개별 철골 견적 한쪽만 입력되어 양쪽 철골비를 제외했습니다." : ""}</p>` : ""}
      <p class="caption muted">운반비 (부가세 별도) · ${[["압쇄", crush], ["분별", selective]].map(([label, result]) => `${label} 입력 ${result.transportQuote == null ? "미입력" : num(result.transportQuote) + "원"} / 반영 ${num(result.transport)}원`).join(" · ")}${cmp.partialTransport ? ` (${crush.transportQuote == null ? "압쇄" : "분별"} 견적 없음, 양쪽 0원 적용)` : ""}</p>
      ${cutBreakEven ? `<p>${cutBreakEven}</p>` : ""}
      ${delta > 0 && !unpricedCuts.length ? `<p>현재 물량과 공기를 유지하면 분별안에서 추가 순수익 또는 비용 절감 ${num(delta)}원이 더 발생할 때 두 공법의 순비용이 같아집니다.</p>` : ""}
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="r">단가 (원, 다르면 압쇄 / 분별)</th><th class="r">압쇄 수량</th><th class="r">압쇄 (백만원)</th><th class="r">분별 수량</th><th class="r">분별 (백만원)</th><th class="r">차이</th></tr></thead>
      <tbody>${detail}</tbody><tfoot><tr><td>순비용 (비용 − 매각수익)</td><td></td><td></td><td class="r">${mil(crush.total, 2)}</td><td></td><td class="r">${mil(selective.total, 2)}</td><td class="r">${mil(delta, 2)}</td></tr></tfoot></table></div>
      <ul class="caption muted">${[["압쇄", crush], ["분별", selective]].map(([label, { mixed, unsoldMetal, embeddedRebar, concreteIntake }]) =>
        `<li>${label} 혼합잔재 ${num(mixed.tons, 2)}t · 확인된 가연물 ${num(mixed.share * 100, 1)}% · 주성상 ${mixLabel[mixed.main]} · ${esc(mixed.rule)} ${num(mixed.fee)}원/t${mixed.needsQuote ? " (프로젝트 기본값)" : ""} · 폐콘크리트 반입 ${num(concreteIntake, 2)}t (미회수 철근 ${num(embeddedRebar, 2)}t 포함) · 기타 미매각 금속 ${num(unsoldMetal, 2)}t</li>`).join("")}</ul>
      <details style="margin-top:8px"><summary>일당 간접비 ${num(p.indirect_per_day)}원 · 가정 (탐색 범위 ${num(indirect.min)}~${num(indirect.max)}원)</summary><p class="caption muted">${esc(indirect.ref)} 간접비는 각 공법의 작업일에 곱합니다.</p></details>
      <p class="caption muted">협회 중간처리단가와 현장 수집·운반비는 별도 항목입니다. 폐목재·폐합성수지의 순단가는 양수면 매각수익, 음수면 처리비입니다.</p>
    </section>
    <section class="card"><h2>공기와 투입 인원</h2>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>공종</th><th>일수 계산식</th><th class="r">작업조 (명)</th><th class="r">압쇄 일수</th><th class="r">압쇄 공수</th><th class="r">분별 일수</th><th class="r">분별 공수</th></tr></thead><tbody>
        ${[["setup", "가설 설치 (비계·방진막)", `${num(p.sched_setup_base, 1)} + 연면적 ÷ 1,000 × ${num(p.sched_setup_per_1000m2, 1)}`],
           ["interior", "내부 철거", `연면적 ÷ 1,000 × ${num(p.sched_interior_per_1000m2, 1)} (최소 ${num(p.sched_interior_min, 1)}일)`],
           ["structure", "구조체 해체", crush.schedule.cutting || selective.schedule.cutting ? "남은 압쇄 작업일 + 콘크리트 절단·인양 작업일" : q.equipment === "mixed" ? "두 장비의 가동시간 합계에서 확인된 동시 가동시간을 차감" : `면적식 ${num(crush.schedule.areaDays, 1)}일${q.structureFactor ? ` × 보정계수 ${num(q.structureFactor, 3)}` : ""}, 장비 생산성 기준 ${num(crush.schedule.volumeDays, 1)}일 중 큰 값`],
           ["finish", "마무리 (정리·비계 해체)", `${num(p.sched_finish_base, 1)} + 연면적 ÷ 1,000 × ${num(p.sched_finish_per_1000m2, 1)}`]]
          .map(([k, label, f]) => `<tr><td>${label}</td><td class="muted">${f}</td><td class="r">${k === "structure" ? "–" : num(crush.crews[k])}</td><td class="r">${num(crush.schedule[k], 1)}</td><td class="r">${k === "structure" ? "–" : num(crush.crews[k] * crush.schedule[k])}</td><td class="r">${num(selective.schedule[k], 1)}</td><td class="r">${k === "structure" ? "–" : num(selective.crews[k] * selective.schedule[k])}</td></tr>`).join("")}
        <tr><td>분별 추가 작업</td><td class="muted">${work.method === "quantity" ? `자재별 분별 총공수 ${num(work.gross, 2)} − 일반해체 공수 ${num(work.baseline, 2)}${q.generalFinishPd == null ? " (기본 선철거 공수 반영)" : ""} 인·일` : `연면적 × (목공 ${num(p.sel_extra_carpenter, 3)} + 보통인부 ${num(p.sel_extra_laborer, 3)} 인·일/㎡)`} ${work.method === "paper" && work.commonWindow > 0 ? ` · 공통 창호 공수 ${num(work.commonWindow, 2)}인·일 비례 차감` : ""} ÷ 작업조 ${num(p.crew_size)}명</td><td class="r">${num(p.crew_size)}</td><td class="r">–</td><td class="r">–</td><td class="r">${num(selective.schedule.selective, 1)}</td><td class="r">${num(work.persons, 1)}</td></tr>
        <tr><td>상시 작업유도·감시</td><td class="muted">전체 작업일</td><td class="r">${num(crush.crews.standing)}</td><td class="r">${num(crush.days, 1)}</td><td class="r">${num(crush.crews.standing * crush.days)}</td><td class="r">${num(selective.days, 1)}</td><td class="r">${num(selective.crews.standing * selective.days)}</td></tr>
        <tr><td>굴착기 연동 살수·신호</td><td class="muted">${crewOnWholeJob ? "전체 작업일" : "대당 평균 가동일"} · 굴착기 ${num(crush.crews.excavators)}대 × ${num(p.crew_per_excavator)}명/대</td><td class="r">${num(crush.crews.structure)}</td><td class="r">${num(crush.equipmentCrewDays, 1)}</td><td class="r">${num(crush.crews.structure * crush.equipmentCrewDays)}</td><td class="r">${num(selective.equipmentCrewDays, 1)}</td><td class="r">${num(selective.crews.structure * selective.equipmentCrewDays)}</td></tr>
      </tbody><tfoot><tr><td>공기 (작업일) · 총공수 (인·일)</td><td></td><td></td><td class="r">${num(crush.days, 1)}</td><td class="r">${num(persons(crush))}</td><td class="r">${num(selective.days, 1)}</td><td class="r">${num(persons(selective))}</td></tr></tfoot></table></div>
      <p>구조체 공기 · 압쇄 ${num(crush.schedule.structure, 1)}일 / 분별 ${num(selective.schedule.structure, 1)}일. 굴착기 가동 · 압쇄 ${num(crush.excavatorHours, 1)}시간 / 분별 ${num(selective.excavatorHours, 1)}시간.</p>
      ${crush.schedule.cutting || selective.schedule.cutting ? `<p class="caption muted">절단·인양 작업일 · 압쇄 ${num(crush.schedule.cutting, 1)}일 / 분별 ${num(selective.schedule.cutting, 1)}일. 도급 인력은 견적에 포함됩니다.</p>` : ""}
      <p class="caption muted">배치 인원은 천마산 p.38, 정선 p.65, 노량진 p.104의 계획을 참고했습니다. 구조체 기간에만 굴착기 연동 인원을 배치하고 관리자를 직접노무에서 제외하는 것은 팀 가정입니다. 천마산은 살수와 작업유도를 각각 전체 21일로 계획했습니다. 모델의 현장 조건에서 전체 작업일 배치도 비교할 수 있습니다.</p>
      <p class="caption muted" style="margin-top:8px">장비 방식은 ${EQUIPMENT[equipmentMode(q)]}입니다. 분별 추가 작업 ${num(selective.schedule.selective, 1)}일 중 병행률 ${num(q.overlap * 100, 1)}%를 반영해 전체 공기가 ${num(selective.schedule.extension, 1)}일 늘어납니다. IFC 창틀·유리 선철거 공수는 두 공법의 내부 철거에 포함됩니다.</p>
      ${paperAlt ? `<p class="caption muted">표 3·4 기재를 달리 해석해 보통인부 추가 품을 0.325로 두면, Δ는 ${mil(paperAlt.delta, 2)}백만원, 공기 차이는 ${num(paperAlt.deltaDays, 1)}일입니다. 이 해석의 출처 확인이 필요합니다.</p>` : ""}
    </section>
    <div class="grid-2">
      <section class="card"><h2>손익분기</h2>${be ? `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px">${be}</ul>` : `<p class="muted">범위 안에서 결과를 뒤집는 변수가 없습니다.</p>`}
        <p class="caption muted" style="margin-top:12px">폐합성수지 순단가 손익분기 ${resinSwitch == null ? "탐색 구간 내 없음" : `${num(resinSwitch)}원/t`} (다른 입력 고정, −100만~500만원/t 탐색).<br>다른 값은 그대로 두고 한 변수만 바꿨을 때 두 안의 비용이 같아지는 지점입니다. 조사 범위 안에서 결과를 뒤집을 수 있는 변수만 보여줍니다.</p>
        <details style="margin-top:8px"><summary>폐목재·수지 사례별 Δ</summary>
          <p class="caption muted">배출원과 비용 포함 범위가 다른 공고 사례입니다.</p>
          <ul>${alternatePrices.map(([label, changes]) => `<li>${label} · ${num(Object.values(changes)[0])}원/t → Δ ${mil(compare(q, { ...p, ...changes }).delta, 2)}백만원</li>`).join("")}</ul>
        </details></section>
      <section class="card"><h2>몬테카를로 결과</h2>${histChart(histogram(sim.sorted))}
        <div class="row" style="margin-top:12px;justify-content:space-between"><span class="num">P10 ${mil(sim.p10)} · P50 ${mil(sim.p50)} · P90 ${mil(sim.p90)} 백만원</span>
        <label class="row no-print caption muted">seed <input class="input sm" style="width:80px" type="number" min="1" data-set="seed" value="${state.seed}"></label></div>
        <p class="caption muted" style="margin-top:8px">범위가 있는 단가 ${vars.length}개를 삼각분포로 뽑아 Δ를 ${num(sim.n)}번 계산했습니다. seed가 같으면 결과가 같습니다.</p></section>
    </div>
    <section class="card"><h2>민감도 (토네이도)</h2>${tornadoChart(torn, delta)}</section>
    ${state.source === "ifc" ? `<section class="card"><h2>3D: 분별 대상과 압쇄 대상</h2>${viewerBox()}</section>` : ""}
    ${q.labor === "quantity" ? `<p class="caption muted"><strong>보드·타일 선철거 공수 가정</strong> · 일괄 압쇄는 보드 ${num(PRESS_FINISH_BASELINE.board * 100)}%, 타일 ${num(PRESS_FINISH_BASELINE.tile * 100)}%, 분별해체는 보드·타일 각각 100%를 적용했습니다. 박지선 외(2023) 표 3·4의 노무 품 비교를 참고한 계산용 가정입니다. 실제 선철거 면적과 별도 반출률은 현장 자료로 확인합니다.</p>` : ""}`;
}

const persons = (s) => s.rows.filter((r) => r.group === "인건비").reduce((a, r) => a + r.qty, 0);

const empty = () => `<section class="card"><p>먼저 <strong>모델</strong> 단계에서 IFC를 올리거나 면적을 넣어 주세요.</p><p style="margin-top:12px"><button class="btn btn-primary" data-tab="model">모델 단계로</button></p></section>`;

function facilityQuotes(row) {
  const fields = row.facilities.map((f, index) => {
    const input = (key, label) => `<label class="field">${label}<input class="input" type="number" min="0" step="any" data-facility="${esc(row.id)}" data-index="${index}" data-key="${key}" value="${f[key] ?? ""}" placeholder="미확인"></label>`;
    return `<fieldset><legend>${esc(f.name)} · ${esc(f.structure)} · ${f.area_m2 == null ? "면적 미기재" : num(f.area_m2, 2) + "㎡"}</legend>
      ${/철골/.test(f.structure) ? input("steelTons", "확인된 철골 중량 (t)") : ""}
      ${input("crushQuote", "압쇄안 순견적 (원)")}${input("selectiveQuote", "분별안 순견적 (원)")}</fieldset>`;
  });
  const total = key => row.facilities.every(f => f[key] != null)
    ? num(row.facilities.reduce((sum, f) => sum + f[key], 0)) + "원"
    : "견적 필요 · " + row.facilities.filter(f => f[key] == null).map(f => esc(f.name)).join(", ");
  return `<section class="card"><h2>${esc(row.name)} 시설별 견적</h2><p>시설별로 절단·인양, 처리·운반과 고재 매각을 모두 반영한 순견적을 입력하세요. 철골 중량은 견적의 근거로 기록합니다.</p>
    <div class="form-grid">${fields.join("")}</div><p>전체 압쇄안 · ${total("crushQuote")}<br>전체 분별안 · ${total("selectiveQuote")}</p></section>`;
}

function validationTab(d) {
  const q = d?.q ?? { ...projectInputs(), fixedComparison: true };
  const sourceCases = state.cases;
  const comparable = comparableCases(sourceCases, q, state.calibrationType);
  const cal = calibrateStructure(sourceCases, q, state.p, state.calibrationType);
  const available = (v, decimal = 1) => v == null ? "–" : num(v, decimal);
  const range = (row) => row.total_days_max == null ? available(row.total_days) : `${num(row.total_days)}~${num(row.total_days_max)}`;
  const error = (v, base) => v == null || !base ? "–" : `${v >= base ? "+" : ""}${num(100 * (v - base) / base, 1)}%`;
  const fields = Object.entries(BENCHMARKS).map(([key, [label, unit]]) => {
    const b = benchmark(comparable, key);
    const digits = unit === "인·일/㎡" ? 5 : unit === "원/일" ? 0 : 2;
    return `<tr><td>${label}</td><td>${unit}</td><td class="r">${b?.count ?? 0}</td><td class="r">${b ? num(b.median, digits) : "–"}</td><td class="r">${b ? `${num(b.min, digits)}~${num(b.max, digits)}` : "–"}</td></tr>`;
  }).join("");
  const cases = sourceCases.map((row) => {
    const actual = row.total_days_max == null ? error(row.prior_days, row.total_days)
      : `${error(row.prior_days, row.total_days_max)} ~ ${error(row.prior_days, row.total_days)}`;
    const modelComparable = row.structure === "rc" && ["above", "full"].includes(row.scope)
      && ["large", "small", "mounted"].includes(row.equipment) && row.area_m2 > 0 && row.floors > 0;
    const activeMixed = row.equipment === "mixed" && q.caseId === row.id && q.equipment === "mixed" && d?.cmp;
    const current = activeMixed ? d.cmp.crush.schedule : modelComparable ? schedule(row, state.p, "crush") : null;
    const period = row.period_length == null ? "원문 기간 미확인" : `${num(row.period_length)}${PERIOD_UNITS[row.period_unit]}${row.period_max ? " 이내" : ""}`;
    const mismatch = current && row.total_days && row.total_days_max == null ? error(current.total, row.total_days) : "";
    const total = current && available(current.total);
    return `<tr><td><strong>${esc(row.name)}</strong><br><small>${esc(row.source)} · ${row.verified ? "원문 대조" : "조원 기록"} · ${row.type === "plan" ? "계획" : "실적"}${row.note ? `<br>${esc(row.note)}` : ""}</small>${row.id === "seodaesin-474-47" ? '<br><button class="btn" data-act="seodaesin">장비별 가동시간 입력</button>' : ""}</td>
      <td>${row.facilities ? row.facilities.map(f => esc(f.name) + " " + (f.area_m2 == null ? "면적 미기재" : num(f.area_m2, 2) + "㎡")).join(" / ") : row.structure === "rc" ? "RC" : "기타"} · ${row.area_m2 == null ? "면적 미확인" : `${num(row.area_m2, 2)}㎡`} · ${row.floors == null ? "층수 미확인" : `${row.floors}층`} · ${SCOPES[row.scope]}</td>
      <td class="r">${period}</td><td class="r">${range(row)} / ${available(row.structure_days)}</td>
      <td class="r">${available(row.prior_days)}${actual === "–" ? "" : ` (${actual})`}</td>
      <td class="r">${total ? `${total}${activeMixed ? " (입력 가동시간)" : row.concrete_m3 == null ? " (면적식)" : ""}${mismatch ? ` · ${mismatch}` : ""}` : row.equipment === "mixed" ? "장비별 가동시간 필요" : row.structure !== "rc" ? "RC 공기식 적용 제외" : "범위·장비·규모 확인 필요"}</td>
      <td class="r">${available(row.prior_crew)} / ${available(row.crew_mean)}</td>
      <td class="r">${available(row.prior_concrete_t, 0)} / ${available(row.concrete_t, 0)}${row.concrete_t && row.prior_concrete_t != null ? ` (${error(row.prior_concrete_t, row.concrete_t)})` : ""}</td></tr>`;
  }).join("");
  return `<section class="card">
      <div class="row no-print">
        <label class="btn btn-primary">검증자료 JSON 가져오기<input type="file" id="validation-file" accept=".json,application/json" hidden></label>
        <button class="btn btn-outline" data-act="validation-export">표본 목록 JSON 내려받기</button>
      </div>
      ${state.caseMessage ? `<p role="status">${esc(state.caseMessage)}</p>` : ""}
      <p class="caption muted">계획서 PDF의 공정표와 물량표를 확인한 후 숫자와 쪽수를 JSON에 입력하세요. 달력일, 주·개월 일정과 작업일은 단위를 구분합니다. 계획값과 완료 현장의 실적은 따로 비교합니다. 파일 입력은 이 브라우저에 저장됩니다.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>현장 · 출처</th><th>대상</th><th>계획서 기간</th><th>전체 / 구조체 작업일</th><th>기존 사이트 (공기 오차)</th><th>현재 압쇄 모델 (일)</th><th>기존 사이트 / 자료 인원 (명)</th><th>기존 사이트 / 자료 폐콘크리트 (t)</th></tr></thead><tbody>${cases}</tbody></table></div>
    </section>
    ${sourceCases.filter(row => row.facilities).map(facilityQuotes).join("")}
    <section class="card">
      <h2>유사 현장으로 구조체 공기 보정</h2>
      <div class="form-grid">
        <label class="field">참조 자료 <select class="select" data-set="calibrationType">${opts({ plan: "예정공정표", actual: "완료 현장 실적" }, state.calibrationType)}</select></label>
        <label class="field">보정 표본에서 제외할 현장 <select class="select" data-set="caseId">
          <option value="">새 현장</option>${sourceCases.map((row) => `<option value="${esc(row.id)}" ${q.caseId === row.id ? "selected" : ""}>${esc(row.name)}</option>`).join("")}
        </select></label>
      </div>
      <p class="caption muted">원문을 대조한 RC 현장 중 해체 범위와 장비 방식이 같고, 면적은 대상의 0.5~2배, 층수는 ±2층인 사례를 씁니다. 구조체 작업일과 부피가 있는 사례 ${MIN_CASES}건 이상에서 한 건씩 빼고 예측해 평균 절대오차를 확인합니다.</p>
      <p>현재 조건 ${num(q.area_m2)}㎡ · 지상 ${q.floors}층 · ${SCOPES[q.scope]} · ${EQUIPMENT[equipmentMode(q)]}<br>유사 사례 ${comparable.length}건 · 구조체 공기 보정용 ${cal.count}건</p>
      ${cal.count >= MIN_CASES ? `<p>평균 절대오차 · 기존 ${num(cal.baseMae, 2)}일 / 교차검증 ${num(cal.cvMae, 2)}일 · 보정계수 ${num(cal.factor, 3)}</p>` : "<p>보정에 필요한 구조체 작업일·부피 자료가 부족합니다.</p>"}
      <button class="btn btn-outline no-print" data-act="calibration-toggle" ${!cal.ready && !state.useCalibration ? "disabled" : ""}>${state.useCalibration ? "보정 해제" : "현재 비교에 보정 적용"}</button>
      ${state.useCalibration && cal.ready ? '<p role="status">현재 비교 계산에 보정계수를 적용합니다.</p>' : ""}
      ${cal.count >= MIN_CASES && !cal.ready ? "<p>교차검증 오차가 감소하지 않아 기존 공기식을 사용합니다.</p>" : ""}
    </section>
    <section class="card"><h2>공수·작업조·장비·간접비 참고값</h2>
      <p class="caption muted">유사 현장에서 확인된 항목만 중앙값과 관측 범위를 표시합니다. 같은 작업 범위와 단위인지 확인한 뒤 단가 탭에 반영할 수 있습니다.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th>단위</th><th class="r">표본 수</th><th class="r">중앙값</th><th class="r">관측 범위</th></tr></thead><tbody>${fields}</tbody></table></div>
    </section>`;
}

/* ---------------- 내보내기 ---------------- */
function summary(d) {
  const { crush, selective, delta, deltaDays } = d.cmp;
  sim ||= simulate(d.q, state.p, variables(rates), { n: 5000, seed: state.seed });
  return { source: state.source === "ifc" ? state.fileName : "area", area_m2: state.area, usage: state.usage, site: state.site, labor_method: d.q.labor,
    window_mode: d.q.windowMode ?? null, window_assumption: d.q.windowMode === "both" ? WINDOW_ASSUMPTION : null, window_glass_pd_per_m2: d.q.windowMode ? d.q.glassPdPerM2 ?? state.p.window_frame_pd_per_m2 : null, frame_tons: { aluminum: d.q.alFrameTons ?? null, pvc: d.q.pvcFrameTons ?? null }, input_quantities: streamTons(d.q, state.p).t, rebar_estimated_t: streamTons(d.q, state.p).rebar, project_inputs: { ...projectInputs(), equipment: d.q.equipment, labor: d.q.labor, finishBaseline: d.q.finishBaseline }, estimation_assumptions: Object.fromEntries(estimateAssumptions(d.q,state.p)), finish_areas_m2: d.q.finishAreas, applied_rates: state.p,
    office_material_salvage_reference: officeSalvageReference(d.q, state.p),
    transport_input: { crush: crush.transportQuote ?? null, selective: selective.transportQuote ?? null },
    transport_applied: { crush: crush.transport, selective: selective.transport },
    transport_quote_won: { crush: crush.transportQuote ?? null, selective: selective.transportQuote ?? null },
    concrete_cut: Object.fromEntries(concreteCutModes.map(([mode]) => [mode, concreteCut(d.q, mode)])),
    steel_dismantling: {
      input: { common: d.q.cutCommon ?? null, crush: d.q.cutCrush ?? null, selective: d.q.cutSel ?? null },
      applied: steelDismantling(d.q), duration_excluded: Boolean(d.q.steelWork),
      structural_steel_t: d.q.structuralSteelTons ?? 0, structural_recovery: state.p.rec_structural_steel,
    },
    unpriced_concrete_cut: d.cmp.unpricedCuts,
    partial_transport_quote: d.cmp.partialTransport,
    crush_total_won: Math.round(crush.total), selective_total_won: Math.round(selective.total), delta_won: Math.round(delta),
    indirect_per_day_won: state.p.indirect_per_day, equipment_crew_period: d.q.equipmentCrewPeriod,
    crush_days: +crush.days.toFixed(1), selective_days: +selective.days.toFixed(1), delta_days: +deltaDays.toFixed(1),
    p_selective_cheaper: +sim.pSelective.toFixed(4), simulation_finish_baseline_fixed: d.q.finishBaseline ?? null, seed: state.seed, estimate: true,
    input_issues: [...new Set([...crush.issues, ...selective.issues])],
    ...(state.planExample ? { plan_example: { source: state.plan.source, scope: state.plan.demolition?.scope, cost_note: state.planExample.costNote, asbestos_cost_excluded: state.plan.hazards?.asbestos === true } } : {}),
    concrete_intake_t: { crush: crush.concreteIntake, selective: selective.concreteIntake }, embedded_rebar_t: { crush: crush.embeddedRebar, selective: selective.embeddedRebar },
    concrete_grade_link: d.q.concreteCase === "linked" ? concreteGradeLink(d.q, state.p) : null,
    concrete_grade_shares: {
      crush: concreteGrades(state.p, false, d.q.concreteCase, d.q).map(grade => grade.share),
      selective: concreteGrades(state.p, true, d.q.concreteCase, d.q).map(grade => grade.share),
    },
    ...(d.planReference ? { plan_waste_reference: { ...d.planReference, disposalApplied: false, slabScheduleAndEquipmentIncluded: false, asbestosCostIncluded: false } } : {}),
    finish_takeoff: d.q.finishTakeoff ?? null,
    finish_mixed_reallocated_t: d.q.finishMixedReallocated ?? null,
    finish_routes: { crush: crush.finishRoutes, selective: selective.finishRoutes },
    structure_calibration_factor: d.q.structureFactor ?? null, unpriced_disposal: { crush: crush.unpricedDisposal, selective: selective.unpricedDisposal }, recommended: d.recommended, basis: d.basis };
}

function exportElementRows(d) {
  const result = d.cmp.selective;
  const rows = elementResults(d.classified, state.p, result.mixed.fee, d.q);
  const appliedTons = Object.values(streamTons(d.q, state.p).t).reduce((sum, weight) => sum + weight, 0);
  return reconcileElementResults([...rows, ...d.frameAdjustments], appliedTons, result);
}

function exportTab(d) {
  if (!d) return empty();
  if (d.comparisonLimit) return planLimitNotice(d);
  if (d.openSteelFrame) return openSteelNotice(d);
  const res = state.source === "ifc" ? exportElementRows(d) : [];
  const preview = res.filter(r => r.category !== "adjustment").sort((a, b) => b.revenue - a.revenue).slice(0, 12);
  preview.push(...res.filter(r => r.category === "adjustment"));
  return `<section class="card"><h2>결과 내보내기</h2>
      <div class="row no-print">
        ${state.source === "ifc" ? `<button class="btn btn-primary" data-act="csv">부재별 결과 CSV</button>` : ""}
        <button class="btn btn-outline" data-act="json">요약 JSON</button>
        <button class="btn btn-outline" data-act="print">보고서 인쇄 · PDF</button>
      </div>
      <pre class="mono" style="margin-top:16px;white-space:pre-wrap">${esc(JSON.stringify(summary(d), null, 2))}</pre>
    </section>
    ${state.source === "ifc" ? `<section class="card"><h2>Revit에 결과 넣기</h2>
      <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
        <li><strong>부재별 결과 CSV</strong>와 <strong>요약 JSON</strong>을 내려받습니다.</li>
        <li>Revit에서 원본 모델을 열고, 저장소의 <span class="mono">revit/ReClaim_SharedParams.txt</span>를 공유 매개변수 파일로 지정합니다.</li>
        <li>pyRevit으로 <span class="mono">revit/write_results.py</span>를 실행해 CSV를 고릅니다. 부재마다 <span class="mono">RC_Waste, RC_Method, RC_Tons, RC_DisposalCost, RC_Revenue</span>가 기록됩니다.</li>
        <li>.rvt로 저장합니다. <span class="mono">RC_Method</span>로 필터를 만들면 분별 대상만 색으로 볼 수 있습니다.</li>
      </ol>
      <h2 style="margin-top:20px">부재별 결과 미리보기 <span class="caption muted">(${num(d.classified.length)}개 중 최대 12개, 전면 분별 기준)</span></h2>
      <p class="caption muted">CSV에는 수동 물량 변경과 처리비·매각수익 정산 차이를 조정 행으로 기록합니다. 톤 합계를 낼 때는 ‘제외’ 행을 빼세요.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Revit ID</th><th>부재</th><th>층</th><th>성상</th><th>방법</th><th class="r">톤</th><th class="r">처리비 (원)</th><th class="r">매각수익 (원)</th></tr></thead><tbody>
      ${preview.map((r) => `<tr><td class="mono">${esc(r.tag || r.globalId)}</td><td>${CATEGORY_LABEL[r.category] ?? "합계 조정"}</td><td>${r.floor}</td><td>${STREAM_LABEL[r.stream] ?? "–"}</td><td>${r.method}</td><td class="r">${num(r.tons, 3)}</td><td class="r">${num(r.disposal)}</td><td class="r">${num(r.revenue)}</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}
    <div class="disclaimer"><div>프로젝트 기본값을 적용한 비교 결과입니다. 현장 견적과 반출 기록이 있으면 해당 값을 입력해 다시 계산할 수 있습니다.</div></div>`;
}

function download(name, text, type) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- 그리기와 이벤트 ---------------- */
const HEAD = {
  model: ["모델과 물량", "Revit에서 내보낸 IFC에서 부재·재료별 물량을 뽑고, 폐기물 성상으로 분류합니다."],
  rates: ["단가", "노임, 품, 처리비, 매각가, 회수율입니다. 모든 값에 출처와 기준 연도를 표시합니다."],
  compare: ["공법 비교", "일괄 압쇄와 전면 분별해체의 인건비·장비비·처리비·매각수익·간접비를 비교합니다."],
  validation: ["해체계획서 검증·보정", "계획 공기와 사이트 계산을 비교하고, 유사한 현장 자료로 구조체 공기를 보정합니다."],
  export: ["내보내기", "부재별 결과를 CSV로 내보내 Revit 모델에 기록합니다."],
};

function render() {
  const d = derive();
  $("#tabs").innerHTML = TABS.map(([k, l], i) => `<button data-tab="${k}" ${k === state.tab ? 'aria-current="step"' : ""}><span>${i + 1}</span>${l}</button>`).join("");
  const wasOpen = $("#site-details")?.open;
  const settlementOpen = $("#finish-settlement")?.open;
  const body = { validation: validationTab, model: modelTab, rates: ratesTab, compare: compareTab, export: exportTab }[state.tab](d);
  $("#content").innerHTML = `<div><h1>${HEAD[state.tab][0]}</h1><p class="lead">${HEAD[state.tab][1]}</p></div>${body}`;
  if (settlementOpen && $("#finish-settlement")) $("#finish-settlement").open = true;
  if (wasOpen && $("#site-details")) $("#site-details").open = true;
  if (d) mountViewer(d);
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab],[data-act],[data-color]");
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; if (state.tab === "compare") state.colorMode = "method"; window.scrollTo(0, 0); return render(); }
  if (t.dataset.color) { state.colorMode = t.dataset.color; return render(); }
  const act = t.dataset.act, d = derive();
  if (act === "confirm-area" && state.source === "ifc") {
    state.areaConfirmed = true;
    sim = null;
    return render();
  }
  if (act === "sample") return loadIfc(await (await fetch("assets/data/sample.ifc")).arrayBuffer(), "sample.ifc (예시 5층 공동주택)");
  if (act === "plan-sample") return loadPlan(await json("plans/example.json"), "계획서 예시");
  if (act === "area" || act === "seodaesin") {
    ++loadVersion;
    Object.assign(state, Object.fromEntries(caseFields.map(key => [key, undefined])), defaultSiteInputs, {
      source: "area", plan: null, planExample: null, model: null, elements: [], overrides: {}, fileKey: null,
      planNotes: [], needsMountedProduction: false, area: 2400, floors: 5, usage: "공동주택", labor: "quantity",
      supplement: false, seed: 1, caseId: "", useCalibration: false, calibrationType: "plan",
      error: "", formError: "", busy: "", p: personalRates,
    });
    if (act === "seodaesin") {
      Object.assign(state, { area: 340.5, floors: 2, scope: "above", equipment: "mixed", usage: "비주거 RC", caseId: "seodaesin-474-47", tab: "model" });
    }
    sim = null; render();
    if (act === "seodaesin") $("#site-details").open = true;
    return;
  }
  if (act === "validation-export") return download("reclaim-validation.json", JSON.stringify({ schema: VALIDATION_SCHEMA, cases: state.cases }, null, 2), "application/json");
  if (act === "calibration-toggle") {
    state.useCalibration = !state.useCalibration;
    sim = null; return render();
  }
  if (act === "reset") { state.p = { ...defaults }; sim = null; save(); return render(); }
  if (["csv", "json"].includes(act) && !d?.cmp) return;
  if (act === "csv") return download("reclaim_elements.csv", "﻿" + toCsv(exportElementRows(d)), "text/csv");
  if (act === "json") return download("reclaim_summary.json", JSON.stringify(summary(d), null, 2), "application/json");
  if (act === "print") return window.print();
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "file" && t.files[0]) return loadIfc(await t.files[0].arrayBuffer(), t.files[0].name);
  if (t.id === "plancase" && t.value) {
    const example = kalisCases.find(c => c.file === t.value);
    if (!example) return;
    try { return loadPlan(await json(example.file), `${example.label} (국토안전관리원 사례)`, example); }
    catch (e) { state.error = `사례 데이터를 읽지 못했습니다: ${e.message}`; return render(); }
  }
  if (t.dataset.facility) {
    const row = state.cases.find(item => item.id === t.dataset.facility);
    const facility = row?.facilities?.[Number(t.dataset.index)];
    if (!facility || !["crushQuote", "selectiveQuote", "steelTons"].includes(t.dataset.key)) return;
    if (!t.validity.valid) return render();
    if (t.value === "") delete facility[t.dataset.key];
    else facility[t.dataset.key] = Number(t.value);
    localCases.set(row.id, row);
    try { localStorage.setItem("rc.validation", JSON.stringify({ schema: VALIDATION_SCHEMA, revision: 2, cases: [...localCases.values()] })); }
    catch { state.caseMessage = "현재 세션에 반영했습니다. 검증자료 JSON을 내려받아 보관하세요."; }
    return render();
  }
  if (t.id === "planfile" && t.files[0]) {
    try { return loadPlan(JSON.parse(await t.files[0].text()), t.files[0].name); }
    catch (e) { state.error = `JSON을 읽지 못했습니다: ${e.message}`; return render(); }
  }
  if (t.id === "validation-file" && t.files[0]) {
    try {
      const imported = validationCases(JSON.parse(await t.files[0].text()));
      for (const row of imported) localCases.set(row.id, row);
      state.cases = allCases();
      try {
        localStorage.setItem("rc.validation", JSON.stringify({ schema: VALIDATION_SCHEMA, revision: 2, cases: [...localCases.values()] }));
        state.caseMessage = `${imported.length}건을 반영했습니다. 같은 ID는 새 자료로 갱신했습니다.`;
      } catch { state.caseMessage = "현재 세션에 반영했습니다. 유지하려면 검증자료 JSON을 내려받으세요."; }
    } catch (err) { state.caseMessage = err.message; }
    sim = null; save(); return render();
  }
  state.formError = "";
  if (t.dataset.p) {
    const key = t.dataset.p, meta = rates.params[key], v = Number(t.value);
    if (meta.optional && !t.value) state.p[key] = -1;
    else if (!meta.locked && t.value && validRate(key, v)) state.p[key] = v;
    else return render();
  }
  else if (t.dataset.set === "officeMaterials") state.officeMaterials = t.checked;
  else if (t.dataset.set === "supplement") state.supplement = t.checked;
  else if (t.dataset.set === "caseId") state.caseId = t.value;
  else if (t.dataset.set === "calibrationType") state.calibrationType = t.value;
  else if (t.dataset.set === "scope" && state.model) {
    state.scope = t.value;
    state.areaConfirmed = false;
    state.area = Math.round((state.scope === "above" ? state.model.aboveArea : state.model.gross.area) * 100) / 100;
  }
  else if (["concreteCase", "usage", "site", "labor", "equipment", "scope", "structure", "scaffold", "equipmentCrewPeriod"].includes(t.dataset.set)) state[t.dataset.set] = t.value;
  else if (caseFields.includes(t.dataset.set)) {
    const key = t.dataset.set, v = t.value === "" ? undefined : Number(t.value);
    const limit = t.max ? Number(t.max) : Infinity;
    if (v != null && (!Number.isFinite(v) || (v < 0 && key !== "pvcPrice") || v > limit || (key === "mountedProduction" && v === 0))) state.formError = "입력 범위를 확인하세요.";
    else if (key.startsWith("mixed") && (v ?? 0) + (state[key === "mixedMineral" ? "mixedCombustible" : "mixedMineral"] ?? 0) > 100) {
      state.formError = "혼합·기타 중 건설폐재류와 가연물의 합은 100% 이하여야 합니다.";
    } else state[key] = v;
  }
  else if (t.dataset.set) {
    const v = Number(t.value);
    if (v > 0 && Number.isFinite(v)) {
      state[t.dataset.set] = t.dataset.set === "floors" ? Math.max(1, Math.round(v)) : v;
      if (t.dataset.set === "area") state.areaConfirmed = true;
    }
  }
  else if (t.dataset.override != null) { if (t.value) state.overrides[t.dataset.override] = t.value; else delete state.overrides[t.dataset.override]; }
  else return;
  sim = null; save(); render();
});

document.addEventListener("dragover", (e) => { if ($("#drop")) { e.preventDefault(); $("#drop").classList.add("over"); } });
document.addEventListener("dragleave", () => $("#drop")?.classList.remove("over"));
document.addEventListener("drop", async (e) => {
  if (!$("#drop")) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadIfc(await f.arrayBuffer(), f.name);
});

const tip = $("#tip");
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = e.clientY + 16 + "px";
});

render();
