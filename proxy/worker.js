// 공공데이터포털 프록시 + 사진 손상 판독 (Cloudflare Workers).
// 인증키는 Worker 비밀 변수 DATA_GO_KR_KEY, ANTHROPIC_API_KEY에만 둔다.
// 호출: https://<worker>.workers.dev/1613000/BldRgstHubService/getBrTitleInfo?sigunguCd=...
//       POST https://<worker>.workers.dev/vision  { image: base64 JPEG, member, type, spec }
// 브이월드는 해외 IP를 막아 여기서 부를 수 없고, 사이트가 브라우저에서 직접 부른다.
const ALLOWED = new Set([
  "1613000/BldRgstHubService/getBrTitleInfo",
  "1230000/ao/PriceInfoService/getPriceInfoListFcltyCmmnMtrilBildng",
]);
const ORIGIN_OK = (o) => o === "https://mungim5556-ui.github.io" || /^http:\/\/localhost:\d+$/.test(o);

// 앱의 CONDITIONS·DAMAGE 키(assets/js/engine.js)와 같은 값만 돌려받는다
const VISION_SCHEMA = {
  type: "object",
  properties: {
    condition: { type: "string", enum: ["good", "fair", "poor"] },
    damage: { type: "array", items: { type: "string", enum: ["crack", "spalling", "discolor", "corrosion", "deform"] } },
    matches_member: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["condition", "damage", "matches_member", "note"],
  additionalProperties: false,
};

const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ponytail: Origin 검사만으로 키 남용을 막는다. 공개 운영 전에 Cloudflare 레이트리밋 규칙을 건다
async function vision(req, env, cors) {
  const { image, member, type, spec } = await req.json().catch(() => ({}));
  if (typeof image !== "string" || !image) return json({ error: "image required" }, 400, cors);
  if (image.length > 2_000_000) return json({ error: "image too large" }, 413, cors); // base64 약 1.5MB
  const kind = type === "steel" ? "구조용 강재" : "콘크리트";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      fallbacks: "default",
      output_config: { format: { type: "json_schema", schema: VISION_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text:
`해체 예정 건물의 현장 사진입니다. 이 사진은 ${kind} ${member || "부재"}${spec ? ` (규격: ${spec})` : ""}를 찍은 것으로 입력되었습니다.
재사용 가능성 1차 스크리닝을 위해 사진에서 보이는 외관만 판단하세요.
- condition: good(눈에 띄는 손상 없음), fair(경미한 표면 손상), poor(구조 성능이 의심되는 손상)
- damage: 보이는 손상만 고르세요. crack 균열, spalling 박리·박락, discolor 변색·백화, corrosion 부식(철근 노출 포함), deform 변형. 없으면 빈 배열.
- matches_member: 사진이 입력된 부재 종류와 재질로 보이면 true, 다른 부재나 재질로 보이면 false.
- note: 판단 근거를 한국어 한두 문장으로. 사진이 흐리거나 멀어서 판단이 어려우면 그렇게 적으세요.` },
        ],
      }],
    }),
  });
  const data = await r.json();
  if (!r.ok) return json({ error: data.error?.message || "api error" }, 502, cors);
  if (data.stop_reason === "refusal") return json({ error: "refused" }, 422, cors);
  const text = data.content.find((b) => b.type === "text")?.text;
  return new Response(text, { headers: { ...cors, "Content-Type": "application/json" } });
}

/* ---------- 해체 분석 결과 저장소 (Revit ReClaim 탭 → Worker KV → 사이트) ----------
   KV 바인딩 RESULTS, 비밀 변수 RESULTS_TOKEN이 있어야 동작한다. 실제 건물 자료라 쓰기·읽기 모두 토큰이 필요하다.
   POST   /results        본문: .reclaim.json (Revit '해체 분석' 요약)  → 201 { id, name, at, ... }
   GET    /results        목록 (최신순, 최대 200건)
   GET    /results/<id>   요약 JSON 그대로
   DELETE /results/<id>   삭제 */
const RESULT_MAX = 4_000_000; // KV 값 한도(25MB)보다 훨씬 작게. 논현동 575부재 ≈ 160KB
const RESULT_INDEX_MAX = 200;

function resultId(name, at) {
  const base = String(name || "model").normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "model";
  return `${base}-${at.replace(/[-:TZ.]/g, "").slice(0, 14)}`;
}

async function results(req, env, url, cors) {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" } });
  if (!env.RESULTS || !env.RESULTS_TOKEN) return json({ error: "results storage is not configured (KV RESULTS, secret RESULTS_TOKEN)" }, 503, cors);
  if ((req.headers.get("Authorization") || "") !== `Bearer ${env.RESULTS_TOKEN}`) return json({ error: "unauthorized" }, 401, cors);
  const id = decodeURIComponent(url.pathname.replace(/^\/results\/?/, ""));
  const index = async () => (await env.RESULTS.get("index", "json")) || [];

  if (req.method === "GET" && !id) return json(await index(), 200, cors);
  if (req.method === "GET") {
    const v = await env.RESULTS.get("r:" + id);
    return v ? new Response(v, { headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } }) : json({ error: "not found" }, 404, cors);
  }
  if (req.method === "POST" && !id) {
    const text = await req.text();
    if (text.length > RESULT_MAX) return json({ error: "too large" }, 413, cors);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "invalid JSON" }, 400, cors); }
    if (!data || !Array.isArray(data.elements) || !Array.isArray(data.levels)) return json({ error: "not a ReClaim result (levels, elements required)" }, 400, cors);
    const at = new Date().toISOString();
    const rid = resultId(data.name, at);
    const entry = {
      id: rid, name: String(data.name || ""), at, use: data.use || "", gfa: Number(data.gfa) || 0, elements: data.elements.length,
      general: data.revit?.general_total ?? null, selective: data.revit?.selective_total ?? null, source: data.source || "revit",
    };
    await env.RESULTS.put("r:" + rid, text);
    const list = (await index()).filter((e) => e.id !== rid);
    list.unshift(entry);
    await env.RESULTS.put("index", JSON.stringify(list.slice(0, RESULT_INDEX_MAX)));
    return json(entry, 201, cors);
  }
  if (req.method === "DELETE" && id) {
    await env.RESULTS.delete("r:" + id);
    await env.RESULTS.put("index", JSON.stringify((await index()).filter((e) => e.id !== id)));
    return json({ deleted: id }, 200, cors);
  }
  return json({ error: "method not allowed" }, 405, cors);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const cors = ORIGIN_OK(origin) ? { "Access-Control-Allow-Origin": origin } : {};
    // Revit(브라우저 아님)에서 오는 요청은 Origin이 없다. 토큰으로만 확인한다.
    if (url.pathname === "/results" || url.pathname.startsWith("/results/")) return results(req, env, url, cors);
    if (url.pathname === "/vision") {
      if (!ORIGIN_OK(origin)) return new Response("Forbidden", { status: 403 });
      if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
      return vision(req, env, cors);
    }
    if (!ALLOWED.has(url.pathname.slice(1))) return new Response("Not found", { status: 404, headers: cors });
    url.searchParams.set("serviceKey", env.DATA_GO_KR_KEY);
    const r = await fetch(`https://apis.data.go.kr${url.pathname}?${url.searchParams}`);
    return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json" } });
  },
};
