// Worker 결과 저장소 검증 (Cloudflare 없이 가짜 KV로): node scripts/test_worker.mjs
import worker from "../proxy/worker.js";

let failed = 0;
const check = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const kv = new Map();
const KV = {
  async get(k, type) { const v = kv.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
  async put(k, v) { kv.set(k, String(v)); },
  async delete(k) { kv.delete(k); },
};
const env = { RESULTS: KV, RESULTS_TOKEN: "test-token" };
const BASE = "https://nijja-api.example.workers.dev";
const call = (path, init = {}, e = env) => worker.fetch(new Request(BASE + path, init), e);
const auth = { Authorization: "Bearer test-token" };

// Revit 해체 분석 요약과 같은 모양 (revit/ReClaim.extension/lib/reclaim_io.py summary_json)
const summary = {
  version: 1, name: "논현동 124-1 건축모델 3D_ReClaim시험", use: "비주거 RC", gfa: 1500.44,
  levels: [{ id: "1층", name: "1층", elevation: 0, height: 3 }],
  elements: [{ id: "12345", source: "ifc", name: "NH 벽 200", category: "wall", area: 30, mats: { rc: 14.7 }, work: [], separable: 2, hazard: "none", levelId: "1층" }],
  params: {}, revit: { general_total: 122366908.25, selective_total: 194419386.23 },
};

check((await call("/results", { headers: auth }, {})).status === 503, "KV·토큰이 없으면 503");
check((await call("/results")).status === 401, "토큰 없이 읽기 → 401");
check((await call("/results", { method: "POST", body: JSON.stringify(summary), headers: { Authorization: "Bearer wrong" } })).status === 401, "틀린 토큰으로 쓰기 → 401");
check((await call("/results", { method: "POST", body: "{}", headers: auth })).status === 400, "ReClaim 결과가 아니면 400");

const r = await call("/results", { method: "POST", body: JSON.stringify(summary), headers: { ...auth, "Content-Type": "application/json" } });
const entry = await r.json();
check(r.status === 201 && entry.id.startsWith("논현동-124-1-건축모델-3D-ReClaim시험-"), `올리기 → 201, id ${entry.id}`);
check(entry.general === summary.revit.general_total && entry.elements === 1, "목록 항목에 합계·부재 수");

const list = await (await call("/results", { headers: auth })).json();
check(list.length === 1 && list[0].id === entry.id, "목록 조회");
const got = await call("/results/" + encodeURIComponent(entry.id), { headers: auth });
check(got.status === 200 && (await got.json()).name === summary.name, "한 건 조회 (한글 id)");

const pre = await call("/results", { method: "OPTIONS", headers: { Origin: "https://mungim5556-ui.github.io", "Access-Control-Request-Headers": "authorization" } });
check(pre.headers.get("Access-Control-Allow-Origin") === "https://mungim5556-ui.github.io" && /Authorization/.test(pre.headers.get("Access-Control-Allow-Headers")), "사이트에서 읽기 사전 요청(CORS) 허용");
const other = await call("/results", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
check(!other.headers.get("Access-Control-Allow-Origin"), "다른 사이트에는 CORS 허용 안 함");

check((await call("/results/" + encodeURIComponent(entry.id), { method: "DELETE", headers: auth })).status === 200, "삭제");
check((await (await call("/results", { headers: auth })).json()).length === 0, "삭제 후 목록 비어 있음");
check((await call("/1613000/unknown")).status === 404, "기존 공공데이터 프록시 경로 규칙 유지");

// ---- 물량 묶음 → Worker가 공법 비교 엔진으로 계산 ----
const { computeQuantities, QUANTITIES_SCHEMA } = await import("../compare/assets/js/pipeline.js");
const { paramValues } = await import("../compare/assets/js/scenario.js");
const { readFileSync } = await import("node:fs");
const rates = JSON.parse(readFileSync(new URL("../compare/assets/data/rates.json", import.meta.url)));
const layer = (name, thickness = 0.2) => ({ name, category: "", thickness });
const elements = [];
for (const floor of [1, 2]) {
  elements.push({ globalId: `S${floor}`, tag: `${100 + floor}`, name: "Slab", category: "slab", floor, volume: 20, area: 100, layers: [layer("Concrete")] });
  for (let i = 0; i < 4; i++) elements.push({ globalId: `W${floor}${i}`, tag: `${200 + floor * 10 + i}`, name: "Wall", category: "wall", floor, volume: 6, area: 30, layers: [layer("Concrete"), layer("Gypsum Board", 0.0125)] });
}
const bundle = { schema: QUANTITIES_SCHEMA, name: "시험 RC 2층", source: "revit",
  model: { name: "시험 RC 2층", elements, gross: { area: 200, basis: "slab" }, floors: 2, aboveFloors: 2, usage: "비주거 RC" }, inputs: { usage: "비주거 RC" } };
const direct = computeQuantities(bundle, { rates, defaults: paramValues(rates) });
const qr = await call("/results", { method: "POST", body: JSON.stringify(bundle), headers: { ...auth, "Content-Type": "application/json" } });
const qe = await qr.json();
check(qr.status === 201 && qe.schema === QUANTITIES_SCHEMA, `물량 묶음 올리기 → 201 (${qe.id})`);
check(qe.result && qe.general === direct.cmp.crush.total && qe.selective === direct.cmp.selective.total, `Worker 계산 = 엔진 직접 호출 (압쇄 ${Math.round(qe.general)} / 분별 ${Math.round(qe.selective)}원)`);
check(Array.isArray(qe.days) && qe.days[0] === direct.cmp.crush.days, "목록 항목에 공기");
check(qe.result.elementRows.some((row) => row.tag === "101" && row.method), "부재별 결과(ElementId·처리 방식)가 있음");
check(qe.engine && qe.result.engine.repo === "mungim5556-ui/reclaim-compare", `계산 엔진 기록 (${String(qe.engine).slice(0, 7)})`);
{ // 미분류 재료·부피 0 부재
  const odd = { ...bundle, name: "미분류", model: { ...bundle.model, elements: [...elements,
    { globalId: "X", tag: "900", name: "Odd", category: "wall", floor: 1, volume: 3, area: 10, layers: [layer("Mystery 123", 0.1), layer("Concrete", 0.1)] },
    { globalId: "Z", tag: "901", name: "Beam", category: "beam", floor: 1, volume: 0, area: 0, layers: [layer("Concrete", 0)] }] } };
  const oe = await (await call("/results", { method: "POST", body: JSON.stringify(odd), headers: auth })).json();
  check(oe.result.unknownMaterials["Mystery 123"] === 1.5 && !("Concrete" in oe.result.unknownMaterials), "미분류 재료 이름·부피 기록");
  check(oe.result.emptyElements.length === 1 && oe.result.emptyElements[0].tag === "901", "부피 0 부재 기록");
  const rec = { ...bundle, name: "결합 복원", model: { ...bundle.model, elements: [...elements,
    { globalId: "Y", tag: "902", name: "Beam", category: "beam", floor: 1, volume: 0.4, area: 0, joinedCut: true, joinResidual: { original: 1.035, residual: 0.4, joined: 6 }, layers: [layer("Concrete", 0.4)] }] } };
  const re = await (await call("/results", { method: "POST", body: JSON.stringify(rec), headers: auth })).json();
  check(re.result.joinRecovered.length === 1 && re.result.joinRecovered[0].residual === 0.4 && re.general > qe.general, "결합 잔여 부피 되살린 부재 기록·물량 반영");
}
// 엔진이 바뀐 것처럼 만들면 GET할 때 다시 계산한다
const key = "r:" + qe.id;
const stored = JSON.parse(kv.get(key));
stored.result.engine.commit = "old-engine"; stored.result.crush.total = 1;
kv.set(key, JSON.stringify(stored));
const again = await (await call("/results/" + encodeURIComponent(qe.id), { headers: auth })).json();
check(again.result.crush.total === direct.cmp.crush.total && again.result.engine.commit !== "old-engine", "엔진이 바뀌면 GET할 때 다시 계산해 갱신");
// 계산할 수 없는 물량(면적 미확인)도 물량은 저장되고 이유가 남는다
const bbox = { ...bundle, name: "외곽 치수", model: { ...bundle.model, gross: { area: 250, basis: "bbox" } } };
const be = await (await call("/results", { method: "POST", body: JSON.stringify(bbox), headers: auth })).json();
check(be.general === null && /외곽 치수/.test(be.error || ""), "면적이 확인되지 않으면 계산 대신 이유를 남김");
check((await call("/results", { method: "POST", body: JSON.stringify({ schema: QUANTITIES_SCHEMA, model: {} }), headers: auth })).status === 400, "model.elements 없으면 400");

process.exitCode = failed ? 1 : 0;
