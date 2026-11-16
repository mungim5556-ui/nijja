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

// IFC 종류 → 앱의 부재 분류
const CATEGORY = {
  IFCWALL: "wall", IFCWALLSTANDARDCASE: "wall", IFCSLAB: "slab", IFCBEAM: "beam", IFCCOLUMN: "column",
  IFCFOOTING: "footing", IFCPILE: "footing", IFCSTAIR: "stair", IFCSTAIRFLIGHT: "stair", IFCRAMP: "stair", IFCROOF: "roof",
  IFCWINDOW: "window", IFCDOOR: "door", IFCCURTAINWALL: "window", IFCCOVERING: "covering", IFCRAILING: "railing",
  IFCPLATE: "plate", IFCMEMBER: "plate", IFCFLOWSEGMENT: "pipe", IFCFLOWFITTING: "pipe", IFCPIPESEGMENT: "pipe",
  IFCPIPEFITTING: "pipe", IFCDUCTSEGMENT: "pipe", IFCDUCTFITTING: "pipe", IFCBUILDINGELEMENTPROXY: "other",
};

// 재료 연결에서 층 목록을 뽑는다. 두께가 있으면 [{name, thickness}], 없으면 이름만.
function materialLayers(o, W, out = [], depth = 0) {
  if (!o || typeof o !== "object" || depth > 7) return out;
  if (o.type === W.IFCMATERIALLAYER) {
    out.push({ name: o.Material?.Name?.value || "", thickness: Number(o.LayerThickness?.value) || 0 });
    return out;
  }
  if (o.type === W.IFCMATERIAL) { out.push({ name: o.Name?.value || "", thickness: 0 }); return out; }
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach((x) => materialLayers(x, W, out, depth + 1));
    else materialLayers(v, W, out, depth + 1);
  }
  return out;
}

export async function parseIfc(buffer) {
  const W = await import(CDN + "web-ifc-api.js");
  const api = new W.IfcAPI();
  api.SetWasmPath(CDN, true);
  await api.Init(undefined, true);
  const model = api.OpenModel(new Uint8Array(buffer));
  try {
    const catOf = new Map(Object.entries(CATEGORY).filter(([k]) => W[k] != null).map(([k, c]) => [W[k], c]));
    const ids = (t) => { const v = api.GetLineIDsWithType(model, t); return Array.from({ length: v.size() }, (_, i) => v.get(i)); };

    // 층: 높이순으로 1, 2, 3…
    const storeys = ids(W.IFCBUILDINGSTOREY)
      .map((id) => ({ id, elev: api.GetLine(model, id).Elevation?.value ?? 0 }))
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
      const layers = materialLayers(api.GetLine(model, r.RelatingMaterial.value, true), W).filter((l) => l.name);
      for (const o of r.RelatedObjects || []) matOf.set(o.value, layers);
    }
    const typeOf = new Map();
    for (const rid of ids(W.IFCRELDEFINESBYTYPE)) {
      const r = api.GetLine(model, rid);
      for (const o of r.RelatedObjects || []) typeOf.set(o.value, r.RelatingType?.value);
    }

    // 형상: 배치 행렬을 적용한 월드 좌표 (web-ifc 출력은 Y-up, m 단위)
    const meshes = [];
    api.StreamAllMeshes(model, (flat) => {
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
          positions[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          positions[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          normals[k * 3] = m[0] * nx + m[4] * ny + m[8] * nz;
          normals[k * 3 + 1] = m[1] * nx + m[5] * ny + m[9] * nz;
          normals[k * 3 + 2] = m[2] * nx + m[6] * ny + m[10] * nz;
        }
        meshes.push({ expressID: flat.expressID, positions, normals, index });
      }
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
      a.volume += Math.abs(meshVolume(mesh.positions, mesh.index));
      a.surface += meshSurface(mesh.positions, mesh.index);
      acc.set(mesh.expressID, a);
    }
    const elements = [...acc].map(([id, a]) => {
      const line = api.GetLine(model, id);
      let category = a.category;
      const pre = line.PredefinedType?.value;
      if (category === "slab" && pre === "BASESLAB") category = "footing";
      if (category === "slab" && pre === "ROOF") category = "roof";
      const w = Number(line.OverallWidth?.value) || 0, h = Number(line.OverallHeight?.value) || 0;
      return {
        expressID: id, globalId: line.GlobalId?.value || "", tag: line.Tag?.value || "", name: line.Name?.value || "",
        category, predefined: pre || "",
        floor: category === "footing" ? 0 : floorOf.get(id) || 1,
        volume: a.volume,
        area: w && h ? w * h : a.surface / 2,
        layers: matOf.get(id) || matOf.get(typeOf.get(id)) || [],
      };
    });
    return { meshes, elements, size, floors: storeys.length || 1 };
  } finally {
    api.CloseModel(model);
  }
}
