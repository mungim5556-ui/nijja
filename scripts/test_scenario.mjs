// 계산 엔진 검증: node scripts/test_scenario.mjs
import { paperCase, compare, simulate } from "../assets/js/bim/scenario.js";
import { demoModel } from "../assets/js/bim/demo-model.js";

let failed = 0;
const check = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const near = (name, got, want, tol) => check(Math.abs(got - want) <= tol, `${name}: ${Math.round(got).toLocaleString()} (기대 ${want.toLocaleString()}, 허용 ±${tol.toLocaleString()})`);
const k = 1000; // 논문 단위: 천원

// 1) 논문(2023) 사례 재현 — paper2023 프리셋
const r = paperCase({ preset: "paper2023" });
near("일반 해체 시공비", r.general.laborCost / k, 635161, 1);
near("분별 해체 시공비", r.selective.laborCost / k, 702683, 1);
near("일반 해체 처리비", r.general.disposalCost / k, 234010, 1);
near("분별 해체 처리비", r.selective.disposalCost / k, 195187, 1);
near("재활용 수익", r.selective.revenueTotal / k, 63426, 634); // 논문은 63t·2,469장으로 반올림 (±1%)
near("Δ 합계", r.delta.total / k, -34727, 347);

// 2) 표 4를 표 3과 맞추면 결론이 뒤집힌다
const aligned = paperCase({ preset: "paper2023", table4: "aligned" });
check(aligned.delta.total > 0, `표 4 보정 시 Δ ${Math.round(aligned.delta.total / k).toLocaleString()}천원 (양수여야 함)`);

// 3) 팀 2024 프리셋: 구조체 압쇄·장비·반출·공기가 들어간다
const m = demoModel();
const c = compare(m, {});
check(c.general.equipCost > 0 && c.general.haulCost > 0 && c.general.structDays > 0, `일괄 압쇄에 장비비·반출비·압쇄 일수 포함 (장비 ${Math.round(c.general.equipCost / 1e6)}백만원, 압쇄 ${c.general.structDays.toFixed(1)}일)`);
check(c.selective.days > c.general.days, `분별 해체 공기가 더 길다 (${c.general.days.toFixed(1)} → ${c.selective.days.toFixed(1)}일)`);
check(Math.abs(c.general.structDays - c.selective.structDays) < 1e-9, "구조체 압쇄 일수는 두 안이 같다");
check(c.selective.disposal.concrete?.cost < c.general.disposal.concrete?.cost, "분별 후 폐콘크리트 처리비가 더 싸다 (순수 폐콘크리트 단가)");

// 4) 몬테카를로는 같은 seed면 같은 결과
const a = simulate(m, {}, { n: 200, seed: 7 }), b = simulate(m, {}, { n: 200, seed: 7 });
check(a.selective.p50 === b.selective.p50 && a.selective.pCheaper === b.selective.pCheaper, "몬테카를로 재현성 (seed 7)");

process.exitCode = failed ? 1 : 0;
