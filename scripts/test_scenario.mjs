// 시나리오 엔진 검증: node scripts/test_scenario.mjs
// 1) 논문(2023) 사례를 면적 원단위 방식으로 재현한다.
import { paperCase, compare, simulate } from "../assets/js/bim/scenario.js";
import { demoModel } from "../assets/js/bim/demo-model.js";

let failed = 0;
const near = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${Math.round(got).toLocaleString()} (논문 ${want.toLocaleString()}, 허용 ±${tol.toLocaleString()})`);
};

const r = paperCase();
const k = 1000; // 논문 단위: 천원
near("일반 해체 시공비", r.general.laborCost / k, 635161, 1);
near("분별 해체 시공비", r.selective.laborCost / k, 702683, 1);
near("일반 해체 처리비", r.general.disposalCost / k, 234010, 1);
near("분별 해체 처리비", r.selective.disposalCost / k, 195187, 1);
near("재활용 수익", r.selective.revenueTotal / k, 63426, 634); // 논문은 63t·2,469장으로 반올림해 계산 (±1%)
near("Δ 합계", r.delta.total / k, -34727, 347);

// 2) 표 4를 표 3과 맞추면 결론이 뒤집힌다 (논문 원문 불일치 확인)
const aligned = paperCase({ table4: "aligned" });
const flips = aligned.delta.total > 0;
if (!flips) failed++;
console.log(`${flips ? "ok  " : "FAIL"} 표 4 보정 시 Δ: ${Math.round(aligned.delta.total / k).toLocaleString()}천원 (양수여야 함)`);

// 3) BIM 방식: 최적안은 완전 철거·분별 해체보다 비싸지 않아야 한다
const m = demoModel();
const c = compare(m, {});
const okOpt = c.optimal.total <= c.full.total + 1 && c.optimal.total <= c.selective.total + 1;
if (!okOpt) failed++;
console.log(`${okOpt ? "ok  " : "FAIL"} 최적안 ≤ 두 안: 완전 ${Math.round(c.full.total / 1e6)} / 분별 ${Math.round(c.selective.total / 1e6)} / 최적 ${Math.round(c.optimal.total / 1e6)} 백만원`);

// 4) 몬테카를로는 같은 seed면 같은 결과
const a = simulate(m, {}, { n: 200, seed: 7 }), b = simulate(m, {}, { n: 200, seed: 7 });
const same = a.selective.p50 === b.selective.p50 && a.selective.pCheaper === b.selective.pCheaper;
if (!same) failed++;
console.log(`${same ? "ok  " : "FAIL"} 몬테카를로 재현성 (seed 7)`);

process.exitCode = failed ? 1 : 0;
