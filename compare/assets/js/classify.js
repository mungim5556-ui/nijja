// IFC 부재(종류·재료 층·부피·면적) → 폐기물 성상별 톤수. DOM·web-ifc를 쓰지 않는다.
import { SEPARATED, STREAMS, EXCLUDED, separation, concreteGrades, rebarTons, streamTons } from "./scenario.js";

export const CATEGORY_LABEL = {
  wall: "벽", slab: "슬래브", beam: "보", column: "기둥", footing: "기초", stair: "계단", roof: "지붕",
  window: "창호", door: "문", covering: "마감", railing: "난간", plate: "판·부재", pipe: "배관·덕트", rebar: "철근 (모델)", other: "기타",
};

// 재료 이름 키워드 → 재료 분류. 위에서부터 먼저 맞는 것을 쓴다.
// ponytail: 이름 키워드 방식이라 오분류가 있을 수 있다. 화면에서 그룹별로 성상을 고칠 수 있게 했다.
const MATERIALS = [
  ["panel", "panel", /sandwich[ -]?panel|샌드위치[ -]?(?:패널|판넬)/i],
  // 철근·섬유로 "보강한" 콘크리트는 철근(강재)·유리섬유(단열재)보다 먼저 콘크리트로 잡는다
  ["concrete", "concrete", /철근\s*콘크리트|보강\s*콘크리트|reinforced\s*concrete|fib(?:er|re)[- ]?reinforced|GFRC|\bRC\b/i],
  // 유리섬유·광물섬유 단열재는 "glass/유리"보다 먼저 잡는다. 판유리 밀도(2.5t/㎥)로 세면 수십~수백 배 무거워진다.
  ["insulation", "resin", /insulation|단열|\beps\b|\bxps\b|styro|urethane|우레탄|스티로폼|polystyrene|폴리스티렌|glass\s*wool|fib(?:er|re)\s*glass|mineral\s*wool|rock\s*wool|그라스울|글라스울|유리\s*섬유|섬유\s*유리|유리면|암면|미네랄\s*울/i],
  ["board", "board", /gypsum|석고|plasterboard|drywall|보드|board|텍스/i],
  ["glass", "glass", /glass|유리|glaz/i],
  ["aluminum", "aluminum", /alumin|알루미늄|샤시|sash/i],
  ["copper", "copper", /copper|구리|동관|동판|brass|황동/i],
  ["resin", "resin", /pvc|염화비닐|비닐|vinyl|plastic|플라스틱|polymer|폴리|합성수지|아크릴|acrylic|장판|linoleum|리놀륨|epoxy|에폭시|carpet|카펫|벽지|wallpaper|rubber|고무|asphalt|아스팔트|방수|waterproof|membrane|bitumen/i],
  ["wood", "wood", /wood|timber|plywood|목재|합판|마루|lumber|mdf|oak|pine|각재/i],
  ["metal", "metal", /steel|강철|스틸|스테인리스|stainless|금속|강재|철골|철근|rebar|강관|강봉|형강|강판|철판|\bSTK[MNR]?\s*\d|iron|metal|\bSS\d|\bSM\d|SHN|H-?beam|stud|galvan|zinc|징크|아연/i],
  ["masonry", "masonry", /brick|block|masonry|조적|벽돌|블록|cmu|stone|석재|화강|granite|대리석|marble|석회석|limestone|사암|sandstone/i],
  ["tile", "tile", /tile|타일|ceramic|도기/i],
  ["mixed", "mixed", /plaster|회반죽|paint|도장/i],
  ["concrete", "concrete", /concrete|콘크리트|\brc\b|cast|mortar|모르타르|screed|cement|시멘트/i],
];
// 재료 이름으로 알 수 없을 때 부재 종류로 정하는 기본값
const FALLBACK = {
  wall: "concrete", slab: "concrete", beam: "concrete", column: "concrete", footing: "concrete", stair: "concrete", roof: "concrete",
  covering: "mixed", railing: "metal", plate: "metal", pipe: "resin", rebar: "metal", other: "mixed",
};
const STRUCTURAL = new Set(["wall", "slab", "beam", "column", "footing", "stair", "roof"]);
const streamOf = (cls) => MATERIALS.find((m) => m[0] === cls)?.[1] || cls;

export function materialClass(name) {
  return MATERIALS.find(([, , re]) => re.test(name || ""))?.[0] || null;
}

// IFC 수량표 중량 ÷ 형상 부피가 강재 밀도(약 7.85t/㎥) 범위이면 재료 정보가 없어도 강재로 본다
export function impliedSteel(el) {
  const density = el.weightTons / el.volume;
  return el.volume > 0 && Number.isFinite(density) && density >= 6.5 && density <= 9;
}

export const groupKey =(el) => `${el.category}${el.category === "plate" && /계단|디딤판|\btreads?\b|\bstairs?\b/i.test(el.name) ? "·stair" : ""}|${el.layers.map((l) => l.name).join("+") || "(재료 없음)"}`;

// 부재 하나 → { parts: [{cls, stream, m3, tons}], tons, stream(가장 무거운 성상), guessed }
export function classify(el, rates, overrides = {}, unknownFrame = "aluminum") {
  const D = rates.density, parts = [];
  let guessed = false, guessedConcreteTread = false;
  const push = (cls, m3, tons) => parts.push({ cls, stream: streamOf(cls), m3, tons: tons ?? m3 * (D[cls] ?? D[streamOf(cls)] ?? 0) });

  // 일부 IFC는 유리와 프레임을 하나의 판형 창호로 내보낸다.
  const combinedFrame = el.category === "window" || el.category === "plate"
    ? el.layers.find(layer => !layer.thickness && /유리|glass|glaz/i.test(layer.name)
      && /알루미늄|alumin|\bpvc\b|염화비닐|vinyl/i.test(layer.name))
    : null;
  const areaBased = el.category === "window" || el.category === "door"
    || (combinedFrame && el.area > 0 && !el.layers.some(layer => layer.thickness > 0));
  if (areaBased && el.category !== "door") {
    // 유리 + 창틀: 두께를 알기 어려워 면적당 무게로 계산
    const knownFrame = el.layers.map((l) => (materialClass(l.name) || materialClass(l.category))).find((c) => c && c !== "glass");
    const frame = combinedFrame
      ? (/\bpvc\b|염화비닐|vinyl/i.test(combinedFrame.name) ? "resin" : "aluminum")
      : knownFrame || unknownFrame;
    guessed = !knownFrame || el.category !== "window";
    push("glass", 0, el.area * rates.perArea.window_glass);
    push(frame, 0, el.area * rates.perArea.window_frame);
    parts[1].windowAssembly = true;
  } else if (el.category === "door") {
    const cls = el.layers.map((l) => (materialClass(l.name) || materialClass(l.category))).find(Boolean);
    if (!cls) guessed = true;
    push(cls || "wood", 0, el.area * rates.perArea.door);
  } else {
    const named = el.layers.map((l) => ({ ...l, cls: (materialClass(l.name) || materialClass(l.category)) }));
    const thick = named.reduce((s, l) => s + l.thickness, 0);
    if (thick > 0) {
      // 복합 부재: 층 두께 비율로 부피를 나눈다
      for (const l of named) {
        if (!l.thickness) continue;
        if (!l.cls || l.cls === "panel") guessed = true;
        push(l.cls || FALLBACK[el.category], (el.volume * l.thickness) / thick);
      }
    } else {
      let cls = named.find((l) => l.cls)?.cls;
      if (!cls || cls === "panel") guessed = true;
      if (!cls) {
        // 재료가 없으면 ① 수량표 중량/형상 부피로 본 밀도, ② 부재 이름(예: "System Panel: Glazed") 순으로 추정한다.
        // 재료 없는 강재 보를 콘크리트(2.4t/㎥)로, 유리 패널을 강재(7.85t/㎥)로 세는 것을 막는다.
        guessedConcreteTread = el.category === "plate" && !el.layers.some(l => l.name || l.category) && /계단|디딤판|\btreads?\b|\bstairs?\b/i.test(el.name);
        cls = guessedConcreteTread ? "concrete" : (impliedSteel(el) ? "metal" : null) || materialClass(el.name) || FALLBACK[el.category];
      }
      push(cls, el.volume);
    }
  }

  // 단일 강재 부재의 수량표 중량을 우선한다. 복합 부재의 전체 중량은 강재에 배정하지 않는다.
  const steelLayers = el.layers.length > 0 && el.layers.every(l => (materialClass(l.name) || materialClass(l.category)) === "metal");
  if (parts.length === 1 && parts[0].cls === "metal" && (steelLayers && !guessed || impliedSteel(el))
      && Number.isFinite(el.weightTons) && el.weightTons > 0) {
    parts[0].tons = el.weightTons;
  }
  // IfcBuildingElementProxy(기타)는 가구·가전·위생기구·조경수 같은 객체가 대부분이고 형상이 닫힌 솔리드가 아니어서
  // 부피가 터무니없이 나온다 (나무 한 그루가 수백 t). 기본은 집계에서 빼고, 화면에서 성상을 고르면 넣는다.
  // 단, 재료 이름으로 성상을 알 수 있는 기타 객체(콘크리트·강재 등으로 모델링한 구조 부재)는 넣는다.
  // ArchiCAD 등은 구조 부재를 IfcBuildingElementProxy로 내보내는 경우가 있어, 통째로 빼면 물량이 크게 빠진다.
  if (el.category === "other" && guessed) { for (const p of parts) p.stream = EXCLUDED; guessed = false; }
  const over = overrides[groupKey(el)];
  if (over) {
    if (over === EXCLUDED || over === "mixed") {
      for (const part of parts) part.stream = over;
    } else if (!parts.every(part => part.stream === over)) {
      // 창호·문의 면적 기준 질량은 성상 정정 후에도 유지한다.
      const areaWeight = areaBased ? parts.reduce((sum, part) => sum + part.tons, 0) : undefined;
      parts.length = 0;
      push(over, areaBased ? 0 : el.volume, areaWeight);
    }
    guessed = false;
    guessedConcreteTread = false;
  }
  if (parts.length === 1 && parts[0].stream === "panel" && Number.isFinite(el.weightTons) && el.weightTons > 0) {
    parts[0].tons = el.weightTons;
  }
  const tons = parts.reduce((s, p) => s + p.tons, 0);
  const stream = [...parts].sort((a, b) => b.tons - a.tons)[0]?.stream || "mixed";
  return { ...el, parts, tons, stream, guessed, guessedConcreteTread };
}

// 벽·바닥·지붕이 모델링되지 않은 개방형 철골은 건축물 RC 견적식의 적용 대상에서 뺀다.
export function isOpenSteelFrame(classified) {
  const above = classified.filter(el => !el.basement && el.category !== "footing" && el.stream !== EXCLUDED);
  const canopy = above.some(el => ["roof", "covering"].includes(el.category) && /차양막|막구조|canopy/i.test(el.name ?? ""));
  const enclosed = above.some(el => ["wall", "slab", "roof"].includes(el.category)
    && !(canopy && el.category !== "slab" && ["panel", "resin"].includes(el.stream)));
  return !enclosed
    && above.some(el => el.category === "column" && el.stream === "metal")
    && above.some(el => ["beam", "plate"].includes(el.category) && el.stream === "metal");
}

// 분류한 부재 목록 → 엔진 물량. 철근은 모델에 없으므로 엔진이 콘크리트 부피에서 추정한다.
export function quantitiesFromElements(classified, area_m2) {
  const t = Object.fromEntries(STREAMS.map((s) => [s, 0]));
  const areaTypes = { board: "board", tile: "tile", aluminum: "aluminum", pvc: "resin" };
  const finishAreas = {};
  for (const [key, cls] of Object.entries(areaTypes)) {
    const frame = key === "aluminum" || key === "pvc";
    const matching = classified.filter((el) => !el.guessed && el.area > 0
      && (key !== "pvc" || el.layers.some((layer) => /pvc|vinyl|염화비닐/i.test(layer.name)))
      && (!frame || el.category === "window")
      && el.parts.some((p) => p.cls === cls && p.stream === streamOf(cls)));
    if (matching.length) finishAreas[key] = matching.reduce((sum, el) => sum + el.area, 0);
  }
  let concrete_m3 = 0, masonry_m3 = 0;
  for (const el of classified) for (const p of el.parts) {
    if (!(p.stream in t)) continue; // 제외한 부재
    t[p.stream] += p.tons;
    if (p.stream === "concrete" && STRUCTURAL.has(el.category)) concrete_m3 += p.m3;
    // 조적벽도 압쇄기로 허물므로 장비 시간·구조체 공기에 넣는다 (철근 추정에는 넣지 않는다)
    if (p.stream === "masonry" && STRUCTURAL.has(el.category)) masonry_m3 += p.m3;
  }
  // 모델에 그린 철근(IfcReinforcingBar 등)은 이미 metal에 들어 있다. 엔진은 콘크리트 부피로 추정한 철근량에서 이만큼을 뺀다.
  const rebarModeledTons = classified.filter((el) => el.category === "rebar" && el.stream === "metal").reduce((sum, el) => sum + el.tons, 0);
  return { area_m2, concrete_m3, masonry_m3, finishAreas, rebarFromConcrete: true, rebarModeledTons, t, basis: "IFC" };
}

// Board and tile use one takeoff for labor and disposal. Reserve estimated mass from
// untyped mixed waste first, since that stock may already include those finishes.
export function connectFinishTakeoff(q, raw, rates, params) {
  q.t = { ...q.t };
  q.finishTakeoff = {};
  let estimated = 0;
  for (const key of ["board", "tile"]) {
    const tonsPerArea = rates.density[key] * rates.finishThickness[key];
    const inputWeight = q[key + "Weight"];
    const measured = inputWeight ?? raw.t[key];
    const hasWeight = inputWeight != null || measured > 0;
    const modeledArea = q.finishAreas[key];
    const unverified = q.finishFallbackDisabled && !hasWeight && modeledArea == null;
    const area = modeledArea ?? (hasWeight ? measured / tonsPerArea : unverified ? 0 : q.area_m2 * params["int_" + key + "_ratio"]);
    const tons = hasWeight ? measured : area * tonsPerArea;
    q.finishAreas[key] = area;
    q.t[key] = tons;
    q.finishTakeoff[key] = { area, tons, estimatedWeight: !hasWeight, estimatedArea: modeledArea == null, unverified };
    if (!hasWeight) estimated += tons;
  }
  const untyped = Math.max(0, 1 - (q.mixedMineral ?? 0) - (q.mixedCombustible ?? 0));
  const reused = Math.min(estimated, q.t.mixed * untyped);
  if (reused > 0) {
    const original = q.t.mixed;
    q.t.mixed -= reused;
    const scale = q.t.mixed > 0 ? original / q.t.mixed : 0;
    q.mixedMineral = (q.mixedMineral ?? 0) * scale;
    q.mixedCombustible = (q.mixedCombustible ?? 0) * scale;
  }
  q.finishMixedReallocated = reused;
}

// 모델에 내장재가 빠져 있으면 표준품셈 원단위로 채운다 (모델 값이 원단위의 절반 미만인 성상만)
export function supplement(q, usage, rates) {
  const u = rates.wasteUnits[usage], added = {}, t = { ...q.t };
  for (const s of ["wood", "resin", "mixed"]) {
    const expected = u[s] * q.area_m2;
    if (t[s] < expected * 0.5) { added[s] = expected - t[s]; t[s] = expected; }
  }
  return { ...q, t, added };
}

// 모델의 t/㎡을 원단위와 비교 (검산)
export function checkAgainstUnits(q, usage, rates, rebarKgPerM3 = rates.params.rebar_kg_per_m3.value) {
  const u = rates.wasteUnits[usage];
  const { t, rebarAdded } = streamTons(q, { rebar_kg_per_m3: rebarKgPerM3 });
  return Object.keys(u).map((s) => {
    const model = t[s] / q.area_m2;
    return { stream: s, model, unit: u[s], ratio: model / u[s], estimatedRebarTons: s === "metal" ? rebarAdded : 0 };
  });
}

// 부재별 결과 (전면 분별 시나리오 기준) — CSV와 Revit 되쓰기에 쓴다
// mixedFee: 건물 전체로 판정한 분별 후 혼합건설폐기물 단가 (scenario.js의 mixedWaste().fee)
export function isStructuralSteelPart(el, part) {
  return part.stream === "metal" && (["beam", "column"].includes(el.category) || el.category === "plate" && !el.guessed);
}

export function elementResults(classified, p, mixedFee = p.fee_mixed_unverified, q = {}) {
  const cost = (net) => Math.max(0, -net), gain = (net) => Math.max(0, net);
  const split = separation(p);
  const quotedShare = q.cleanPrice == null ? 0 : (q.cleanSel ?? 0) / 100;
  const gradeFee = concreteGrades(p, true, q.concreteCase).reduce((sum, grade) => sum + grade.share * grade.fee, 0);
  const concreteFee = (1 - quotedShare) * gradeFee + quotedShare * (q.cleanPrice ?? 0);
  const fee = (s) => s === "concrete" ? concreteFee
    : s === "masonry" ? p.fee_concrete
    : s === "wood" ? split.wood * cost(p.net_wood) + (1 - split.wood) * mixedFee
    : s === "resin" ? split.resin * cost(p.net_resin) + (1 - split.resin) * mixedFee
    : s === "glass" ? split.glass * Math.max(0, p.fee_glass_separate) + (1 - split.glass) * mixedFee
    : s === "board" ? split.board * Math.max(0, p.fee_board_separate) + (1 - split.board) * mixedFee
    : s === "panel" ? Math.max(0, p.fee_panel)
    : s === "mixed" || s === "tile" ? mixedFee : 0;
  const price = (s) => s === "metal" ? p.rec_scrap_sel * p.price_scrap
    : s === "copper" ? (q.fixedComparison ? 0 : (p.rec_copper_sel ?? p.rec_nonferrous_sel) * p.price_copper)
    : s === "aluminum" ? p.rec_nonferrous_sel * p.price_aluminum
    : s === "wood" ? split.wood * gain(p.net_wood)
    : s === "resin" ? split.resin * gain(p.net_resin) : 0;
  // 구조 콘크리트 안의 철근 추정량은 엔진과 같이 폐콘크리트에서 빼서 고철로 센다
  // 모델 철근이 있으면 엔진과 같이: 콘크리트에서는 철근 전체를 빼고, 고철 수익은 모델에 없는 추정분만 콘크리트 부재에 배분한다
  const total = q.concrete_m3 > 0 ? streamTons({ ...q, t: { concrete: Infinity } }, p) : null;
  const estimated = q.concrete_m3 > 0 ? rebarTons(q, p.rebar_kg_per_m3) : 0;
  const scale = total && estimated > 0 ? total.rebar / estimated : 1, sold = total && total.rebar > 0 ? total.rebarAdded / total.rebar : 1;
  const rebarOf = (el, x) => x.cls === "concrete" && x.stream === "concrete" && STRUCTURAL.has(el.category)
    ? Math.min(x.tons, scale * rebarTons({ concrete_m3: x.m3, rebarKgPerM3: q.rebarKgPerM3 }, p.rebar_kg_per_m3)) : 0;
  return classified.map((el) => ({
    globalId: el.globalId, tag: el.tag, category: el.category, floor: el.floor, stream: el.stream,
    method: el.stream === EXCLUDED ? "제외" : SEPARATED.has(el.stream) ? "분별" : "압쇄",
    tons: el.tons,
    disposal: el.parts.reduce((s, x) => s + (x.tons - rebarOf(el, x)) * (q.windowMode && x.stream === "glass" && (el.category === "window" || el.parts.some(part => part.windowAssembly)) ? p.fee_mixed_unverified : fee(x.stream))
      + (q.fixedComparison && x.stream === "metal" && el.category !== "rebar" ? x.tons * (1 - (q.steelWork && isStructuralSteelPart(el, x) ? p.rec_structural_steel ?? p.rec_scrap_sel : p.rec_scrap_sel)) * p.fee_mixed_unverified : 0)
      + rebarOf(el, x) * (1 - p.rec_scrap_sel) * p.fee_concrete, 0),
    revenue: el.parts.reduce((s, x) => s + x.tons * ((el.category === "window" || x.windowAssembly) && x.stream === "aluminum" && q.windowMode
      ? q.alPrice == null ? p.price_aluminum : q.alPrice * 1000
      : q.steelWork && isStructuralSteelPart(el, x) ? (p.rec_structural_steel ?? p.rec_scrap_sel) * p.price_scrap : price(x.stream)) + rebarOf(el, x) * sold * price("metal"), 0),
  }));
}

export function reconcileElementResults(results, appliedTons, scenario) {
  const exported = results.reduce((sum, row) => {
    if (row.stream !== EXCLUDED) sum.weightUnits += Math.round(Number(row.tons.toFixed(4)) * 10000);
    sum.disposal += Math.round(row.disposal);
    sum.revenue += Math.round(row.revenue);
    return sum;
  }, { weightUnits: 0, disposal: 0, revenue: 0 });
  const weightUnits = Math.round(appliedTons * 10000) - exported.weightUnits;
  const disposal = Math.round(scenario.disposal) - exported.disposal;
  const revenue = Math.round(scenario.revenue) - exported.revenue;
  if (weightUnits === 0 && disposal === 0 && revenue === 0) return results;
  return [...results, {
    globalId: "", tag: "", category: "adjustment", floor: "", stream: "",
    method: "합계 정산", tons: weightUnits / 10000, disposal, revenue,
  }];
}

export function toCsv(results) {
  const head = "GlobalId,ElementId,Category,Floor,RC_Waste,RC_Method,RC_Tons,RC_DisposalCost,RC_Revenue";
  return [head, ...results.map((r) => [r.globalId, r.tag, r.category, r.floor, r.stream, r.method, r.tons.toFixed(4), Math.round(r.disposal), Math.round(r.revenue)].join(","))].join("\n") + "\n";
}
