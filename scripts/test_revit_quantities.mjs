// Revit 물량 경로 검증 (Revit 없이): 가짜 Revit 원자료 → Python(reclaim_quantities.py) 묶음 → Worker 계산 → Python RC_* 값
// 사용: node scripts/test_revit_quantities.mjs   (python3 필요)
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../proxy/worker.js";

let failed = 0;
const check = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const lib = fileURLToPath(new URL("../revit/ReClaim.extension/lib/", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "reclaim-q-"));

// Revit에서 읽은 것과 같은 모양: 재료 이름·분류와 재료별 부피, 레벨 이름
const levels = [{ name: "B1", elevation: -3.5 }, { name: "1F", elevation: 0 }, { name: "2F", elevation: 3.3 }, { name: "3F", elevation: 6.6 }];
const raw = [];
let tag = 1000;
for (const level of ["1F", "2F", "3F"]) {
  raw.push({ globalId: `g${tag}`, tag: tag++, name: "바닥 200", category: "floor", level, volume: 30, area: 150, layers: [{ name: "콘크리트 - 현장 타설", category: "콘크리트", thickness: 30 }] });
  for (let i = 0; i < 6; i++) raw.push({ globalId: `g${tag}`, tag: tag++, name: "RC 벽 200 + 석고", category: "wall", level, volume: 4.2, area: 20, top: 9.9,
    layers: [{ name: "콘크리트 - 현장 타설", category: "콘크리트", thickness: 4 }, { name: "석고보드", category: "석고", thickness: 0.2 }] });
  raw.push({ globalId: `g${tag}`, tag: tag++, name: "기둥", category: "column", level, volume: 1.5, area: 0, layers: [{ name: "Concrete", category: "Concrete", thickness: 1.5 }] });
  raw.push({ globalId: `g${tag}`, tag: tag++, name: "창 1500x1200", category: "window", level, volume: 0.05, area: 1.8, layers: [{ name: "Glass", category: "Glass", thickness: 0 }, { name: "Aluminum", category: "Metal", thickness: 0 }] });
}
raw.push({ globalId: "gB", tag: tag++, name: "지하 외벽", category: "wall", level: "B1", volume: 12, area: 40, layers: [] });
raw.push({ globalId: "gF", tag: tag++, name: "기초", category: "foundation", level: "B1", volume: 40, area: 0, layers: [] });
const fixture = join(tmp, "raw.json");
writeFileSync(fixture, JSON.stringify({ raw, levels, name: "Revit 시험 3층", usage: "비주거 RC" }));

const bundle = JSON.parse(execFileSync("python3", [join(lib, "reclaim_quantities.py"), "--fixture", fixture], { encoding: "utf8" }));
check(bundle.schema === "reclaim-quantities/1" && bundle.model.usage === "비주거 RC", "Python 묶음: 형식·용도");
check(bundle.model.gross.basis === "slab" && bundle.model.gross.area === 450, `연면적 = 바닥 슬래브 합 ${bundle.model.gross.area}㎡`);
check(bundle.model.aboveFloors === 3 && bundle.model.basementFloors === 1, `지상 ${bundle.model.aboveFloors}층 · 지하 ${bundle.model.basementFloors}층`);

const kv = new Map();
const env = { RESULTS_TOKEN: "t", RESULTS: {
  async get(k, type) { const v = kv.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
  async put(k, v) { kv.set(k, String(v)); }, async delete(k) { kv.delete(k); } } };
const res = await worker.fetch(new Request("https://x/results", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify(bundle) }), env);
const entry = await res.json();
const r = entry.result;
check(res.status === 201 && r?.crush && r?.selective, `Worker 계산 (압쇄 ${Math.round(r?.crush?.total / 1e6)} / 분별 ${Math.round(r?.selective?.total / 1e6)}백만원, 공기 ${r?.crush?.days?.toFixed(1)} / ${r?.selective?.days?.toFixed(1)}일)`);
check(r?.tons?.concrete > 0 && r?.concreteM3 > 0, `성상별 톤: 폐콘크리트 ${r?.tons?.concrete?.toFixed(1)}t, 콘크리트 ${r?.concreteM3?.toFixed(1)}㎥`);
check(r?.inputs?.area === 450 && r?.inputs?.usage === "비주거 RC", "서버가 쓴 입력: 연면적·용도");

const resultFile = join(tmp, "result.json");
writeFileSync(resultFile, JSON.stringify(r));
const rows = JSON.parse(execFileSync("python3", ["-c", `
import json,sys
sys.path.insert(0, ${JSON.stringify(lib)})
import reclaim_quantities as Q
print(json.dumps(Q.param_rows(json.load(open(${JSON.stringify(resultFile)})))))`], { encoding: "utf8" }));
const wall = rows["1001"];
check(wall && wall.waste && wall.tons > 0 && ["selective", "general"].includes(wall.method), `RC_* 값: 벽 ${wall?.waste} ${wall?.tons?.toFixed(2)}t ${wall?.method}`);
check(Object.keys(rows).length >= raw.length - 2, `ElementId별 결과 ${Object.keys(rows).length}개 (부재 ${raw.length}개)`);

rmSync(tmp, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
