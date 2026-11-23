import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derive, computeModel, computeQuantities, QUANTITIES_SCHEMA, caseFields, defaultSiteInputs } from "../assets/js/pipeline.js";
import { paramValues } from "../assets/js/scenario.js";

const rates = JSON.parse(readFileSync(new URL("../assets/data/rates.json", import.meta.url)));
const defaults = paramValues(rates);

// parseIfc()와 같은 모양의 작은 RC 건물 (지상 2층, 바닥 슬래브 2장, 벽, 기둥, 창)
const layer = (name, thickness = 0.2) => ({ name, category: "", thickness });
function smallModel() {
  const elements = [];
  for (const floor of [1, 2]) {
    elements.push({ globalId: `S${floor}`, tag: `${100 + floor}`, name: "Slab", category: "slab", floor, volume: 20, area: 100, layers: [layer("Concrete")] });
    for (let i = 0; i < 4; i++) elements.push({ globalId: `W${floor}${i}`, tag: `${200 + floor * 10 + i}`, name: "Wall", category: "wall", floor, volume: 6, area: 30,
      layers: [layer("Concrete", 0.2), layer("Gypsum Board", 0.0125)] });
    elements.push({ globalId: `C${floor}`, tag: `${300 + floor}`, name: "Column", category: "column", floor, volume: 1.2, area: 0, layers: [layer("Concrete")] });
    elements.push({ globalId: `N${floor}`, tag: `${400 + floor}`, name: "Window", category: "window", floor, volume: 0.05, area: 4, layers: [layer("Glass", 0), layer("Aluminum", 0)] });
  }
  return { name: "small", elements, gross: { area: 200, basis: "slab" }, floors: 2, aboveFloors: 2, usage: "비주거 RC" };
}

test("computeModel: IFC 기본 조건으로 두 공법을 계산하고 부재별 결과를 낸다", () => {
  const r = computeModel(smallModel(), {}, { rates, defaults });
  assert.ok(!r.comparisonLimit, `비교 제한 없음: ${r.comparisonLimit}`);
  assert.ok(r.cmp, "비교 결과가 있어야 한다");
  assert.ok(Number.isFinite(r.cmp.crush.total) && Number.isFinite(r.cmp.selective.total));
  assert.ok(r.cmp.crush.days > 0 && r.cmp.selective.days > 0);
  assert.equal(r.state.usage, "비주거 RC");
  assert.equal(r.state.area, 200);
  assert.equal(r.state.labor, "quantity");
  assert.ok(r.elementRows.some(row => row.tag === "101"), "부재 ElementId(tag)가 결과에 남아야 한다");
});

test("computeModel: 같은 입력은 같은 결과, 입력값은 화면 기본값을 덮는다", () => {
  const a = computeModel(smallModel(), {}, { rates, defaults });
  const b = computeModel(smallModel(), {}, { rates, defaults });
  assert.equal(a.cmp.crush.total, b.cmp.crush.total);
  assert.equal(a.cmp.selective.total, b.cmp.selective.total);
  const c = computeModel(smallModel(), { usage: "공동주택", area: 180 }, { rates, defaults });
  assert.equal(c.state.usage, "공동주택");
  assert.equal(c.state.area, 180);
  assert.equal(c.state.areaConfirmed, true);
});

test("computeModel은 화면(app.js)과 같은 derive를 쓴다", () => {
  const model = smallModel();
  const r = computeModel(model, {}, { rates, defaults });
  const direct = derive({ ...r.state }, { rates, defaults });
  assert.equal(direct.cmp.crush.total, r.cmp.crush.total);
  assert.equal(direct.cmp.selective.total, r.cmp.selective.total);
  for (const key of caseFields) assert.ok(key in r.state, `${key}가 상태에 있어야 한다`);
  for (const [key, value] of Object.entries(defaultSiteInputs)) if (key !== "scope") assert.equal(r.state[key], value);
});

test("computeQuantities: 물량 묶음 형식을 확인한다", () => {
  const r = computeQuantities({ schema: QUANTITIES_SCHEMA, model: smallModel(), inputs: { usage: "비주거 RC" } }, { rates, defaults });
  assert.ok(r.cmp);
  assert.throws(() => computeQuantities({ schema: "x", model: smallModel() }, { rates, defaults }), /schema/);
  assert.throws(() => computeQuantities({ schema: QUANTITIES_SCHEMA, model: {} }, { rates, defaults }), /elements/);
});

test("외곽 치수로 추정한 면적은 확인 전까지 비교하지 않는다 (화면과 같은 제한)", () => {
  const model = { ...smallModel(), gross: { area: 250, basis: "bbox" } };
  const r = computeModel(model, {}, { rates, defaults });
  assert.equal(r.cmp, null);
  assert.match(r.comparisonLimit, /외곽 치수/);
  assert.ok(computeModel(model, { area: 200 }, { rates, defaults }).cmp, "면적을 넣으면 비교한다");
});
