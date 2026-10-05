// Revit 등에서 내보낸 IFC를 읽어 3D 메시와 평가용 부재 목록을 만든다 (web-ifc)
const CDN = "https://cdn.jsdelivr.net/npm/web-ifc@0.0.78/";
const DENSITY = { concrete: 2.4, steel: 7.85 }; // t/m³

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

// ponytail: 재료 이름 키워드로 분류. 오분류가 잦으면 Revit 재료의 Class 속성을 읽도록 바꾼다
const isSteel = (name) => /steel|강재|철골|\bSS\d|\bSM\d|SHN|H-?beam/i.test(name);

// 재료 연결(단일 재료·레이어셋·목록 등)에서 첫 IfcMaterial 이름 — 복합벽은 주 재료 하나로 본다
function materialName(o, W, depth = 0) {
  if (!o || typeof o !== "object" || depth > 6) return "";
  if (o.type === W.IFCMATERIAL) return o.Name?.value || "";
  for (const v of Object.values(o)) {
    const n = Array.isArray(v) ? v.map((x) => materialName(x, W, depth + 1)).find(Boolean) : materialName(v, W, depth + 1);
    if (n) return n;
  }
  return "";
}

export async function parseIfc(buffer) {
  const W = await import(CDN + "web-ifc-api.js");
  const api = new W.IfcAPI();
  api.SetWasmPath(CDN, true);
  await api.Init(undefined, true);
  const model = api.OpenModel(new Uint8Array(buffer));
  try {
    const MEMBER = {
      [W.IFCWALL]: "벽", [W.IFCWALLSTANDARDCASE]: "벽", [W.IFCSLAB]: "슬래브",
      [W.IFCBEAM]: "보", [W.IFCCOLUMN]: "기둥", [W.IFCFOOTING]: "기초", [W.IFCPILE]: "기초",
    };
    const ids = (t) => { const v = api.GetLineIDsWithType(model, t); return Array.from({ length: v.size() }, (_, i) => v.get(i)); };

    // 층: 높이순으로 1, 2, 3… — ponytail: 지하층도 1층부터 매긴다. 앱에 지하 개념이 생기면 나눈다
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
    const matOf = new Map();
    for (const rid of ids(W.IFCRELASSOCIATESMATERIAL)) {
      const r = api.GetLine(model, rid);
      const name = materialName(api.GetLine(model, r.RelatingMaterial.value, true), W);
      for (const o of r.RelatedObjects || []) matOf.set(o.value, name);
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
        meshes.push({ expressID: flat.expressID, positions, normals, index, color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w] });
      }
    });
    if (!meshes.length) throw new Error("IFC에 형상이 없습니다.");

    // 모델 바닥 중심을 원점으로
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const { positions: p } of meshes) for (let k = 0; k < p.length; k++) { const a = k % 3; if (p[k] < min[a]) min[a] = p[k]; if (p[k] > max[a]) max[a] = p[k]; }
    const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
    for (const { positions: p } of meshes) for (let k = 0; k < p.length; k++) p[k] -= off[k % 3];
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    // 평가 대상 부재: 부피 합산, 중심 위치로 구역(A 좌상·B 우상·C 좌하·D 우하) 판정
    const acc = new Map();
    for (const mesh of meshes) {
      const type = api.GetLineType(model, mesh.expressID);
      if (!MEMBER[type]) continue;
      const a = acc.get(mesh.expressID) || { type, vol: 0, sx: 0, sz: 0, n: 0 };
      a.vol += Math.abs(meshVolume(mesh.positions, mesh.index));
      for (let k = 0; k < mesh.positions.length; k += 3) { a.sx += mesh.positions[k]; a.sz += mesh.positions[k + 2]; a.n++; }
      acc.set(mesh.expressID, a);
    }
    const elements = [...acc].map(([id, a]) => {
      let member = MEMBER[a.type];
      if (a.type === W.IFCSLAB && api.GetLine(model, id).PredefinedType?.value === "BASESLAB") member = "기초";
      const spec = matOf.get(id) || "";
      const kind = isSteel(spec) ? "steel" : "concrete";
      const cx = a.sx / a.n, cz = a.sz / a.n;
      return {
        expressID: id, member, type: kind, spec,
        floor: member === "기초" ? 0 : floorOf.get(id) || 1,
        zone: cz < 0 ? (cx < 0 ? "A" : "B") : (cx < 0 ? "C" : "D"),
        qty: a.vol * DENSITY[kind],
      };
    });
    return { meshes, elements, size, floors: storeys.length };
  } finally {
    api.CloseModel(model);
  }
}

// 셀프체크: 단위 정육면체 부피 = 1
{
  const p = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
  const i = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  console.assert(Math.abs(Math.abs(meshVolume(p, i)) - 1) < 1e-9, "meshVolume self-check failed");
}
