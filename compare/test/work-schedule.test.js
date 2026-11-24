import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ifcScopeElements } from "../assets/js/ifc.js";
import { reportHtml, steelScheduleBasis } from "../assets/js/report.js";
import { compare, paramValues, workScheduleIssues } from "../assets/js/scenario.js";

const p = paramValues(JSON.parse(readFileSync(new URL("../assets/data/rates.json", import.meta.url))));
const q = {
  area_m2: 965.04, floors: 4, site: "tight", equipment: "mounted", labor: "quantity",
  concrete_m3: 500, t: { concrete: 1200 }, finishAreas: { board: 1500, tile: 0 },
  finishBaseline: { board: 0.6, tile: 1 }, windowMode: "both", windowArea: 0,
};

test("철골 기간의 공법별 공정표 출처와 포함 확인 상태를 보고서에도 공유한다", () => {
  const steel = { ...q, steelWork: true };
  const defaultTiming = steelScheduleBasis(compare(steel, p));
  assert.equal(defaultTiming.duration_by_mode.crush.duration_excluded, true);
  assert.equal(defaultTiming.duration_by_mode.selective.duration_excluded, true);

  const withCrush = { ...steel, workSchedule: { crush: { totalDays: 22 } } };
  const referenced = steelScheduleBasis(compare(withCrush, p));
  assert.equal(referenced.duration_by_mode.crush.source, "input");
  assert.equal(referenced.duration_by_mode.selective.source, "crush-reference");
  assert.equal(referenced.duration_by_mode.selective.duration_excluded, null);

  const partlyEntered = { ...steel, workSchedule: { crush: { structureDays: 11 } } };
  const structureTiming = steelScheduleBasis(compare(partlyEntered, p));
  assert.match(structureTiming.duration_by_mode.crush.label, /입력 구조체 작업일 적용/);
  assert.equal(structureTiming.duration_by_mode.crush.duration_excluded, null);

  const entered = { ...withCrush, workSchedule: { ...withCrush.workSchedule, selective: { totalDays: 25 } } };
  const result = compare(entered, p);
  assert.equal(result.crush.days, 22);
  assert.equal(result.selective.days, 25);
  const both = steelScheduleBasis(result);
  assert.equal(both.duration_excluded, null);
  assert.equal(both.duration_by_mode.selective.source, "input");
  const html = reportHtml({ summary: { steel_dismantling: both }, elements: [] });
  assert.ok(html.includes(both.duration_label));
  assert.doesNotMatch(html, /철골 공기 미반영/);
});

test("계획서 전체·구조체 일수는 작업일에 적용하며 굴착기 가동시간과 따로 처리한다", () => {
  const defaults = compare(q, p);
  const input = { ...q, workSchedule: { crush: { totalDays: 15, structureDays: 11 } } };
  const result = compare(input, p);
  assert.equal(result.crush.days, 15);
  assert.equal(result.crush.schedule.structure, 11);
  assert.equal(result.crush.schedule.sources.structure, "input");
  assert.equal(result.crush.schedule.modelTotal, defaults.crush.days);
  assert.equal(result.crush.excavatorHours, defaults.crush.excavatorHours);
  assert.equal(result.crush.indirect, 15 * p.indirect_per_day);
  assert.equal(result.selective.schedule.sources.total, "crush-reference");
  assert.ok(Math.abs(result.deltaDays - defaults.deltaDays) < 1e-6);
  assert.deepEqual(workScheduleIssues(input), []);
});

test("공법별 작업일·실제 가동시간·구조체 장비 패키지와 별도 공종을 독립 적용한다", () => {
  const input = { ...q, scope: "below", basementFloors: 4, workSchedule: {
    crush: { totalDays: 12, structureDays: 10, excavatorHours: 32, equipmentQuote: 0, extraWorksCost: 500000 },
    selective: { totalDays: 16, structureDays: 11, setupDays: 0, excavatorHours: 48, equipmentQuote: 1000000, extraWorksCost: 0 },
  } };
  const result = compare(input, p);
  assert.equal(result.deltaDays, 4);
  assert.equal(result.selective.schedule.setup, 0);
  assert.ok(Math.abs(result.crush.excavatorHours - 32) < 1e-6);
  assert.ok(Math.abs(result.selective.equipmentCrewDays - 48 / p.hours_per_day) < 1e-6);
  assert.equal(result.crush.equipment, 500000);
  assert.ok(result.selective.equipment > 1000000);
  assert.ok(!result.selective.rows.some(row => row.item.startsWith("이동식 크레인")));
  assert.deepEqual(workScheduleIssues(input), []);
});

test("일정 합계에서 공종 병행을 허용하고 개별 입력이 전체 작업일을 넘으면 확인한다", () => {
  const input = { ...q, workSchedule: { crush: { totalDays: 11, setupDays: 4, interiorDays: 5, structureDays: 8 } } };
  const result = compare(input, p);
  assert.deepEqual(workScheduleIssues(input), []);
  assert.equal(result.crush.days, 11);
  assert.ok(result.crush.schedule.phaseDifference > 0);
  assert.match(workScheduleIssues({ ...input, workSchedule: { crush: { totalDays: 5, structureDays: 8 } } })[0], /초과/);
});

test("지상·지하 범위는 경계 슬래브를 한쪽에만 집계한다", () => {
  const floor = { category: "slab" };
  const cap = { category: "roof", basementCap: true };
  const footing = { category: "footing" };
  const basementWall = { category: "wall", basement: true };
  const elements = [floor, cap, footing, basementWall];
  assert.deepEqual(ifcScopeElements(elements, "above"), [floor]);
  assert.deepEqual(ifcScopeElements(elements, "below"), [cap, footing, basementWall]);
  const aboveOwner = { basementCapOwner: "above" };
  assert.deepEqual(ifcScopeElements(elements, "above", aboveOwner), [floor, cap]);
  assert.deepEqual(ifcScopeElements(elements, "below", aboveOwner), [footing, basementWall]);
  const noFoundation = { includeBasementCap: false, includeFoundation: false };
  assert.deepEqual(ifcScopeElements(elements, "above", noFoundation), [floor, cap]);
  assert.deepEqual(ifcScopeElements(elements, "below", noFoundation), [basementWall]);
  assert.deepEqual(ifcScopeElements(elements, "below", { ...noFoundation, basementCapOwner: "below" }), [cap, basementWall]);
  assert.equal(ifcScopeElements(elements, "full"), elements);
  assert.equal(ifcScopeElements(elements, "partial"), elements);
});
