// IFC 부재(종류·재료 층·부피·면적) → 폐기물 성상별 톤수. DOM·web-ifc를 쓰지 않는다.
import { SEPARATED, STREAMS } from "./scenario.js";

export const CATEGORY_LABEL = {
  wall: "벽", slab: "슬래브", beam: "보", column: "기둥", footing: "기초", stair: "계단", roof: "지붕",
  window: "창호", door: "문", covering: "마감", railing: "난간", plate: "판·부재", pipe: "배관·덕트", other: "기타",
};

// 재료 이름 키워드 → 재료 분류. 위에서부터 먼저 맞는 것을 쓴다.
// ponytail: 이름 키워드 방식이라 오분류가 있을 수 있다. 화면에서 그룹별로 성상을 고칠 수 있게 했다.
const MATERIALS = [
  ["insulation", "resin", /insulation|단열|\beps\b|\bxps\b|styro|urethane|우레탄|스티로폼/i],
  ["board", "board", /gypsum|석고|plasterboard|drywall|보드|board|텍스/i],
  ["glass", "glass", /glass|유리|glazing/i],
  ["aluminum", "aluminum", /alumin|알루미늄|샤시|sash/i],
  ["copper", "copper", /copper|구리|동관|brass|황동/i],
  ["resin", "resin", /pvc|vinyl|plastic|polymer|합성수지|장판|linoleum|리놀륨|epoxy|carpet|카펫|벽지|wallpaper|rubber/i],
  ["wood", "wood", /wood|timber|plywood|목재|합판|마루|lumber|mdf|oak|pine|각재/i],
  ["metal", "metal", /steel|강재|철골|iron|metal|\bSS\d|\bSM\d|SHN|H-?beam|stud|galvan/i],
  ["masonry", "concrete", /brick|block|masonry|조적|벽돌|블록|cmu|stone|석재/i],
  ["mixed", "mixed", /tile|타일|ceramic|도기|plaster|회반죽|paint|도장/i],
  ["concrete", "concrete", /concrete|콘크리트|\brc\b|cast|mortar|모르타르|screed|cement|시멘트/i],
];
// 재료 이름으로 알 수 없을 때 부재 종류로 정하는 기본값
const FALLBACK = {
  wall: "concrete", slab: "concrete", beam: "concrete", column: "concrete", footing: "concrete", stair: "concrete", roof: "concrete",
  covering: "mixed", railing: "metal", plate: "metal", pipe: "resin", other: "mixed",
};
const STRUCTURAL = new Set(["wall", "slab", "beam", "column", "footing", "stair", "roof"]);
const streamOf = (cls) => MATERIALS.find((m) => m[0] === cls)?.[1] || cls;

export function materialClass(name) {
  return MATERIALS.find(([, , re]) => re.test(name || ""))?.[0] || null;
}

export const groupKey = (el) => `${el.category}|${el.layers.map((l) => l.name).join("+") || "(재료 없음)"}`;

// 부재 하나 → { parts: [{cls, stream, m3, tons}], tons, stream(가장 무거운 성상), guessed }
export function classify(el, rates, overrides = {}) {
  const D = rates.density, parts = [];
  let guessed = false;
  const push = (cls, m3, tons) => parts.push({ cls, stream: streamOf(cls), m3, tons: tons ?? m3 * D[cls] });

  if (el.category === "window") {
    // 유리 + 창틀: 두께를 알기 어려워 면적당 무게로 계산
    const frame = el.layers.map((l) => materialClass(l.name)).find((c) => c && c !== "glass") || "aluminum";
    push("glass", 0, el.area * rates.perArea.window_glass);
    push(frame, 0, el.area * rates.perArea.window_frame);
  } else if (el.category === "door") {
    const cls = el.layers.map((l) => materialClass(l.name)).find(Boolean);
    if (!cls) guessed = true;
    push(cls || "wood", 0, el.area * rates.perArea.door);
  } else {
    const named = el.layers.map((l) => ({ ...l, cls: materialClass(l.name) }));
    const thick = named.reduce((s, l) => s + l.thickness, 0);
    if (thick > 0) {
      // 복합 부재: 층 두께 비율로 부피를 나눈다
      for (const l of named) {
        if (!l.thickness) continue;
        if (!l.cls) guessed = true;
        push(l.cls || FALLBACK[el.category], (el.volume * l.thickness) / thick);
      }
    } else {
      const cls = named.find((l) => l.cls)?.cls;
      if (!cls) guessed = true;
      push(cls || FALLBACK[el.category], el.volume);
    }
  }

  const over = overrides[groupKey(el)];
  if (over) { for (const p of parts) p.stream = over; guessed = false; }
  const tons = parts.reduce((s, p) => s + p.tons, 0);
  const stream = [...parts].sort((a, b) => b.tons - a.tons)[0]?.stream || "mixed";
  return { ...el, parts, tons, stream, guessed };
}

// 분류한 부재 목록 → 엔진 물량. 철근은 모델에 없으므로 엔진이 콘크리트 부피에서 추정한다.
export function quantitiesFromElements(classified, area_m2) {
  const t = Object.fromEntries(STREAMS.map((s) => [s, 0]));
  let concrete_m3 = 0;
  for (const el of classified) for (const p of el.parts) {
    t[p.stream] += p.tons;
    if (p.cls === "concrete" && STRUCTURAL.has(el.category)) concrete_m3 += p.m3;
  }
  return { area_m2, concrete_m3, rebarFromConcrete: true, t, basis: "IFC" };
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
export function checkAgainstUnits(q, usage, rates) {
  const u = rates.wasteUnits[usage];
  return Object.keys(u).map((s) => {
    const model = (s === "metal" && q.rebarFromConcrete ? q.t.metal + (q.concrete_m3 * rates.params.rebar_kg_per_m3.value) / 1000 : q.t[s]) / q.area_m2;
    return { stream: s, model, unit: u[s], ratio: model / u[s] };
  });
}

// 부재별 결과 (전면 분별 시나리오 기준) — CSV와 Revit 되쓰기에 쓴다
export function elementResults(classified, p) {
  const fee = (s) => s === "concrete" ? p.fee_concrete_selective
    : s === "wood" ? p.rec_sel * p.fee_wood + (1 - p.rec_sel) * p.fee_mixed_selective
    : s === "resin" ? p.rec_sel * p.fee_resin + (1 - p.rec_sel) * p.fee_mixed_selective
    : s === "glass" || s === "board" || s === "mixed" ? p.fee_mixed_selective : 0;
  const price = (s) => s === "metal" ? p.rec_scrap_sel * p.price_scrap
    : s === "copper" ? p.rec_nonferrous_sel * p.price_copper
    : s === "aluminum" ? p.rec_nonferrous_sel * p.price_aluminum
    : s === "wood" ? p.rec_sel * p.price_wood
    : s === "resin" ? p.rec_sel * p.price_resin : 0;
  return classified.map((el) => ({
    globalId: el.globalId, tag: el.tag, category: el.category, floor: el.floor, stream: el.stream,
    method: SEPARATED.has(el.stream) ? "분별" : "압쇄",
    tons: el.tons,
    disposal: el.parts.reduce((s, x) => s + x.tons * fee(x.stream), 0),
    revenue: el.parts.reduce((s, x) => s + x.tons * price(x.stream), 0),
  }));
}

export function toCsv(results) {
  const head = "GlobalId,ElementId,Category,Floor,RC_Waste,RC_Method,RC_Tons,RC_DisposalCost,RC_Revenue";
  return [head, ...results.map((r) => [r.globalId, r.tag, r.category, r.floor, r.stream, r.method, r.tons.toFixed(4), Math.round(r.disposal), Math.round(r.revenue)].join(","))].join("\n") + "\n";
}
