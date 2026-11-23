// IFC 형상은 검토 위치와 치수의 참고값이다. 절단면과 공법은 확인된 입력으로만 집계한다.
const structural = new Set(["slab", "roof", "wall", "beam", "column", "footing", "stair"]);
const horizontalSlabs = new Set(["slab", "roof"]);
const cutModes = { both: ["crush", "selective"], crush: ["crush"], selective: ["selective"] };
const cutTools = new Set(["wire", "wall", "other"]);
const perimeterName = /외벽|외곽|돌출|캔틸레버|파라펫|난간벽|\b(?:parapet|cantilever)\b|\b(?:exterior|external|outer|end)[ -]+(?:wall|beam|slab)\b/i;
const coreName = /코어|샤프트|승강기|엘리베이터|전단벽|\b(?:core|shaft|stairwell|elevator)\b|\bshear[ -]+wall\b/i;
const stairPartName = /디딤단|디딤판|계단\s*참|\b(?:landing|tread)\b/i;
const roofCoverName = /슬레이트|경량\s*경사지붕\s*마감|\bslate\b/i;
const geometryByModel = new WeakMap();
const positive = value => Number.isFinite(value) && value > 0;
const text = value => typeof value === "string" ? value.trim() : "";
const idOf = el => el.globalId || (el.expressID != null ? String(el.expressID) : "");

function isRoofCovering(el) {
  if (!horizontalSlabs.has(el.category) || !el.guessed) return false;
  const layers = el.layers ?? [];
  // 지붕 유형만으로 콘크리트로 추정된 마감은 절단 후보에서 뺀다. 콘크리트층이 있는 복합 지붕은 검토할 수 있다.
  return layers.length ? layers.every(layer => roofCoverName.test(layer.name) || roofCoverName.test(layer.category))
    : roofCoverName.test(el.name);
}

function meshBounds(model) {
  if (!model) return new Map();
  const cached = geometryByModel.get(model);
  if (cached) return cached;
  const result = new Map();
  for (const { expressID, positions } of model.meshes ?? []) {
    const bounds = result.get(expressID) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let offset = 0; offset < positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const coordinate = positions[offset + axis];
        bounds.min[axis] = Math.min(bounds.min[axis], coordinate);
        bounds.max[axis] = Math.max(bounds.max[axis], coordinate);
      }
    }
    result.set(expressID, bounds);
  }
  geometryByModel.set(model, result);
  return result;
}

function dimensionsOf(bounds) {
  if (!bounds) return null;
  const dimensions = bounds.max.map((max, axis) => max - bounds.min[axis]);
  return dimensions.every(positive) ? dimensions : null;
}

function floorEnvelopes(members) {
  const floors = new Map();
  for (const { el, bounds, dimensions } of members) {
    if (!dimensions || !["slab", "wall", "column", "beam"].includes(el.category)) continue;
    const storey = floors.get(el.floor) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const axis of [0, 2]) {
      storey.min[axis] = Math.min(storey.min[axis], bounds.min[axis]);
      storey.max[axis] = Math.max(storey.max[axis], bounds.max[axis]);
    }
    floors.set(el.floor, storey);
  }
  return floors;
}

function onPerimeter({ el, bounds, dimensions }, storey) {
  if (!dimensions || !storey || !["column", "wall"].includes(el.category)) return false;
  const nextToEdge = axis => {
    const span = storey.max[axis] - storey.min[axis];
    const outerEdge = Math.min(bounds.min[axis] - storey.min[axis], storey.max[axis] - bounds.max[axis]);
    return span > 0 && dimensions[axis] < span * 0.25 && outerEdge <= Math.max(0.02, span * 0.01);
  };
  if (el.category === "column") return [0, 2].every(nextToEdge);
  return [0, 2].some(axis => {
    const tangent = axis === 0 ? 2 : 0;
    const tangentSpan = storey.max[tangent] - storey.min[tangent];
    return nextToEdge(axis) && dimensions[axis] < dimensions[tangent] / 3
      && dimensions[tangent] >= Math.min(1.5, tangentSpan * 0.1);
  });
}

function geometryOf(el, dimensions, volume, lengthScale) {
  const concreteFraction = Math.min(1, volume / el.volume);
  const layerThickness = (el.layers ?? []).reduce((sum, layer) => sum + (positive(layer.thickness) ? layer.thickness : 0), 0) * lengthScale;
  if (horizontalSlabs.has(el.category) && positive(layerThickness)) {
    return { thickness: layerThickness * concreteFraction, normalAxis: "y", basis: "layers" };
  }
  if (!dimensions) return { thickness: null, normalAxis: null, basis: "unavailable" };
  const [width, height, depth] = dimensions;
  if (horizontalSlabs.has(el.category) && height < Math.min(width, depth) && concreteFraction > 0.99) {
    const fill = (el.meshVolume ?? el.volume) / ((el.floorFootprint || width * depth) * height);
    if (fill >= 0.9 && fill <= 1.1) return { thickness: height, normalAxis: "y", basis: "bounds" };
  }
  if (el.category === "wall" && positive(layerThickness)) {
    return { thickness: layerThickness * concreteFraction, normalAxis: null, basis: "layers" };
  }
  // 직사각형 상자를 거의 채우는 벽만 해당한다. 회전된 벽이나 개구부가 있는 벽의 외접폭은 두께로 쓰지 않는다.
  if (el.category === "wall" && concreteFraction > 0.99
      && (el.meshVolume ?? el.volume) / (width * height * depth) >= 0.95) {
    const normalAxis = width < depth ? "x" : "z";
    return { thickness: Math.min(width, depth), normalAxis, basis: "bounds" };
  }
  return { thickness: null, normalAxis: null, basis: "bounds" };
}

function crossSection({ el, dimensions }) {
  if (!dimensions || !["beam", "column", "footing"].includes(el.category)) return 0;
  const [width, height, depth] = dimensions;
  if ((el.meshVolume ?? el.volume) / (width * height * depth) < 0.95) return 0;
  return el.category === "beam" ? height * Math.min(width, depth) : width * depth;
}

function largeSections(members) {
  const categorySections = new Map();
  for (const member of members) {
    const section = crossSection(member);
    if (!section) continue;
    const sections = categorySections.get(member.el.category) ?? [];
    sections.push(section);
    categorySections.set(member.el.category, sections);
  }
  const thresholds = new Map();
  for (const [category, sections] of categorySections) {
    if (sections.length < 3) continue;
    sections.sort((a, b) => a - b);
    thresholds.set(category, Math.max(sections[Math.floor(sections.length * 0.75)], sections[Math.floor(sections.length / 2)] * 1.5));
  }
  return thresholds;
}

const reasons = {
  basementBoundary: [1, "지상·지하 경계 · 존치부 확인"],
  roof: [2, "옥상·옥탑 · 낙하 및 인양 조건 확인"],
  perimeter: [2, "외곽 후보 · 도로·보행로 및 인양 조건 확인"],
  core: [3, "코어·샤프트 · 부분 존치 여부 확인"],
  envelope: [4, "층 외곽 형상 · 외부 조건 확인"],
  largeSection: [5, "모델 내 큰 단면 · 정밀 분리 필요 여부 확인"],
};

export function concreteCutCandidates(classified, model, scope) {
  const geometry = meshBounds(model);
  const storeys = new Map((model?.storeys ?? []).map(storey => [storey.floor, storey.name]));
  const members = classified.filter(el => structural.has(el.category)).map(el => {
    const bounds = geometry.get(el.expressID) ?? el.bounds;
    return { el, id: idOf(el), bounds, dimensions: dimensionsOf(bounds) };
  });
  const floors = scope === "partial" ? new Map() : floorEnvelopes(members);
  const thresholds = largeSections(members.filter(({ el }) => el.parts?.some(part => part.stream === "concrete")));
  const hasBasement = model?.basementFloors > 0;
  const lengthScale = positive(model?.lengthScale) ? model.lengthScale : 1;
  const result = [];
  for (const member of members) {
    const { el, id, dimensions } = member;
    const concrete = (el.parts ?? []).filter(part => part.stream === "concrete" && positive(part.m3));
    const volume = concrete.reduce((sum, part) => sum + part.m3, 0);
    if (!id || !positive(volume) || isRoofCovering(el)) continue;
    const namedPerimeter = perimeterName.test(el.name) || el.predefined === "PARAPET";
    const stairPart = el.category === "stair" || (el.category === "slab" && (el.predefined === "LANDING" || stairPartName.test(el.name)));
    if (stairPart && !namedPerimeter) continue;
    let reasonCode;
    if (hasBasement && el.basementCap) reasonCode = "basementBoundary";
    else if (el.category === "roof" || (el.roofLevel && (horizontalSlabs.has(el.category) || namedPerimeter))) reasonCode = "roof";
    else if (coreName.test(el.name)) reasonCode = "core";
    else if (namedPerimeter) reasonCode = "perimeter";
    else if (onPerimeter(member, floors.get(el.floor))) reasonCode = "envelope";
    else if (crossSection(member) >= (thresholds.get(el.category) ?? Infinity)) reasonCode = "largeSection";
    if (!reasonCode) continue;
    const [priority, reason] = reasons[reasonCode];
    const massTons = concrete.reduce((sum, part) => sum + (positive(part.tons) ? part.tons : 0), 0);
    result.push({
      id, expressID: el.expressID, name: el.name, category: el.category, floor: el.floor, storey: storeys.get(el.floor) ?? "",
      reasonCode, reason, priority, materialUnverified: !!el.guessed, volume, massTons, dimensions,
      ...geometryOf(el, dimensions, volume, lengthScale),
    });
  }
  return result.sort((a, b) => a.priority - b.priority || a.floor - b.floor || b.volume - a.volume || a.expressID - b.expressID);
}

function measuredArea(row) {
  if (row.measure === "area") return row.area;
  const count = row.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1) return null;
  if (row.measure === "line" && positive(row.length) && positive(row.thickness)) return row.length * row.thickness * count;
  if (row.measure === "section" && positive(row.width) && positive(row.depth)) return row.width * row.depth * count;
  return null;
}

export function normalizeConcreteCutPlan(input, candidates = null) {
  const rows = [], issues = [], areas = { crush: 0, selective: 0 };
  const byId = candidates == null ? null : new Map(candidates.map(candidate => [candidate.id, candidate]));
  const seenIds = new Set(), seenCuts = new Map();
  for (const [index, entry] of (Array.isArray(input) ? input : []).entries()) {
    const row = entry ?? {};
    const id = text(row.id);
    const candidateId = text(row.candidateId);
    const candidate = byId?.get(candidateId);
    const label = text(row.label);
    const methods = Object.hasOwn(cutModes, row.method) ? cutModes[row.method] : null;
    const cutArea = measuredArea(row);
    const key = JSON.stringify([candidateId, label.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ")]);
    const existing = seenCuts.get(key) ?? new Set();
    let problem;
    if (!id || !label) problem = "절단면 이름을 입력하세요.";
    else if (candidateId && byId && !candidate) problem = "이 부재는 현재 범위의 절단 후보에서 확인되지 않습니다.";
    else if (!methods || !cutTools.has(row.tool)) problem = "적용 공법과 절단 장비를 선택하세요.";
    else if (!positive(cutArea)) problem = "절단 치수 또는 면적과 올바른 면 수를 입력하세요.";
    else if (seenIds.has(id) || methods.some(mode => existing.has(mode))) problem = "같은 절단면이 이 공법에 이미 포함되어 있습니다.";
    else if (methods.some(mode => !Number.isFinite(areas[mode] + cutArea))) problem = "절단면적 합계가 너무 큽니다.";
    if (problem) {
      issues.push(`절단면 ${index + 1} · ${problem}`);
      continue;
    }
    seenIds.add(id);
    for (const mode of methods) {
      areas[mode] += cutArea;
      existing.add(mode);
    }
    seenCuts.set(key, existing);
    rows.push({ ...row, id, candidateId, label, cutArea, candidate });
  }
  return { rows, issues, areas };
}
