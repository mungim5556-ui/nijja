// 물량 추출 검증용 IFC4 (mm 단위). 부재마다 정답 부피·톤수를 알고 있어서, 사이트에서 읽은 값과 오차를 잴 수 있다.
// 실행: node scripts/make_test_ifc.mjs  →  test/fixtures/robust.ifc, test/fixtures/robust.expected.json
// 다루는 경우: IFC4 StandardCase 부재, 한글 재료 이름, 재료 없는 강재(수량표 중량), Qto NetVolume 우선,
//              모델 철근, Revit 파트(IfcBuildingElementPart), 커튼월 부모·패널 중복, 재료 있는/없는 기타 객체
import { writeFileSync, mkdirSync } from "node:fs";

const L = [];
const add = (s) => { L.push(`#${L.length + 1}=${s};`); return `#${L.length}`; };
const r = (x) => { const s = String(+x.toFixed(5)); return s.includes(".") ? s : s + "."; };
const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
let g = 0;
const guid = () => { let n = ++g, s = ""; for (let i = 0; i < 21; i++) { s = B64[n % 64] + s; n = Math.floor(n / 64); } return `'1${s}'`; };

const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
const dirZ = add("IFCDIRECTION((0.,0.,1.))");
const wcs = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${wcs},$)`);
const units = add(`IFCUNITASSIGNMENT((${[
  add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)"),
  add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
  add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
  add("IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.)"),
].join(",")}))`);
const project = add(`IFCPROJECT(${guid()},$,'ReClaim robustness test',$,$,$,$,(${ctx}),${units})`);
const place0 = add(`IFCLOCALPLACEMENT($,${wcs})`);
const site = add(`IFCSITE(${guid()},$,'Site',$,$,${place0},$,$,.ELEMENT.,$,$,$,$,$)`);
const building = add(`IFCBUILDING(${guid()},$,'Building',$,$,${place0},$,$,.ELEMENT.,$,$,$)`);
add(`IFCRELAGGREGATES(${guid()},$,$,$,${project},(${site}))`);
add(`IFCRELAGGREGATES(${guid()},$,$,$,${site},(${building}))`);
const storey = add(`IFCBUILDINGSTOREY(${guid()},$,'1F',$,$,${place0},$,$,.ELEMENT.,0.)`);
add(`IFCRELAGGREGATES(${guid()},$,$,$,${building},(${storey}))`);

const profile2d = add(`IFCAXIS2PLACEMENT2D(${add("IFCCARTESIANPOINT((0.,0.))")},$)`);
// 상자 (mm): 중심 (cx, cy), 바닥 z, 크기 dx×dy×dz
function shape(cx, cy, z, dx, dy, dz) {
  const placement = add(`IFCLOCALPLACEMENT($,${add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((${r(cx)},${r(cy)},${r(z)}))`)},$,$)`)})`);
  const solid = add(`IFCEXTRUDEDAREASOLID(${add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${profile2d},${r(dx)},${r(dy)})`)},${wcs},${dirZ},${r(dz)})`);
  const rep = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${add(`IFCSHAPEREPRESENTATION(${ctx},'Body','SweptSolid',(${solid}))`)}))`);
  return `${placement},${rep}`;
}
const m3 = (dx, dy, dz) => dx * dy * dz / 1e9;
// IFC(STEP) 문자열: 한글 등 비ASCII는 Revit처럼 \X2\(UTF-16 16진수)\X0\로 쓴다
const enc = (text) => text.replace(/[^\x20-\x7e]+/g, (run) => `\\X2\\${[...run].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("")}\\X0\\`).replace(/'/g, "''");

const mats = new Map(), contained = [], expected = [];
const material = (name) => mats.get(name) || mats.set(name, add(`IFCMATERIAL('${enc(name)}',$,$)`)).get(name);
const assoc = (el, name) => add(`IFCRELASSOCIATESMATERIAL(${guid()},$,$,$,(${el}),${material(name)})`);
const qto = (el, entries) => {
  const qs = entries.map(([kind, name, value]) => kind === "volume"
    ? add(`IFCQUANTITYVOLUME('${name}',$,$,${r(value)},$)`) : add(`IFCQUANTITYWEIGHT('${name}',$,$,${r(value)},$)`));
  add(`IFCRELDEFINESBYPROPERTIES(${guid()},$,$,$,(${el}),${add(`IFCELEMENTQUANTITY(${guid()},$,'BaseQuantities',$,$,(${qs.join(",")}))`)})`);
};
let tag = 500000;
// 부재: type(IFC4 9개 속성) · 재료 · 상자 · 기대값 {stream, m3, tons}
function element(type, name, box, mat, expect, { extra = ",$", contain = true } = {}) {
  const el = add(`${type}(${guid()},$,'${enc(name)}',$,$,${shape(...box)},'${++tag}'${extra})`);
  if (mat) assoc(el, mat);
  if (contain) contained.push(el);
  if (expect) expected.push({ tag: String(tag), name, ...expect });
  return el;
}
const box = (cx, cy, z, dx, dy, dz) => [cx, cy, z, dx, dy, dz];

// 1. IFC4 StandardCase 기둥 4개, 한글 재료 이름 (0.5 × 0.5 × 3 m = 0.75 ㎥)
for (const [x, y] of [[0, 0], [6000, 0], [0, 6000], [6000, 6000]]) {
  element("IFCCOLUMNSTANDARDCASE", "기둥", box(x, y, 0, 500, 500, 3000), "콘크리트, 현장 타설 - 24MPa", { stream: "concrete", m3: 0.75, tons: 0.75 * 2.4 });
}
// 2. 강재 보: 한글 "금속 - 강철" (0.2 × 0.4 × 6 m = 0.48 ㎥ → 3.768 t)
element("IFCBEAMSTANDARDCASE", "강재 보", box(3000, 0, 3000, 6000, 200, 400), "금속 - 강철 - ASTM A36", { stream: "metal", m3: 0.48, tons: 0.48 * 7.85 });
// 3. 재료 없는 강재 보 + 수량표 중량 3,700 kg (부피 0.48 ㎥ → 밀도 7.7)
const bare = element("IFCBEAM", "재료 없는 보", box(3000, 6000, 3000, 6000, 200, 400), null, { stream: "metal", m3: 0.48, tons: 3.7 });
qto(bare, [["weight", "NetWeight", 3700]]);
// 4. 슬래브: 형상 6.4 × 6.4 × 0.2 = 8.192 ㎥, Qto NetVolume 7.5 ㎥(개구부 제외 가정) → Qto 사용
const slab = element("IFCSLABSTANDARDCASE", "슬래브", box(3000, 3000, 3400, 6400, 6400, 200), "철근콘크리트", { stream: "concrete", m3: 7.5, tons: 7.5 * 2.4 });
qto(slab, [["volume", "GrossVolume", m3(6400, 6400, 200)], ["volume", "NetVolume", 7.5]]);
// 5. 모델 철근 10개: 0.025 × 0.025 × 6 m = 0.00375 ㎥ × 10 = 0.0375 ㎥ → 0.294 t
for (let i = 0; i < 10; i++) {
  element("IFCREINFORCINGBAR", "철근 D25", box(3000, 600 * i, 3450, 6000, 25, 25), "철근", { stream: "metal", m3: 0.00375, tons: 0.00375 * 7.85 },
    { extra: ",$,$,$,$,.MAIN.,$" });
}
// 6. Revit 파트: 형상 없는 벽을 벽돌 파트 2개로 (각 3 × 0.1 × 3 m = 0.9 ㎥)
const wall = add(`IFCWALL(${guid()},$,'${enc("파트로 나눈 벽")}',$,$,${place0},$,'${++tag}',$)`);
contained.push(wall);
const parts = [0, 1].map((i) => element("IFCBUILDINGELEMENTPART", "벽 파트", box(1500 + 3000 * i, -1000, 0, 3000, 100, 3000), "벽돌, 일반",
  { stream: "masonry", m3: 0.9, tons: 0.9 * 1.9 }, { contain: false }));
add(`IFCRELAGGREGATES(${guid()},$,$,$,${wall},(${parts.join(",")}))`);
// 7. 커튼월: 부모도 형상이 있고(0.6 ㎥ 상자) 유리 패널 2개도 있다 → 부모는 빼고 패널만 (각 1.5 × 0.02 × 3 m = 0.09 ㎥)
const cw = element("IFCCURTAINWALL", "커튼월", box(3000, 7000, 0, 3000, 200, 1000), null, null);
const panels = [0, 1].map((i) => element("IFCPLATE", "System Panel: Glazed", box(2250 + 1500 * i, 7000, 0, 1500, 20, 3000), null,
  { stream: "glass", m3: 0.09, tons: 0.09 * 2.5 }, { contain: false }));
add(`IFCRELAGGREGATES(${guid()},$,$,$,${cw},(${panels.join(",")}))`);
// 8. 기타 객체: 콘크리트 재료가 있으면 넣고(1 ㎥), 재료가 없으면(가구 등) 뺀다
element("IFCBUILDINGELEMENTPROXY", "프록시 기초보", box(-2000, 0, 0, 1000, 1000, 1000), "Concrete", { stream: "concrete", m3: 1, tons: 2.4 });
element("IFCBUILDINGELEMENTPROXY", "가구", box(-2000, 3000, 0, 1000, 1000, 1000), null, { stream: "excluded", m3: 1, tons: 0 });

add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,(${contained.join(",")}),${storey})`);

const out = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME('robust.ifc','2026-11-21T00:00:00',(''),(''),'reclaim-compare','reclaim-compare','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${L.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
const dir = new URL("../test/fixtures/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("robust.ifc", dir), out);
writeFileSync(new URL("robust.expected.json", dir), JSON.stringify(expected, null, 1) + "\n");
const total = (s) => expected.filter((e) => e.stream === s).reduce((a, e) => a + e.tons, 0);
console.log(`robust.ifc: ${L.length} entities, ${expected.length} checked elements`,
  Object.fromEntries(["concrete", "metal", "masonry", "glass"].map((s) => [s, +total(s).toFixed(4)])));
