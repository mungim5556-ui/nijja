// BIM 편집기의 기준 데이터: 재료, 폐기물 성상, 부재 구성(어셈블리), 해체 품, 단가.
// 품과 처리단가의 기본값은 박지선·장경필·송태협(2023), 한국건설순환자원학회 논문집 11(3) 251-259에서 가져왔다.
// 재료 밀도는 프로토타입용 가정값이며 KDS 41 10 15 등 원문으로 확인해야 한다.

export const PAPER = {
  cite: "박지선·장경필·송태협 (2023), 건축물 분별해체 제도 활성화를 위한 경제적 효용성 평가, 한국건설순환자원학회 논문집 11(3) 251-259",
  doi: "10.14190/JRCR.2023.11.3.251",
};

/* ---------- 폐기물 성상 ---------- */
// 건설폐기물법 시행령 별표 1의 18종 가운데 이 편집기가 다루는 것.
export const WASTE = {
  concrete: { label: "폐콘크리트·건설폐재류", color: "#9C9084", combustible: false },
  metal: { label: "폐금속류", color: "#4A6FA5", combustible: false },
  wood: { label: "폐목재", color: "#B07A45", combustible: true },
  resin: { label: "폐합성수지", color: "#3E9C8F", combustible: true },
  glass: { label: "폐유리", color: "#7FB3D5", combustible: false },
  board: { label: "폐보드류", color: "#C9B79C", combustible: false },
  tile: { label: "폐타일·도자기", color: "#B85C4A", combustible: false },
  wallpaper: { label: "폐벽지", color: "#D9B23A", combustible: true },
  mixed: { label: "혼합건설폐기물", color: "#6B6560", combustible: false },
};

/* ---------- 재료 ---------- */
// density: t/㎥ (가정값)
export const MATERIALS = {
  rc: { label: "철근콘크리트", density: 2.45, waste: "concrete" },
  mortar: { label: "시멘트 모르타르", density: 2.0, waste: "concrete" },
  plaster: { label: "회반죽·플라스터", density: 1.6, waste: "concrete" },
  brick: { label: "벽돌", density: 1.9, waste: "concrete" },
  lumber: { label: "각재(목재)", density: 0.5, waste: "wood" },
  plywood: { label: "합판", density: 0.6, waste: "wood" },
  flooring: { label: "마루판", density: 0.7, waste: "wood" },
  tex: { label: "텍스(광물섬유판)", density: 0.35, waste: "board" },
  gypsum: { label: "석고보드", density: 0.8, waste: "board" },
  pvcSheet: { label: "장판·리놀륨(PVC)", density: 1.35, waste: "resin" },
  pvcFrame: { label: "PVC 창틀", density: 1.4, waste: "resin" },
  eps: { label: "단열재(EPS)", density: 0.02, waste: "resin" },
  tile: { label: "타일", density: 2.0, waste: "tile" },
  wallpaper: { label: "벽지", density: 0.8, waste: "wallpaper" },
  glass: { label: "판유리", density: 2.5, waste: "glass" },
  aluminum: { label: "알루미늄", density: 2.7, waste: "metal" },
  steel: { label: "강재", density: 7.85, waste: "metal" },
  woodDoor: { label: "목재 문짝·문틀", density: 0.55, waste: "wood" },
};

/* ---------- 해체 품 (인/㎡) ---------- */
// general: 논문 표 3(일반 해체), selective: 논문 표 4(분별 해체). 단위 인/㎡.
// 논문은 모든 항목에 공사면적(2,400㎡)을 곱했고, BIM 모드에서는 해당 부재의 면적을 곱한다.
// selectiveAligned: 표 4에서 빠지거나 줄어든 두 항목(천장 모르타르, 바닥 타일)을 표 3과 같게 맞춘 값.
export const WORK_ITEMS = {
  "roof.tile": { label: "지붕 기와", general: { roofer: 0.01, laborer: 0.02 }, selective: { roofer: 0.01, laborer: 0.02 } },
  "roof.frame": { label: "지붕틀", general: { carpenter: 0.04, laborer: 0.02 }, selective: { laborer: 0.02 } },
  "roof.masonry": { label: "지붕 조적", general: { mason: 0.02, laborer: 0.02 }, selective: { mason: 0.02, laborer: 0.02 } },
  "ceiling.rafter": { label: "천장 반자틀", general: { carpenter: 0.05, laborer: 0.025 }, selective: { carpenter: 0.05, laborer: 0.025 } },
  "ceiling.tex": { label: "천장 텍스·합판", general: { carpenter: 0.015, laborer: 0.03 }, selective: { carpenter: 0.05, laborer: 0.03 } },
  "ceiling.mortar": { label: "천장 모르타르·회반죽", general: { laborer: 0.12 }, selective: {}, selectiveAligned: { laborer: 0.12 } },
  "wall.partition": { label: "벽 목공사·칸막이", general: { carpenter: 0.06, laborer: 0.03 }, selective: { carpenter: 0.05, laborer: 0.03 } },
  "wall.tex": { label: "벽 텍스·합판", general: { carpenter: 0.01, laborer: 0.02 }, selective: { carpenter: 0.025, laborer: 0.02 } },
  "wall.wainscot": { label: "징두리판벽", general: { laborer: 0.03 }, selective: { laborer: 0.03 } },
  "wall.plaster": { label: "회벽", general: { laborer: 0.04 }, selective: { laborer: 0.04 } },
  "wall.tile": { label: "벽 타일", general: { laborer: 0.2 }, selective: { laborer: 0.2 } },
  "wall.wallpaper": { label: "벽지", general: { laborer: 0.01 }, selective: { laborer: 0.01 } },
  "floor.wood": { label: "바닥 장선·마루판", general: { carpenter: 0.2, laborer: 0.1 }, selective: { carpenter: 0.1, laborer: 0.1 } },
  "floor.mortar": { label: "바닥 모르타르", general: { laborer: 0.12 }, selective: { laborer: 0.12 } },
  "floor.linoleum": { label: "바닥 리놀륨·장판", general: { laborer: 0.03 }, selective: { laborer: 0.03 } },
  "floor.tile": { label: "바닥 타일", general: { laborer: 0.2 }, selective: { laborer: 0.02 }, selectiveAligned: { laborer: 0.2 } },
  "opening.glass": { label: "유리 철거", general: {}, selective: { carpenter: 0.02, laborer: 0.05 } },
  "opening.window": { label: "창틀 분리", general: {}, selective: { carpenter: 0.05, laborer: 0.025 } },
  "opening.door": { label: "문틀 분리", general: {}, selective: { carpenter: 0.02, laborer: 0.05 } },
  // 분별해체에만 있는 공정. 부재가 아니라 연면적에 곱한다.
  "sorting": { label: "폐기물 선별·분리 반출", general: {}, selective: { carpenter: 0.1, laborer: 0.2 }, perGFA: true },
};

export const TRADES = {
  carpenter: "목공",
  laborer: "보통인부",
  roofer: "지붕공",
  mason: "조적공",
};

/* ---------- 기본 단가 ---------- */
export const DEFAULT_PARAMS = {
  basis: "논문(2023) 기준값",
  // 노임 (원/인). 논문 표 5. 지붕공·조적공은 두 방법에 같아 논문이 계산에서 뺐으므로 0으로 둔다.
  wage: { carpenter: 267639, laborer: 161858, roofer: 0, mason: 0 },
  // 처리단가 (원/t). 한국건설자원협회 2023 공시(논문 표 7), 목재·합성수지는 논문 표 8·9.
  disposal: {
    concrete: 46374,
    wood: 35000,
    resin: 49000,
    glass: 67377, // 가정: 분리된 유리는 가연성 5% 미만 혼합건설폐기물 단가
    board: 67377, // 가정
    tile: 46374, // 가정: 불연성이라 건설폐재류와 함께 처리
    wallpaper: 67377, // 논문: 벽지는 분리하지 않고 혼합으로 배출
    metal: 0,
    mixedGeneral: 166193, // 일반 해체: 가연성이 섞인 혼합폐기물
    mixedSelective: 67377, // 분별 해체: 가연성이 빠진 혼합폐기물
  },
  // 재활용 수익 (원/t). 논문은 제품 판매가로 계산했다.
  revenue: {
    wood: Math.round(4000 / (0.9 * 1.8 * 0.01 * 0.9)), // 합판 4,000원/장, 0.9×1.8×0.01m, 밀도 0.9 → 약 274,348원/t
    resin: 850000, // 그래뉼
    metal: 0, // 두 방법에 공통이므로 0
  },
  recovery: 1.0, // 회수율. 논문은 100%를 가정했다.
  residualMixed: true, // 모델에 없는 혼합폐기물을 논문 표 6 원단위로 보정
  // 표 4를 그대로 쓸지(논문), 표 3과 맞춘 값을 쓸지
  table4: "paper", // paper | aligned
  // 공기·간접비 (논문에 없는 확장 항목)
  crewSize: 20, // 하루 투입 인원
  indirectPerDay: 0, // 원/일. 0이면 논문과 같은 범위로 계산한다.
};

/* ---------- 부재 종류와 구성 ---------- */
export const TYPES = {
  wall: { label: "벽", kind: "line", icon: "wall", defaults: { thickness: 0.2 }, structural: true },
  partition: { label: "칸막이", kind: "line", icon: "partition", defaults: { thickness: 0.1 } },
  column: { label: "기둥", kind: "point", icon: "column", defaults: { w: 0.5, d: 0.5 }, structural: true },
  beam: { label: "보", kind: "line", icon: "beam", defaults: { thickness: 0.3, depth: 0.5 }, structural: true },
  slab: { label: "슬래브", kind: "rect", icon: "slab", structural: true },
  ceiling: { label: "천장", kind: "rect", icon: "ceiling" },
  floorFinish: { label: "바닥 마감", kind: "rect", icon: "floor" },
  window: { label: "창", kind: "opening", icon: "window", defaults: { width: 1.8, height: 1.5, sill: 0.9 } },
  door: { label: "문", kind: "opening", icon: "door", defaults: { width: 0.9, height: 2.1, sill: 0 } },
};

// 어셈블리: 부재의 재료 층과 해체 작업.
// layers의 thickness는 m. area 기준 부재(천장·바닥)는 면적×두께, 벽은 길이×높이×두께로 부피를 낸다.
// faces: 벽 마감 층이 양면에 붙는지(2) 한 면인지(1)
export const ASSEMBLIES = {
  // 벽
  "wall.rc": { type: "wall", label: "RC 벽 (마감 없음)", layers: [{ m: "rc", t: 0.2, core: true }], work: [] },
  "wall.rc.paper": { type: "wall", label: "RC 벽 + 모르타르 + 벽지", layers: [{ m: "rc", t: 0.2, core: true }, { m: "mortar", t: 0.018, faces: 2 }, { m: "wallpaper", t: 0.0005, faces: 2 }], work: ["wall.wallpaper"], faces: 2 },
  "wall.rc.tile": { type: "wall", label: "RC 벽 + 타일 (욕실)", layers: [{ m: "rc", t: 0.2, core: true }, { m: "mortar", t: 0.02, faces: 1 }, { m: "tile", t: 0.008, faces: 1 }], work: ["wall.tile"], faces: 1 },
  "wall.rc.insul": { type: "wall", label: "RC 외벽 + 단열재 + 석고보드 + 벽지", layers: [{ m: "rc", t: 0.2, core: true }, { m: "eps", t: 0.09, faces: 1 }, { m: "gypsum", t: 0.0095, faces: 1 }, { m: "wallpaper", t: 0.0005, faces: 1 }], work: ["wall.tex", "wall.wallpaper"], faces: 1 },
  // 칸막이
  "partition.wood": { type: "partition", label: "목조 칸막이 (각재 + 양면 합판 + 벽지)", layers: [{ m: "lumber", t: 0.03, core: true }, { m: "plywood", t: 0.009, faces: 2 }, { m: "wallpaper", t: 0.0005, faces: 2 }], work: ["wall.partition", "wall.tex", "wall.wallpaper"], faces: 2 },
  "partition.gypsum": { type: "partition", label: "경량 칸막이 (강재 스터드 + 석고보드)", layers: [{ m: "steel", t: 0.002, core: true }, { m: "gypsum", t: 0.0125, faces: 2 }, { m: "wallpaper", t: 0.0005, faces: 2 }], work: ["wall.tex", "wall.wallpaper"], faces: 2 },
  "partition.brick": { type: "partition", label: "조적 칸막이 + 미장", layers: [{ m: "brick", t: 0.09, core: true }, { m: "plaster", t: 0.015, faces: 2 }], work: ["wall.plaster"], faces: 2 },
  // 구조
  "column.rc": { type: "column", label: "RC 기둥", layers: [{ m: "rc", core: true }], work: [] },
  "column.steel": { type: "column", label: "철골 기둥", layers: [{ m: "steel", core: true, fill: 0.08 }], work: [] },
  "beam.rc": { type: "beam", label: "RC 보", layers: [{ m: "rc", core: true }], work: [] },
  "slab.rc": { type: "slab", label: "RC 슬래브 210", layers: [{ m: "rc", t: 0.21 }], work: [] },
  // 천장
  "ceiling.tex": { type: "ceiling", label: "반자틀 + 텍스", layers: [{ m: "lumber", t: 0.006 }, { m: "tex", t: 0.012 }], work: ["ceiling.rafter", "ceiling.tex"] },
  "ceiling.plywood": { type: "ceiling", label: "반자틀 + 합판 + 벽지", layers: [{ m: "lumber", t: 0.006 }, { m: "plywood", t: 0.009 }, { m: "wallpaper", t: 0.0005 }], work: ["ceiling.rafter", "ceiling.tex"] },
  "ceiling.gypsum": { type: "ceiling", label: "경량철골 반자 + 석고보드", layers: [{ m: "steel", t: 0.0008 }, { m: "gypsum", t: 0.0095 }], work: ["ceiling.rafter", "ceiling.tex"] },
  "ceiling.plaster": { type: "ceiling", label: "모르타르·회반죽 천장", layers: [{ m: "plaster", t: 0.015 }], work: ["ceiling.mortar"] },
  // 바닥 마감
  "floor.linoleum": { type: "floorFinish", label: "모르타르 + 장판", layers: [{ m: "mortar", t: 0.04 }, { m: "pvcSheet", t: 0.002 }], work: ["floor.mortar", "floor.linoleum"] },
  "floor.wood": { type: "floorFinish", label: "모르타르 + 마루판", layers: [{ m: "mortar", t: 0.04 }, { m: "flooring", t: 0.012 }], work: ["floor.mortar", "floor.wood"] },
  "floor.tile": { type: "floorFinish", label: "모르타르 + 타일 (욕실)", layers: [{ m: "mortar", t: 0.04 }, { m: "tile", t: 0.01 }], work: ["floor.mortar", "floor.tile"] },
  // 개구부. layers 두께 대신 개구부 면적당 질량(kg/㎡)을 쓴다.
  "window.alPvc": { type: "window", label: "PVC 창틀 + 복층유리", perArea: [{ m: "pvcFrame", kg: 9 }, { m: "glass", kg: 20 }], work: ["opening.glass", "opening.window"] },
  "window.al": { type: "window", label: "알루미늄 창틀 + 유리", perArea: [{ m: "aluminum", kg: 6 }, { m: "glass", kg: 15 }], work: ["opening.glass", "opening.window"] },
  "door.wood": { type: "door", label: "목재 문 + 문틀", perArea: [{ m: "woodDoor", kg: 18 }], work: ["opening.door"] },
  "door.steel": { type: "door", label: "철재 현관문", perArea: [{ m: "steel", kg: 45 }], work: ["opening.door"] },
};

export const DEFAULT_ASSEMBLY = {
  wall: "wall.rc.paper",
  partition: "partition.wood",
  column: "column.rc",
  beam: "beam.rc",
  slab: "slab.rc",
  ceiling: "ceiling.tex",
  floorFinish: "floor.linoleum",
  window: "window.alPvc",
  door: "door.wood",
};

// 논문 표 1의 해체 시공성 6점 척도
export const SEPARABLE = {
  6: "일반 작업자가 원형 보존하며 해체",
  5: "특수 공구로 원형 보존 가능",
  4: "전문 인력·공구로 해체 가능",
  3: "습식·금속 고정이나 현장 해체 쉬움",
  2: "무겁거나 노출 위험, 이물질 많음",
  1: "현장 해체 시 작업자 위험",
};
export const SEPARABLE_MIN = 3; // 이 점수 미만이면 분별해체 대상에서 뺀다

export const CONNECTIONS = {
  screw: "나사·못",
  bolt: "볼트",
  clip: "클립·끼움",
  adhesive: "접착",
  mortar: "모르타르·습식",
  weld: "용접",
  monolithic: "일체 타설",
};

export const HAZARD = { none: "없음", suspected: "석면 의심", confirmed: "석면 확인" };

// 논문 표 6: 해체 시 폐기물 발생 원단위 (t/㎡, 국토교통부 2023 표준품셈)
export const WASTE_UNIT = {
  "주거 단독주택": { concrete: 1.3321, metal: 0.001, wood: 0.0968, resin: 0.0263, mixed: 0.203 },
  "주거 공동주택": { concrete: 1.477, metal: 0.0655, wood: 0.015, resin: 0.0261, mixed: 0.1637 },
  "비주거 RC": { concrete: 1.4028, metal: 0.073, wood: 0.0638, resin: 0.0215, mixed: 0.1348 },
  "비주거 철골": { concrete: 0.9167, metal: 0.055, wood: 0.0194, resin: 0.0261, mixed: 0.1348 },
  "비주거 SRC": { concrete: 1.5861, metal: 0.122, wood: 0.0018, resin: 0.0245, mixed: 0.1452 },
};
