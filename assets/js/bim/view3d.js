// BIM 모델 3D 보기 (three.js). 평면 좌표 (x, y)를 3D의 (x, z)로, 층 높이를 y로 쓴다.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ASSEMBLIES, MATERIALS, WASTE, TYPES } from "./catalog.js";
import { levelOf, lineLength } from "./scenario.js";

const DECISION = { selective: 0x1baf7a, general: 0xb2aba1, structure: 0x9c9084, selected: 0xe8742a };

function dominantWaste(el, q) {
  const tons = q?.[el.id]?.tons || {};
  let best = null, max = 0;
  for (const [w, t] of Object.entries(tons)) if (t > max && w !== "concrete") { best = w; max = t; }
  if (!best && tons.concrete) best = "concrete";
  if (!best) {
    const asm = ASSEMBLIES[el.assembly];
    const m = asm?.layers?.[0]?.m || asm?.perArea?.[0]?.m;
    best = MATERIALS[m]?.waste || "mixed";
  }
  return best;
}

export function createModel3D(container, { model, q, result, colorBy = "waste", levelId = null, selectedId = null, onPick }) {
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 500;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.02;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.1));
  const sun = new THREE.DirectionalLight(0xffeedd, 1.3);
  sun.position.set(40, 80, 30);
  scene.add(sun);

  const box = new THREE.Box3();
  const meshes = [];
  const matCache = {};
  const mat = (hex, opacity = 1) => {
    const k = hex + ":" + opacity;
    return (matCache[k] ||= new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, transparent: opacity < 1, opacity }));
  };
  const colorOf = (el) => {
    if (el.id === selectedId) return DECISION.selected;
    if (colorBy === "decision") {
      const m = result?.perElement?.[el.id]?.method;
      if (TYPES[el.type].structural && !(ASSEMBLIES[el.assembly]?.work || []).length) return DECISION.structure;
      return m === "selective" ? DECISION.selective : DECISION.general;
    }
    return parseInt(WASTE[dominantWaste(el, q)].color.slice(1), 16);
  };

  const els = model.elements.filter((e) => !levelId || e.levelId === levelId);
  for (const el of els) {
    const lv = levelOf(model, el);
    const base = lv?.elevation || 0;
    const H = Number(el.height) || lv?.height || 2.8;
    const kind = TYPES[el.type]?.kind;
    let mesh = null;
    if (kind === "line" && el.type !== "beam") {
      const len = lineLength(el);
      if (len < 0.01) continue;
      const t = Number(el.thickness) || TYPES[el.type].defaults.thickness;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(len, H, t), mat(colorOf(el), el.type === "partition" ? 0.85 : 1));
      mesh.position.set((el.x1 + el.x2) / 2, base + H / 2, (el.y1 + el.y2) / 2);
      mesh.rotation.y = -Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
    } else if (el.type === "beam") {
      const len = lineLength(el);
      const d = Number(el.depth) || 0.5;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(len, d, Number(el.thickness) || 0.3), mat(colorOf(el)));
      mesh.position.set((el.x1 + el.x2) / 2, base + (lv?.height || 2.8) - d / 2, (el.y1 + el.y2) / 2);
      mesh.rotation.y = -Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
    } else if (kind === "point") {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(el.w, H, el.d), mat(colorOf(el)));
      mesh.position.set(el.x + el.w / 2, base + H / 2, el.y + el.d / 2);
    } else if (kind === "rect") {
      const th = el.type === "slab" ? 0.21 : 0.03;
      const y = el.type === "slab" ? base - th / 2 : el.type === "floorFinish" ? base + th / 2 + 0.01 : base + (lv?.height || 2.8) - 0.15;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(el.w), th, Math.abs(el.d)), mat(colorOf(el), el.type === "ceiling" ? 0.55 : 1));
      mesh.position.set(el.x + el.w / 2, y, el.y + el.d / 2);
    } else if (kind === "opening") {
      const host = model.elements.find((e) => e.id === el.hostId);
      if (!host) continue;
      const len = lineLength(host);
      const ux = (host.x2 - host.x1) / len, uy = (host.y2 - host.y1) / len;
      const cx = host.x1 + ux * len * el.t, cy = host.y1 + uy * len * el.t;
      const t = (Number(host.thickness) || 0.2) + 0.04;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(el.width, el.height, t), mat(colorOf(el), el.type === "window" ? 0.7 : 1));
      mesh.position.set(cx, base + (el.sill || 0) + el.height / 2, cy);
      mesh.rotation.y = -Math.atan2(uy, ux);
    }
    if (!mesh) continue;
    mesh.userData.id = el.id;
    scene.add(mesh);
    meshes.push(mesh);
    box.expandByObject(mesh);
  }

  const size = box.isEmpty() ? new THREE.Vector3(20, 10, 20) : box.getSize(new THREE.Vector3());
  const center = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z, size.y, 10);
  const ground = new THREE.GridHelper(span * 3, 30, 0x55565e, 0x3a3b44);
  ground.position.set(center.x, box.isEmpty() ? 0 : box.min.y - 0.02, center.z);
  scene.add(ground);
  camera.position.set(center.x + span * 1.1, center.y + span * 0.9, center.z + span * 1.3);
  controls.target.copy(center);

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(meshes)[0];
    onPick?.(hit ? hit.object.userData.id : null);
  });

  let raf = 0;
  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  const ro = new ResizeObserver(() => {
    const W = container.clientWidth, Hh = container.clientHeight;
    if (!W || !Hh) return;
    renderer.setSize(W, Hh);
    camera.aspect = W / Hh;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  return {
    view: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
    setView: (v) => { if (v) { camera.position.fromArray(v.position); controls.target.fromArray(v.target); } },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const m of meshes) m.geometry.dispose();
      for (const m of Object.values(matCache)) m.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
