// 공공데이터포털 프록시 (Cloudflare Workers). 인증키는 Worker 비밀 변수 DATA_GO_KR_KEY에만 둔다.
// 호출: https://<worker>.workers.dev/1613000/BldRgstHubService/getBrTitleInfo?sigunguCd=...
const ALLOWED = new Set(["1613000/BldRgstHubService/getBrTitleInfo"]);
const ORIGIN_OK = (o) => o === "https://mungim5556-ui.github.io" || /^http:\/\/localhost:\d+$/.test(o);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const cors = ORIGIN_OK(origin) ? { "Access-Control-Allow-Origin": origin } : {};
    if (!ALLOWED.has(url.pathname.slice(1))) return new Response("Not found", { status: 404, headers: cors });
    url.searchParams.set("serviceKey", env.DATA_GO_KR_KEY);
    const r = await fetch(`https://apis.data.go.kr${url.pathname}?${url.searchParams}`);
    return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json" } });
  },
};
