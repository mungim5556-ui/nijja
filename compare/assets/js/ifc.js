// Revit 등에서 내보낸 IFC를 읽어 3D 메시와 부재 목록(부피·면적·재료 층)을 만든다 (web-ifc)
// nijja의 ifc.js를 바탕으로 창호·문·마감·배관과 재료 층, GlobalId·Tag(Revit 요소 ID)를 더했다.
const CDN = "https://cdn.jsdelivr.net/npm/web-ifc@0.0.78/";

// 3D 메시 (x,y,z) 배열의 닫힌 솔리드 부피(m³) — 부호 있는 사면체 합
export function meshVolume(pos, index) {
  let v = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

// 메시 겉넓이(m²) — 얇은 판 부재는 겉넓이의 절반이 한쪽 면 면적이다
export function meshSurface(pos, index) {
  let s = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}

// IFC 길이 단위 → m 배율. web-ifc의 형상은 m로 바뀌어 나오지만, 속성 값(창·문의 OverallWidth 등)은
// 파일 단위 그대로라 Revit 기본값(mm)이면 1,000배가 된다. units = IfcUnitAssignment.Units (GetLine(..., true)로 펼친 것)
const PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10,
  DECI: 0.1, CENTI: 0.01, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };
const enumOf = (x) => String(x?.value ?? x ?? "").replace(/\./g, "").toUpperCase();
export function lengthScale(units = []) {
  const unit = units.find((u) => enumOf(u?.UnitType) === "LENGTHUNIT");
  return unit ? unitFactor(unit) : 1;
}
function unitFactor(u) {
  if (u.ConversionFactor) {
    // 인치·피트 등: ValueComponent × (기준 SI 단위의 배율)
    const c = u.ConversionFactor, v = Number(c.ValueComponent?.value ?? c.ValueComponent) || 1;
    return v * (c.UnitComponent ? unitFactor(c.UnitComponent) : 1);
  }
  return PREFIX[enumOf(u.Prefix)] ?? 1;
}

// IFC 종류 → 앱의 부재 분류
const CATEGORY = {
  IFCWALL: "wall", IFCWALLSTANDARDCASE: "wall", IFCSLAB: "slab", IFCBEAM: "beam", IFCCOLUMN: "column",
  IFCFOOTING: "footing", IFCPILE: "footing", IFCSTAIR: "stair", IFCSTAIRFLIGHT: "stair", IFCRAMP: "stair", IFCROOF: "roof",
  IFCWINDOW: "window", IFCDOOR: "door", IFCCURTAINWALL: "window", IFCCOVERING: "covering", IFCRAILING: "railing",
  IFCPLATE: "plate", IFCMEMBER: "plate", IFCFLOWSEGMENT: "pipe", IFCFLOWFITTING: "pipe", IFCPIPESEGMENT: "pipe",
  IFCPIPEFITTING: "pipe", IFCDUCTSEGMENT: "pipe", IFCDUCTFITTING: "pipe", IFCBUILDINGELEMENTPROXY: "other",
  // IFC4·ArchiCAD·Tekla가 쓰는 세부 종류. 빠지면 부재가 경고 없이 물량에서 사라진다.
  IFCWALLELEMENTEDCASE: "wall", IFCSLABSTANDARDCASE: "slab", IFCSLABELEMENTEDCASE: "slab", IFCBEAMSTANDARDCASE: "beam",
  IFCCOLUMNSTANDARDCASE: "column", IFCMEMBERSTANDARDCASE: "plate", IFCPLATESTANDARDCASE: "plate",
  IFCDOORSTANDARDCASE: "door", IFCWINDOWSTANDARDCASE: "window", IFCRAMPFLIGHT: "stair", IFCCHIMNEY: "wall",
  IFCSHADINGDEVICE: "plate", IFCCAISSONFOUNDATION: "footing", IFCDEEPFOUNDATION: "footing",
  // 모델링한 철근. 있으면 콘크리트 부피로 추정하는 철근량을 그만큼 덜 더한다.
  IFCREINFORCINGBAR: "rebar", IFCREINFORCINGMESH: "rebar", IFCTENDON: "rebar",
  // Revit "파트"로 나눈 부재. 종류는 원래 부재(집합 부모)를 따른다.
  IFCBUILDINGELEMENTPART: "part",
};

// 재료 연결에서 층 목록을 뽑는다. 두께가 있으면 [{name, thickness}], 없으면 이름만.
function materialLayers(o, W, out = [], depth = 0) {
  if (!o || typeof o !== "object" || depth > 7) return out;
  if (o.type === W.IFCMATERIALLAYER) {
    out.push({ name: o.Material?.Name?.value || "", category: o.Material?.Category?.value || "", thickness: Number(o.LayerThickness?.value) || 0 });
    return out;
  }
  if (o.type === W.IFCMATERIAL) { out.push({ name: o.Name?.value || "", category: o.Category?.value || "", thickness: 0 }); return out; }
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach((x) => materialLayers(x, W, out, depth + 1));
    else materialLayers(v, W, out, depth + 1);
  }
  return out;
}

// 닫힌 바닥 솔리드의 위·아래 면을 수평 투영한다. 수직 옆면의 투영 면적은 0이다.
export function horizontalFootprint(positions, index) {
  let twiceArea = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ux = positions[b] - positions[a], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vz = positions[c + 2] - positions[a + 2];
    twiceArea += Math.abs(ux * vz - uz * vx);
  }
  return twiceArea / 4;
}

// 창·문 면적(㎡): 속성(폭×높이)을 쓰되, 형상 겉넓이의 절반보다 터무니없이 크면(단위 오류) 형상 값을 쓴다
export function openingArea(w, h, surface) {
  const geo = surface / 2;
  if (!(w && h)) return geo;
  return geo > 0 && w * h > geo * 5 ? geo : w * h;
}

// 연면적(㎡) 추정: 바닥 슬래브(기초 슬래브 포함, 지붕·옥상 제외) 면적의 합. 슬래브가 없으면 외곽 상자 × 층수.
// 외곽 상자 × 층수는 대지·옥탑·기준 레벨까지 세어 몇 배로 커지기 쉽다.
// 옥상 슬래브(그 층에 벽·기둥이 없는 맨 위 슬래브)는 바닥이 아니므로 뺀다.
export function grossArea(elements, size, floors) {
  const vertical = new Set(elements.filter((e) => e.category === "wall" || e.category === "column").map((e) => e.floor));
  const isSlab = (e) => e.category === "slab" || (e.category === "footing" && e.predefined === "BASESLAB");
  let slabs = elements.filter((e) => e.category === "slab" && vertical.has(e.floor));
  // 기초 슬래브(매트)는 1층 바닥 슬래브가 따로 없을 때만 1층 바닥으로 센다
  if (!slabs.some((e) => e.floor === 1)) slabs.push(...elements.filter((e) => e.category === "footing" && e.predefined === "BASESLAB"));
  if (!slabs.length) slabs = elements.filter(isSlab);
  const area = slabs.reduce((s, e) => s + (e.floorFootprint ?? e.area ?? 0), 0);
  return area > 0 ? { area, basis: "slab" } : { area: size[0] * size[2] * floors, basis: "bbox" };
}

export function ifcScopeElements(elements, scope, {
  includeFoundation = true, includeBasementCap, basementCapOwner = includeBasementCap === false ? "above" : "below",
} = {}) {
  if (scope !== "above" && scope !== "below") return elements;
  const owner = basementCapOwner === "above" ? "above" : "below";
  return elements.filter(el => {
    if (el.category === "footing") return scope === "below" && includeFoundation;
    if (el.basementCap) return scope === owner;
    return scope === (el.basement ? "below" : "above");
  });
}

function scopeGeometry(elements, size, storeys) {
  const storeyElements = new Map();
  for (const el of elements) {
    if (el.category !== "other" && el.category !== "footing" && (el.volume > 0 || el.area > 0)) {
      const onFloor = storeyElements.get(el.floor) ?? [];
      onFloor.push(el);
      storeyElements.set(el.floor, onFloor);
    }
  }
  const occupied = [...storeyElements.values()].flat();
  const below = occupied.filter(el => el.basement);
  const above = occupied.filter(el => !el.basement && !el.roofLevel);
  const basementCapCount = above.filter(el => el.basementCap).length;
  // A ground-floor slab can be the ceiling of B1. It is not by itself an above-ground storey.
  const basementOnlyCandidate = below.length > 0 && !above.some(el => !el.basementCap);
  const basementFloors = new Set(below.map(el => el.floor)).size;
  const aboveGround = basementOnlyCandidate ? [] : above;
  const aboveFloors = new Set(aboveGround.map(el => el.floor)).size;
  const belowArea = basementFloors ? grossArea(below, size, basementFloors) : { area: 0, basis: "none" };
  const aboveGroundArea = aboveFloors ? grossArea(aboveGround, size, aboveFloors) : { area: 0, basis: "none" };
  return {
    aboveFloors, aboveArea: aboveGroundArea.area, aboveBasis: aboveGroundArea.basis,
    basementFloors, basementArea: belowArea.area, basementBasis: belowArea.basis, basementCapCount, basementOnlyCandidate,
    storeys: storeys.map((story, idx) => ({ floor: idx + 1, name: story.name, elevation_m: story.elevation_m,
      basement: story.basement, roof: story.roof, elementCount: storeyElements.get(idx + 1)?.length ?? 0 })),
  };
}

// 모든 하위 가지에 집계 가능한 부재가 있는 경우에만 집합 부모를 제외한다.
export function dropAggregateParents(acc, parts) {
  const hasGeometry = (id, seen = new Set()) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const children = parts.get(id) || [];
    return children.length > 0 && children.every((child) => acc.has(child) || hasGeometry(child, new Set(seen)));
  };
  for (const id of [...acc.keys()].filter(id => hasGeometry(id))) acc.delete(id);
  return acc;
}

export function massUnitTons(unit) {
  if (!unit || enumOf(unit.UnitType) !== "MASSUNIT") return NaN;
  if (unit.ConversionFactor) {
    const conversion = unit.ConversionFactor;
    return Number(conversion.ValueComponent?.value) * massUnitTons(conversion.UnitComponent);
  }
  if (enumOf(unit.Name) !== "GRAM") return NaN;
  const prefix = enumOf(unit.Prefix);
  return (prefix ? PREFIX[prefix] : 1) / 1e6;
}

// IFC 부피 단위 → ㎥ 배율 (SI 접두어는 길이에 붙으므로 세제곱)
export function volumeUnitM3(unit) {
  if (!unit) return 1;
  if (enumOf(unit.UnitType) !== "VOLUMEUNIT") return NaN;
  if (unit.ConversionFactor) {
    const c = unit.ConversionFactor;
    return Number(c.ValueComponent?.value ?? c.ValueComponent) * (c.UnitComponent ? volumeUnitM3(c.UnitComponent) : 1);
  }
  if (enumOf(unit.Name) !== "CUBIC_METRE") return NaN;
  const prefix = enumOf(unit.Prefix);
  return prefix ? PREFIX[prefix] ** 3 : 1;
}

function areaUnitM2(unit) {
  if (enumOf(unit?.UnitType) !== "AREAUNIT") return NaN;
  if (unit.ConversionFactor) {
    const c = unit.ConversionFactor;
    return Number(c.ValueComponent?.value ?? c.ValueComponent) * areaUnitM2(c.UnitComponent);
  }
  return enumOf(unit.Name) === "SQUARE_METRE" ? (PREFIX[enumOf(unit.Prefix)] ?? 1) ** 2 : NaN;
}

function massPerLengthUnit(unit) {
  let mass = 0, length = 0, scale = 1;
  for (const element of unit?.Elements ?? []) {
    const exponent = Number(element.Exponent?.value);
    if (!Number.isInteger(exponent)) return NaN;
    const unitType = enumOf(element.Unit?.UnitType);
    if (unitType === "MASSUNIT") {
      mass += exponent;
      scale *= massUnitTons(element.Unit) ** exponent;
    } else if (unitType === "LENGTHUNIT") {
      length += exponent;
      scale *= unitFactor(element.Unit) ** exponent;
    } else return NaN;
  }
  return mass === 1 && length === -1 ? scale : NaN;
}

const positive = value => Number.isFinite(value) && value > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const propertyName = property => String(property?.Name?.value ?? "").toLowerCase().replace(/\s/g, "");
const measuredLengthScale = (unit, projectScale) => unit == null ? projectScale
  : enumOf(unit.UnitType) === "LENGTHUNIT" ? unitFactor(unit) : NaN;
const pureCopper = value => /\bcopper\b|\bcu\b|순동|구리|동관|동선/i.test(value)
  && !/brass|bronze|alloy|tinned|plated|clad|황동|청동|합금|도금|복합|알루미늄|alumin/i.test(value);
const insulated = /insulat|sheath|피복|절연|외피|\bpvc\b|\bxlpe\b/i;
const otherCable = /optical|fiber|fibre|bare|busbar|광케이블|광섬유|나선|무피복|\bcca\b|clad|구리피복\s*알루미늄/i;
const excludedCableTypes = new Set(["BUSBARSEGMENT", "CONDUCTORSEGMENT", "CORESEGMENT", "FIBERSEGMENT", "FIBERTUBE", "OPTICALCABLESEGMENT"]);

// 현장 회수량 산정에 쓸 수 있는, 실제 모델 속성에 근거한 설치 중량만 계산한다.
export function ifcServiceMass(kind, measures) {
  const { weight, length, massPerLength, wallVolume, netSectionArea, outerDiameter, innerDiameter, wallThickness } = measures;
  if (nonnegative(weight)) return { tons: weight, basis: "ifc-weight" };
  if (kind === "cable") {
    const tons = length * massPerLength;
    return positive(length) && nonnegative(massPerLength) && Number.isFinite(tons)
      ? { tons, basis: "ifc-mass-per-length" } : { tons: null, basis: null };
  }
  const density = 8.96; // 동관 동재량 t/㎥
  if (positive(wallVolume) && Number.isFinite(wallVolume * density)) return { tons: wallVolume * density, basis: "ifc-net-volume" };
  if (positive(length) && positive(netSectionArea) && Number.isFinite(netSectionArea * length * density)) {
    return { tons: netSectionArea * length * density, basis: "ifc-net-section" };
  }
  const inner = innerDiameter ?? (positive(wallThickness) ? outerDiameter - 2 * wallThickness : null);
  if (positive(length) && positive(outerDiameter) && positive(inner) && inner < outerDiameter) {
    const tons = Math.PI / 4 * (outerDiameter - inner) * (outerDiameter + inner) * length * density;
    if (positive(tons)) return { tons, basis: "ifc-tube-dimensions" };
  }
  return { tons: null, basis: null };
}

export function ifcServiceKind(type, predefined, layers, productName) {
  const materials = layers.map(layer => [layer.name, layer.category].filter(Boolean).join(" ")).filter(Boolean);
  if (type === "pipe") return materials.length > 0 && materials.every(pureCopper) ? "copperPipe" : null;
  if (type !== "cable" || excludedCableTypes.has(predefined) || otherCable.test(productName)) return null;
  const details = [productName, ...materials];
  if (!details.some(pureCopper) || materials.some(material => /\bcca\b|clad/i.test(material)
    || (/alumini?um|알루미늄/i.test(material) && !/shield|screen|차폐|실드/i.test(material)))) return null;
  return predefined === "CABLESEGMENT" || details.some(detail => insulated.test(detail)) ? "cable" : null;
}

function readServiceQuantity(quantity, types, units) {
  const name = propertyName(quantity);
  if (quantity.type === types.IFCQUANTITYWEIGHT && ["grossweight", "총중량"].includes(name)) {
    // 표준 배관 NetWeight에는 관 속 유체가 포함된다.
    return ["weight", Number(quantity.WeightValue?.value) * massUnitTons(quantity.Unit ?? units.mass)];
  }
  if (quantity.type === types.IFCQUANTITYLENGTH && name === "length") {
    return ["length", Number(quantity.LengthValue?.value) * measuredLengthScale(quantity.Unit, units.length)];
  }
  if (quantity.type === types.IFCQUANTITYAREA && name === "netcrosssectionarea") {
    return ["netSectionArea", Number(quantity.AreaValue?.value) * areaUnitM2(quantity.Unit ?? units.area)];
  }
  if (quantity.type === types.IFCQUANTITYVOLUME && ["pipewallvolume", "coppervolume"].includes(name)) {
    const unit = quantity.Unit ?? units.volume;
    return ["wallVolume", unit ? Number(quantity.VolumeValue?.value) * volumeUnitM3(unit) : NaN];
  }
  return [];
}

function serviceProperties(kind, propertyIds, read, types, units) {
  const measures = {};
  const expected = kind === "cable" ? "pset_cablesegmenttypecablesegment" : "pset_pipesegmenttypecommon";
  const lengthFields = { length: "length", outerdiameter: "outerDiameter", innerdiameter: "innerDiameter", wallthickness: "wallThickness" };
  for (const propertyId of propertyIds) {
    const set = read(propertyId);
    if (propertyName(set) !== expected) continue;
    for (const { value: id } of set.HasProperties ?? []) {
      const property = read(id, true);
      if (property.type !== types.IFCPROPERTYSINGLEVALUE) continue;
      const name = propertyName(property);
      const value = Number(property.NominalValue?.value);
      if (name === "massperlength" && kind === "cable" && property.NominalValue?.name === "IFCMASSPERLENGTHMEASURE") {
        const perMetre = value * massPerLengthUnit(property.Unit ?? units.massPerLength);
        if (nonnegative(perMetre)) measures.massPerLength = perMetre;
      } else if (Object.hasOwn(lengthFields, name)) {
        const metres = value * measuredLengthScale(property.Unit, units.length);
        if (positive(metres)) measures[lengthFields[name]] = metres;
      }
    }
  }
  return measures;
}

function ancestorIds(id, parentOf) {
  const parents = [], seen = new Set([id]);
  for (let parent = parentOf.get(id); parent != null && !seen.has(parent); parent = parentOf.get(parent)) {
    parents.push(parent);
    seen.add(parent);
  }
  return parents;
}

function ifcServices({ types, read, ids, typeOf, serviceTypes, serviceData, unitDefaults, parentOf, matOf, floorOf, storeys }) {
  if (!serviceTypes.size) return [];
  const serviceParents = new Map(parentOf);
  for (const id of ids(types.IFCRELNESTS)) {
    const nested = read(id);
    const parent = nested.RelatingObject?.value;
    if (parent != null) for (const child of nested.RelatedObjects ?? []) {
      if (!serviceParents.has(child.value)) serviceParents.set(child.value, parent);
    }
  }
  const distribution = new Set(ids(types.IFCDISTRIBUTIONFLOWELEMENT, true));
  const records = new Map();
  for (const [expressID, type] of serviceTypes) {
    const line = read(expressID);
    const typeId = typeOf.get(expressID);
    const definition = typeId != null ? read(typeId) : null;
    const occurrenceType = enumOf(line.PredefinedType);
    const predefined = occurrenceType && occurrenceType !== "NOTDEFINED" ? occurrenceType : enumOf(definition?.PredefinedType);
    const name = line.Name?.value || "";
    const product = [name, line.ObjectType?.value, definition?.Name?.value, definition?.ElementType?.value].filter(Boolean).join(" ");
    const ownLayers = matOf.get(expressID);
    const kind = ifcServiceKind(type, predefined, ownLayers?.length ? ownLayers : matOf.get(typeId) ?? [], product);
    if (!kind) continue;
    const parents = ancestorIds(expressID, serviceParents);
    const floor = [expressID, ...parents].map(id => floorOf.get(id)).find(value => value != null) ?? null;
    const { properties, quantities } = serviceData.get(expressID);
    const propertyIds = [...(definition?.HasPropertySets ?? []).map(ref => ref.value), ...properties];
    const measures = { ...serviceProperties(kind, propertyIds, read, types, unitDefaults), ...quantities };
    records.set(expressID, {
      record: {
        kind, expressID, globalId: line.GlobalId?.value || "", tag: line.Tag?.value || "", name, floor,
        category: "pipe", basement: storeys[(floor ?? 0) - 1]?.basement ?? false, basementCap: false,
        ...ifcServiceMass(kind, measures),
      },
      parents,
    });
  }
  for (const [id, { record, parents }] of records) {
    // 기기 또는 다른 종류의 설비에 들어있는 관과 전선은 별도 물량으로 더하지 않는다.
    if (parents.some(parent => distribution.has(parent) && records.get(parent)?.record.kind !== record.kind)) records.delete(id);
  }
  // 이미 수량이 있는 모델의 전체 구간과 해당 하위 구간이 같이 있으면 전체를 한 번만 센다.
  const selected = [...records.values()].filter(({ record, parents }) =>
    !parents.some(id => records.get(id)?.record.kind === record.kind && records.get(id).record.tons != null));
  const representedParents = new Set(selected.flatMap(({ record, parents }) => parents.filter(id => records.get(id)?.record.kind === record.kind)));
  const replaces = new Map();
  for (const [expressID, type] of serviceTypes) {
    const root = ancestorIds(expressID, serviceParents).findLast(id => serviceTypes.get(id) === type && records.get(id)?.record.tons != null);
    if (root == null) continue;
    const duplicates = replaces.get(root) ?? [];
    duplicates.push(expressID);
    replaces.set(root, duplicates);
  }
  return selected.map(({ record }) => record)
    .filter(record => record.tons != null || !representedParents.has(record.expressID))
    .map(record => ({ ...record, replaces: [record.expressID, ...(replaces.get(record.expressID) ?? [])] }));
}

// 부재 부피: IFC 수량표(Qto) 부피가 있으면 그것을, 없으면 형상 부피를 쓴다.
// Revit 등이 계산한 NetVolume이 web-ifc 형상(열린 메시·불리언 실패)보다 믿을 만하다.
export function pickVolume(meshVolume, qtoVolume) {
  if (Number.isFinite(qtoVolume) && qtoVolume > 0) return { volume: qtoVolume, source: "qto", diff: meshVolume > 0 ? meshVolume / qtoVolume - 1 : null };
  return { volume: meshVolume, source: "mesh", diff: null };
}

// 부피 출처 요약: Qto를 쓴 부재 수와 형상 부피와의 차이 (|차이| 중앙값, 10% 넘게 다른 부재 수)
export function volumeCheck(elements) {
  const withQto = elements.filter((el) => el.volumeSource === "qto");
  const diffs = withQto.map((el) => Math.abs(el.volumeDiff)).filter(Number.isFinite).sort((a, b) => a - b);
  return { qto: withQto.length, mesh: elements.length - withQto.length,
    medianDiff: diffs.length ? diffs[Math.floor(diffs.length / 2)] : null, over10: diffs.filter((d) => d > 0.1).length };
}

// IFC4에서는 사각 중공 단면의 Position 생략이 가능하다. 일부 파서 버전은 명시한 원점을 요구한다.
export function normalizeHollowProfilePositions(bytes) {
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return bytes; }
  const omitted = /(^[\t ]*#\d+\s*=\s*IFCRECTANGLEHOLLOWPROFILEDEF\s*\(\s*\.AREA\.\s*,\s*(?:\$|'(?:[^']|'')*')\s*,\s*)\$(?=\s*,)/gim;
  if (!omitted.test(source)) return bytes;
  const insertion = source.toUpperCase().lastIndexOf("ENDSEC;");
  if (insertion < 0) return bytes;
  let maxId = 0;
  for (const match of source.matchAll(/^\s*#(\d+)\s*=/gm)) maxId = Math.max(maxId, Number(match[1]));
  const point = maxId + 1, placement = maxId + 2;
  const extra = `#${point}=IFCCARTESIANPOINT((0.,0.));\n#${placement}=IFCAXIS2PLACEMENT2D(#${point},$);\n`;
  const data = source.slice(0, insertion).replace(omitted, (_, prefix) => prefix + "#" + placement);
  return new TextEncoder().encode(data + extra + source.slice(insertion));
}

export function ifcBuildingUse(building, project, survey) {
  function usageOf(text) {
    if (/아파트|공동주택|다가구|다세대|연립주택|빌라|\bapartment\b|\bmulti[- ]family\b/i.test(text)) return "공동주택";
    if (/단독|관사|\bsingle[- ]family\b/i.test(text)) return "단독주택";
    if (/학교|교사동|교육연구시설|어린이집|유아원|상가|근린생활시설|업무시설|사무실|사무동|사무용|공장|창고|\b(?:offices?|schools?|retail|factory|warehouse)\b/i.test(text)) return "비주거 RC";
    return /주택/.test(text) ? "단독주택" : null;
  }
  const location = [building, survey, project].filter(Boolean);
  const usage = location.map(usageOf).find(Boolean) ?? null;
  const serviceAreaExcluded = location.some(text => /공장|창고|축사|차양막|철탑|\b(?:factory|warehouse)\b/i.test(text))
    || /지하층|지하부|\bbasement\b/i.test(survey);
  return { usage, serviceAreaExcluded };
}

const HEIGHT_COMPONENTS = new Set(["wall", "slab", "beam", "column", "roof", "plate"]);

export function ifcAboveGroundHeight(groundY, elements, storeys, floorOf, topById) {
  if (!Number.isFinite(groundY)) return null;
  let topY = -Infinity;
  for (const el of elements) {
    if (el.basementCap || !HEIGHT_COMPONENTS.has(el.category)) continue;
    const storey = storeys[(floorOf(el.expressID) ?? 0) - 1];
    const meshTop = topById.get(el.expressID);
    if (storey && !storey.basement && Number.isFinite(meshTop)) {
      topY = Math.max(topY, meshTop);
    }
  }
  const height = Math.round((topY - groundY) * 1000) / 1000;
  return positive(height) ? height : null;
}

function groundLevelY(api, model, W, storeys, scale) {
  const grade = /^(?:G\.?\s*L\.?|ground\s+level|grade(?:\s+level)?|지표면|지반(?:고|면)?)$/i;
  const surveyLevels = storeys.filter(storey => grade.test(storey.name));
  const grounds = surveyLevels.length ? surveyLevels : storeys.filter(storey => !storey.basement
    && (storey.ground || /^(?:지상\s*)?1\s*층(?=$|\s|\(|\[)/.test(storey.name)));
  if (grounds.length !== 1 || !positive(scale)) return null;
  const placement = grounds[0].placement;
  if (placement == null || api.GetLineType(model, placement) !== W.IFCLOCALPLACEMENT) return null;
  try {
    // Object placements use IFC Z-up and file units. The streamed geometry uses Y-up metres.
    const matrix = api.GetWorldTransformMatrix(model, placement);
    if (!(Math.abs(matrix[10] - 1) < 1e-9) || matrix[15] !== 1 || !Number.isFinite(matrix[14])) return null;
    return matrix[14] * scale;
  } catch {
    return null;
  }
}

export async function parseIfc(buffer) {
  const W = await import(CDN + "web-ifc-api.js");
  const api = new W.IfcAPI();
  api.SetWasmPath(CDN, true);
  await api.Init(undefined, true);
  const model = api.OpenModel(normalizeHollowProfilePositions(new Uint8Array(buffer)));
  try {
    const catOf = new Map(Object.entries(CATEGORY).filter(([k]) => W[k] != null).map(([k, c]) => [W[k], c]));
    const ids = (t, inherit = false) => {
      if (t == null) return [];
      const v = api.GetLineIDsWithType(model, t, inherit);
      return Array.from({ length: v.size() }, (_, i) => v.get(i));
    };
    const read = (id, deep = false) => api.GetLine(model, id, deep);
    const [ua] = ids(W.IFCUNITASSIGNMENT);
    const units = ua ? api.GetLine(model, ua, true).Units || [] : [];
    const scale = lengthScale(units);
    const projectMass = units.find(u => enumOf(u.UnitType) === "MASSUNIT");
    const volumeUnit = units.find(u => enumOf(u.UnitType) === "VOLUMEUNIT");
    const projectVolume = volumeUnitM3(volumeUnit);
    const unitDefaults = {
      mass: projectMass, length: units.some(unit => enumOf(unit.UnitType) === "LENGTHUNIT") ? scale : NaN, volume: volumeUnit,
      area: units.find(u => enumOf(u.UnitType) === "AREAUNIT"),
      massPerLength: units.find(u => enumOf(u.UnitType) === "MASSPERLENGTHUNIT"),
    };
    const typeOf = new Map();
    const serviceTypes = new Map([
      ...ids(W.IFCCABLESEGMENT).map(id => [id, "cable"]),
      ...ids(W.IFCPIPESEGMENT).map(id => [id, "pipe"]),
    ]);
    for (const rid of ids(W.IFCRELDEFINESBYTYPE)) {
      const relation = read(rid);
      const typeId = relation.RelatingType?.value;
      if (typeId == null) continue;
      const type = api.GetLineType(model, typeId);
      const service = type === W.IFCCABLESEGMENTTYPE ? "cable" : type === W.IFCPIPESEGMENTTYPE ? "pipe" : null;
      for (const object of relation.RelatedObjects || []) {
        typeOf.set(object.value, typeId);
        if (service && api.GetLineType(model, object.value) === W.IFCFLOWSEGMENT) serviceTypes.set(object.value, service);
      }
    }
    const serviceData = new Map([...serviceTypes.keys()].map(id => [id, { quantities: {}, properties: [] }]));
    const weights = new Map(), volumes = new Map();
    for (const rid of ids(W.IFCRELDEFINESBYPROPERTIES)) {
      const relation = api.GetLine(model, rid);
      const id = relation.RelatingPropertyDefinition?.value;
      if (!id) continue;
      const definitionType = api.GetLineType(model, id);
      const serviceObjects = (relation.RelatedObjects || []).map(object => serviceData.get(object.value)).filter(Boolean);
      if (definitionType === W.IFCPROPERTYSET) for (const service of serviceObjects) service.properties.push(id);
      if (definitionType !== W.IFCELEMENTQUANTITY) continue;
      for (const ref of read(id).Quantities || []) {
        if (serviceObjects.length > 0) {
          const [key, value] = readServiceQuantity(read(ref.value, true), W, unitDefaults);
          if (key && (key === "weight" ? nonnegative(value) : positive(value))) {
            for (const service of serviceObjects) service.quantities[key] ??= value;
          }
        }
        if (api.GetLineType(model, ref.value) === W.IFCQUANTITYVOLUME) {
          const quantity = api.GetLine(model, ref.value, true);
          // NetVolume(개구부 제외)을 GrossVolume보다 우선한다
          const priority = ["grossvolume", "volume", "netvolume"].indexOf(String(quantity.Name?.value || "").toLowerCase().replace(/\s/g, ""));
          const m3 = Number(quantity.VolumeValue?.value) * (quantity.Unit ? volumeUnitM3(quantity.Unit) : projectVolume);
          if (priority >= 0 && Number.isFinite(m3) && m3 > 0) for (const object of relation.RelatedObjects || []) {
            if ((volumes.get(object.value)?.priority ?? -1) < priority) volumes.set(object.value, { priority, m3 });
          }
          continue;
        }
        if (api.GetLineType(model, ref.value) !== W.IFCQUANTITYWEIGHT) continue;
        const quantity = api.GetLine(model, ref.value, true);
        const priority = ["grossweight","추정중량","netweight","순중량"].indexOf(String(quantity.Name?.value || "").toLowerCase().replace(/\s/g,""));
        if (priority < 0) continue;
        const tons = Number(quantity.WeightValue?.value) * massUnitTons(quantity.Unit || projectMass);
        if (!Number.isFinite(tons) || tons <= 0) continue;
        for (const object of relation.RelatedObjects || []) {
          if ((weights.get(object.value)?.priority ?? -1) < priority) weights.set(object.value, {priority, tons});
        }
      }
    }

    // 층: 높이순으로 1, 2, 3…
    const storeys = ids(W.IFCBUILDINGSTOREY)
      .map((id) => {
        const level = api.GetLine(model, id);
        const name = String(level.Name?.value ?? "").trim();
        const elev = Number(level.Elevation?.value ?? 0);
        return { id, name, elev, elevation_m: elev * scale, placement: level.ObjectPlacement?.value,
          basement: /^(?:(?:level|floor|fl)\s*)?(?:B\s*\d+|지하|Basement|Underground)/i.test(name),
          ground: /^(?:G(?:round\s*(?:floor)?)?F?|(?:지상\s*)?1\s*층|[01]\s*F|(?:level|floor|l)[\s_-]*[01])(?:\b|$)/i.test(name),
          roof: /^(?:RF\b|PH\b|Roof|옥상|옥탑|지붕)/i.test(name) };
      })
      .sort((a, b) => a.elev - b.elev);
    const floorOfStorey = new Map(storeys.map((s, i) => [s.id, i + 1]));
    const floorOf = new Map();
    for (const rid of ids(W.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const r = api.GetLine(model, rid);
      const f = floorOfStorey.get(r.RelatingStructure?.value);
      if (f) for (const e of r.RelatedElements || []) floorOf.set(e.value, f);
    }
    // 재료: 부재에 직접 붙은 것이 없으면 유형(IfcWallType 등)에 붙은 것을 쓴다
    const matOf = new Map();
    for (const rid of ids(W.IFCRELASSOCIATESMATERIAL)) {
      const r = api.GetLine(model, rid);
      const layers = materialLayers(api.GetLine(model, r.RelatingMaterial.value, true), W).filter((l) => l.name || l.category);
      for (const o of r.RelatedObjects || []) matOf.set(o.value, layers);
    }
    // 형상: 배치 행렬을 적용한 월드 좌표 (web-ifc 출력은 Y-up, m 단위)
    const meshes = [];
    const topById = new Map();
    api.StreamAllMeshes(model, (flat) => {
      let top = -Infinity;
      for (let i = 0; i < flat.geometries.size(); i++) {
        const pg = flat.geometries.get(i);
        const g = api.GetGeometry(model, pg.geometryExpressID);
        const vd = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const index = Uint32Array.from(api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize()));
        g.delete();
        const m = pg.flatTransformation;
        const n = vd.length / 6;
        const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          const [x, y, z, nx, ny, nz] = vd.subarray(k * 6, k * 6 + 6);
          positions[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          const worldY = m[1] * x + m[5] * y + m[9] * z + m[13];
          positions[k * 3 + 1] = worldY;
          if (Number.isFinite(worldY)) top = Math.max(top, worldY);
          positions[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          normals[k * 3] = m[0] * nx + m[4] * ny + m[8] * nz;
          normals[k * 3 + 1] = m[1] * nx + m[5] * ny + m[9] * nz;
          normals[k * 3 + 2] = m[2] * nx + m[6] * ny + m[10] * nz;
        }
        meshes.push({ expressID: flat.expressID, positions, normals, index });
      }
      if (Number.isFinite(top)) topById.set(flat.expressID, top);
    });
    if (!meshes.length) throw new Error("IFC에 형상이 없습니다.");

    // 모델 바닥 중심을 원점으로
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const { positions: p } of meshes) for (let k = 0; k < p.length; k++) { const a = k % 3; if (p[k] < min[a]) min[a] = p[k]; if (p[k] > max[a]) max[a] = p[k]; }
    const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
    for (const { positions: p } of meshes) for (let k = 0; k < p.length; k++) p[k] -= off[k % 3];
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    const acc = new Map();
    for (const mesh of meshes) {
      const category = catOf.get(api.GetLineType(model, mesh.expressID));
      if (!category) continue;
      const a = acc.get(mesh.expressID) || { category, volume: 0, surface: 0 };
      if (category === "stair" || category === "plate") {
        a.bounds ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let i = 0; i < mesh.positions.length; i++) {
          const axis = i % 3;
          a.bounds.min[axis] = Math.min(a.bounds.min[axis], mesh.positions[i]);
          a.bounds.max[axis] = Math.max(a.bounds.max[axis], mesh.positions[i]);
        }
      }
      a.volume += Math.abs(meshVolume(mesh.positions, mesh.index));
      a.surface += meshSurface(mesh.positions, mesh.index);
      if (category === "slab" || category === "footing" || category === "part") {
        a.floorFootprint = (a.floorFootprint ?? 0) + horizontalFootprint(mesh.positions, mesh.index);
      }
      acc.set(mesh.expressID, a);
    }
    // 커튼월·계단·지붕처럼 하위 부재(패널·멀리언·계단참·지붕 슬래브)로 나뉜 집합 부재는
    // 하위 형상을 모두 집계할 수 있는 집합 부재만 부모 형상을 제외한다.
    const parts = new Map();
    for (const rid of ids(W.IFCRELAGGREGATES)) {
      const r = api.GetLine(model, rid);
      const parent = r.RelatingObject?.value;
      if (parent != null) parts.set(parent, [...(parts.get(parent) || []), ...(r.RelatedObjects || []).map((o) => o.value)]);
    }
    dropAggregateParents(acc, parts);
    // 파트·철근은 집합 부모(또는 주인 부재)의 층·종류를 따른다
    const parentOf = new Map();
    for (const [parent, children] of parts) for (const child of children) parentOf.set(child, parent);
    for (const [id, a] of acc) if (a.category === "part") {
      const parent = parentOf.get(id);
      a.category = (parent != null && catOf.get(api.GetLineType(model, parent))) || "other";
      if (a.category === "part") a.category = "other";
      if (parent != null && !floorOf.has(id) && floorOf.has(parent)) floorOf.set(id, floorOf.get(parent));
      if (parent != null && !matOf.has(id) && matOf.has(parent)) matOf.set(id, matOf.get(parent));
    }
    const lastBasement = storeys.findLastIndex(story => story.basement);
    const groundFloor = lastBasement >= 0 && storeys[lastBasement + 1]?.ground ? lastBasement + 2 : -1;
    const elements = [...acc].map(([id, a]) => {
      const line = api.GetLine(model, id);
      let category = a.category;
      const pre = line.PredefinedType?.value;
      if (category === "slab" && pre === "BASESLAB") category = "footing";
      if (category === "slab" && pre === "ROOF") category = "roof";
      const w = (Number(line.OverallWidth?.value) || 0) * scale, h = (Number(line.OverallHeight?.value) || 0) * scale;
      const floor = floorOf.get(id);
      const storey = storeys[(floor ?? 0) - 1];
      return {
        expressID: id, globalId: line.GlobalId?.value || "", tag: line.Tag?.value || "", name: line.Name?.value || "",
        category, bounds: a.bounds, predefined: pre || "",
        basement: storey?.basement ?? false,
        basementCap: floor === groundFloor && (category === "slab" || category === "roof"),
        roofLevel: storey?.roof ?? false,
        floor: category === "footing" ? 0 : floor || 1,
        ...(({ volume, source, diff }) => ({ volume, volumeSource: source, meshVolume: a.volume, volumeDiff: diff }))(pickVolume(a.volume, volumes.get(id)?.m3)),
        weightTons: weights.get(id)?.tons,
        area: openingArea(w, h, a.surface), floorFootprint: a.floorFootprint > 0 ? a.floorFootprint : undefined,
        layers: matOf.get(id) || matOf.get(typeOf.get(id)) || [],
      };
    });
    // 층수: 부재가 실제로 들어 있는 층만 센다 (Revit의 기준 레벨·지붕 레벨 제외)
    const used = new Set(elements.filter((e) => e.category !== "footing").map((e) => e.floor));
    const floors = used.size || storeys.length || 1;
    const describe = type => ids(type).map(id => read(id))
      .flatMap(item => [item.Name, item.LongName, item.ObjectType, item.Description]).map(value => value?.value || "").join(" ");
    // Survey exports can have generic building names and carry the scope in the source title.
    let survey = "";
    for (const id of ids(W.IFCPROPERTYSET)) {
      const properties = read(id);
      if (properties.Name?.value !== "Pset_SurveyEvidence") continue;
      const source = (properties.HasProperties ?? []).map(ref => read(ref.value)).find(prop => prop.Name?.value === "Source");
      const title = source?.NominalValue?.value;
      if (typeof title === "string" && title.trim()) {
        survey = title.split(" - ")[0].trim();
        break;
      }
    }
    const buildingUse = ifcBuildingUse(describe(W.IFCBUILDING), describe(W.IFCPROJECT), survey);
    const services = ifcServices({ types: W, read, ids, typeOf, serviceTypes, serviceData, unitDefaults, parentOf, matOf, floorOf, storeys });
    const heightFloorOf = id => {
      if (floorOf.has(id)) return floorOf.get(id);
      const seen = new Set();
      while (id != null && !seen.has(id)) {
        if (floorOf.has(id)) return floorOf.get(id);
        seen.add(id);
        id = parentOf.get(id);
      }
    };
    const groundY = groundLevelY(api, model, W, storeys, unitDefaults.length);
    const aboveHeight_m = ifcAboveGroundHeight(groundY, elements, storeys, heightFloorOf, topById);
    return { meshes, elements, services, size, floors, ...scopeGeometry(elements, size, storeys), ...buildingUse, lengthScale: scale, gross: grossArea(elements, size, floors),
      aboveHeight_m, aboveHeightBasis: aboveHeight_m == null ? null : "ifc-geometry",
      volumeCheck: volumeCheck(elements) };
  } finally {
    api.CloseModel(model);
  }
}
