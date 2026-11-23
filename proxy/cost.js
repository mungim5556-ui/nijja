// 공법 비교 계산 엔진 (reclaim-compare를 compare/로 동기화한 것)으로 Revit 물량 묶음을 계산한다.
// Worker 진입 파일(worker.js)에는 일반 함수를 export하지 않는다 (Cloudflare는 진입 파일의 export를 진입점으로 본다).
import { computeQuantities, QUANTITIES_SCHEMA } from "../compare/assets/js/pipeline.js";
import { paramValues, streamTons } from "../compare/assets/js/scenario.js";
import { materialClass } from "../compare/assets/js/classify.js";
import RATES from "../compare/assets/data/rates.json" with { type: "json" };
import UPSTREAM from "../compare/UPSTREAM.json" with { type: "json" };

export { QUANTITIES_SCHEMA };
export const ENGINE = { repo: UPSTREAM.repo, commit: UPSTREAM.commit, date: UPSTREAM.date };
const DEFAULTS = paramValues(RATES);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
const SCENARIO_KEYS = ["total", "labor", "equipment", "disposal", "transport", "indirect", "revenue", "days"];
const ROW_KEYS = ["globalId", "tag", "category", "floor", "stream", "method", "tons", "disposal", "revenue"];

// 재료 이름·분류로 성상을 알 수 없는 층 → {재료 이름: ㎥}. 엔진은 이런 층을 부재 범주 기본 재료로 셈한다.
export function unknownMaterials(model) {
  const out = {};
  for (const el of model?.elements || []) {
    const layers = el.layers || [];
    const thick = layers.reduce((s, l) => s + (l.thickness || 0), 0);
    if (!(thick > 0) || el.category === "window" || el.category === "door") continue;
    for (const l of layers) {
      if (!l.thickness || materialClass(l.name) || materialClass(l.category)) continue;
      const name = l.name || "(이름 없음)";
      out[name] = Math.round(((out[name] || 0) + (el.volume || 0) * l.thickness / thick) * 1000) / 1000;
    }
  }
  return out;
}

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
    unknownMaterials: unknownMaterials(bundle.model),
    // 부피·면적이 모두 0이라 물량에 들어가지 않은 부재 (Revit 형상을 못 읽은 경우)
    emptyElements: (bundle.model?.elements || []).filter((e) => !(e.volume > 0) && !(e.area > 0) && !["window", "door"].includes(e.category))
      .map((e) => ({ tag: e.tag, category: e.category, name: e.name, joinedCut: Boolean(e.joinedCut), joinResidual: e.joinResidual ?? null })),
    // 결합으로 깎였지만 상대 부재에도 들어가지 않은 부분을 되살린 부재 (Revit에서 원래 형상 − 결합 상대)
    joinRecovered: (bundle.model?.elements || []).filter((e) => e.joinedCut && e.volume > 0 && e.joinResidual)
      .map((e) => ({ tag: e.tag, category: e.category, name: e.name, ...e.joinResidual })),
    elementRows: (out.elementRows || []).map((r) => pick(r, ROW_KEYS)),
  };
}

