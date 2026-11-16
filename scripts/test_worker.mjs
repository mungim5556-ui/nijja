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

process.exitCode = failed ? 1 : 0;
