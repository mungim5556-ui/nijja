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

test("계획서의 현장·장비 조건: 명시한 값이 우선하고, 없으면 해체공법 문구로 탑재를 추정한다", async () => {
  const { planConditions } = await import("../assets/js/plan.js");
  const { SITES, EQUIPMENT } = await import("../assets/js/scenario.js");
  const opts = { sites: SITES, equipments: EQUIPMENT };
  assert.deepEqual(planConditions({ demolition: { site: "restricted", equipment: "small", crane_days: 3, ground_floors: 1 } }, opts).values,
    { site: "restricted", equipment: "small", craneDays: 3, groundFloors: 1 });
  const smallMounted = planConditions({ demolition: { method: "압쇄기(소형장비 탑재, 크레인 양중) + 인력" } }, opts);
  assert.deepEqual(smallMounted.values, { equipment: "mounted" });
  assert.equal(smallMounted.needsMountedProduction, false);
  const mounted = planConditions({ demolition: { method: "32톤 굴착기 탑재" } }, opts);
  assert.deepEqual(mounted.values, { equipment: "mounted", mountedLarge: true });
  assert.equal(mounted.needsMountedProduction, true);
  assert.deepEqual(planConditions({ demolition: { method: "부재 절단 후 크레인 인양" } }, opts).values, {});
  assert.deepEqual(planConditions(example, opts).values, { structure: "rc", scope: "full" }); // 조건이 없으면 기존 기본값(보통·자동)을 쓴다
  assert.deepEqual(planConditions({ demolition: { site: "wide", method: "장비 탑재" } }, opts).values, { equipment: "mounted", site: "wide" });
});

test("계획서가 명시한 경계 슬래브 귀속만 적용한다", async () => {
  const { planConditions } = await import("../assets/js/plan.js");
  assert.equal(planConditions({ demolition: { basement_cap_owner: "above" } }).values.basementCapOwner, "above");
  assert.equal(planConditions({ demolition: { basement_cap_owner: "invalid" } }).values.basementCapOwner, undefined);
  assert.equal(planConditions(load("kalis/06-office-below.json")).values.basementCapOwner, "below");
});

test("공개 계획서 7건: IFC 부재 수와 재료별 부피가 예시 목록과 일치한다", () => {
  const { items } = load("kalis/index.json");
  assert.equal(items.length, 7);
  for (const row of items) {
    const plan = load(row.file.replace(/^plans\//, ""));
    const members = planMembers(plan), v = planVolumes(members), ifc = planToIfc(plan);
    assert.equal(members.length, row.model.members, row.label);
    assert.equal((ifc.match(/=IFC(COLUMN|BEAM|SLAB|WALLSTANDARDCASE|COVERING)\(/g) || []).length, members.length);
    assert.ok(members.every(b => [b.dx, b.dy, b.dz].every(n => Number.isFinite(n) && n > 0)), row.label);
    near(v.structure, row.model.concrete_m3, 0.051);
    near(v.steel, row.model.steel_m3, 0.051);
    near(v.masonry, row.model.masonry_m3, 0.051);
    if (row.inputs.scope === "above") assert.ok(members.every(b => !/^B\d/.test(b.level)), row.label);
    if (plan.building.floors_above === 0) assert.ok(members.every(b => b.z + b.dz <= 1e-8), row.label);
  }
});
