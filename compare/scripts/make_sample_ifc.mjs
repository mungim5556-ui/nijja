// 예시 IFC(5층 벽식 공동주택 1동, 30×16m, 연면적 2,400㎡)를 만든다 — 논문 사례와 같은 규모.
// 실행: node scripts/make_sample_ifc.mjs  →  assets/data/sample.ifc
// 창호·문 자리의 벽 개구부는 뚫지 않았다(벽 부피가 조금 크게 잡힌다). 시연·시험용 모델이다.
import { writeFileSync } from "node:fs";

const L = [];
const add = (s) => { L.push(`#${L.length + 1}=${s};`); return `#${L.length}`; };
const r = (x) => { const s = String(+x.toFixed(5)); return s.includes(".") ? s : s + "."; };
const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
let g = 0;
const guid = () => { let n = ++g, s = ""; for (let i = 0; i < 21; i++) { s = B64[n % 64] + s; n = Math.floor(n / 64); } return `'0${s}'`; };

const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
const dirZ = add("IFCDIRECTION((0.,0.,1.))");
const wcs = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${wcs},$)`);
const units = add(`IFCUNITASSIGNMENT((${add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)")},${add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)")},${add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)")}))`);
const project = add(`IFCPROJECT(${guid()},$,'ReClaim Sample Apartment',$,$,$,$,(${ctx}),${units})`);
const place0 = add(`IFCLOCALPLACEMENT($,${wcs})`);
const site = add(`IFCSITE(${guid()},$,'Site',$,$,${place0},$,$,.ELEMENT.,$,$,$,$,$)`);
const building = add(`IFCBUILDING(${guid()},$,'Building',$,$,${place0},$,$,.ELEMENT.,$,$,$)`);
add(`IFCRELAGGREGATES(${guid()},$,$,$,${project},(${site}))`);
add(`IFCRELAGGREGATES(${guid()},$,$,$,${site},(${building}))`);

const profile2d = add(`IFCAXIS2PLACEMENT2D(${add("IFCCARTESIANPOINT((0.,0.))")},$)`);
// 상자: 중심 (cx, cy), 바닥 높이 z, 크기 dx×dy×dz
function shape(cx, cy, z, dx, dy, dz) {
  const placement = add(`IFCLOCALPLACEMENT($,${add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((${r(cx)},${r(cy)},${r(z)}))`)},$,$)`)})`);
  const solid = add(`IFCEXTRUDEDAREASOLID(${add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${profile2d},${r(dx)},${r(dy)})`)},${wcs},${dirZ},${r(dz)})`);
  const rep = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${add(`IFCSHAPEREPRESENTATION(${ctx},'Body','SweptSolid',(${solid}))`)}))`);
  return `${placement},${rep}`;
}

const mats = new Map(), byMat = new Map();
const material = (name) => mats.get(name) || mats.set(name, add(`IFCMATERIAL('${name}')`)).get(name);
// 층 구성: [[재료, 두께], ...] 또는 재료 이름 하나
function assoc(el, spec) {
  const key = JSON.stringify(spec);
  if (!byMat.has(key)) {
    const ref = typeof spec === "string" ? material(spec)
      : add(`IFCMATERIALLAYERSETUSAGE(${add(`IFCMATERIALLAYERSET((${spec.map(([m, t]) => add(`IFCMATERIALLAYER(${material(m)},${r(t)},$)`)).join(",")}),'${spec.map(([m]) => m).join("/")}')`)},.AXIS2.,.POSITIVE.,0.)`);
    byMat.set(key, { ref, els: [] });
  }
  byMat.get(key).els.push(el);
}

let tag = 300000;
const perStorey = [];
function element(type, name, box, spec, extra = "") {
  const el = add(`${type}(${guid()},$,'${name}',$,$,${shape(...box)},'${++tag}'${extra})`);
  assoc(el, spec);
  perStorey.at(-1).els.push(el);
  return el;
}

const FLOORS = 5, H = 2.8, SLAB = 0.21, W = 30, D = 16;
const EXT = [["Concrete", 0.2], ["EPS Insulation", 0.04], ["Gypsum Board", 0.01]];
const PARTITION = [["Gypsum Board", 0.0125], ["Wood Stud", 0.045], ["Gypsum Board", 0.0125]];

for (let f = 0; f < FLOORS; f++) {
  const z = f * H, zw = z + SLAB, hw = H - SLAB;
  const storey = add(`IFCBUILDINGSTOREY(${guid()},$,'${f + 1}F',$,$,${place0},$,$,.ELEMENT.,${r(z)})`);
  perStorey.push({ storey, els: [] });
  if (f === 0) element("IFCSLAB", "Mat Foundation", [0, 0, -0.6, W, D, 0.6], "Concrete", ",.BASESLAB.");
  element("IFCSLAB", "Floor Slab", [0, 0, z, W, D, SLAB], "Concrete", ",.FLOOR.");
  if (f === FLOORS - 1) element("IFCSLAB", "Roof Slab", [0, 0, z + H, W, D, SLAB], "Concrete", ",.ROOF.");

  for (const y of [-D / 2 + 0.125, D / 2 - 0.125]) element("IFCWALLSTANDARDCASE", "Exterior Wall", [0, y, zw, W, 0.25, hw], EXT);
  for (const x of [-W / 2 + 0.125, W / 2 - 0.125]) element("IFCWALLSTANDARDCASE", "Exterior Wall", [x, 0, zw, 0.25, D - 0.5, hw], EXT);
  for (const x of [-10, -5, 0, 5, 10]) element("IFCWALLSTANDARDCASE", "Bearing Wall", [x, 0, zw, 0.2, D - 0.5, hw], "Concrete");
  for (let i = 0; i < 6; i++) {
    const x = -12.5 + i * 5;
    element("IFCWALLSTANDARDCASE", "Partition", [x, 2.5, zw, 4.6, 0.07, hw], PARTITION);
    element("IFCWALLSTANDARDCASE", "Partition", [x, -2.5, zw, 4.6, 0.07, hw], PARTITION);
    for (const y of [-D / 2 + 0.125, D / 2 - 0.125]) element("IFCWINDOW", "Window 1800x1500", [x, y, zw + 0.9, 1.8, 0.3, 1.5], "Aluminum", ",1.5,1.8");
    element("IFCDOOR", "Door 900x2100", [x - 1.5, 2.5, zw, 0.9, 0.05, 2.1], "Wood", ",2.1,0.9");
    element("IFCDOOR", "Door 900x2100", [x + 1.5, -2.5, zw, 0.9, 0.05, 2.1], "Wood", ",2.1,0.9");
    element("IFCCOVERING", "PVC Flooring", [x, 4, zw, 4.6, 7, 0.003], "PVC Flooring", ",.FLOORING.");
    element("IFCCOVERING", "Oak Flooring", [x, -4, zw, 4.6, 7, 0.008], "Oak Flooring", ",.FLOORING.");
    element("IFCCOVERING", "Ceiling", [x, 0, z + H - 0.2, 4.6, D - 0.6, 0.0095], "Gypsum Board", ",.CEILING.");
    element("IFCCOVERING", "Bathroom Tile", [x + 2, 0, zw, 0.008, 3, hw], "Ceramic Tile", ",.CLADDING.");
  }
  element("IFCFLOWSEGMENT", "Water Pipe", [0, 0.5, z + H - 0.1, W - 1, 0.012, 0.012], "Copper Pipe");
  element("IFCFLOWSEGMENT", "Drain Pipe", [0, -0.5, z + H - 0.1, W - 1, 0.03, 0.03], "PVC Pipe");
}

add(`IFCRELAGGREGATES(${guid()},$,$,$,${building},(${perStorey.map((s) => s.storey).join(",")}))`);
for (const s of perStorey) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,(${s.els.join(",")}),${s.storey})`);
for (const { ref, els } of byMat.values()) add(`IFCRELASSOCIATESMATERIAL(${guid()},$,$,$,(${els.join(",")}),${ref})`);

const out = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('sample.ifc','2026-11-14T00:00:00',(''),(''),'reclaim-compare','reclaim-compare','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
${L.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
writeFileSync(new URL("../assets/data/sample.ifc", import.meta.url), out);
console.log(`sample.ifc: ${L.length} entities, ${tag - 300000} elements`);
