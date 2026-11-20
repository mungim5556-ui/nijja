// 같은 IFC → 같은 결과인지 확인한다 (재료 지정·용도·앞서 연 모델에 따라 결과가 바뀌지 않게).
// 준비: npm install --no-save web-ifc@0.0.78   사용: node scripts/test_ifc_repeat.mjs [IFC 파일]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { extractModel, applyMapping, unknownMaterials, classifyMaterial, elementMaterials } from "../assets/js/bim/ifc-import.js";
import { compare, grossFloorArea } from "../assets/js/bim/scenario.js";

let failed = 0;
const check = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

// 1) 재료 키워드 경계 (웹 IFC 없이도 확인)
const cases = { Birch: null, Steps: null, "Steel posts": "steel", Larch: null, "철근콘크리트": "rc", "Steel reinforced concrete": "rc",
  "RC 200": "rc", "EPS 100": "eps", STS304: "stainless", "OSB 12": "plywood", "Concrete, Cast-in-Place": "rc" };
const wrong = Object.entries(cases).filter(([n, k]) => classifyMaterial(n) !== k).map(([n, k]) => `${n}→${classifyMaterial(n)} (기대 ${k})`);
check(!wrong.length, `재료 키워드 경계 ${wrong.join(", ")}`);

// 2) 미분류 층 채움 규칙: 한 층을 지정해도 부재 총 톤이 줄지 않고, 부피는 모두 계산에 들어간다
const wall = { category: "wall", volume: 10, area: 40, layers: [{ name: "Unknown A", t: 0.2 }, { name: "Unknown B", t: 0.05 }] };
const t0 = elementMaterials(wall), t1 = elementMaterials(wall, { "Unknown B": "gypsum" });
const sum = (m) => Object.values(m).reduce((s, v) => s + v, 0);
check(t0.unknownVolume === 0 && Math.abs(t0.estimated.volume - 10) < 1e-9, `미분류 벽: 부피 전부 기본재료(rc)로 추정 (${t0.estimated.volume}㎥)`);
check(t1.mats.gypsum > 0 && Math.abs(t1.estimated.volume - 8) < 1e-9 && t1.unknownVolume === 0, "한 층 지정 후: 지정 층은 석고, 나머지만 추정");
check(sum(t1.mats) > 0 && sum(t0.mats) > 0, `총 톤 ${sum(t0.mats).toFixed(2)} → ${sum(t1.mats).toFixed(2)} (지정해도 부피가 빠지지 않음)`);

// 3) 실제 IFC: 두 번 읽기, 다른 모델을 먼저 읽기, 재료 지정 후 연면적
const file = process.argv[2] || fileURLToPath(new URL("../compare/assets/data/sample.ifc", import.meta.url));
let W;
try { W = createRequire(join(process.cwd(), "package.json"))("web-ifc"); }
catch { console.log("skip IFC 단계: web-ifc 없음 (npm install --no-save web-ifc@0.0.78)"); process.exit(failed ? 1 : 0); }
const api = new W.IfcAPI();
await api.Init(undefined, true);
const buf = readFileSync(file);
const read = (opts) => { const id = api.OpenModel(new Uint8Array(buf)); try { return extractModel(api, W, id, { name: "t", use: "주거 공동주택", keepMeshes: false, ...opts }); } finally { api.CloseModel(id); } };
const key = (m) => { const c = compare(m, m.params); const tons = m.elements.reduce((s, e) => s + sum(e.mats), 0);
  return JSON.stringify({ g: Math.round(c.general.total), s: Math.round(c.selective.total), tons: tons.toFixed(3), gfa: grossFloorArea(m), d: [c.general.days.toFixed(2), c.selective.days.toFixed(2)] }); };
const a = read({}), b = read({});
check(key(a.model) === key(b.model), `같은 파일 두 번: ${key(a.model)}`);
read({ use: "비주거 철골", mapping: { anything: "steel" } }); // 다른 조건으로 한 번 읽어 모듈 상태를 흔든다
const c = read({});
check(key(c.model) === key(a.model), "다른 조건으로 읽은 뒤에도 같음");
const names = Object.keys(unknownMaterials(a.model));
const mapped = applyMapping(a.model, names.length ? { [names[0]]: "gypsum" } : {});
check(grossFloorArea(mapped) === grossFloorArea(a.model), `재료 지정과 무관한 연면적 ${grossFloorArea(a.model)}㎡ (미분류 이름 ${names.length}개)`);
const reread = read({ mapping: mapped.materialMap });
check(key(reread.model) === key(mapped), "지정 후 다시 계산 = 지정을 넣고 파일을 다시 읽은 결과");
process.exit(failed ? 1 : 0);
