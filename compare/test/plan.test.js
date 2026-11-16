import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { planMembers, planVolumes, planToIfc } from "../assets/js/plan.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../assets/data/plans/${f}`, import.meta.url)));
const example = load("example.json");
// 실제 계획서 데이터는 저장소에 올리지 않으므로, 파일이 있을 때만 검사한다
const real = new URL("../assets/data/plans/private-1.json", import.meta.url);
const plan = existsSync(real) ? load("private-1.json") : null;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test("작은 계획서: 기둥·벽·보·슬래브·마감 상자가 치수대로 나온다", () => {
  const p = {
    sections: { C: { b: 500, h: 400 }, W: { t: 200 }, G: { b: 300, h: 600 }, S: { t: 120 } },
    materials: { floor_finish: { material: "Mortar", thickness: 30 } },
    levels: [{ name: "1F", elevation: 0, layout: "a" }, { name: "RF", elevation: 3000, layout: "b" }],
    layouts: {
      a: { columns: [{ s: "C", x: 1000, y: 2000 }], walls: [{ s: "W", x1: 0, y1: 0, x2: 0, y2: 5000 }], beams: [{ s: "G", x1: 0, y1: 0, x2: 4000, y2: 0 }], slabs: [{ s: "S", x1: 0, y1: 0, x2: 4000, y2: 5000 }] },
      b: { columns: [], walls: [], beams: [], slabs: [{ s: "S", x1: 0, y1: 0, x2: 4000, y2: 5000 }] },
    },
  };
  const mb = planMembers(p), v = planVolumes(mb);
  near(v.column, 0.5 * 0.4 * 3);
  near(v.wall, 0.2 * 5 * 3);
  near(v.beam, 0.3 * (0.6 - 0.12) * 4); // 슬래브 두께만큼 뺀다
  near(v.slab, 2 * 4 * 5 * 0.12);
  near(v.finish, 4 * 5 * 0.03); // 맨 위층 슬래브에는 마감을 넣지 않는다
  const col = mb.find((b) => b.kind === "column");
  assert.deepEqual([col.cx, col.cy, col.z, col.dz], [1, -2, 0, 3]);
  const beam = mb.find((b) => b.kind === "beam");
  near(beam.z + beam.dz, -0.12); // 보 윗면 = 슬래브 아랫면
});

test("실제 계획서: 지상층만 뽑으면 지하층 기둥·벽이 빠진다", { skip: !plan }, () => {
  const above = planMembers(plan), all = planMembers(plan, { demolitionOnly: false });
  assert.ok(!above.some((b) => b.level === "B1") && all.some((b) => b.level === "B1"));
  assert.equal(above.filter((b) => b.kind === "column").length, 18 * 4);
  assert.equal(all.filter((b) => b.kind === "column").length, 18 * 5);
  for (const b of all) assert.ok(b.dx > 0 && b.dy > 0 && b.dz > 0, JSON.stringify(b));
});

test("실제 계획서: 구조체 톤수가 계획서 폐콘크리트량의 75~110%", { skip: !plan }, () => {
  const v = planVolumes(planMembers(plan));
  const ratio = ((v.structure + v.finish) * 2.4) / plan.check.waste_concrete_t;
  assert.ok(ratio > 0.75 && ratio < 1.1, `ratio ${ratio}`);
});

test("IFC 텍스트: 부재 수가 맞고 한글이 들어가지 않는다", () => {
  const text = planToIfc(example), n = planMembers(example).length;
  assert.equal(planMembers(example).filter((x) => x.kind === "column").length, 12 * 3);
  assert.equal((text.match(/=IFC(COLUMN|BEAM|SLAB|WALLSTANDARDCASE|COVERING)\(/g) || []).length, n);
  assert.ok(text.startsWith("ISO-10303-21;") && text.trimEnd().endsWith("END-ISO-10303-21;"));
  assert.ok(/^[\x00-\x7F]*$/.test(text));
  assert.ok(text.includes("IFCMATERIAL('Concrete 21MPa')") && text.includes("IFCMATERIAL('Mortar')"));
});
