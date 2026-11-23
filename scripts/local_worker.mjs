// 결과 서버(proxy/worker.js)를 PC에서 띄운다 (Cloudflare 없이 시험용). KV는 메모리, 결과는 폴더에도 저장한다.
// 사용: node scripts/local_worker.mjs [--port 8787] [--token local-test] [--out 폴더]
// Revit 일괄 실행을 이쪽으로 보내려면 설정 파일의 upload.url을 http://localhost:8787/results 로, token을 같은 값으로 둔다.
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../proxy/worker.js";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt("--port", 8787));
const token = opt("--token", "local-test");
const out = opt("--out", null);
if (out) mkdirSync(out, { recursive: true });

const kv = new Map();
const env = { RESULTS_TOKEN: token, RESULTS: {
  async get(k, type) { const v = kv.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
  async put(k, v) { kv.set(k, String(v)); if (out && k.startsWith("r:")) writeFileSync(join(out, k.slice(2).replace(/[\\/:*?"<>|]/g, "_") + ".json"), String(v)); },
  async delete(k) { kv.delete(k); } } };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const t = performance.now();
  const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env);
  const text = await r.text();
  const ms = (performance.now() - t).toFixed(1);
  let note = "";
  if (req.method === "POST") {
    try { const j = JSON.parse(text); note = j.result ? ` 압쇄 ${(j.result.crush?.total / 1e6).toFixed(1)} / 분별 ${(j.result.selective?.total / 1e6).toFixed(1)}백만원` : ` ${j.error || j.resultError || ""}`; } catch {}
  }
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} → ${r.status} (${ms} ms, 본문 ${body ? body.length : 0}B)${note}`);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(text);
}).listen(port, () => console.log(`로컬 결과 서버: http://localhost:${port}/results (토큰 ${token})`));
