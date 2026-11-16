// 계획서 데이터(JSON) 형식을 보여주는 가상의 예시 건물. 실제 건물이 아니다.
// 실행: node scripts/make_example_plan.mjs → assets/data/plans/example.json
// 좌표는 mm, 원점은 도면 왼쪽 위, y는 아래로 증가. 보·벽은 축에 나란한 선분.
import { writeFileSync } from "node:fs";

const X = [0, 6000, 12000, 18000], Y = [0, 7000, 14000];
const columns = X.flatMap((x) => Y.map((y) => ({ s: "C1", x, y })));
const L = (s, x1, y1, x2, y2) => ({ s, x1, y1, x2, y2 });
const beams = [
  ...Y.map((y) => L("G1", 0, y, 18000, y)), ...X.map((x) => L("G2", x, 0, x, 14000)),
  L("B1", 3000, 0, 3000, 14000), L("B1", 9000, 0, 9000, 14000), L("B1", 15000, 0, 15000, 14000),
];
// 계단실(12000~18000 × 0~3000)은 슬래브가 뚫려 있다
const slabs = [L("S1", 0, 0, 12000, 14000), L("S1", 12000, 3000, 18000, 14000)];
const core = [L("W1", 12000, 0, 12000, 3000), L("W1", 12000, 3000, 18000, 3000)];

const plan = {
  schema: "reclaim-plan/1",
  source: { document: "가상 예시 (실제 건물 아님)", note: "형식 설명용 가상 데이터" },
  building: {
    name: "예시 근린생활시설", usage: "근린생활시설", structure: "철근콘크리트구조", built: 1990,
    floors_above: 3, floors_below: 0, height_m: 11.1,
    area_m2: 756, building_area_m2: 252, demolition_area_m2: 756, wasteUnit: "비주거 RC",
  },
  demolition: { fromLevel: "1F", scope: "전체 해체", method: "압쇄기(구조체) + 인력(내·외장재)" },
  materials: { concrete_fck_MPa: 21, rebar_fy_MPa: 400, floor_finish: { material: "Mortar", thickness: 30 } },
  rebar_kg_per_m3: { value: 100, note: "가정" },
  hazards: { asbestos: false, other: false },
  check: { waste_concrete_t: 800, note: "가상 값" },
  sections: {
    C1: { type: "column", b: 500, h: 500 }, W1: { type: "wall", t: 200 },
    G1: { type: "beam", b: 400, h: 600 }, G2: { type: "beam", b: 400, h: 600 }, B1: { type: "beam", b: 300, h: 500 },
    S1: { type: "slab", t: 150 },
  },
  // 층: 그 층 바닥의 슬래브·보 + 그 층에 서 있는 기둥·벽(위층 바닥까지)
  levels: [
    { name: "1F", elevation: 0, layout: "ground" }, { name: "2F", elevation: 3600, layout: "typical" },
    { name: "3F", elevation: 7200, layout: "typical" }, { name: "RF", elevation: 10800, layout: "roof" },
  ],
  layouts: {
    ground: { columns, walls: core, beams: [], slabs: [L("S1", 0, 0, 18000, 14000)] },
    typical: { columns, walls: core, beams, slabs },
    roof: { columns: [], walls: [], beams, slabs: [L("S1", 0, 0, 18000, 14000)] },
  },
};
writeFileSync(new URL("../assets/data/plans/example.json", import.meta.url), JSON.stringify(plan, null, 1));
console.log("wrote example plan");
