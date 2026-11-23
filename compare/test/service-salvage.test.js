import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compare, paramValues } from "../assets/js/scenario.js";
import { elementResults, quantitiesFromElements } from "../assets/js/classify.js";
import { identifyIfcServices, ifcServiceInventory, serviceSalvage } from "../assets/js/service-salvage.js";

const p = paramValues(JSON.parse(readFileSync(new URL("../assets/data/rates.json", import.meta.url), "utf8")));
const job = { area_m2: 1000, floors: 1, t: {}, fixedComparison: true, serviceProfile: "home", serviceInventory: ifcServiceInventory([]) };
const near = (number, expected) => assert.ok(Math.abs(number - expected) < 1e-8, `${number} vs ${expected}`);

test("연면적에 용도별 설치 원단위를 곱하고 공법별 추정 매각을 적용한다", () => {
  const home = serviceSalvage(job, p);
  assert.equal(home.cable.source, "area");
  assert.equal(home.cable.kg, 350);
  assert.equal(home.copperPipe.kg, 100);
  near(home.cable.methods.crush.soldKg, 175);
  near(home.cable.methods.selective.soldKg, 262.5);
  near(home.copperPipe.methods.crush.soldKg, 64);
  near(home.copperPipe.methods.selective.soldKg, 79);
  const nonres = serviceSalvage({ ...job, serviceProfile: "nonres" }, p);
  assert.equal(nonres.cable.kg, 600);
  assert.equal(nonres.copperPipe.kg, 250);
  const costs = compare(job, p);
  near(costs.selective.revenue - costs.crush.revenue, 543_000);
  assert.equal(serviceSalvage({ ...job, serviceProfile: undefined }, p).copperPipe.kg, null);
});

test("IFC 수량은 면적 추정에 우선하며 부분 수량, 현장 입력과 0을 구분한다", () => {
  const serviceInventory = ifcServiceInventory([
    { kind: "cable", tons: 0.020 }, { kind: "cable", tons: null }, { kind: "copperPipe", tons: 0 },
  ]);
  const result = serviceSalvage({ ...job, serviceInventory, cableCrush: 0 }, p);
  assert.equal(result.cable.source, "ifc");
  assert.equal(result.cable.kg, 20);
  assert.equal(result.cable.model.unknownCount, 1);
  assert.equal(result.cable.methods.crush.soldKg, 0);
  assert.equal(result.cable.methods.crush.confirmed, true);
  near(result.cable.methods.selective.soldKg, 15);
  assert.equal(result.copperPipe.kg, 0);
  const entered = serviceSalvage({ ...job, serviceInventory, cableInstalled: 0.030 }, p);
  assert.equal(entered.cable.source, "input");
  assert.equal(entered.cable.kg, 30);
});

test("IFC 설비 형상과 수량을 한 번만 세고 부재별 매각·처리 합계를 보존한다", () => {
  const entries = [
    { expressID: 1, replaces: [1, 2], name: "전력 케이블", category: "pipe", kind: "cable", tons: 0.100 },
    { expressID: 3, name: "동관", category: "pipe", kind: "copperPipe", tons: 0.200 },
  ];
  const existing = [1, 2, 3].map(expressID => ({ expressID, category: "pipe", area: 0, layers: [],
    stream: "copper", tons: 1, parts: [{ cls: "copper", stream: "copper", tons: 1, m3: 0 }] }));
  const classified = identifyIfcServices(existing, entries);
  assert.deepEqual(classified.map(item => item.expressID), [1, 3]);
  const quantities = quantitiesFromElements(classified.filter(el => el.serviceKind !== "cable"), 1000);
  const q = { ...job, ...quantities, serviceInventory: ifcServiceInventory(entries), copperModeledTons: quantities.t.copper };
  assert.equal(q.t.copper, 0.2);
  const comparison = compare(q, p);
  for (const mode of ["crush", "selective"]) {
    const result = comparison[mode];
    const rows = elementResults(classified, p, result.mixed.fee, q, mode, result);
    near(rows.reduce((sum, row) => sum + row.revenue, 0), result.revenue);
    near(rows.reduce((sum, row) => sum + row.disposal, 0), result.disposal);
    if (mode === "selective") assert.equal(rows[0].method, "분별 해체");
  }

  const corrected = { ...q, cableInstalled: 0.040, pipeInstalled: 0.080 };
  const crush = compare(corrected, p).crush;
  near(crush.cableResidue, 0.020);
  near(crush.unsoldMetal, 0.0288);
  const rows = elementResults(classified, p, crush.mixed.fee, corrected, "crush", crush);
  near(rows.reduce((sum, row) => sum + row.disposal, 0), crush.disposal);

  const over = compare({ ...corrected, cableCrush: 0.050 }, p).crush;
  assert.equal(over.services.cable.methods.crush.soldKg, 50);
  assert.equal(over.cableResidue, 0);
  assert.ok(over.issues.some(issue => issue.includes("설치량을 초과")));
});
