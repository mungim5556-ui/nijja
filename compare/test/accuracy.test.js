// IFC 물량·비용 정확도 보정 (2026-11-20): 성상 오분류, 철근 이중 계상, 집합 부재 이중 계상, 조적 압쇄 부피,
// 분별 공수와 일반해체 공수의 중복, 콘크리트 성상 배분의 기본값
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, materialClass, quantitiesFromElements, elementResults, checkAgainstUnits } from "../assets/js/classify.js";
import { dropAggregateParents } from "../assets/js/ifc.js";
import { compare, costScenario, paramValues, quantitiesFromArea, selExtra, generalInteriorPd, streamTons, concreteGrades } from "../assets/js/scenario.js";

const rates = JSON.parse(readFileSync(new URL("../assets/data/rates.json", import.meta.url)));
const p = paramValues(rates);
const el = (category, layers, volume = 1, area = 10, extra = {}) => ({ expressID: 1, globalId: "G", tag: "1", category, floor: 1, volume, area, layers, ...extra });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("유리섬유·광물섬유 단열재는 폐유리(2.5t/㎥)가 아니라 단열재로 분류한다", () => {
  for (const name of ["Glass Wool", "Fiberglass Batt", "그라스울 50K", "유리섬유 보온재", "유리면", "Mineral Wool", "암면"]) {
    assert.equal(materialClass(name), "insulation", name);
  }
  assert.equal(materialClass("Glass"), "glass");
  assert.equal(materialClass("복층유리"), "glass");
  const wall = classify(el("wall", [{ name: "Concrete", thickness: 0.2 }, { name: "Glass Wool", thickness: 0.1 }], 3), rates);
  near(wall.parts[1].tons, 1 * rates.density.insulation); // 1㎥ × 0.03, 2.5t 아님
});

test("재료 없는 커튼월 유리 패널은 이름으로 폐유리, 재료 없는 강재 보는 수량표 중량으로 강재", () => {
  const panel = classify(el("plate", [], 0.02, 1.5, { name: "System Panel: Glazed" }), rates);
  assert.equal(panel.stream, "glass");
  near(panel.tons, 0.02 * rates.density.glass);
  assert.equal(panel.guessed, true);

  const beam = classify(el("beam", [], 0.05, 0, { weightTons: 0.3925 }), rates); // 0.3925 / 0.05 = 7.85 t/㎥
  assert.equal(beam.stream, "metal");
  near(beam.tons, 0.3925);
  // 중량이 콘크리트 밀도면 기존처럼 부재 종류 기본값(콘크리트)
  assert.equal(classify(el("beam", [], 0.05, 0, { weightTons: 0.12 }), rates).stream, "concrete");
});

test("철근콘크리트 2.4t/㎥ 안의 철근은 폐콘크리트에서 빼고 고철로 센다 (총중량 보존)", () => {
  const q = { area_m2: 100, concrete_m3: 50, rebarFromConcrete: true, t: { concrete: 120, metal: 3 } };
  const { t, rebar } = streamTons(q, p);
  near(rebar, 50 * p.rebar_kg_per_m3 / 1000);
  near(t.concrete, 120 - rebar);
  near(t.metal, 3 + rebar);
  near(t.concrete + t.metal, 123);
  for (const mode of ["crush", "selective"]) {
    const s = costScenario(q, p, mode);
    const concreteRows = s.rows.filter((r) => r.group === "처리비" && concreteGrades(p, mode === "selective").some((g) => g.name === r.item));
    near(concreteRows.reduce((a, r) => a + r.qty, 0), 120 - rebar);
  }
  // 원단위(면적) 물량은 철근을 따로 더하지 않으므로 그대로
  const area = quantitiesFromArea(1000, "공동주택", rates);
  assert.equal(streamTons(area, p).t.concrete, area.t.concrete);
  // 검산표도 같은 기준
  const check = checkAgainstUnits({ ...q, area_m2: 100 }, "공동주택", rates);
  near(check.find((c) => c.stream === "concrete").model, (120 - rebar) / 100);
});

test("부재별 결과(CSV)의 처리비·수익 합계가 엔진의 철근 분리와 같은 기준", () => {
  const classified = [classify(el("slab", [{ name: "Concrete", thickness: 0 }], 10), rates)];
  const res = elementResults(classified, p, p.fee_mixed_unverified, { concreteCase: "same" })[0];
  const rebar = 10 * p.rebar_kg_per_m3 / 1000;
  const fee = concreteGrades(p, true, "same").reduce((s, g) => s + g.share * g.fee, 0);
  near(res.disposal, (24 - rebar) * fee + rebar * (1 - p.rec_scrap_sel) * p.fee_concrete, 1e-6);
  near(res.revenue, rebar * p.rec_scrap_sel * p.price_scrap, 1e-6);
});

test("조적벽 부피도 압쇄 장비 시간·구조체 공기에 들어간다 (철근 추정에는 안 들어간다)", () => {
  const classified = [
    classify(el("wall", [{ name: "Concrete", thickness: 0 }], 10), rates),
    classify(el("wall", [{ name: "Brick", thickness: 0 }], 4), rates),
  ];
  const q = { ...quantitiesFromElements(classified, 100), floors: 1 };
  near(q.concrete_m3, 10);
  near(q.masonry_m3, 4);
  const withMasonry = costScenario(q, p, "crush");
  const without = costScenario({ ...q, masonry_m3: 0 }, p, "crush");
  near(withMasonry.excavatorHours, 14 / p.crush_m3_per_day * p.hours_per_day);
  assert.ok(withMasonry.excavatorHours > without.excavatorHours);
  near(streamTons(q, p).rebar, 10 * p.rebar_kg_per_m3 / 1000);
});

test("집합 부재: 하위 부재에 형상이 있으면 부모(커튼월·계단·지붕)를 빼서 이중 계상을 막는다", () => {
  const acc = new Map([[1, "curtain wall"], [2, "panel"], [3, "mullion"], [10, "stair"], [20, "roof"]]);
  const parts = new Map([[1, [2, 3]], [10, [11, 12]], [20, [21]], [21, [22]]]);
  dropAggregateParents(acc, parts);
  assert.deepEqual([...acc.keys()], [2, 3, 10, 20]); // 계단·지붕은 하위 형상이 없어 부모를 남긴다
  const partial = new Map([[20, "roof"], [22, "roof slab"]]);
  assert.deepEqual([...dropAggregateParents(partial, new Map([[20, [22, 23]]])).keys()], [20, 22]);
  const deep = new Map([[20, "roof"], [22, "roof slab"]]);
  assert.deepEqual([...dropAggregateParents(deep, parts).keys()], [22]); // 손자에 형상이 있어도 뺀다
});

test("작업량 방식: 일반해체 공수 미입력이면 두 안 공통 내부 철거 공수를 빼서 중복을 막는다", () => {
  const q = { ...quantitiesFromArea(2400, "공동주택", rates), floors: 5, labor: "quantity" };
  const interior = generalInteriorPd(q, p);
  near(interior, p.crew_interior * p.sched_interior_per_1000m2 * 2.4);
  const auto = selExtra(q, p), none = selExtra({ ...q, generalFinishPd: 0 }, p), given = selExtra({ ...q, generalFinishPd: 5 }, p);
  near(auto.persons, auto.gross - interior);
  near(none.persons, none.gross);
  near(given.persons, given.gross - 5);
  assert.ok(auto.issues.some((i) => i.includes("잠정") && i.includes("0을 입력")));
  // 내부 철거 인부 행은 두 안에 그대로 있다 (분별안만 빼는 것이 아니다)
  const item = (s) => s.rows.find((r) => r.item === "내부 철거 인부").qty;
  const cmp = compare(q, p);
  near(item(cmp.crush), item(cmp.selective));
  near(item(cmp.crush), p.crew_interior * Math.max(p.sched_interior_min, p.sched_interior_per_1000m2 * 2.4));
});

test("작은 건물: 내부 철거 최소 1일치는 차감하지 않아 분별 추가 공수가 0으로 사라지지 않는다", () => {
  const small = { ...quantitiesFromArea(64.17, "단독주택", rates), floors: 1, labor: "quantity" };
  const extra = selExtra(small, p);
  near(extra.interiorPd, p.crew_interior * p.sched_interior_per_1000m2 * 0.06417);
  assert.ok(extra.persons > 0 && Math.abs(extra.persons - (extra.gross - extra.interiorPd)) < 1e-9);
  assert.ok(compare(small, p).deltaDays > 0);
  // 공정표의 내부 철거 일수(최소 1일)는 그대로
  near(compare(small, p).crush.schedule.interior, p.sched_interior_min);
});

test("콘크리트 성상 배분의 기본값은 두 공법 동일: 근거 없이 분별안에 유리하게 기울지 않는다", () => {
  const q = { ...quantitiesFromArea(2400, "공동주택", rates), floors: 5 };
  const cmp = compare(q, p);
  const concrete = (s) => s.rows.filter((r) => concreteGrades(p, false).some((g) => g.name === r.item)).reduce((a, r) => a + r.amount, 0);
  near(concrete(cmp.crush), concrete(cmp.selective), 1e-6);
  assert.ok(compare({ ...q, concreteCase: "good" }, p).delta < cmp.delta); // 사용자가 고르면 반영된다
});

test("섬유 유리 배팅과 유리·프레임 합성 창호를 별도로 분류한다", () => {
  assert.equal(materialClass("섬유 유리 배팅"), "insulation");
  assert.equal(materialClass("폴리염화비닐, 리지드"), "resin");
  const window = classify(el("plate", [{ name: "창호(알루미늄+유리)", category: "Glazing", thickness: 0 }], 0.8, 9), rates);
  assert.equal(window.guessed, true);
  assert.deepEqual(window.parts.map(part => part.stream), ["glass", "aluminum"]);
  near(window.parts[0].tons, 9 * rates.perArea.window_glass);
  near(window.parts[1].tons, 9 * rates.perArea.window_frame);
  const solidGlass = classify(el("plate", [{ name: "복층유리", thickness: 0 }], 0.02, 1), rates);
  near(solidGlass.tons, 0.02 * rates.density.glass);
});

test("보드·타일 철거 비용만 있고 효과가 0이면 그 금액과 상쇄 조건을 알려 준다", async () => {
  const { unbenefitedFinishLabor } = await import("../assets/js/scenario.js");
  const base = { ...quantitiesFromArea(2400, "공동주택", rates), floors: 5, labor: "quantity",
    finishAreas: { board: 3600, tile: 480, aluminum: 360 } };
  const r = unbenefitedFinishLabor(base, p);
  const without = compare({ ...base, finishAreas: { ...base.finishAreas, board: 0, tile: 0 } }, p);
  near(r.cost, compare(base, p).delta - without.delta, 1e-3);
  assert.ok(r.cost > 0 && r.sharePoints > 0);
  // 효과를 넣으면(콘크리트 배분 선택, 보드 분리+견적) 경고하지 않는다. 논문 방식도 해당 없음.
  assert.equal(unbenefitedFinishLabor({ ...base, concreteCase: "good" }, p), null);
  const boardQuote = { ...p, rec_sel_board: 0.8, fee_board_separate: 50000 };
  assert.ok(unbenefitedFinishLabor({ ...base, t: { ...base.t, board: 0 } }, boardQuote));
  assert.equal(unbenefitedFinishLabor({ ...base, t: { ...base.t, board: 10 } }, boardQuote), null);
  assert.equal(unbenefitedFinishLabor({ ...base, labor: "paper" }, p), null);
});

test("창틀 면적이 하나라도 확인되면 창틀은 추정으로 표시하지 않는다", () => {
  const q = { ...quantitiesFromArea(2400, "공동주택", rates), labor: "quantity" };
  const msg = (areas) => selExtra({ ...q, finishAreas: areas }, p).issues.find((i) => i.includes("연면적 비율로 추정")) ?? "";
  assert.equal(msg({ board: 10, tile: 10, aluminum: 5 }), "");
  assert.ok(msg({ board: 10, aluminum: 5 }).startsWith("타일 면적"));
  assert.ok(msg({}).startsWith("보드·타일·창틀"));
});

test("한글 Revit 재료 이름: 강철·철근·비닐·석재·방수를 알아보고, 철근콘크리트는 콘크리트로", () => {
  const cases = { "금속 - 강철 - ASTM A36": "metal", "강철, 45-345": "metal", "금속 - 스테인리스강": "metal", "철근": "metal", "Rebar": "metal",
    "철근콘크리트": "concrete", "Reinforced Concrete": "concrete", "유리섬유 보강 콘크리트": "concrete", "콘크리트, 현장 타설 - 24MPa": "concrete",
    "비닐 바닥재": "resin", "비닐 타일": "resin", "아스팔트": "resin", "방수 시트": "resin", "화강석": "masonry", "대리석": "masonry",
    "동판": "copper", "징크": "metal", "Polystyrene": "insulation", "Concrete Masonry Units": "masonry" };
  for (const [name, cls] of Object.entries(cases)) assert.equal(materialClass(name), cls, name);
  // 한글 강재 이름의 보는 콘크리트(2.4)가 아니라 강재(7.85)로
  near(classify(el("beam", [{ name: "금속 - 강철", thickness: 0 }], 0.48), rates).tons, 0.48 * 7.85);
});

test("기타 객체: 재료로 성상을 알면 넣고, 모르면 뺀다", () => {
  assert.equal(classify(el("other", [{ name: "Concrete", thickness: 0 }], 1), rates).stream, "concrete");
  assert.equal(classify(el("other", [], 1), rates).stream, "excluded");
});

test("모델 철근: 추정량에서 모델 철근만큼 덜 더하고, 콘크리트에서는 철근 전체를 뺀다", () => {
  const q = { concrete_m3: 10, rebarFromConcrete: true, rebarModeledTons: 0.3, t: { concrete: 24, metal: 0.3 } };
  const { t, rebar, rebarAdded } = streamTons(q, p);
  near(rebar, 1); near(rebarAdded, 0.7); near(t.concrete, 23); near(t.metal, 1);
  // 모델 철근이 추정보다 많으면 모델 값을 쓴다
  const more = streamTons({ ...q, rebarModeledTons: 1.5, t: { concrete: 24, metal: 1.5 } }, p);
  near(more.rebar, 1.5); near(more.rebarAdded, 0); near(more.t.metal, 1.5); near(more.t.concrete, 22.5);
});

test("IFC 부피 단위와 Qto 우선", async () => {
  const { volumeUnitM3, pickVolume, volumeCheck } = await import("../assets/js/ifc.js");
  near(volumeUnitM3({ UnitType: { value: "VOLUMEUNIT" }, Name: { value: "CUBIC_METRE" } }), 1);
  near(volumeUnitM3({ UnitType: { value: "VOLUMEUNIT" }, Name: { value: "CUBIC_METRE" }, Prefix: { value: "MILLI" } }), 1e-9);
  near(volumeUnitM3({ UnitType: { value: "VOLUMEUNIT" }, ConversionFactor: { ValueComponent: { value: 0.0283168 },
    UnitComponent: { UnitType: { value: "VOLUMEUNIT" }, Name: { value: "CUBIC_METRE" } } } }), 0.0283168);
  assert.deepEqual(pickVolume(8.192, 7.5).source, "qto");
  near(pickVolume(8.192, 7.5).volume, 7.5);
  assert.equal(pickVolume(8.192, undefined).source, "mesh");
  const check = volumeCheck([{ volumeSource: "qto", volumeDiff: 0.2 }, { volumeSource: "qto", volumeDiff: -0.01 }, { volumeSource: "mesh" }]);
  assert.deepEqual([check.qto, check.mesh, check.over10], [2, 1, 1]);
});

test("시험 IFC의 기대값 파일이 생성 스크립트와 맞는다", () => {
  const expected = JSON.parse(readFileSync(new URL("./fixtures/robust.expected.json", import.meta.url)));
  const total = (s) => expected.filter((e) => e.stream === s).reduce((a, e) => a + e.tons, 0);
  near(total("concrete"), 27.6, 1e-9); near(total("metal"), 7.762375, 1e-9); near(total("masonry"), 3.42, 1e-9); near(total("glass"), 0.45, 1e-9);
  assert.equal(expected.length, 23);
});

test("수동 재료 정정 시 중량과 압쇄 물량이 같은 재료를 사용한다", () => {
  const wall = el("wall", [], 10);
  const key = "wall|(재료 없음)";
  for (const [material, concrete, masonry, mass] of [
    ["masonry", 0, 10, 19],
    ["metal", 0, 0, 78.5],
    ["mixed", 0, 0, 24],
  ]) {
    const q = quantitiesFromElements([classify(wall, rates, { [key]: material })], 100);
    near(q.concrete_m3, concrete);
    near(q.masonry_m3, masonry);
    near(q.t[material], mass);
  }
});

test("면적 기준 창호와 문은 성상을 바꿔도 질량과 구조체 부피가 유지된다", () => {
  for (const category of ["window", "door"]) {
    const frame = el(category, [], 0.81, 2.7);
    const original = classify(frame, rates);
    for (const material of ["glass", "panel", "concrete"]) {
      const adjusted = classify(frame, rates, { [`${category}|(재료 없음)`]: material });
      assert.equal(adjusted.stream, material);
      near(adjusted.tons, original.tons);
      assert.equal(adjusted.parts[0].m3, 0);
    }
  }
});

test("별도 반출 비용 미입력과 무상 처리를 구분한다", () => {
  const q = { area_m2: 100, t: { glass: 10, board: 4, panel: 2, metal: 10 } };
  const inputs = { ...p, rec_sel_glass: 0.5, rec_sel_board: 0.5,
    fee_glass_separate: -1, fee_board_separate: -1, fee_panel: -1, fee_unsold_metal: -1 };
  const missing = costScenario(q, inputs, "selective");
  assert.deepEqual(missing.unpricedDisposal.map(row => row.item).sort(),
    ["미매각 금속", "분리 폐보드", "분리 폐유리", "폐샌드위치패널"].sort());
  near(missing.unpricedDisposal.find(row => row.item === "분리 폐유리").tons, 5);
  const free = costScenario(q, { ...inputs, fee_glass_separate: 0, fee_board_separate: 0,
    fee_panel: 0, fee_unsold_metal: 0 }, "selective");
  assert.deepEqual(free.unpricedDisposal, []);
});

test("공법별 운반 견적은 각 순비용에 한 번만 반영하고 0원과 미입력을 구분한다", () => {
  const q = { area_m2: 100, t: { concrete: 10 } };
  const base = compare(q, p);
  const quoted = compare({ ...q, transportCrush: 1200000, transportSel: 800000 }, p);
  near(quoted.crush.total - base.crush.total, 1200000);
  near(quoted.selective.total - base.selective.total, 800000);
  near(quoted.delta - base.delta, -400000);
  assert.equal(base.crush.transportQuote, undefined);
  const partial = compare({ ...q, transportCrush: 1200000 }, p);
  assert.equal(partial.crush.transportQuote, 1200000);
  assert.equal(partial.partialTransport, true);
  near(partial.delta, base.delta);
  const free = compare({ ...q, transportCrush: 0, transportSel: 800000 }, p);
  assert.equal(free.partialTransport, false);
  near(free.delta, base.delta + 800000);
  assert.equal(quoted.crush.rows.find(row => row.item === "가설 설치 비계공").price, 284440);
});

test("미회수 매립 철근만 건설폐재류 처리비에 한 번 반영한다", () => {
  const q = {area_m2: 1000, concrete_m3:1329, rebarKgPerM3:100, rebarFromConcrete:true, t:{concrete:3190}};
  for (const [mode, residue] of [["crush",10.632],["selective",6.645]]) {
    const r = costScenario(q,p,mode);
    const row = r.rows.find(x => x.item.includes("동반 반입"));
    near(row.qty,residue);
    near(row.amount,residue*p.fee_concrete);
    near(r.concreteIntake+r.sold.metal,q.t.concrete);
    assert.equal(r.unsoldMetal,0);
    assert.equal(r.unpricedDisposal.length,0);
    const separate = costScenario({...q, t:{...q.t,metal:50}},p,mode);
    near(separate.embeddedRebar,residue);
    assert.ok(separate.unsoldMetal>0);
  }
});
