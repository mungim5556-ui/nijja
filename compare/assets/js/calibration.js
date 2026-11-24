import { equipmentMode, schedule, SITES } from "./scenario.js?v=service-recovery-20261123";

export const VALIDATION_SCHEMA = "reclaim-validation/1";
export const MIN_CASES = 5;
export const SCOPES = { above: "지상부", below: "지하부", full: "기초·지하부 포함", partial: "부분해체", unknown: "미확인" };
export const PERIOD_UNITS = { calendar_day: "달력일", planned_day: "계획일", week: "주", month: "개월" };
const optionalNumbers = [
  "height_m", "total_days", "total_days_max", "structure_days", "crew_mean", "concrete_t", "concrete_m3",
  "period_length", "budget_won",
  "prior_days", "prior_crew", "prior_concrete_t", "extra_carpenter_pd_per_m2", "extra_laborer_pd_per_m2",
  "selective_crew", "excavator_m3_per_day", "indirect_per_day",
];

export function validationCases(doc) {
  if (doc?.schema !== VALIDATION_SCHEMA || !Array.isArray(doc.cases)) throw new Error("검증자료 JSON 형식이 다릅니다.");
  const ids = new Set();
  return doc.cases.map((row, i) => {
    const invalid = (field) => { throw new Error(`${i + 1}번째 사례: ${field} 항목을 확인하세요.`); };
    for (const field of ["id", "name", "source"]) {
      if (typeof row?.[field] !== "string" || !row[field].trim()) invalid(field);
    }
    const id = row.id.trim();
    if (ids.has(id)) invalid("중복 사례 ID");
    ids.add(id);
    if (row.area_m2 != null && !(Number.isFinite(row.area_m2) && row.area_m2 > 0)) invalid("해체 면적(㎡)");
    if (row.floors != null && !(Number.isInteger(row.floors) && row.floors >= 1)) invalid("지상 층수");
    if (!["rc", "other"].includes(row.structure)) invalid("구조");
    if (!Object.hasOwn(SCOPES, row.scope)) invalid("해체 범위");
    if (!["large", "small", "mounted", "mixed", "manual", "unknown"].includes(row.equipment)) invalid("구조체 장비");
    if (!Object.hasOwn(SITES, row.site) && row.site !== "unknown") invalid("대지 조건");
    if (!["plan", "actual"].includes(row.type) || typeof row.verified !== "boolean") invalid("자료 유형 및 출처 대조 여부");
    const out = { id, name: row.name.trim(), source: row.source.trim(), structure: row.structure, scope: row.scope,
      equipment: row.equipment, site: row.site, type: row.type, verified: row.verified, area_m2: row.area_m2,
      floors: row.floors, note: typeof row.note === "string" ? row.note : "" };
    if (row.facilities != null) {
      if (!Array.isArray(row.facilities) || !row.facilities.length) invalid("대상 시설");
      out.facilities = row.facilities.map(f => {
        if (!f || typeof f.name !== "string" || !f.name.trim() || typeof f.structure !== "string") invalid("시설명·구조");
        if (f.area_m2 != null && !(Number.isFinite(f.area_m2) && f.area_m2 > 0)) invalid("시설 면적");
        const item = { name: f.name, structure: f.structure, area_m2: f.area_m2 ?? null };
        for (const key of ["crushQuote", "selectiveQuote", "steelTons"]) {
          if (f[key] == null) continue;
          if (!Number.isFinite(f[key]) || f[key] < 0) invalid("시설 견적·중량");
          item[key] = f[key];
        }
        return item;
      });
    }
    for (const key of optionalNumbers) {
      if (row[key] == null) continue;
      if (!Number.isFinite(row[key]) || row[key] < 0) invalid(key);
      out[key] = row[key];
    }
    if (out.period_length != null) {
      if (!Object.hasOwn(PERIOD_UNITS, row.period_unit) || out.period_length <= 0) invalid("기간의 단위 또는 길이");
      out.period_unit = row.period_unit;
      out.period_max = row.period_max === true;
    }
    if (out.total_days_max != null && !(out.total_days_max >= (out.total_days ?? Infinity))) invalid("공기 범위");
    if (out.structure_days > (out.total_days_max ?? out.total_days ?? Infinity)) invalid("구조체 공기가 전체 공기를 초과");
    return out;
  });
}

export const median = (values) => {
  const x = values.slice().sort((a, b) => a - b), center = Math.floor(x.length / 2);
  return x.length % 2 ? x[center] : (x[center - 1] + x[center]) / 2;
};

function caseQuantity(row) {
  return { area_m2: row.area_m2, floors: row.floors, site: row.site, equipment: row.equipment, concrete_m3: row.concrete_m3 };
}

export function comparableCases(cases, q, type) {
  return cases.filter((row) => row.verified && row.type === type && row.structure === "rc" && q.structure === "rc"
    && ["above", "full"].includes(q.scope) && row.scope === q.scope && row.equipment === equipmentMode(q)
    && row.id !== q.caseId && row.floors != null && row.area_m2 >= q.area_m2 / 2 && row.area_m2 <= q.area_m2 * 2
    && Math.abs(row.floors - q.floors) <= 2);
}

const absoluteError = (actual, predicted) => Math.abs(predicted - actual);

export function calibrateStructure(cases, q, p, type) {
  // Number of machine-days is part of the current prediction. Require comparable volume for fitting.
  const rows = comparableCases(cases, q, type).filter(row => row.equipment !== "mixed").filter((row) => row.structure_days > 0 && row.concrete_m3 > 0);
  const samples = rows.map((row) => {
    const input = caseQuantity(row);
    const base = schedule(input, p, "crush");
    return { input, actual: row.structure_days, before: base.structure, ratio: row.structure_days / base.areaDays };
  });
  const count = samples.length;
  if (count < MIN_CASES) return { count, ready: false };
  const factor = median(samples.map((row) => row.ratio));
  let baseError = 0, cvError = 0;
  for (const [i, row] of samples.entries()) {
    const heldOutFactor = median(samples.filter((_, j) => i !== j).map((x) => x.ratio));
    const predicted = schedule({ ...row.input, structureFactor: heldOutFactor }, p, "crush").structure;
    baseError += absoluteError(row.actual, row.before);
    cvError += absoluteError(row.actual, predicted);
  }
  return { count, factor, baseMae: baseError / count, cvMae: cvError / count, ready: cvError + 1e-9 < baseError };
}

export const BENCHMARKS = {
  extra_carpenter_pd_per_m2: ["분별 추가 목공", "인·일/㎡"],
  extra_laborer_pd_per_m2: ["분별 추가 보통인부", "인·일/㎡"],
  selective_crew: ["분별 추가 작업조", "명"],
  crew_mean: ["평균 일일 투입", "명"],
  excavator_m3_per_day: ["굴착기 실제 처리량 (대당)", "㎥/일"],
  indirect_per_day: ["일당 간접비", "원/일"],
};

export function benchmark(rows, field) {
  const values = rows.map((row) => row[field]).filter(Number.isFinite);
  return values.length ? { count: values.length, median: median(values), min: Math.min(...values), max: Math.max(...values) } : null;
}
