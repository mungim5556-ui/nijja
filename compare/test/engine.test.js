import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paperMode, compare, costScenario, paramValues, quantitiesFromArea } from "../assets/js/scenario.js";
import { breakEven, simulate, tornado, triangular, variables, mulberry32 } from "../assets/js/sensitivity.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../assets/data/${f}`, import.meta.url)));
const paper = load("paper2023_case.json"), rates = load("rates.json");
const p = paramValues(rates), q = quantitiesFromArea(2400, "공동주택", rates), vars = variables(rates);

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

test("품 항목 합계가 논문 표 3·4 합계와 같다", () => {
  const sum = (m, i) => +rates.laborItems.reduce((s, x) => s + x[m][i], 0).toFixed(3);
  assert.deepEqual([sum("crush", 0), sum("crush", 1), sum("selective", 0), sum("selective", 1)], [0.375, 1.015, 0.465, 1.04]);
  assert.deepEqual([p.crush_carpenter, p.crush_laborer, p.sel_carpenter, p.sel_laborer], [0.375, 1.015, 0.465, 1.04]);
});

test("총액 = 내역 행의 합, 구조체 비용은 두 안이 같다", () => {
  const { crush, selective } = compare(q, p);
  for (const s of [crush, selective]) {
    assert.ok(Math.abs(s.rows.reduce((a, r) => a + r.amount, 0) - s.total) < 1);
    assert.ok(s.total > 0 && s.days > 0);
  }
  assert.equal(crush.equipment, selective.equipment);
  assert.ok(selective.labor > crush.labor && selective.disposal < crush.disposal && selective.days > crush.days);
});

test("혼합폐기물 처리비가 오르면 분별 쪽으로 기운다", () => {
  const base = compare(q, p).delta;
  assert.ok(compare(q, { ...p, fee_mixed_crush: p.fee_mixed_crush * 3 }).delta < base);
});

test("손익분기: 찾은 값에서 Δ ≈ 0", () => {
  const x = breakEven(q, p, "price_resin", 0, 5e6);
  assert.ok(x != null);
  assert.ok(Math.abs(compare(q, { ...p, price_resin: x }).delta) < 1);
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
  assert.ok(Math.abs(row.qty - 50 * 0.1 * 0.9) < 1e-9);
});
