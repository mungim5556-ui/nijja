// IFC → BIM 편집기 부재(source: "ifc"). 부재마다 재료별 톤·면적·해체 작업을 자동으로 정한다.
// 브라우저(web-ifc CDN)와 Node(npm web-ifc, scripts/batch_ifc.mjs) 양쪽에서 쓴다.
import { MATERIALS, MATERIAL_KEYWORDS } from "./catalog.js";
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

  const unknown = {};
  const elements = [];
  let gfa = 0;
  for (const [eid, a] of acc) {
    const line = api.GetLine(modelID, eid);
    let category = TYPES.get(api.GetLineType(modelID, eid));
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

    // 재료별 톤
    const mats = {};
    let unknownVolume = 0;
    const keys = layers.map((l) => classifyMaterial(l.name, mapping));
    layers.forEach((l, i) => { if (!keys[i] && l.name) unknown[l.name] = (unknown[l.name] || 0) + 1; });
    if (category === "window" || category === "door") {
      for (const [m, kg] of Object.entries(OPENING[category](keys.filter(Boolean)))) mats[m] = (area * kg) / 1000;
    } else {
      // 몫은 모든 층(미분류 포함) 기준으로 나누고, 미분류 층의 몫은 빼 둔다(unknownVolume)
      const fallback = ["wall", "floor", "roof", ...STRUCTURAL].includes(category) ? "rc" : null;
      const all = layers.length ? layers.map((l, i) => ({ key: keys[i], t: l.t })) : fallback ? [{ key: fallback, t: 1 }] : [];
      const sumT = all.length && all.every((p) => p.t != null) ? all.reduce((s, p) => s + p.t, 0) : 0;
      for (const p of all) {
        const share = sumT > 0 ? p.t / sumT : 1 / all.length;
        if (p.key) mats[p.key] = (mats[p.key] || 0) + a.vol * share * MATERIALS[p.key].density;
        else unknownVolume += a.vol * share;
      }
      if (all.length && all.every((p) => !p.key) && fallback) mats[fallback] = a.vol * MATERIALS[fallback].density;
    }
    if (category === "floor" && (mats.rc || 0) > 0) gfa += area;
    const hz = String(pr.Hazard || "");
    elements.push({
      id: `ifc${eid}`, source: "ifc", expressID: eid,
      ifcGuid: line.GlobalId?.value || "", revitId: /^\d+$/.test(line.Tag?.value || "") ? Number(line.Tag.value) : null,
      name: line.Name?.value || "", ifcType: api.GetNameFromTypeCode ? api.GetNameFromTypeCode(api.GetLineType(modelID, eid)) : "",
      category, levelId: levelOf.get(eid) || "L1", area, volume: a.vol, mats,
      materialNames: layers.map((l) => l.name), unknownVolume,
      work: workFor(category, mats),
      separable: Number(pr.Separable) || (STRUCTURAL.includes(category) ? 2 : 5),
      hazard: /확인|confirmed/i.test(hz) ? "confirmed" : /의심|suspected/i.test(hz) ? "suspected" : "none",
    });
  }
  const levels = storeys.length
    ? storeys.map((s, i) => ({ id: `L${i + 1}`, name: s.name, elevation: Math.round(s.elev * 100) / 100, height: Math.round(((storeys[i + 1]?.elev ?? s.elev + 3) - s.elev) * 100) / 100 || 3 }))
    : [{ id: "L1", name: "1층", elevation: 0, height: 3 }];
  return {
    model: { version: 1, name, use, levels, elements, params: {}, gfa: Math.round(gfa) || undefined, source: "ifc" },
    meshes, unknown,
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
