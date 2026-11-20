// IFC → BIM 편집기 부재(source: "ifc"). 부재마다 재료별 톤·면적·해체 작업을 자동으로 정한다.
// 브라우저(web-ifc CDN)와 Node(npm web-ifc, scripts/batch_ifc.mjs) 양쪽에서 쓴다.
import { MATERIALS, MATERIAL_KEYWORDS, CATEGORY_DEFAULT } from "./catalog.js";
import { workFor } from "./cost.js";

export const WEB_IFC_CDN = "https://cdn.jsdelivr.net/npm/web-ifc@0.0.78/";

// 닫힌 메시 부피 (부호 있는 사면체 합)
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

const KEYWORDS = MATERIAL_KEYWORDS.map(([k, re]) => [k, new RegExp(re, "i")]);
export function classifyMaterial(name, mapping = {}) {
  if (!name) return null;
  if (mapping[name]) return mapping[name];
  for (const [k, re] of KEYWORDS) if (re.test(name)) return k;
  return null;
}

// 창·문 면적당 질량 (kg/㎡) — 편집기 ASSEMBLIES와 같은 가정값
const OPENING = {
  window: (keys) => (keys.includes("aluminum") ? { aluminum: 6, glass: 15 } : { pvcFrame: 9, glass: 20 }),
  door: (keys) => (keys.includes("steel") ? { steel: 45 } : { woodDoor: 18 }),
};
const STRUCTURAL = ["column", "beam", "foundation", "stair"];

// 부재 하나의 재료별 톤. 파일을 다시 읽지 않고 재료 지정(mapping)만 바꿔 다시 계산할 수 있게 순수 함수로 둔다.
// 미분류 층은 부재 기본재료(CATEGORY_DEFAULT: 벽·바닥·지붕·구조 = 철근콘크리트, 천장 = 석고보드)로 채우고 '추정'으로 남긴다.
// 기본재료가 없는 범주(난간·배관·기타)의 미분류 몫만 계산에서 빠진다(unknownVolume).
export function elementMaterials({ category, layers = [], volume = 0, area = 0 }, mapping = {}) {
  const keys = layers.map((l) => classifyMaterial(l.name, mapping));
  const mats = {};
  const estimated = { volume: 0, names: [] };
  let unknownVolume = 0;
  if (category === "window" || category === "door") {
    for (const [m, kg] of Object.entries(OPENING[category](keys.filter(Boolean)))) mats[m] = (area * kg) / 1000;
    return { mats, keys, estimated, unknownVolume };
  }
  const fallback = CATEGORY_DEFAULT[category] || null;
  const parts = layers.length ? layers.map((l, i) => ({ key: keys[i], t: l.t, name: l.name })) : [{ key: null, t: 1, name: "" }];
  const sumT = parts.every((p) => p.t != null && p.t > 0) ? parts.reduce((s, p) => s + p.t, 0) : 0;
  for (const p of parts) {
    const vol = volume * (sumT > 0 ? p.t / sumT : 1 / parts.length);
    let key = p.key;
    if (!key && fallback) {
      key = fallback;
      estimated.volume += vol;
      estimated.names.push(p.name || "(재료 없음)");
    }
    if (key) mats[key] = (mats[key] || 0) + vol * MATERIALS[key].density;
    else unknownVolume += vol;
  }
  return { mats, keys, estimated, unknownVolume };
}

// IFC에서 읽은 모델의 재료 지정을 바꿔 부재별 톤·작업을 다시 계산한다 (새 모델 객체를 돌려준다)
export function applyMapping(model, mapping = {}) {
  const elements = model.elements.map((el) => {
    if (el.source !== "ifc" || !el.layers) return el;
    const r = elementMaterials(el, mapping);
    return { ...el, mats: r.mats, unknownVolume: r.unknownVolume, estimated: r.estimated, work: workFor(el.category, r.mats) };
  });
  return { ...model, elements, materialMap: { ...mapping } };
}

// 분류하지 못한 재료 이름 → 부피(㎥) 합 (지정 표에 쓴다)
export function unknownMaterials(model, mapping = model.materialMap || {}) {
  const out = {};
  for (const el of model.elements) {
    if (el.source !== "ifc" || !el.layers || el.category === "window" || el.category === "door") continue;
    const sumT = el.layers.every((l) => l.t != null && l.t > 0) ? el.layers.reduce((s, l) => s + l.t, 0) : 0;
    el.layers.forEach((l) => {
      if (!l.name || classifyMaterial(l.name, mapping)) return;
      const v = el.volume * (sumT > 0 ? l.t / sumT : 1 / el.layers.length);
      out[l.name] = (out[l.name] || 0) + v;
    });
  }
  return out;
}

function typeTable(W) {
  return [
    [W.IFCWALL, "wall"], [W.IFCWALLSTANDARDCASE, "wall"], [W.IFCCURTAINWALL, "wall"],
    [W.IFCSLAB, "floor"], [W.IFCROOF, "roof"], [W.IFCCOVERING, "covering"],
    [W.IFCCOLUMN, "column"], [W.IFCBEAM, "beam"], [W.IFCMEMBER, "beam"], [W.IFCPLATE, "wall"],
    [W.IFCFOOTING, "foundation"], [W.IFCPILE, "foundation"],
    [W.IFCSTAIR, "stair"], [W.IFCSTAIRFLIGHT, "stair"], [W.IFCRAILING, "railing"],
    [W.IFCWINDOW, "window"], [W.IFCDOOR, "door"],
    [W.IFCFLOWSEGMENT, "mep"], [W.IFCBUILDINGELEMENTPROXY, "other"],
  ].filter(([t]) => t !== undefined);
}

// 재료 연결 → [{name, t}] (t: 층 두께 또는 구성 비율, 없으면 null)
function materialLayers(o, W, depth = 0) {
  if (!o || typeof o !== "object" || depth > 8) return [];
  const T = o.type;
  if (T === W.IFCMATERIAL) return [{ name: o.Name?.value || "", t: null }];
  if (T === W.IFCMATERIALLAYER) return [{ name: o.Material?.Name?.value || "", t: o.LayerThickness?.value ?? null }];
  if (T === W.IFCMATERIALLAYERSET) return (o.MaterialLayers || []).flatMap((l) => materialLayers(l, W, depth + 1));
  if (T === W.IFCMATERIALLAYERSETUSAGE) return materialLayers(o.ForLayerSet, W, depth + 1);
  if (T === W.IFCMATERIALLIST) return (o.Materials || []).flatMap((m) => materialLayers(m, W, depth + 1));
  if (W.IFCMATERIALCONSTITUENTSET && T === W.IFCMATERIALCONSTITUENTSET) return (o.MaterialConstituents || []).flatMap((c) => materialLayers(c, W, depth + 1));
  if (W.IFCMATERIALCONSTITUENT && T === W.IFCMATERIALCONSTITUENT) return materialLayers(o.Material, W, depth + 1).map((m) => ({ ...m, t: o.Fraction?.value ?? null }));
  if (W.IFCMATERIALPROFILESETUSAGE && T === W.IFCMATERIALPROFILESETUSAGE) return materialLayers(o.ForProfileSet, W, depth + 1);
  if (W.IFCMATERIALPROFILESET && T === W.IFCMATERIALPROFILESET) return (o.MaterialProfiles || []).flatMap((p) => materialLayers(p.Material, W, depth + 1));
  for (const v of Object.values(o)) {
    const r = Array.isArray(v) ? v.flatMap((x) => materialLayers(x, W, depth + 1)) : materialLayers(v, W, depth + 1);
    if (r.length) return r;
  }
  return [];
}

function lengthScale(api, model, W) {
  const ids = api.GetLineIDsWithType(model, W.IFCSIUNIT);
  for (let i = 0; i < ids.size(); i++) {
    const u = api.GetLine(model, ids.get(i));
    if (u.UnitType?.value !== "LENGTHUNIT") continue;
    return { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[u.Prefix?.value] || 1;
  }
  const cb = api.GetLineIDsWithType(model, W.IFCCONVERSIONBASEDUNIT);
  for (let i = 0; i < cb.size(); i++) {
    const u = api.GetLine(model, cb.get(i));
    if (u.UnitType?.value === "LENGTHUNIT" && /foot|feet/i.test(u.Name?.value || "")) return 0.3048;
  }
  return 1;
}

const ids = (api, model, t) => { const v = api.GetLineIDsWithType(model, t); return Array.from({ length: v.size() }, (_, i) => v.get(i)); };

// api: 초기화된 web-ifc IfcAPI, W: web-ifc 모듈. 반환: { model(편집기 모델), meshes, unknown, stats }
export function extractModel(api, W, modelID, { name = "IFC 모델", mapping = {}, use = "주거 공동주택", keepMeshes = true } = {}) {
  const scale = lengthScale(api, modelID, W);
  const TYPES = new Map(typeTable(W));

  // 층
  const storeys = ids(api, modelID, W.IFCBUILDINGSTOREY)
    .map((id) => { const s = api.GetLine(modelID, id); return { id, name: s.Name?.value || `층 ${id}`, elev: (s.Elevation?.value ?? 0) * scale }; })
    .sort((a, b) => a.elev - b.elev);
  const levelOfStorey = new Map(storeys.map((s, i) => [s.id, `L${i + 1}`]));
  const levelOf = new Map();
  for (const rid of ids(api, modelID, W.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const r = api.GetLine(modelID, rid);
    const lv = levelOfStorey.get(r.RelatingStructure?.value);
    if (lv) for (const e of r.RelatedElements || []) levelOf.set(e.value, lv);
  }
  // 재료
  const matOf = new Map();
  for (const rid of ids(api, modelID, W.IFCRELASSOCIATESMATERIAL)) {
    const r = api.GetLine(modelID, rid);
    const layers = materialLayers(api.GetLine(modelID, r.RelatingMaterial.value, true), W);
    for (const o of r.RelatedObjects || []) matOf.set(o.value, layers);
  }
  // 속성: Pset_ReClaim + 기본 물량(Qto_*)
  const props = new Map();
  for (const rid of ids(api, modelID, W.IFCRELDEFINESBYPROPERTIES)) {
    const r = api.GetLine(modelID, rid);
    const def = api.GetLine(modelID, r.RelatingPropertyDefinition.value, true);
    const pname = def?.Name?.value || "";
    const bag = {};
    if (/^Pset_ReClaim$/i.test(pname)) {
      for (const p of def.HasProperties || []) bag[p.Name?.value] = p.NominalValue?.value;
    } else if (/^Qto_/i.test(pname)) {
      for (const q of def.Quantities || []) {
        const v = q.AreaValue?.value ?? q.LengthValue?.value ?? q.VolumeValue?.value;
        if (v !== undefined) bag["qto:" + q.Name?.value] = v;
      }
    } else continue;
    for (const o of r.RelatedObjects || []) props.set(o.value, { ...(props.get(o.value) || {}), ...bag });
  }

  // 형상: 부재별 부피·외곽
  const acc = new Map();
  const meshes = [];
  api.StreamAllMeshes(modelID, (flat) => {
    if (!TYPES.has(api.GetLineType(modelID, flat.expressID))) return;
    for (let i = 0; i < flat.geometries.size(); i++) {
      const pg = flat.geometries.get(i);
      const g = api.GetGeometry(modelID, pg.geometryExpressID);
      const vd = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const index = Uint32Array.from(api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize()));
      g.delete();
      const m = pg.flatTransformation;
      const n = vd.length / 6;
      const positions = new Float32Array(n * 3);
      const a = acc.get(flat.expressID) || { vol: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let k = 0; k < n; k++) {
        const x = vd[k * 6], y = vd[k * 6 + 1], z = vd[k * 6 + 2];
        const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        positions.set(p, k * 3);
        for (let j = 0; j < 3; j++) { if (p[j] < a.min[j]) a.min[j] = p[j]; if (p[j] > a.max[j]) a.max[j] = p[j]; }
      }
      a.vol += Math.abs(meshVolume(positions, index));
      acc.set(flat.expressID, a);
      if (keepMeshes) meshes.push({ expressID: flat.expressID, positions, index });
    }
  });

  const elements = [];
  let gfa = 0;
  for (const [eid, a] of acc) {
    const line = api.GetLine(modelID, eid);
    let category = TYPES.get(api.GetLineType(modelID, eid));
    const ifcType = category === "floor" ? "floor-slab" : category;
    const pre = line.PredefinedType?.value;
    if (category === "covering") category = pre === "CEILING" ? "ceiling" : pre === "FLOORING" ? "floor" : "wall";
    if (category === "floor" && pre === "BASESLAB") category = "foundation";
    if (category === "floor" && pre === "ROOF") category = "roof";
    const pr = props.get(eid) || {};
    const layers = matOf.get(eid) || [];
    const dims = [0, 1, 2].map((j) => a.max[j] - a.min[j]); // x, y(높이), z

    // 면적
    let area = 0;
    if (category === "window" || category === "door") {
      const w = (line.OverallWidth?.value || 0) * scale, h = (line.OverallHeight?.value || 0) * scale;
      area = pr["qto:Area"] || (w && h ? w * h : Math.max(dims[0], dims[2]) * dims[1]);
    } else if (!STRUCTURAL.includes(category)) {
      const qto = pr["qto:NetSideArea"] || pr["qto:GrossSideArea"] || pr["qto:NetArea"] || pr["qto:GrossArea"];
      const thick = layers.every((l) => l.t != null) && layers.length ? layers.reduce((s, l) => s + l.t, 0) * scale : 0;
      area = qto || (thick > 0 ? a.vol / thick : category === "wall" ? Math.max(dims[0], dims[2]) * dims[1] : dims[0] * dims[2]);
    }

    // 재료별 톤 (미분류 층은 부재 기본재료로 채운다 — elementMaterials)
    const layerList = layers.map((l) => ({ name: l.name, t: l.t }));
    const { mats, estimated, unknownVolume } = elementMaterials({ category, layers: layerList, volume: a.vol, area }, mapping);
    // 연면적: 바닥 슬래브(마감 IfcCovering 제외)의 면적. 재료 분류와 무관하게 정해진다
    const isSlab = ifcType === "floor-slab";
    if (category === "floor" && isSlab) gfa += area;
    const hz = String(pr.Hazard || "");
    elements.push({
      id: `ifc${eid}`, source: "ifc", expressID: eid,
      ifcGuid: line.GlobalId?.value || "", revitId: /^\d+$/.test(line.Tag?.value || "") ? Number(line.Tag.value) : null,
      name: line.Name?.value || "", ifcType: api.GetNameFromTypeCode ? api.GetNameFromTypeCode(api.GetLineType(modelID, eid)) : "",
      category, levelId: levelOf.get(eid) || "L1", area, volume: a.vol, mats,
      layers: layerList, materialNames: layers.map((l) => l.name), unknownVolume, estimated, slab: isSlab || undefined,
      work: workFor(category, mats),
      separable: Number(pr.Separable) || (STRUCTURAL.includes(category) ? 2 : 5),
      hazard: /확인|confirmed/i.test(hz) ? "confirmed" : /의심|suspected/i.test(hz) ? "suspected" : "none",
    });
  }
  const levels = storeys.length
    ? storeys.map((s, i) => ({ id: `L${i + 1}`, name: s.name, elevation: Math.round(s.elev * 100) / 100, height: Math.round(((storeys[i + 1]?.elev ?? s.elev + 3) - s.elev) * 100) / 100 || 3 }))
    : [{ id: "L1", name: "1층", elevation: 0, height: 3 }];
  const model = { version: 1, name, use, levels, elements, params: {}, gfa: Math.round(gfa) || undefined, source: "ifc", materialMap: { ...mapping } };
  const unknown = unknownMaterials(model, mapping);
  return {
    model, meshes, unknown,
    stats: { elements: elements.length, unknownMaterials: Object.keys(unknown).length, lengthScale: scale },
  };
}

// 브라우저: ArrayBuffer → 결과
export async function importIfcBuffer(buffer, opts = {}) {
  const W = await import(WEB_IFC_CDN + "web-ifc-api.js");
  const api = new W.IfcAPI();
  api.SetWasmPath(WEB_IFC_CDN, true);
  await api.Init(undefined, true);
  const id = api.OpenModel(new Uint8Array(buffer));
  try { return extractModel(api, W, id, opts); } finally { api.CloseModel(id); }
}
