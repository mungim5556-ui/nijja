// catalog.js(단가 원본) → revit/ReClaim.extension/lib/rates.json
// 사용: node scripts/export_rates.mjs        (파일을 씀)
//       node scripts/export_rates.mjs --check (최신인지 확인만, 다르면 종료 코드 1)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as C from "../assets/js/bim/catalog.js";

const out = fileURLToPath(new URL("../revit/ReClaim.extension/lib/rates.json", import.meta.url));
const data = {
  _comment: "자동 생성 파일. 직접 고치지 말고 assets/js/bim/catalog.js를 고친 뒤 node scripts/export_rates.mjs를 실행하세요.",
  materials: Object.fromEntries(Object.entries(C.MATERIALS).map(([k, v]) => [k, { label: v.label, density: v.density, waste: v.waste }])),
  waste: Object.fromEntries(Object.entries(C.WASTE).map(([k, v]) => [k, { label: v.label, color: v.color }])),
  workItems: C.WORK_ITEMS,
  workRules: C.WORK_RULES,
  materialKeywords: C.MATERIAL_KEYWORDS,
  presets: C.PRESETS,
  defaultPreset: C.DEFAULT_PARAMS.key,
  separableMin: C.SEPARABLE_MIN,
  wasteUnit: C.WASTE_UNIT,
  metalPriceKey: C.METAL_PRICE_KEY,
  inertMats: C.INERT_MATS,
  crushMats: C.CRUSH_MATS,
};
const text = JSON.stringify(data, null, 2) + "\n";
if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(out, "utf8"); } catch {}
  if (cur !== text) { console.log("FAIL rates.json이 catalog.js와 다릅니다. node scripts/export_rates.mjs 를 실행하세요."); process.exitCode = 1; }
  else console.log("ok   rates.json 최신");
} else {
  writeFileSync(out, text);
  console.log("wrote", out);
}
