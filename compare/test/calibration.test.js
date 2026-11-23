import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calibrateStructure, validationCases, comparableCases, benchmark } from "../assets/js/calibration.js";
import { paramValues, schedule } from "../assets/js/scenario.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../assets/data/${name}`, import.meta.url)));
const p = paramValues(load("rates.json"));
const q = { area_m2: 1000, floors: 4, site: "normal", structure: "rc", scope: "above", equipment: "large" };

function dataset(factor = 1.25) {
  return Array.from({ length: 5 }, (_, i) => {
    const row = { ...q, id: `c${i}`, name: `현장 ${i}`, source: "시험자료", area_m2: 850 + i * 70, concrete_m3: 250,
      type: "plan", verified: true, crew_mean: 4 + i };
    return { ...row, structure_days: schedule(row, p, "crush").areaDays * factor };
  });
}

test("검증자료 형식, 중복 현장, 일수 오류를 확인한다", () => {
  const sample = load("plan-validation.json");
  const cases = validationCases(sample);
  assert.equal(cases.length, 12);
  assert.equal(cases.find((row) => row.id === "cheonmasan").period_length, 21);
  assert.equal(cases.find((row) => row.id === "cheonmasan").total_days, undefined);
  const beomil = cases.find((row) => row.id === "beomil-830-72");
  assert.deepEqual([beomil.period_length, beomil.total_days, beomil.period_unit], [17, 7, "calendar_day"]);
  assert.equal(cases.find((row) => row.id === "gijang-dongbu").period_max, true);
  assert.equal(calibrateStructure(cases, { ...q, equipment: "mounted" }, p, "plan").count, 0);
  assert.throws(() => validationCases({ ...sample, cases: [sample.cases[0], sample.cases[0]] }), /중복/);
  assert.throws(() => validationCases({ ...sample, cases: [{ ...sample.cases[0], structure_days: 16 }] }), /초과/);
  assert.throws(() => validationCases({ ...sample, cases: [{ ...sample.cases[0], period_unit: "invalid" }] }), /기간/);
});

test("출처 확인·동일 장비·작업 범위·자료 유형과 대상 현장 제외", () => {
  const rows = dataset();
  assert.equal(comparableCases(rows, q, "plan").length, 5);
  assert.equal(comparableCases(rows, q, "actual").length, 0);
  assert.equal(comparableCases(rows, { ...q, scope: "full" }, "plan").length, 0);
  assert.equal(comparableCases(rows, { ...q, equipment: "mounted" }, "plan").length, 0);
  assert.equal(comparableCases(rows, { ...q, caseId: "c0" }, "plan").length, 4);
  assert.deepEqual(benchmark(rows, "crew_mean"), { count: 5, median: 6, min: 4, max: 8 });
});

test("보정은 유사 사례 5건과 교차검증 오차 개선이 필요하다", () => {
  const fit = calibrateStructure(dataset(), q, p, "plan");
  assert.equal(fit.ready, true);
  assert.ok(Math.abs(fit.factor - 1.25) < 1e-9);
  assert.ok(fit.cvMae < fit.baseMae);
  assert.deepEqual(calibrateStructure(dataset().slice(0, 4), q, p, "plan"), { count: 4, ready: false });
  assert.equal(calibrateStructure(dataset(1), q, p, "plan").ready, false);
});
