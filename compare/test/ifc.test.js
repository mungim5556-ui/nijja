import test from "node:test";
import assert from "node:assert/strict";
import { lengthScale, openingArea } from "../assets/js/ifc.js";

// web-ifc가 GetLine(..., true)로 펼친 IfcUnitAssignment.Units와 같은 모양
const si = (prefix) => ({ UnitType: { value: "LENGTHUNIT" }, Prefix: prefix ? { value: prefix } : null, Name: { value: "METRE" } });
const angle = { UnitType: { value: "PLANEANGLEUNIT" }, Name: { value: "RADIAN" } };

test("IFC 길이 단위: m는 1, mm는 0.001, 인치·피트는 환산 배율", () => {
  assert.equal(lengthScale([angle, si(null)]), 1);
  assert.equal(lengthScale([angle, si("MILLI")]), 0.001);
  assert.equal(lengthScale([si(".CENTI.")]), 0.01); // 점이 붙은 열거값도 받는다
  const foot = { UnitType: { value: "LENGTHUNIT" }, Name: { value: "FOOT" },
    ConversionFactor: { ValueComponent: { value: 0.3048 }, UnitComponent: si(null) } };
  assert.ok(Math.abs(lengthScale([foot]) - 0.3048) < 1e-12);
  const inchInMm = { UnitType: { value: "LENGTHUNIT" }, ConversionFactor: { ValueComponent: { value: 25.4 }, UnitComponent: si("MILLI") } };
  assert.ok(Math.abs(lengthScale([inchInMm]) - 0.0254) < 1e-12);
  assert.equal(lengthScale([]), 1); // 단위 정보가 없으면 m로 본다
});

test("창·문 면적: mm 속성을 m로 바꾸면 그대로 쓰고, 단위가 어긋나 터무니없으면 형상 값을 쓴다", () => {
  // Revit 샘플 창 2700 × 1500 mm, 형상 겉넓이 약 9㎡
  assert.ok(Math.abs(openingArea(2700 * 0.001, 1500 * 0.001, 9) - 4.05) < 1e-9);
  assert.equal(openingArea(2700, 1500, 9), 4.5); // 배율을 못 읽었을 때 (4,050,000㎡ → 형상 4.5㎡)
  assert.equal(openingArea(0, 0, 6), 3);
  assert.equal(openingArea(1.8, 1.5, 0), 2.7);
});

test("연면적 추정: 바닥·기초 슬래브 면적 합 (지붕 제외), 슬래브가 없으면 외곽 상자 × 층수", async () => {
  const { grossArea } = await import("../assets/js/ifc.js");
  const els = [
    { category: "slab", floor: 1, area: 120 }, { category: "slab", floor: 2, area: 110 },
    { category: "slab", floor: 3, area: 115 }, // 옥상 슬래브: 3층에 벽·기둥이 없다
    { category: "footing", floor: 0, predefined: "BASESLAB", area: 130 }, { category: "footing", floor: 0, predefined: "", area: 40 },
    { category: "roof", floor: 3, area: 125 }, { category: "wall", floor: 1, area: 50 }, { category: "column", floor: 2, area: 1 },
  ];
  // 1층 슬래브가 있으면 기초 매트는 세지 않는다: 120 + 110
  assert.deepEqual(grossArea(els, [20, 9, 15], 3), { area: 230, basis: "slab" });
  // 1층 슬래브가 없으면 기초 매트가 1층 바닥이다: 130 + 110
  assert.deepEqual(grossArea(els.filter((e) => !(e.category === "slab" && e.floor === 1)), [20, 9, 15], 3), { area: 240, basis: "slab" });
  // 벽·기둥 정보가 없으면 슬래브를 모두 센다
  assert.deepEqual(grossArea([{ category: "slab", floor: 1, area: 100 }, { category: "slab", floor: 2, area: 100 }], [1, 1, 1], 2), { area: 200, basis: "slab" });
  assert.deepEqual(grossArea([{ category: "wall", area: 50 }], [20, 9, 15], 3), { area: 900, basis: "bbox" });
});

test("기타 객체(IfcBuildingElementProxy)는 기본으로 물량에서 빠지고, 성상을 고르면 들어간다", async () => {
  const { readFileSync } = await import("node:fs");
  const { classify, quantitiesFromElements, groupKey, elementResults } = await import("../assets/js/classify.js");
  const { paramValues } = await import("../assets/js/scenario.js");
  const rates = JSON.parse(readFileSync(new URL("../assets/data/rates.json", import.meta.url)));
  const tree = { category: "other", name: "RPC Tree", volume: 400, area: 0, layers: [] };
  const wall = { category: "wall", volume: 10, area: 0, layers: [{ name: "Concrete", thickness: 0 }] };
  const q = quantitiesFromElements([tree, wall].map((e) => classify(e, rates)), 100);
  assert.equal(q.t.mixed, 0);
  assert.ok(Math.abs(q.t.concrete - 24) < 1e-9);
  assert.ok(!Object.values(q.t).some(Number.isNaN));
  const inc = quantitiesFromElements([classify(tree, rates, { [groupKey(tree)]: "mixed" })], 100);
  assert.ok(inc.t.mixed > 0);
  assert.equal(elementResults([classify(tree, rates)], paramValues(rates))[0].method, "제외");
});

test("사각 중공 단면의 생략된 2D 원점만 보완한다", async () => {
  const { normalizeHollowProfilePositions } = await import("../assets/js/ifc.js");
  const text = "DATA;\n#23=IFCRECTANGLEHOLLOWPROFILEDEF(.AREA.,'TUBE',$,0.075,0.075,0.0032,$,$);\nENDSEC;";
  const input = new TextEncoder().encode(text);
  const output = new TextDecoder().decode(normalizeHollowProfilePositions(input));
  assert.match(output, /'TUBE',#25,0.075/);
  assert.match(output, /#25=IFCAXIS2PLACEMENT2D\(#24,\$\)/);
  assert.ok(new TextDecoder().decode(input).includes("'TUBE',$,"));
  const normalized = new TextEncoder().encode(output);
  assert.equal(normalizeHollowProfilePositions(normalized), normalized);
});
