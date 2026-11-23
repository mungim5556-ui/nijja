import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, materialClass, isOpenSteelFrame, quantitiesFromElements, supplement, elementResults, reconcileElementResults, toCsv, groupKey } from "../assets/js/classify.js";
import { meshVolume, meshSurface, massUnitTons } from "../assets/js/ifc.js";
import { costScenario, paramValues, quantitiesFromArea } from "../assets/js/scenario.js";

const rates = JSON.parse(readFileSync(new URL("../assets/data/rates.json", import.meta.url)));
const el = (category, layers, volume = 1, area = 10) => ({ expressID: 1, globalId: "G", tag: "42", category, floor: 1, volume, area, layers });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("단위 정육면체: 부피 1, 겉넓이 6", () => {
  const p = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
  const i = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  near(Math.abs(meshVolume(p, i)), 1);
  near(meshSurface(p, i), 6);
});

test("재료 이름 → 분류", () => {
  const cases = { "Concrete": "concrete", "콘크리트 24MPa": "concrete", "Gypsum Board": "board", "석고보드": "board", "Plywood": "wood", "Wood Stud": "wood",
    "Steel Stud": "metal", "EPS Insulation": "insulation", "PVC Flooring": "resin", "Copper Pipe": "copper", "Aluminum": "aluminum", "벽돌": "masonry", "Ceramic Tile": "tile", "Generic": null };
  for (const [name, cls] of Object.entries(cases)) assert.equal(materialClass(name), cls, name);
});

test("강관·강봉의 수량표 중량과 IFC 재료 분류", () => {
  for (const layer of [{name:"강관(STK400)"}, {name:"강봉"}, {name:"STK400"}, {name:"Generic",category:"Steel"}]) {
    const member = {...el("beam", [layer]), weightTons:0.873};
    const result = classify(member, rates);
    assert.equal(result.stream, "metal");
    near(result.tons, 0.873);
  }
  near(massUnitTons({UnitType:"MASSUNIT",Name:"GRAM",Prefix:"KILO"}), 0.001);
  assert.ok(Number.isNaN(massUnitTons(null)));
  assert.equal(materialClass("철근콘크리트"), "concrete");
});

test("복합벽은 층 두께 비율로 나눈다", () => {
  const c = classify(el("wall", [{ name: "Concrete", thickness: 0.2 }, { name: "EPS Insulation", thickness: 0.04 }, { name: "Gypsum Board", thickness: 0.01 }], 2.5), rates);
  near(c.parts[0].tons, 2 * 2.4);
  near(c.parts[1].tons, 0.4 * 0.03);
  near(c.parts[2].tons, 0.1 * 0.8);
  assert.deepEqual(c.parts.map((p) => p.stream), ["concrete", "resin", "board"]);
  assert.equal(c.stream, "concrete");
  assert.equal(c.guessed, false);
});

test("창호는 면적으로 유리와 창틀을 나누고, 재료 없는 벽은 추정으로 표시", () => {
  const w = classify(el("window", [{ name: "Aluminum", thickness: 0 }], 0.3, 2.7), rates);
  near(w.parts.find((p) => p.stream === "glass").tons, 2.7 * 0.03);
  near(w.parts.find((p) => p.stream === "aluminum").tons, 2.7 * 0.01);
  const g = classify(el("wall", []), rates);
  assert.equal(g.guessed, true);
  assert.equal(g.stream, "concrete");
});

test("사용자 지정 성상이 우선한다", () => {
  const e = el("covering", [{ name: "Generic", thickness: 0 }]);
  assert.equal(classify(e, rates, { [groupKey(e)]: "wood" }).stream, "wood");
});

test("물량 합산, 원단위 보충, 부재별 결과 CSV", () => {
  const list = [
    classify(el("slab", [{ name: "Concrete", thickness: 0 }], 100), rates),
    classify(el("covering", [{ name: "Plywood", thickness: 0 }], 0.5), rates),
    classify(el("pipe", [{ name: "Copper Pipe", thickness: 0 }], 0.01), rates),
  ];
  const q = quantitiesFromElements(list, 1000);
  near(q.concrete_m3, 100); near(q.t.concrete, 240); near(q.t.wood, 0.3); near(q.t.copper, 0.089);
  const s = supplement(q, "공동주택", rates);
  near(s.t.wood, 15); near(s.t.resin, 26.1); near(s.t.mixed, 163.7); near(s.t.concrete, 240);
  const res = elementResults(list, paramValues(rates));
  // 처리 방식은 실제 작업 기준: 슬래브는 압쇄, 합판·동관은 선철거(분별)
  assert.deepEqual(res.map((r) => r.method), ["압쇄 해체", "분별 해체", "분별 해체"]);
  assert.ok(res[2].revenue > 1e6 && res[0].disposal > 0);
  const csv = toCsv(res).trim().split("\n");
  assert.equal(csv.length, 4);
  assert.ok(csv[0].startsWith("GlobalId,ElementId") && csv[1].startsWith("G,42,slab,1,concrete,압쇄 해체,240.0000"));
  // 압쇄 해체로 표시한 슬래브에서도 철근 매각수익이 생기고, 회수율만큼 공법별로 다르다
  const p = paramValues(rates);
  const selective = elementResults(list, p, p.fee_mixed_unverified, q, "selective");
  const crush = elementResults(list, p, p.fee_mixed_unverified, q, "crush");
  assert.equal(selective[0].method, "압쇄 해체");
  assert.ok(selective[0].revenue > 0 && crush[0].revenue > 0);
  near(selective[0].revenue / crush[0].revenue, p.rec_scrap_sel / p.rec_scrap_crush);
  // 일괄 압쇄에서는 아무것도 선철거하지 않는다
  assert.deepEqual(crush.map((r) => r.method), ["압쇄 해체", "압쇄 해체", "압쇄 해체"]);
});

test("개방형 철골과 바닥이 있는 철골 건물 구분", () => {
  const members = [
    el("column", [{name:"강관(STK400)"}]),
    el("beam", [{name:"강관(STK400)"}]),
    el("footing", [{name:"콘크리트"}]),
  ].map(member => classify(member, rates));
  assert.equal(isOpenSteelFrame(members), true);
  assert.equal(isOpenSteelFrame([...members, classify(el("slab", [{name:"콘크리트"}]), rates)]), false);
});

test("일괄 압쇄 부재표는 건물 전체와 같은 보드·타일 처리 경로를 적용한다", () => {
  const p = paramValues(rates);
  const q = quantitiesFromArea(1000, "비주거 RC", rates);
  q.t = { ...Object.fromEntries(Object.keys(q.t).map(key => [key, 0])), board: 10, tile: 10 };
  q.concrete_m3 = 0;
  q.finishTakeoff = {};
  q.finishBaseline = { board: 0.6, tile: 1 };
  q.finishDemolitionMixedShare = 0;
  q.boardCrush = 20;
  q.boardFee = 12345;
  const scenario = costScenario(q, p, "crush");
  assert.equal(scenario.finishRoutes.board.separate, 2);
  assert.equal(scenario.finishRoutes.board.concreteCarryover, 4);
  const classified = ["board", "tile"].map(stream => ({
    stream, tons: 10, parts: [{ stream, tons: 10 }],
  }));
  const rows = elementResults(classified, p, scenario.mixed.fee, q, "crush", scenario);
  assert.ok(Math.abs(rows[0].disposal - (2 * 12345 + 4 * scenario.mixed.fee + 4 * p.fee_concrete)) < 1e-8);
  assert.ok(Math.abs(rows[1].disposal - 10 * scenario.mixed.fee) < 1e-8);
  assert.ok(Math.abs(rows[0].disposal + rows[1].disposal - scenario.disposal) < 1e-8);
});

test("PVC 창틀의 처리비와 매각수익을 원래 부재에 기록한다", () => {
  const p = paramValues(rates);
  const frame = { ...el("window", []), stream: "resin", tons: 1, parts: [{ stream: "resin", tons: 1 }] };
  const pipe = { ...el("pipe", []), tag: "43", stream: "resin", tons: 0.2, parts: [{ stream: "resin", tons: 0.2 }] };
  const parts = [frame, pipe];
  const q = { ...quantitiesFromElements(parts, 100), fixedComparison: true, pvcFrameTons: 1, windowMode: "both" };
  for (const mode of ["crush", "selective"]) {
    for (const pvcPrice of [undefined, -150, 0, 500]) {
      const input = { ...q, pvcPrice };
      const scenario = costScenario(input, p, mode);
      const rows = elementResults(parts, p, scenario.mixed.fee, input, mode, scenario);
      near(rows[0].revenue, Math.max(0, pvcPrice ?? 0) * 1000);
      near(rows[0].disposal, pvcPrice == null ? scenario.mixed.fee : Math.max(0, -pvcPrice) * 1000);
      near(rows[0].disposal + rows[1].disposal, scenario.disposal);
      near(rows[0].revenue + rows[1].revenue, scenario.revenue);
      const reconciled = reconcileElementResults(rows, 1.2, scenario);
      assert.equal(reconciled.length, 2);
      assert.equal(toCsv(reconciled).split("\n")[1].split(",").at(-1), String(Math.round(rows[0].revenue)));
    }
  }
});
