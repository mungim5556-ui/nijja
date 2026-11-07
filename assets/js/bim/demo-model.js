// 예시 모델: 논문 사례와 같은 5층 공동주택, 기준층 30×16m(480㎡) × 5개 층 = 연면적 2,400㎡.
// 한 층에 4세대(15×8m)가 있고, 세대마다 목조 칸막이·욕실·천장·바닥 마감·창·문을 둔다.
import { DEFAULT_ASSEMBLY, TYPES } from "./catalog.js";

let seq = 0;
export const uid = (p = "e") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newElement(type, levelId, geom, extra = {}) {
  return {
    id: uid(type.slice(0, 2)),
    type,
    levelId,
    assembly: DEFAULT_ASSEMBLY[type],
    separable: TYPES[type].structural ? 2 : 5,
    connection: TYPES[type].structural ? "monolithic" : "screw",
    hazard: "none",
    ...(TYPES[type].defaults || {}),
    ...geom,
    ...extra,
  };
}

export function emptyModel() {
  return {
    version: 1,
    name: "새 모델",
    use: "주거 공동주택",
    levels: [{ id: "L1", name: "1층", elevation: 0, height: 2.8 }],
    elements: [],
    params: {},
  };
}

function typicalFloor(levelId) {
  const els = [];
  const L = (type, x1, y1, x2, y2, extra) => { const e = newElement(type, levelId, { x1, y1, x2, y2 }, extra); els.push(e); return e; };
  const R = (type, x, y, w, d, extra) => { const e = newElement(type, levelId, { x, y, w, d }, extra); els.push(e); return e; };
  const O = (type, host, t, extra) => { const e = newElement(type, levelId, { hostId: host.id, t }, extra); els.push(e); return e; };

  // 슬래브
  R("slab", 0, 0, 30, 16);
  // 외벽 (단열·석고보드·벽지)
  const ext = { assembly: "wall.rc.insul" };
  const south = L("wall", 0, 16, 30, 16, ext);
  const north = L("wall", 0, 0, 30, 0, ext);
  L("wall", 0, 0, 0, 16, ext);
  L("wall", 30, 0, 30, 16, ext);
  // 세대 경계벽 (RC + 모르타르 + 벽지)
  const midY = L("wall", 0, 8, 30, 8);
  L("wall", 15, 0, 15, 16);
  // 기둥
  for (const x of [0, 7.5, 15, 22.5, 30]) for (const y of [0, 8, 16]) R("column", x - 0.25, y - 0.25, 0.5, 0.5);
  for (const x of [0, 7.5, 15, 22.5, 30]) L("beam", x, 0, x, 16);

  // 세대 4개
  const units = [
    { x0: 0, y0: 0, floor: "floor.linoleum" },
    { x0: 15, y0: 0, floor: "floor.linoleum" },
    { x0: 0, y0: 8, floor: "floor.wood" },
    { x0: 15, y0: 8, floor: "floor.linoleum" },
  ];
  for (const u of units) {
    const { x0, y0 } = u;
    // 방 칸막이 (목조)
    const p1 = L("partition", x0 + 5, y0, x0 + 5, y0 + 8);
    const p2 = L("partition", x0 + 10, y0, x0 + 10, y0 + 5);
    O("door", p1, 0.7);
    O("door", p2, 0.5);
    // 욕실 (조적 칸막이 + 타일 벽)
    const bath = L("partition", x0 + 10, y0 + 5, x0 + 15, y0 + 5, { assembly: "partition.brick", separable: 2, connection: "mortar" });
    O("door", bath, 0.3);
    L("wall", x0 + 12.6, y0 + 5, x0 + 12.6, y0 + 8, { assembly: "wall.rc.tile", thickness: 0.15 });
    // 천장
    R("ceiling", x0, y0, 15, 8, { assembly: u.y0 === 0 ? "ceiling.tex" : "ceiling.plywood" });
    // 바닥 마감
    R("floorFinish", x0, y0, 15, 5, { assembly: u.floor });
    R("floorFinish", x0, y0 + 5, 10, 3, { assembly: u.floor });
    R("floorFinish", x0 + 10, y0 + 5, 5, 3, { assembly: "floor.tile", connection: "mortar", separable: 2 });
  }
  // 창 (남측 4개 × 2세대, 북측 2개 × 2세대)
  for (const t of [0.08, 0.2, 0.33, 0.45, 0.58, 0.7, 0.83, 0.95]) O("window", south, t, { width: 2.4, height: 1.8, sill: 0.6 });
  for (const t of [0.15, 0.4, 0.65, 0.9]) O("window", north, t);
  // 현관문 (세대 경계벽)
  for (const t of [0.1, 0.4, 0.6, 0.9]) O("door", midY, t, { assembly: "door.steel", width: 1.0, connection: "bolt" });
  return els;
}

export function demoModel() {
  const levels = [1, 2, 3, 4, 5].map((n) => ({ id: `L${n}`, name: `${n}층`, elevation: Math.round((n - 1) * 2.8 * 100) / 100, height: 2.8 }));
  const elements = [];
  for (const lv of levels) {
    const els = typicalFloor(lv.id);
    elements.push(...els);
  }
  return { version: 1, name: "예시: 5층 공동주택 (논문 사례 규모)", use: "주거 공동주택", levels, elements, params: {} };
}

// 한 층의 부재를 다른 층으로 복사한다. 개구부의 hostId도 새 id로 바꾼다.
export function copyLevel(model, fromId, toId) {
  const src = model.elements.filter((e) => e.levelId === fromId);
  const map = {};
  const out = src.map((e) => {
    const n = { ...e, id: uid(e.type.slice(0, 2)), levelId: toId };
    map[e.id] = n.id;
    return n;
  });
  for (const n of out) if (n.hostId) n.hostId = map[n.hostId] || n.hostId;
  return out;
}
