// JS 엔진(cost.js)과 Revit용 Python 엔진(reclaim_engine.py)이 같은 결과를 내는지 확인한다.
// 사용: node scripts/test_engines.mjs   (python3 필요)
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compare, toItems, grossFloorArea } from "../assets/js/bim/scenario.js";
import { demoModel } from "../assets/js/bim/demo-model.js";

const fixture = fileURLToPath(new URL("./fixtures/takeoff.json", import.meta.url));
const engine = fileURLToPath(new URL("../revit/ReClaim.extension/lib/reclaim_engine.py", import.meta.url));
let failed = 0;
const check = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

// rates.json 최신 여부
try { execFileSync("node", [fileURLToPath(new URL("./export_rates.mjs", import.meta.url)), "--check"], { stdio: "inherit" }); }
catch { failed++; }

// 예시 모델의 물량으로 fixture를 만든다 (석면 부재 하나를 섞어 유해물질 경로도 확인)
const m = demoModel();
const items = toItems(m);
items[5] = { ...items[5], hazard: "suspected" };
const ctx = { gfa: grossFloorArea(m), use: m.use };
const cases = [{ name: "팀 2024", params: {} }, { name: "논문 2023", params: { preset: "paper2023" } }, { name: "표 4 보정 + 간접비", params: { table4: "aligned", indirectPerDay: 800000, recovery: 0.7 } }];

const { compareItems } = await import("../assets/js/bim/cost.js");
for (const c of cases) {
  writeFileSync(fixture, JSON.stringify({ items, ctx, params: c.params }));
  const js = compareItems(items, ctx, c.params);
  const py = JSON.parse(execFileSync("python3", [engine, "--fixture", fixture], { encoding: "utf8" }));
  for (const s of ["general", "selective"]) {
    for (const k of ["laborCost", "equipCost", "haulCost", "disposalCost", "revenueTotal", "days", "total"]) {
      const a = js[s][k], b = py[s][k];
      const ok = Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.001);
      if (!ok) check(false, `${c.name} ${s}.${k}: JS ${a} / Python ${b}`);
    }
  }
  check(true, `${c.name}: JS·Python 일치 (일괄 ${Math.round(js.general.total / 1e6)} / 분별 ${Math.round(js.selective.total / 1e6)} 백만원)`);
}
writeFileSync(fixture, JSON.stringify({ items, ctx, params: {} }, null, 1));
execFileSync("python3", [engine], { stdio: "inherit" });
process.exitCode = failed ? 1 : 0;
