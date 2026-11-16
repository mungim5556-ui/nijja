import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, materialClass, quantitiesFromElements, supplement, elementResults, toCsv, groupKey } from "../assets/js/classify.js";
import { meshVolume, meshSurface } from "../assets/js/ifc.js";
import { paramValues } from "../assets/js/scenario.js";

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
    "Steel Stud": "metal", "EPS Insulation": "insulation", "PVC Flooring": "resin", "Copper Pipe": "copper", "Aluminum": "aluminum", "벽돌": "masonry", "Ceramic Tile": "mixed", "Generic": null };
  for (const [name, cls] of Object.entries(cases)) assert.equal(materialClass(name), cls, name);
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
  assert.deepEqual(res.map((r) => r.method), ["압쇄", "분별", "분별"]);
  assert.ok(res[2].revenue > 1e6 && res[0].disposal > 0);
  const csv = toCsv(res).trim().split("\n");
  assert.equal(csv.length, 4);
  assert.ok(csv[0].startsWith("GlobalId,ElementId") && csv[1].startsWith("G,42,slab,1,concrete,압쇄,240.0000"));
});
