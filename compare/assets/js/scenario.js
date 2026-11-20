// 일괄 압쇄 vs 전면 분별해체 비용 엔진. DOM을 쓰지 않는 순수 함수만 둔다.
// 물량 q = { area_m2, concrete_m3, rebarFromConcrete, t: { concrete, metal, wood, resin, glass, board, mixed, copper, aluminum } }
// 단가 p = { 키: 숫자 } (rates.json의 params에서 value만 뽑은 것)

export const STREAMS = ["concrete", "metal", "wood", "resin", "glass", "board", "mixed", "copper", "aluminum"];
export const STREAM_LABEL = {
  concrete: "폐콘크리트·조적", metal: "철근·강재", wood: "폐목재", resin: "폐합성수지", glass: "폐유리",
  board: "폐보드", mixed: "혼합·기타", copper: "구리", aluminum: "알루미늄",
};
// 분별해체에서 따로 떼어 내는 성상 (나머지는 구조체와 함께 압쇄)
export const SEPARATED = new Set(["wood", "resin", "glass", "board", "copper", "aluminum"]);

export const paramValues = (rates) => Object.fromEntries(Object.entries(rates.params).map(([k, v]) => [k, v.value]));

const tons = (q) => Object.fromEntries(STREAMS.map((s) => [s, Number(q.t?.[s]) || 0]));

export function costScenario(q, p, mode) {
  const sel = mode === "selective";
  const t = tons(q);
  // IFC 모델에는 철근이 없으므로 콘크리트 부피에서 추정한다
  const metal = t.metal + (q.rebarFromConcrete ? (q.concrete_m3 * p.rebar_kg_per_m3) / 1000 : 0);
  const rows = [];
  const add = (group, item, qty, unit, price, sign = 1) => {
    const amount = sign * qty * price;
    rows.push({ group, item, qty, unit, price, amount });
    return amount;
  };

  // 1. 내장재 해체 인건비 (논문 표 3·4·5: 면적 × 품 × 노임)
  const carpenters = q.area_m2 * (sel ? p.sel_carpenter : p.crush_carpenter);
  const laborers = q.area_m2 * (sel ? p.sel_laborer : p.crush_laborer);
  let labor = add("인건비", "내장재 해체 목공", carpenters, "인", p.wage_carpenter)
    + add("인건비", "내장재 해체 보통인부", laborers, "인", p.wage_laborer);

  // 2. 구조체 해체 (두 안에 공통)
  const structDays = q.concrete_m3 / p.crush_m3_per_day;
  labor += add("인건비", "구조체 해체 보조 인부", structDays * p.structure_crew, "인", p.wage_laborer);
  const equipment = add("장비비", "굴착기+압쇄기", structDays * p.hours_per_day, "h", p.excavator_per_h);

  // 3. 폐기물 처리비 — 압쇄는 떼지 않은 내장재가 모두 혼합폐기물이 된다
  const sep = sel ? p.rec_sel : 0;
  const wood = t.wood * sep, resin = t.resin * sep;
  const mixed = t.mixed + t.glass + t.board + t.wood - wood + t.resin - resin;
  let disposal = add("처리비", STREAM_LABEL.concrete, t.concrete, "t", sel ? p.fee_concrete_selective : p.fee_concrete)
    + add("처리비", "혼합건설폐기물", mixed, "t", sel ? p.fee_mixed_selective : p.fee_mixed_crush);
  if (sel) disposal += add("처리비", "분리 폐목재", wood, "t", p.fee_wood) + add("처리비", "분리 폐합성수지", resin, "t", p.fee_resin);

  // 4. 매각 수익
  const nf = sel ? p.rec_nonferrous_sel : p.rec_nonferrous_crush;
  let revenue = -add("매각수익", "고철", metal * (sel ? p.rec_scrap_sel : p.rec_scrap_crush), "t", p.price_scrap, -1)
    - add("매각수익", "구리", t.copper * nf, "t", p.price_copper, -1)
    - add("매각수익", "알루미늄", t.aluminum * nf, "t", p.price_aluminum, -1);
  if (sel) revenue += -add("매각수익", "폐목재", wood, "t", p.price_wood, -1) - add("매각수익", "폐합성수지", resin, "t", p.price_resin, -1);

  // 5. 공기와 간접비
  const days = (carpenters + laborers) / p.crew_size + structDays;
  const indirect = add("간접비", "현장 간접비", days, "일", p.indirect_per_day);

  return { mode, labor, equipment, disposal, revenue, indirect, days, total: labor + equipment + disposal + indirect - revenue, rows: rows.filter((r) => r.qty > 0) };
}

export function compare(q, p) {
  const crush = costScenario(q, p, "crush"), selective = costScenario(q, p, "selective");
  return { crush, selective, delta: selective.total - crush.total, deltaDays: selective.days - crush.days };
}

// 면적 × 표준품셈 원단위로 물량을 추정 (IFC가 없을 때, 또는 모델 검산용)
export function quantitiesFromArea(area_m2, usage, rates) {
  const u = rates.wasteUnits[usage];
  const t = Object.fromEntries(STREAMS.map((k) => [k, (u[k] || 0) * area_m2]));
  return { area_m2, concrete_m3: t.concrete / rates.density.concrete, rebarFromConcrete: false, t, basis: "원단위" };
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
