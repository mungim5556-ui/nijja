// 폴더 안의 IFC 파일을 모두 읽어 모델별 물량과 일괄 압쇄 vs 전면 분별해체 결과를 CSV 한 장으로 낸다.
// 준비: npm install --no-save web-ifc@0.0.78
// 사용: node scripts/batch_ifc.mjs <IFC 폴더> [결과.csv] [--use "주거 공동주택"] [--preset team2024|paper2023]
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
import { extractModel } from "../assets/js/bim/ifc-import.js";
import { compare, grossFloorArea } from "../assets/js/bim/scenario.js";
import { MATERIALS } from "../assets/js/bim/catalog.js";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const use = opt("--use", "주거 공동주택");
const preset = opt("--preset", "team2024");
const [dir, out = "reclaim_batch.csv"] = args;
if (!dir || !existsSync(dir)) { console.error("사용: node scripts/batch_ifc.mjs <IFC 폴더> [결과.csv]"); process.exit(2); }

let W;
try { W = createRequire(join(process.cwd(), "package.json"))("web-ifc"); }
catch { console.error("web-ifc가 없습니다. 먼저 실행하세요: npm install --no-save web-ifc@0.0.78"); process.exit(2); }
const api = new W.IfcAPI();
await api.Init();

const wastes = ["concrete", "metal", "wood", "resin", "glass", "board", "tile", "wallpaper"];
const head = ["file", "elements", "unknown_materials", "gfa_m2", ...wastes.map((w) => `${w}_t`), "t_per_m2",
  "general_total_won", "selective_total_won", "delta_won", "general_days", "selective_days", "cheaper"];
const rows = [head.join(",")];
for (const f of readdirSync(dir).filter((n) => /\.ifc$/i.test(n)).sort()) {
  const id = api.OpenModel(new Uint8Array(readFileSync(join(dir, f))));
  try {
    const { model, stats } = extractModel(api, W, id, { name: basename(f), use, keepMeshes: false });
    const c = compare(model, { preset });
    const gfa = grossFloorArea(model);
    const tons = Object.fromEntries(wastes.map((w) => [w, 0]));
    for (const e of model.elements) for (const [m, t] of Object.entries(e.mats)) { const w = MATERIALS[m].waste; if (w in tons) tons[w] += t; }
    const total = Object.values(tons).reduce((s, v) => s + v, 0);
    const d = c.selective.total - c.general.total;
    rows.push([JSON.stringify(f), stats.elements, stats.unknownMaterials, Math.round(gfa), ...wastes.map((w) => tons[w].toFixed(2)),
      gfa ? (total / gfa).toFixed(4) : "", Math.round(c.general.total), Math.round(c.selective.total), Math.round(d),
      c.general.days.toFixed(1), c.selective.days.toFixed(1), d < 0 ? "selective" : "general"].join(","));
    console.log(`${f}: 부재 ${stats.elements}, 연면적 ${Math.round(gfa)}㎡, 일괄 ${Math.round(c.general.total / 1e6)} / 분별 ${Math.round(c.selective.total / 1e6)} 백만원`);
  } catch (e) {
    rows.push([JSON.stringify(f), "", "", "", ...wastes.map(() => ""), "", "", "", "", "", "", JSON.stringify("error: " + e.message)].join(","));
    console.log(`${f}: 오류 ${e.message}`);
  } finally { api.CloseModel(id); }
}
writeFileSync(out, "﻿" + rows.join("\n") + "\n");
console.log(`결과: ${out}`);
