// reclaim-compare 저장소(공법 비교 원본)를 compare/ 폴더로 그대로 옮기고, compare.html을 원본 index.html에서 다시 만든다.
// nijja 전용 부분(상단 탭·로그인·다크 모드·테마)만 덧입힌다. 원본 계산 코드는 고치지 않는다.
// 사용: node scripts/sync_compare.mjs <reclaim-compare 체크아웃 폴더> [--commit <sha>] [--date <ISO>]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEST = join(ROOT, "compare");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const commit = opt("--commit"), date = opt("--date");
const [src] = args;
if (!src || !existsSync(join(src, "index.html"))) { console.error("사용: node scripts/sync_compare.mjs <reclaim-compare 폴더>"); process.exit(2); }

// 원본에서 옮길 것 (index.html은 compare.html로 따로 만든다)
const COPY = ["assets", "test", "scripts", "revit", "package.json", "README.md"];
// nijja에만 있는 파일: 지우지 않는다
const KEEP = new Set(["assets/css/reclaim-theme.css", "UPSTREAM.json"]);

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const want = new Set();
for (const top of COPY) {
  const s = join(src, top);
  if (!existsSync(s)) continue;
  for (const f of statSync(s).isDirectory() ? walk(s) : [s]) {
    const rel = relative(src, f).split("\\").join("/");
    want.add(rel);
    const d = join(DEST, rel);
    mkdirSync(dirname(d), { recursive: true });
    copyFileSync(f, d);
  }
}
let removed = 0;
for (const f of existsSync(DEST) ? walk(DEST) : []) {
  const rel = relative(DEST, f).split("\\").join("/");
  if (!want.has(rel) && !KEEP.has(rel)) { rmSync(f); removed++; }
}

// compare.html = 원본 index.html + nijja 머리말·상단 탭
let html = readFileSync(join(src, "index.html"), "utf8");
const must = (re, what) => { if (!re.test(html)) throw new Error(`원본 index.html에서 ${what}을(를) 찾지 못했습니다. scripts/sync_compare.mjs를 고쳐야 합니다.`); };
must(/<meta charset="utf-8">/i, "<meta charset>");
must(/<\/head>/i, "</head>");
must(/<body[^>]*>/i, "<body>");
must(/<\/body>/i, "</body>");
html = html.replace(/<meta charset="utf-8">/i, (m) => `${m}
  <!-- 자동 생성: scripts/sync_compare.mjs가 reclaim-compare의 index.html로 만든다. 직접 고치지 마세요. -->
  <!-- 공법 비교 원본은 compare/ 폴더에 있다. base로 상대 경로(CSS·JS·데이터)를 그 폴더 기준으로 맞춘다. -->
  <base href="compare/">`);
html = html.replace(/<title>[^<]*<\/title>/i, "<title>ReClaim 공법 비교</title>");
html = html.replace(/<\/head>/i, `  <link rel="stylesheet" href="../assets/css/site-nav.css">
  <link rel="stylesheet" href="assets/css/reclaim-theme.css">
  <script src="../assets/js/auth.js"></script>
  <script>
    // 로그인하지 않았으면 로그인 페이지로 (base 때문에 auth.require 대신 직접 경로를 쓴다)
    if (!window.auth?.get()) location.replace(new URL("../login.html?next=compare.html", document.baseURI).href);
    try { const t = localStorage.getItem("reclaim.theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
  </script>
</head>`);
html = html.replace(/<body[^>]*>/i, (m) => `${m}
<nav class="site-nav" aria-label="ReClaim 화면">
  <a class="site-logo" href="../index.html">ReClaim</a>
  <a href="../app.html">해체 계획</a>
  <a href="../bim.html">BIM 편집기</a>
  <a href="../compare.html" aria-current="page">공법 비교</a>
  <span class="site-spacer"></span>
  <button class="site-theme" id="site-theme" type="button" aria-label="다크 모드 전환" title="다크 모드 전환"><svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg></button>
</nav>`);
// 원본의 제목 줄을 nijja 로고 형태로 (모양이 바뀌었으면 원본 그대로 둔다)
html = html.replace(/<div class="brand">[\s\S]*?<\/div>/i, `<div class="brand">
    <span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg></span>
    <div class="titles"><strong>공법 비교</strong><span>BIM·해체계획서 기반 분별해체 vs 일괄 압쇄 경제성 비교</span></div>
  </div>`);
html = html.replace(/<\/body>/i, `<script>
  document.getElementById("site-theme").addEventListener("click", () => {
    const el = document.documentElement;
    const dark = el.dataset.theme === "dark" || (!el.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    el.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("reclaim.theme", el.dataset.theme); } catch {}
  });
</script>
</body>`);
writeFileSync(join(ROOT, "compare.html"), html);

const info = { repo: "mungim5556-ui/reclaim-compare", commit: commit || null, date: date || null, syncedBy: "scripts/sync_compare.mjs" };
writeFileSync(join(DEST, "UPSTREAM.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`compare/ 동기화: 파일 ${want.size}개 복사, ${removed}개 삭제, compare.html 다시 만듦${commit ? ` (원본 ${commit.slice(0, 7)})` : ""}`);
