import assert from "node:assert/strict";
import test from "node:test";
import { formatCostDifference, stackedBars } from "../assets/js/charts.js";

test("비용 차이의 억·만원·원 경계와 부호를 표시한다", () => {
  assert.deepEqual(
    [0, 9_999, 10_000, 12_345, 99_999_999, 100_000_000, 123_450_000]
      .map(value => formatCostDifference(value)),
    ["0원", "9,999원", "1만원", "1만원", "9,999만원", "1억 0만원", "1억 2,345만원"],
  );
  assert.equal(formatCostDifference(-123_456_789, true), "−1억 2,345만원");
  assert.equal(formatCostDifference(54_321, true), "+5만원");
  assert.equal(formatCostDifference(-0.5, true), "0원");
});

test("가까운 순비용을 막대에서 각각 원 단위로 읽을 수 있다", () => {
  const chart = stackedBars([
    { name: "일괄 압쇄", labor: 40731572, total: 40731572, days: 13.429 },
    { name: "전면 분별", labor: 40702009, total: 40702009, days: 14.652 },
  ]);
  assert.match(chart, /^<svg viewBox="0 0 760 140"/);
  assert.match(chart, /x="748"[^>]+class="c-value">40,731,572원/);
  assert.match(chart, /x="748"[^>]+class="c-value">40,702,009원/);
  assert.match(chart, /순비용 · 13\.4일/);
  assert.match(chart, /data-tip="전면 분별 · 인건비 40,702,009원"/);
});

test("매각수익과 비용은 같은 0점과 원당 막대 길이를 적용한다", () => {
  const chart = stackedBars([
    { name: "압쇄", labor: 1000, revenue: 500, total: 500, days: 1 },
    { name: "분별", labor: 990, revenue: 500, total: 490, days: 1 },
  ]);
  const rects = [...chart.matchAll(/<rect x="([^"]+)" y="[^"]+" width="([^"]+)"/g)].map(match => match.slice(1).map(Number));
  const [zero] = [...chart.matchAll(/<line x1="([^"]+)"/g)].map(match => Number(match[1]));
  assert.equal(rects[0][0], rects[2][0]);
  assert.equal(rects[0][0] - 1, zero);
  assert.deepEqual(rects[1], rects[3]);
  assert.ok(rects[1][0] + rects[1][1] < zero);
  assert.ok(Math.abs((rects[0][1] + 2) / (rects[2][1] + 2) - 1000 / 990) < 1e-12);
  assert.match(chart, /class="c-note">0원/);
});

test("비용과 매각수익이 모두 0일 때 가짜 막대를 그리지 않는다", () => {
  const chart = stackedBars([
    { name: "압쇄", total: 0, days: 0 },
    { name: "분별", total: 0, days: 0 },
  ]);
  assert.doesNotMatch(chart, /NaN|Infinity|<rect/);
  assert.equal([...chart.matchAll(/class="c-value">0원/g)].length, 2);
});
