// 공법 비교 계산 엔진 (reclaim-compare를 compare/로 동기화한 것)으로 Revit 물량 묶음을 계산한다.
// Worker 진입 파일(worker.js)에는 일반 함수를 export하지 않는다 (Cloudflare는 진입 파일의 export를 진입점으로 본다).
import { computeQuantities, QUANTITIES_SCHEMA } from "../compare/assets/js/pipeline.js";
import { paramValues, streamTons } from "../compare/assets/js/scenario.js";
import RATES from "../compare/assets/data/rates.json" with { type: "json" };
import UPSTREAM from "../compare/UPSTREAM.json" with { type: "json" };

export { QUANTITIES_SCHEMA };
export const ENGINE = { repo: UPSTREAM.repo, commit: UPSTREAM.commit, date: UPSTREAM.date };
const DEFAULTS = paramValues(RATES);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
const SCENARIO_KEYS = ["total", "labor", "equipment", "disposal", "transport", "indirect", "revenue", "days"];
const ROW_KEYS = ["globalId", "tag", "category", "floor", "stream", "method", "tons", "disposal", "revenue"];

// 물량 묶음 → 저장할 계산 결과 (화면 없이 쓰는 값만)
export function costBundle(bundle) {
  const out = computeQuantities(bundle, { rates: RATES, defaults: DEFAULTS });
  const cmp = out.cmp;
  return {
    engine: ENGINE,
    at: new Date().toISOString(),
    inputs: pick(out.state, ["usage", "area", "areaBasis", "areaConfirmed", "floors", "scope", "site", "equipment", "structure", "labor", "supplement"]),
    comparisonLimit: out.comparisonLimit || null,
    openSteelFrame: Boolean(out.openSteelFrame),
    review: out.review || [],
    crush: cmp ? pick(cmp.crush, SCENARIO_KEYS) : null,
    selective: cmp ? pick(cmp.selective, SCENARIO_KEYS) : null,
    // 성상별 톤 (화면 '입력 물량'과 같은 값), 콘크리트 부피
    tons: cmp ? streamTons(out.q, out.state.p).t : null,
    concreteM3: out.q?.concrete_m3 ?? null,
    delta: cmp ? cmp.delta : null,
    deltaDays: cmp ? cmp.deltaDays : null,
    recommended: out.recommended ?? null,
    includedCostResult: out.includedCostResult ?? null,
    elementRows: (out.elementRows || []).map((r) => pick(r, ROW_KEYS)),
  };
}

