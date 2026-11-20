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
check(c.general.equipCost > 0 && c.general.structDays > 0 && c.general.indirect > 0, `일괄 압쇄에 장비비·압쇄 일수·간접비 포함 (장비 ${Math.round(c.general.equipCost / 1e6)}백만원, 압쇄 ${c.general.structDays.toFixed(1)}일)`);
check(c.general.haulCost === 0 && c.selective.equip.excavatorSmall === undefined, "ReClaim Compare에 없는 반출비·소형 장비는 기본값에서 꺼져 있다");
check((c.general.revenue.steel || 0) > 0, `콘크리트 속 철근(100kg/㎥) 고철 수익 (${Math.round((c.general.revenue.steel || 0) / 1e6)}백만원)`);
check(c.selective.days > c.general.days, `분별 해체 공기가 더 길다 (${c.general.days.toFixed(1)} → ${c.selective.days.toFixed(1)}일)`);
check(Math.abs(c.general.structDays - c.selective.structDays) < 1e-9, "구조체 압쇄 일수는 두 안이 같다");
check(Math.abs(c.selective.disposal.concrete.cost - c.general.disposal.concrete.cost) < 1, "폐콘크리트 처리단가는 두 방법이 같다 (fee_concrete_selective = fee_concrete)");

// 5) ReClaim Compare(reclaim-compare 저장소 a5c3be0)와 같은 결과: 공동주택 2,400㎡, 원단위 물량
const rcq = { concrete: 1.477 * 2400, metal: 0.0655 * 2400, wood: 0.015 * 2400, resin: 0.0261 * 2400, mixed: 0.1637 * 2400 };
const rc = paperCase({}, { area: 2400, use: "주거 공동주택", tonsOverride: rcq });
near("ReClaim Compare 일괄 압쇄 (백만원)", rc.general.total / 1e4, 100162, 2);
near("ReClaim Compare 전면 분별해체 (백만원)", rc.selective.total / 1e4, 100583, 2);

// 4) 몬테카를로는 같은 seed면 같은 결과
const a = simulate(m, {}, { n: 200, seed: 7 }), b = simulate(m, {}, { n: 200, seed: 7 });
check(a.selective.p50 === b.selective.p50 && a.selective.pCheaper === b.selective.pCheaper, "몬테카를로 재현성 (seed 7)");

process.exitCode = failed ? 1 : 0;
