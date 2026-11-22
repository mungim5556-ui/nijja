import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { concreteGradeLink, concreteGrades, costScenario, paramValues } from "../assets/js/scenario.js";

const rates = JSON.parse(readFileSync(new URL("../assets/data/rates.json", import.meta.url)));
const p = paramValues(rates);
const model = {
  concreteCase: "linked",
  finishBaseline: { board: 0.6, tile: 1 },
  finishTakeoff: { board: {}, tile: {} },
  finishAreas: { board: 14302.89, tile: 1907.052 },
  t: { board: 143.0289, tile: 45.769248, concrete: 7968.550875802546 },
  concrete_m3: 2938,
  area_m2: 9535.26,
  floors: 15,
  labor: "quantity",
};

function shares(q, selective = true) {
  return concreteGrades(p, selective, q.concreteCase, q).map(grade => Math.round(grade.share * 10000) / 100);
}

test("04 benchmark reproduces both existing grade allocations", () => {
  assert.deepEqual(shares(model, false), [66, 26, 8]);
  assert.deepEqual(shares(model), [80, 18, 2]);
});

test("finish routes conserve mass and charge each tonne once", () => {
  const quoted = { ...model, boardFee: 50000, boardSel: 50, finishDemolitionMixedShare: 0.5 };
  for (const mode of ["crush", "selective"]) {
    const result = costScenario(quoted, p, mode);
    const total = Object.values(result.finishRoutes).reduce((sum, row) => {
      assert.ok(Math.abs(row.total - row.separate - row.preRemovalMixed - row.demolitionMixed - row.concreteCarryover) < 1e-9);
      return sum + row.total;
    }, 0);
    const split = result.finishRoutes.board.separate + result.finishRoutes.tile.separate;
    const carryover = result.finishRoutes.board.concreteCarryover + result.finishRoutes.tile.concreteCarryover;
    assert.ok(Math.abs(total - result.mixed.tons - split - carryover) < 1e-9);
    const billed = result.rows.filter(row => row.group === "처리비").reduce((sum, row) => sum + row.qty, 0);
    assert.ok(Math.abs(billed - model.t.concrete - total) < 1e-9);
  }
});

test("zero additional pre-removal has zero grade improvement", () => {
  assert.deepEqual(shares({ ...model, finishBaseline: { board: 1, tile: 1 } }), [66, 26, 8]);
});

test("grade improvement is monotonic and capped", () => {
  const variants = [0, 0.5, 1, 5].map(scale => shares({ ...model, t: { ...model.t, board: model.t.board * scale } }));
  assert.deepEqual(variants, [[66, 26, 8], [73, 22, 5], [80, 18, 2], [80, 18, 2]]);
});

test("scaling finish and concrete equally keeps grades", () => {
  const q = { ...model, t: { ...model.t, board: model.t.board / 2 } };
  assert.deepEqual(shares(q), shares({ ...q, t: Object.fromEntries(Object.entries(q.t).map(([key, tons]) => [key, tons * 2])) }));
});

test("missing finish data does not credit selective grade improvement", () => {
  const q = { ...model, finishTakeoff: { board: { unverified: true }, tile: {} } };
  assert.equal(concreteGradeLink(q, p).status, "missing-finish");
  assert.deepEqual(shares(q), shares(q, false));
});
