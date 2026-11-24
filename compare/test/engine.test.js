import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paperMode, compare, costScenario, mixedWaste, paramValues, quantitiesFromArea, schedule, excavators, crews, selExtra } from "../assets/js/scenario.js";
import { breakEven, simulate, tornado, triangular, variables, mulberry32 } from "../assets/js/sensitivity.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../assets/data/${f}`, import.meta.url)));
const paper = load("paper2023_case.json"), rates = load("rates.json");
const p = paramValues(rates), q = quantitiesFromArea(2400, "공동주택", rates), vars = variables(rates);

test("창틀 순중량을 한 번만 정산하고 PVC 무상·유상처리·매각을 구분한다", () => {
  const frames = { ...q, t: { aluminum: 0.1, resin: 0.2 }, alFrameTons: 0.1, pvcFrameTons: 0.2,
    alSel: 80, alCrush: 80, pvcSel: 50, pvcCrush: 50, alPrice: 2000 };
  for (const mode of ["crush", "selective"]) {
    for (const price of [-100, 0, 100]) {
      const r = costScenario({ ...frames, pvcPrice: price }, p, mode);
      assert.equal(r.revenue, 160000 + Math.max(0, price * 100));
      assert.equal(r.mixed.tons, 0.1);
      const row = r.rows.find(row => row.item.startsWith("PVC 창틀"));
      assert.equal(row.qty, 100);
      assert.equal(Math.abs(row.amount), Math.abs(price * 100));
    }
  }
});

test("공통 선철거·별도 반출·미매각 금속을 두 공법에 정산한다", () => {
  const input = { ...q, labor: "quantity", finishAreas: {board:5000,tile:400,aluminum:0}, generalFinishPd:0,
    t:{board:10,tile:20,metal:100}, metalFee:10000, boardSel:50, tileSel:75, boardFee:50000, tileFee:30000 };
  const separate = compare(input,p);
  const common = compare({...input, sharedFinish:100},p);
  assert.ok(common.crush.days > separate.crush.days);
  assert.ok(Math.abs(common.deltaDays) < 1e-10);
  assert.equal(common.selective.mixed.tons,10);
  assert.equal(common.crush.mixed.tons,30);
  assert.equal(common.selective.rows.find(r=>r.item==="분리 폐타일·도자기").amount,450000);
  assert.equal(common.hasUnpricedDisposal,false);
});

test("논문 사례 재현: 표 5·8·9와 Δ = −34,727천원", () => {
  const r = paperMode(paper);
  assert.deepEqual(r.construction, paper.expected.construction);
  assert.deepEqual(r.disposal, paper.expected.disposal);
  assert.equal(r.sheets, 2469);
  assert.equal(r.revenue, paper.expected.revenue);
  assert.equal(r.delta, paper.expected.delta);
});

test("논문 사례: 재활용 수익이 0이면 분별이 28,699천원 더 비싸다", () => {
  const c = structuredClone(paper);
  c.revenue.wood.won_per_sheet = 0; c.revenue.resin.won_per_t = 0;
  assert.equal(paperMode(c).delta, 28699);
});

test("분별 추가 품 = 논문 표 3·4의 분별 − 일반 차이", () => {
  const diff = (i) => +rates.laborItems.reduce((s, x) => s + x.selective[i] - x.crush[i], 0).toFixed(3);
  assert.deepEqual([diff(0), diff(1)], [0.09, 0.025]);
  assert.deepEqual([p.sel_extra_carpenter, p.sel_extra_laborer], [0.09, 0.025]);
  // 논문 사례 규모(2,400㎡)에서 논문의 시공비 증가 67,522천원과 같다
  const paperWages = { ...p, wage_carpenter: paper.wage.carpenter, wage_laborer: paper.wage.laborer };
  const rows = costScenario({ ...q, floors: 5 }, paperWages, "selective").rows.filter((r) => r.item.startsWith("분별 추가"));
  assert.equal(Math.round(rows.reduce((a, r) => a + r.qty, 0)), 276);
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.amount, 0) / 1000 - 67522) < 1);
});

test("상시 유도·감시와 굴착기 연동 인원은 투입일수에 맞게 따로 계산한다", () => {
  const wide = { ...q, area_m2: 4514.84, floors: 4, site: "wide" };
  assert.equal(excavators({ area_m2: 965.04, site: "wide" }, p), 1);
  assert.equal(excavators(wide, p), 2);
  assert.equal(crews(wide, p).standing, 1);
  assert.equal(crews(wide, p).structure, 4);
  const base = costScenario(wide, p, "selective");
  const whole = costScenario({ ...wide, equipmentCrewPeriod: "all" }, p, "selective");
  const qty = (s, item) => s.rows.find((r) => r.item === item).qty;
  assert.equal(qty(base, "상시 작업유도·감시"), base.days);
  assert.equal(qty(base, "굴착기 연동 살수·신호"), base.excavatorHours / p.hours_per_day * p.crew_per_excavator);
  assert.equal(qty(whole, "굴착기 연동 살수·신호"), whole.days * 4);
  assert.equal(whole.days, base.days);
  assert.equal(whole.indirect, base.indirect);
  assert.ok(whole.labor > base.labor);
  for (const site of ["normal", "tight", "restricted", undefined]) assert.equal(excavators({ ...wide, site }, p), 1);
});

test("일당 간접비 70만원과 50~90만원 탐색 범위가 계산에 들어간다", () => {
  assert.equal(p.indirect_per_day, 700000);
  assert.equal(rates.params.indirect_per_day.assumed, true);
  const v = vars.find((v) => v.key === "indirect_per_day");
  assert.deepEqual([v.min, v.max], [500000, 900000]);
  const r = compare(q, p);
  assert.equal(r.selective.indirect, r.selective.days * p.indirect_per_day);
  const [effect] = tornado(q, p, [v]);
  assert.ok(Math.abs(effect.span - r.deltaDays * 400000) < 1e-6);
  assert.notEqual(simulate(q, p, [v], { n: 50 }).p10, simulate(q, p, [v], { n: 50 }).p90);
});

test("총액은 내역의 합이며 분별 보조 장비는 추가 작업에만 계상한다", () => {
  const { crush, selective } = compare(q, p);
  for (const s of [crush, selective]) {
    assert.ok(Math.abs(s.rows.reduce((a, r) => a + r.amount, 0) - s.total) < 1);
    assert.ok(s.total > 0 && s.days > 0);
  }
  const estimated = selective.schedule.selective * p.selective_equipment_hours_per_day * p.selective_equipment_per_h;
  assert.ok(estimated > 0);
  assert.ok(Math.abs(selective.equipment - crush.equipment - estimated) < 1e-6);
  const quoted = compare({ ...q, selectiveEquipmentQuote: 1200000 }, p);
  assert.ok(Math.abs(quoted.selective.equipment - quoted.crush.equipment - 1200000) < 1e-6);
  const confirmed = compare({ ...q, selectiveEquipmentHours: 2.5 }, p);
  assert.ok(Math.abs(confirmed.selective.equipment - confirmed.crush.equipment - 2.5 * p.selective_equipment_per_h) < 1e-6);
  assert.equal(confirmed.selective.days, selective.days);
  assert.equal(confirmed.selective.revenue, selective.revenue);
  const noExtra = compare({ ...q, selectiveEquipmentHours: 0 }, p);
  assert.equal(noExtra.selective.equipment, noExtra.crush.equipment);
  const quotedHours = compare({ ...q, selectiveEquipmentHours: 2.5, selectiveEquipmentQuote: 1200000 }, p);
  assert.equal(quotedHours.selective.equipment, quoted.selective.equipment);
  const parallel = compare({ ...q, overlap: 1 }, p);
  assert.equal(parallel.selective.equipment, selective.equipment);
  assert.ok(selective.labor > crush.labor && selective.disposal < crush.disposal && selective.days > crush.days);
});

test("혼합폐기물 처리비가 오르면 분별 쪽으로 기운다", () => {
  const base = compare(q, p).delta;
  assert.ok(compare(q, { ...p, fee_mixed_unverified: p.fee_mixed_unverified * 3 }).delta < base);
});

test("손익분기: 찾은 값에서 Δ ≈ 0", () => {
  const x = breakEven(q, p, "net_resin", -5e5, 5e6);
  assert.ok(x != null);
  assert.ok(Math.abs(compare(q, { ...p, net_resin: x }).delta) < 1);
  assert.equal(breakEven(q, p, "hours_per_day", 1, 24), null); // 두 안에 공통이라 부호가 바뀌지 않는다
});

test("몬테카를로: 같은 seed면 같은 결과, 분위수 순서", () => {
  const a = simulate(q, p, vars, { n: 500, seed: 7 }), b = simulate(q, p, vars, { n: 500, seed: 7 });
  assert.equal(a.pSelective, b.pSelective);
  assert.equal(a.p50, b.p50);
  assert.ok(a.p10 <= a.p50 && a.p50 <= a.p90);
  assert.notEqual(simulate(q, p, vars, { n: 500, seed: 8 }).p50, a.p50);
});

test("삼각분포는 범위 안, 토네이도는 영향 큰 순", () => {
  const rnd = mulberry32(3);
  for (let i = 0; i < 1000; i++) { const x = triangular(rnd(), 2, 2, 5); assert.ok(x >= 2 && x <= 5); }
  const t = tornado(q, p, vars);
  assert.ok(t.length === vars.length && t[0].span >= t.at(-1).span);
});

test("철근 추정: IFC 물량이면 콘크리트 부피에서 고철 수익이 나온다", () => {
  const ifcQ = { area_m2: 100, concrete_m3: 50, rebarFromConcrete: true, t: { concrete: 120 } };
  const row = costScenario(ifcQ, p, "crush").rows.find((r) => r.item === "고철");
  assert.ok(Math.abs(row.qty - 50 * 0.1 * p.rec_scrap_crush) < 1e-9);
});

test("출처가 확인된 탑재 현장의 면적식에 소형 장비율을 중복 적용하지 않는다", () => {
  const cases = load("plan-validation.json").cases;
  for (const [id, expectedTotal, expectedStructure] of [
    ["nonhyeon-124-1", 16.8, 11.3], ["noryangjin-67-8", 9.1, 5.0],
  ]) {
    const row = cases.find((row) => row.id === id);
    const s = schedule(row, p, "crush");
    assert.equal(+s.total.toFixed(1), expectedTotal);
    assert.equal(+s.structure.toFixed(1), expectedStructure);
    assert.equal(s.structure, s.areaDays);
    assert.equal(s.selective, 0);
  }
});

test("분별 공기: 작업조와 병행률로 전체 연장을 계산한다", () => {
  const q4 = { ...q, floors: 5 }, c = schedule(q4, p, "crush"), s = schedule(q4, p, "selective");
  const extra = 2400 * (0.09 + 0.025) / p.crew_size;
  assert.ok(Math.abs(s.total - c.total - extra) < 1e-9 && extra === 46);
  assert.ok(Math.abs(compare(q4, p).crush.days - c.total) < 1e-9);
  assert.equal(compare({ ...q4, overlap: 0.5 }, p).deltaDays, 23);
  assert.equal(compare({ ...q4, overlap: 1 }, p).deltaDays, 0);
});

test("분리 목재·수지는 순단가 하나: +면 매각수익, −면 처리비 (둘이 함께 들어가지 않는다)", () => {
  const qq = { ...q, floors: 5 };
  for (const [net, group] of [[-230000, "처리비"], [150000, "매각수익"]]) {
    const s = costScenario(qq, { ...p, net_resin: net }, "selective");
    const rows = s.rows.filter((r) => r.item.endsWith("폐합성수지"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].group, group);
    assert.ok(Math.abs(Math.abs(rows[0].amount) - Math.abs(net) * qq.t.resin * p.rec_sel_resin) < 1);
  }
  assert.ok(!costScenario(qq, p, "crush").rows.some((r) => r.item.endsWith("폐합성수지")));
});

test("가연물 한도와 성상 기준을 두 공법에 동일하게 적용한다", () => {
  const t = { glass: 0, board: 0, mixed: 95, wood: 5, resin: 0 };
  const split = { wood: 0, resin: 0, glass: 0, board: 0 };
  const m = (waste, params = p, composition = { mixedMineral: 1 }) => mixedWaste(waste, split, params, composition);
  assert.equal(m(t).share, 0.05);
  assert.equal(m(t).fee, p.fee_mixed_mineral);
  assert.equal(m({ ...t, wood: 0 }).fee, p.fee_concrete);
  assert.equal(m({ ...t, wood: 5.1 }).needsQuote, true);
  assert.equal(m({ ...t, wood: 5.1 }, { ...p, fee_mixed_quote: 130000 }).fee, 130000);
  assert.equal(m(t, p, {}).main, "unknown");
  assert.equal(m({ ...t, glass: 200 }).fee, p.fee_mixed_inert);
  assert.equal(m({ ...t, board: 200 }).fee, p.fee_board_mixed);
  assert.equal(m({ ...t, mixed: 0, wood: 20, board: 100 }).needsQuote, true);
});

test("분별 후 혼합잔재·별도 처리·매각·미매각 물량이 원래 물량과 같다", () => {
  const t = { concrete: 50, metal: 10, copper: 2, aluminum: 3, glass: 20, tile: 12, board: 5, mixed: 30, wood: 2, resin: 4 };
  const out = compare({ ...q, t, mixedMineral: 1 }, { ...p, rec_sel_glass: 0.6, rec_sel_board: 1, fee_glass_separate: 70000, fee_board_separate: 0 });
  for (const s of [out.crush, out.selective]) {
    const tally = s.mixed.tons + t.concrete + s.unsoldMetal + Object.values(s.sold).reduce((a, b) => a + b, 0)
      + Object.values(s.split).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(tally - Object.values(t).reduce((a, b) => a + b, 0)) < 1e-9);
  }
  assert.equal(out.selective.rows.find((row) => row.item === "분리 폐유리").qty, 12);
});

test("비주거 RC 면적 모드: 1,000㎡의 폐금속 추정량은 73t", () => {
  assert.equal(quantitiesFromArea(1000, "비주거 RC", rates).t.metal, 73);
});

test("대지 협소·진입 제한: 소형 장비로 장비 시간이 늘고 크레인이 붙으며 구조체 공기가 길어진다", () => {
  const base = { ...q, floors: 5 };
  const hours = (s) => s.rows.filter((r) => r.group === "장비비" && r.unit === "h").reduce((a, r) => a + r.qty, 0);
  const n = costScenario({ ...base, site: "normal" }, p, "crush");
  // 소형 지상 장비: 전체 부피를 소형 장비 해체량으로
  const small = costScenario({ ...base, equipment: "small" }, p, "crush");
  assert.ok(Math.abs(hours(small) / hours(n) - p.crush_m3_per_day / p.crush_m3_per_day_small) < 1e-9);
  for (const site of ["tight", "restricted"]) {
    const t = costScenario({ ...base, site }, p, "crush");
    for (const r of t.rows.filter((r) => r.unit === "h")) assert.equal(r.price, p.excavator_per_h);
    assert.ok(Math.abs(t.excavatorHours - hours(t)) < 1e-9);
    // 탑재: 위층은 소형 장비, 지상 장비가 닿는 하부 층은 대형 장비
    const share = p.mounted_ground_floors / base.floors, V = base.concrete_m3;
    const expected = (V * (1 - share) / p.crush_m3_per_day_small + V * share / p.crush_m3_per_day) * p.hours_per_day;
    assert.ok(Math.abs(hours(t) - expected) < 1e-6);
    const crane = t.rows.find((r) => r.item.startsWith("이동식 크레인"));
    const mountedDays = V * (1 - share) / p.crush_m3_per_day_small, groundDays = V * share / p.crush_m3_per_day;
    assert.ok(crane && Math.abs(crane.qty - t.schedule.structure * mountedDays / (mountedDays + groundDays)) < 1e-9);
    assert.ok(crane.qty < t.schedule.structure);
    assert.ok(!n.rows.some((r) => r.item.startsWith("이동식 크레인")));
    assert.ok(t.schedule.structure > n.schedule.structure && t.equipment > n.equipment);
  }
  // 두 안에 똑같이 들어가므로 대지 조건만으로는 Δ가 거의 변하지 않는다 (간접비·상시 인원 일수만 같이 늘어난다)
  assert.equal(compare({ ...base, site: "tight" }, p).deltaDays, compare({ ...base, site: "normal" }, p).deltaDays);
});

test("분별 작업량의 단위와 일반해체 공수 차감을 확인한다", () => {
  const qq = { ...q, floors: 5, labor: "quantity", finishAreas: { board: 30, tile: 10, pvc: 10, aluminum: 10 }, generalFinishPd: 1.5 };
  const result = selExtra(qq, p);
  const expected = 2 + 10 * (p.window_pvc_pd_per_m2 + p.window_al_pd_per_m2) - 1.5;
  assert.ok(Math.abs(result.persons - expected) < 1e-9);
  const s = costScenario(qq, p, "selective");
  assert.ok(Math.abs(s.schedule.selective - expected / p.crew_size) < 1e-9);
  assert.equal(s.rows.find((row) => row.item.startsWith("분별 추가")).unit, "인·일");
  assert.equal(selExtra({ ...qq, generalFinishPd: 3 }, p).persons, 0);
  assert.ok(selExtra({ ...qq, generalFinishPd: undefined }, p).issues.some((issue) => issue.includes("잠정")));
});

test("대형 병렬 장비의 공기와 소형 지상 장비의 크레인 독립 지정", () => {
  const wide = { ...q, area_m2: 4500, floors: 4, site: "wide" };
  const parallel = compare({ ...wide, parallelGain: 0.8 }, p).crush;
  const serial = compare(wide, p).crush;
  assert.ok(parallel.schedule.structure < serial.schedule.structure);
  assert.equal(parallel.excavatorHours, serial.excavatorHours);
  const ground = compare({ ...wide, equipment: "small" }, p).crush;
  assert.equal(ground.crews.excavators, 1);
  assert.ok(!ground.rows.some((row) => row.item.includes("크레인")));
  const mounted = compare({ ...wide, equipment: "mounted", craneDays: 1 }, p).crush;
  assert.equal(mounted.rows.find((row) => row.item.includes("크레인")).qty, 1);
});

test("콘크리트 견적은 해당 물량만 대체하고 별도 매각분은 공법별로 한 번 차감한다", () => {
  const qg = { ...q, concreteCase: "good" };
  const base = compare(qg, p);
  const result = compare({ ...qg, cleanSel: 25, cleanPrice: 30000,
    cableCrush: 1, cableSel: 2, cablePrice: 100000 }, p);
  assert.equal(result.selective.revenue - base.selective.revenue, 200000);
  assert.equal(result.crush.revenue - base.crush.revenue, 100000);
  assert.ok(Math.abs(base.selective.disposal - result.selective.disposal
    - q.t.concrete * 0.25 * (35290.8 - 30000)) < 0.01);
  assert.equal(compare({ ...qg, cleanSel: 25 }, p).delta, base.delta);
});

test("목공 비율을 바꾸면 총공수는 같고 직종별 차액만 인건비에 반영된다", () => {
  const input = { ...q, labor: "quantity", generalFinishPd: 1 };
  const initial = costScenario(input, p, "selective");
  const split = costScenario({ ...input, carpenterShare: 50 }, p, "selective");
  const persons = selExtra(input, p).persons;
  assert.equal(initial.days, split.days);
  assert.ok(Math.abs(split.labor - initial.labor - persons / 2 * (p.wage_carpenter - p.wage_laborer)) < 0.01);
});

test("조적에는 별도 처리 단가를 적용하고 콘크리트에만 성상 가정을 적용한다", () => {
  const input = { ...q, t: { concrete: 100, masonry: 20 } };
  const same = compare({ ...input, concreteCase: "same" }, p);
  const good = compare({ ...input, concreteCase: "good" }, p);
  assert.equal(same.crush.disposal, same.selective.disposal);
  assert.equal(good.crush.disposal, same.crush.disposal);
  assert.equal(good.selective.rows.find(row => row.item.startsWith("폐벽돌")).amount, 20 * p.fee_concrete);
  assert.equal(good.selective.rows.find(row => row.item === "순수 폐콘크리트").qty, 80);
});

test("고정 비교는 창틀·유리 공수를 한 번만 반영하고 유리와 기타 금속을 혼합 반출한다", () => {
  const q = {
    area_m2: 100, floors: 1, labor: "quantity", fixedComparison: true, windowMode: "both",
    finishAreas: { board: 0, tile: 0, aluminum: 100 }, windowArea: 100,
    glassPdPerM2: 0.02, windowGlassTons: 2, alFrameTons: 1,
    generalFinishPd: 0, t: { aluminum: 1, glass: 2, copper: 1 },
  };
  const pFixed = { ...p, sched_interior_min: 0, sched_interior_per_1000m2: 0 };
  const { crush, selective } = compare(q, pFixed);
  assert.equal(selExtra(q, pFixed).persons, 0);
  for (const result of [crush, selective]) {
    assert.ok(Math.abs(result.schedule.interior * result.crews.interior - 100 * (p.window_al_pd_per_m2 + 0.02)) < 1e-9);
    assert.equal(result.rows.find(row => row.item === "알루미늄 창틀").amount, -p.price_aluminum);
    assert.equal(result.rows.find(row => row.item === "혼합 반출 창호 유리").amount, 2 * p.fee_mixed_unverified);
    assert.equal(result.rows.find(row => row.item === "혼합 반출 미회수 기타 금속").price, p.fee_mixed_unverified);
  }
});

test("공통 철골 견적과 회수율은 양쪽에 적용되고 RC 철근 회수율은 따로 적용된다", () => {
  const input = {
    area_m2: 120, floors: 1, steelWork: true, structuralSteelTons: 90, fixedComparison: true,
    t: { metal: 100, concrete: 100 }, rebarFromConcrete: true, rebarModeledTons: 10,
  };
  const base = compare(input, p);
  const common = compare({ ...input, cutCommon: 10000000 }, p);
  const individual = compare({ ...input, cutCommon: 10000000, cutSel: 12000000 }, p);
  assert.ok(Math.abs(common.delta - base.delta) < 1e-6);
  assert.ok(Math.abs(individual.delta - base.delta - 2000000) < 1e-6);
  assert.ok(Math.abs(base.crush.sold.metal - (90 * p.rec_structural_steel + 10 * p.rec_scrap_crush)) < 1e-8);
  assert.ok(Math.abs(base.selective.sold.metal - (90 * p.rec_structural_steel + 10 * p.rec_scrap_sel)) < 1e-8);
  assert.ok(Math.abs(base.crush.unsoldMetal - base.selective.unsoldMetal) < 1e-8);
});

test("동관과 피복 전선은 확인된 공통 매각량만 기본 비교에 반영한다", () => {
  const input = { ...q, fixedComparison: true, t: { concrete: 50, copper: 1.5 } };
  const base = compare(input, p);
  const shared = compare({ ...input, copperPipeSold: 1, cableCommon: 0.5 }, p);
  assert.equal(base.crush.sold.copper, 0);
  assert.equal(base.selective.sold.copper, 0);
  assert.ok(Math.abs(shared.delta - base.delta) < 1e-6);
  for (const result of [shared.crush, shared.selective]) {
    assert.equal(result.sold.copper, 1);
    assert.equal(result.unsoldMetal, 0.5);
    assert.equal(result.rows.find(row => row.item === "확인된 동관").amount, -15200000);
    assert.equal(result.rows.find(row => row.item === "별도 계근 폐전선").amount, -1800000);
  }
  const individual = compare({ ...input, cableCommon: 0.5, cableSel: 1, cablePrice: 4000000 }, p);
  assert.ok(Math.abs(individual.delta - base.delta + 2000000) < 1e-6);
});

test("사무소 설치량에 위치별 회수율을 적용하고 확인된 매각량을 우선한다", () => {
  const input = { ...q, area_m2: 2400, officeRecovery: true, fixedComparison: true, t: { concrete: 50 } };
  const base = compare({ ...input, officeRecovery: false }, p);
  const assumed = compare(input, p);
  assert.ok(Math.abs(assumed.delta - base.delta + 1874880) < 0.01);
  for (const result of [assumed.crush, assumed.selective]) {
    const pipe = result.rows.find(row => row.item === "동관 (사무소 추정)");
    const cable = result.rows.find(row => row.item === "피복 전선 (사무소 추정)");
    assert.ok(Math.abs(pipe.qty - 1334.4) < 1e-9);
    assert.ok(Math.abs(cable.qty - (result === assumed.crush ? 781.2 : 1302)) < 1e-9);
    assert.equal(result.concreteIntake, base.crush.concreteIntake);
  }
  const confirmed = compare({ ...input, copperPipeSold: 0, cableCommon: 0.5 }, p);
  for (const result of [confirmed.crush, confirmed.selective]) {
    assert.equal(result.rows.some(row => row.item.endsWith("(사무소 추정)")), false);
    assert.equal(result.rows.find(row => row.item === "별도 계근 폐전선").amount, -1800000);
  }
  const modeled = compare({ ...input, t: { concrete: 50, copper: 1 } }, p);
  assert.equal(modeled.crush.rows.some(row => row.item === "동관 (사무소 추정)"), false);
});

test("현장 설치량은 면적이나 용도 대신 입력값을 쓰고 확인된 매각량을 우선한다", () => {
  const input = { ...q, area_m2: 16241, fixedComparison: true, t: { concrete: 50, copper: 1 } };
  const base = compare(input, p);
  assert.equal(base.crush.rows.some(row => row.item.endsWith("추정)")), false);
  const installed = compare({ ...input, pipeInstalled: 1, cableInstalled: 0.2 }, p);
  for (const result of [installed.crush, installed.selective]) {
    assert.ok(Math.abs(result.rows.find(row => row.item === "동관 (현장 설치량 추정)").qty - 695) < 1e-9);
    assert.ok(Math.abs(result.unsoldMetal - 0.305) < 1e-9);
  }
  assert.equal(installed.crush.rows.find(row => row.item === "피복 전선 (현장 설치량 추정)").qty, 105);
  assert.equal(installed.selective.rows.find(row => row.item === "피복 전선 (현장 설치량 추정)").qty, 175);
  const confirmed = compare({ ...input, cableInstalled: 0.2, cableCommon: 0 }, p);
  assert.equal(confirmed.selective.rows.some(row => row.item === "피복 전선 (현장 설치량 추정)"), false);
});

test("폐전선 계근값은 입력한 공법만 대체하고 0t도 적용한다", () => {
  const input = { ...q, fixedComparison: true, t: {}, cableInstalled: 1 };
  const sale = (result, item) => Math.abs(result.rows.find(row => row.item === item)?.amount ?? 0);
  const estimated = "피복 전선 (현장 설치량 추정)";
  const measured = "별도 계근 폐전선";
  const selectiveOnly = compare({ ...input, cableSel: 0.75 }, p);
  assert.equal(sale(selectiveOnly.crush, estimated), 1890000);
  assert.equal(sale(selectiveOnly.selective, estimated), 0);
  assert.equal(sale(selectiveOnly.selective, measured), 2700000);

  const crushZero = compare({ ...input, cableCrush: 0 }, p);
  assert.ok(!crushZero.crush.rows.some(row => row.item === estimated || row.item === measured));
  assert.equal(sale(crushZero.selective, estimated), 3150000);
  const commonZero = compare({ ...input, cableCommon: 0, cableSel: 0.75 }, p);
  assert.ok(!commonZero.crush.rows.some(row => row.item === estimated || row.item === measured));
  assert.equal(sale(commonZero.selective, measured), 2700000);
});

test("공법별 콘크리트 절단·인양 견적은 해당 구간의 압쇄 작업을 대체한다", () => {
  const input = { ...q, equipment: "large", concrete_m3: 100, masonry_m3: 25 };
  const base = compare(input, p);
  const cut = { volume: 50, cost: 4500000, days: 3 };
  const result = compare({ ...input, concreteCut: { selective: cut } }, p);
  assert.equal(result.crush.total, base.crush.total);
  assert.ok(Math.abs(result.selective.excavatorHours - base.selective.excavatorHours * 0.6) < 1e-9);
  assert.ok(Math.abs(result.selective.schedule.structure - (base.selective.schedule.structure * 0.6 + 3)) < 1e-9);
  const prep = base.selective.schedule.selective * p.selective_equipment_hours_per_day * p.selective_equipment_per_h;
  assert.ok(Math.abs(result.selective.equipment - ((base.selective.equipment - prep) * 0.6 + prep + cut.cost)) < 1e-6);
  assert.ok(Math.abs(result.selective.indirect - result.selective.days * p.indirect_per_day) < 1e-6);
  assert.ok(Math.abs(result.deltaDays - (result.selective.days - result.crush.days)) < 1e-9);
  assert.equal(result.selective.disposal, base.selective.disposal);
  const both = compare({ ...input, concreteCut: { crush: cut, selective: cut } }, p);
  assert.ok(Math.abs(both.selective.equipment - both.crush.equipment - prep) < 1e-6);
  const full = compare({ ...input, masonry_m3: 0, concreteCut: { crush: { ...cut, volume: 100, cost: 0 } } }, p);
  assert.equal(full.crush.excavatorHours, 0);
  assert.equal(full.crush.equipmentCrewDays, 0);
  assert.equal(full.crush.schedule.structure, 3);
});

test("확정 절단면적과 참고 가동시간은 기본 압쇄 물량·공기·매각량을 바꾸지 않는다", () => {
  const input = { ...q, equipment: "mounted", concrete_m3: 100, masonry_m3: 25 };
  const base = compare(input, p);
  const cut = { area: 5, hours: 14.25, days: 0, cost: 1645185, costBasis: "reference", liftingRequired: true, liftingCost: 400000 };
  const result = compare({ ...input, concreteCut: { selective: cut } }, p);
  assert.equal(result.crush.total, base.crush.total);
  assert.equal(result.selective.excavatorHours, base.selective.excavatorHours);
  assert.equal(result.selective.days, base.selective.days);
  assert.equal(result.selective.disposal, base.selective.disposal);
  assert.equal(result.selective.revenue, base.selective.revenue);
  assert.ok(Math.abs(result.selective.equipment - base.selective.equipment - 2045185) < 1e-6);
  assert.deepEqual(result.unpricedCuts, []);
  assert.deepEqual(result.unscheduledCuts, []);
  const priced = item => result.selective.rows.find(row => row.item.includes(item)).amount;
  assert.equal(priced("공개 참고단가"), 1645185);
  assert.equal(priced("별도 인양비"), 400000);
});

test("공통 절단일은 양안에 반영하며 직접 입력한 공기와 장비의 이중 계산을 피한다", () => {
  const input = { ...q, equipment: "large", concrete_m3: 100, masonry_m3: 25 };
  const base = compare(input, p);
  const cut = { area: 5, days: 2, cost: 2500000, liftingIncluded: true, liftingCost: 100000, avoidedHours: 4 };
  const both = compare({ ...input, concreteCut: { crush: cut, selective: cut } }, p);
  assert.ok(Math.abs(both.deltaDays - base.deltaDays) < 1e-9);
  assert.ok(Math.abs(both.crush.days - base.crush.days - 2) < 1e-9);
  assert.equal(both.crush.excavatorHours, base.crush.excavatorHours - 4);
  assert.equal(both.crush.cut.avoidedHoursApplied, 4);
  assert.equal(both.crush.cut.daysApplied, 2);
  assert.equal(both.crush.cut.cost, 2500000);
  const entered = compare({ ...input, concreteCut: { selective: cut },
    workSchedule: { selective: { totalDays: 32, structureDays: 16, excavatorHours: 20, equipmentQuote: 800000 } } }, p);
  assert.equal(entered.selective.days, 32);
  assert.equal(entered.selective.schedule.structure, 16);
  assert.equal(entered.selective.excavatorHours, 20);
  assert.equal(entered.selective.cut.avoidedHoursApplied, 0);
  assert.equal(entered.selective.cut.daysApplied, 0);
  assert.equal(entered.selective.rows.find(row => row.item.startsWith("구조체 기본 장비")).amount, 800000);
});

test("절단 견적이나 공기가 미확인일 때 확인된 비용은 표시하고 비교 상태를 구분한다", () => {
  const base = compare(q, p);
  const result = compare({ ...q, concreteCut: { selective: { area: 3, cost: 1000000, quoteIncomplete: true } } }, p);
  assert.deepEqual(result.unpricedCuts, ["selective"]);
  assert.deepEqual(result.unscheduledCuts, ["selective"]);
  assert.equal(result.selective.equipment - base.selective.equipment, 1000000);
  assert.equal(result.selective.days, base.selective.days);
  const noCutQuote = compare({ ...q, concreteCut: { selective: { area: 3, liftingCost: 200000 } },
    workSchedule: { selective: { totalDays: 30 } } }, p);
  assert.deepEqual(noCutQuote.unpricedCuts, ["selective"]);
  assert.deepEqual(noCutQuote.unscheduledCuts, []);
  assert.equal(noCutQuote.selective.days, 30);
  assert.equal(noCutQuote.selective.rows.find(row => row.item.endsWith("별도 인양비")).amount, 200000);
});
