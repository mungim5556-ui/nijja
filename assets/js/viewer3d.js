// 부재 단위의 간소화된 3D 블록 모델 (three.js)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = {
  concrete: 0x9c9084,
  steel: 0x4a6fa5,
  reuse: 0x2f7d4f,
  review: 0xd9b23a,
  dispose: 0xb2aba1,
  current: 0xe8742a,
};
const FLOOR_H = 3.5;
const ZONE = { A: [-6, -4], B: [6, -4], C: [-6, 4], D: [6, 4] };

function geometryFor(m, slot) {
  const [cx, cz] = ZONE[m.zone] || ZONE.A;
  const f = Number(m.floor) || 1;
  const top = f * FLOOR_H;
  const off = slot * 0.35;
  switch (m.member) {
    case "슬래브": return { size: [11.6, 0.3, 7.6], pos: [cx, top - 0.15 - off, cz] };
    case "보": return { size: [11, 0.6, 0.45], pos: [cx, top - 0.6, cz + off * 3 - 1.5] };
    case "벽": return { size: [11, FLOOR_H - 0.4, 0.3], pos: [cx, top - FLOOR_H / 2 - 0.2, cz + (cz < 0 ? -3.7 : 3.7) + off] };
    case "기둥": return { multi: [[cx - 5.4, cz - 3.4], [cx + 5.4, cz + 3.4], [cx - 5.4, cz + 3.4], [cx + 5.4, cz - 3.4]].map(([x, z]) => ({ size: [0.7, FLOOR_H - 0.3, 0.7], pos: [x + off, top - FLOOR_H / 2 - 0.15, z] })) };
    case "기초": return { size: [11.8, 1, 7.8], pos: [cx, -0.5 - off, cz] };
    default: return { size: [2, 2, 2], pos: [cx, top - 1, cz] };
  }
}

export function createViewer(container, { materials, evals, steps, floors, onPick, view }) {
  const w = container.clientWidth || 800;
  const h = 520;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 500);
  const height = (Number(floors) || 5) * FLOOR_H;
  camera.position.set(34, height + 16, 38);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, height / 2, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.05;
  if (view) {
    camera.position.fromArray(view.position);
    controls.target.fromArray(view.target);
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
  const sun = new THREE.DirectionalLight(0xffe2c4, 1.4);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x2b2c35, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.01;
  scene.add(ground);
  const grid = new THREE.GridHelper(80, 40, 0x44454e, 0x33343c);
  grid.position.y = -1;
  scene.add(grid);

  // 건물 외곽 (참고용 와이어)
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(24, height, 16)),
    new THREE.LineBasicMaterial({ color: 0x6b6560, transparent: true, opacity: 0.5 })
  );
  shell.position.y = height / 2;
  scene.add(shell);

  // 구역 라벨
  for (const [z, [x, zz]] of Object.entries(ZONE)) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(237,235,231,.9)"; g.font = "700 72px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(z, 64, 64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    s.position.set(x, -0.6, zz + (zz < 0 ? -6 : 6));
    s.scale.set(2.2, 2.2, 1);
    scene.add(s);
  }

  // 자재 블록
  const stepOf = {};
  steps.forEach((s, i) => s.materialIds.forEach((id) => (stepOf[id] = i)));
  const slots = {};
  const meshes = [];
  for (const m of materials) {
    const key = `${m.floor}-${m.zone}-${m.member}`;
    const slot = (slots[key] = (slots[key] ?? -1) + 1);
    const geo = geometryFor(m, slot);
    const parts = geo.multi || [geo];
    for (const p of parts) {
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.concrete, roughness: 0.85, metalness: m.type === "steel" ? 0.4 : 0.05, transparent: true });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.size), mat);
      mesh.position.set(...p.pos);
      mesh.userData = { m, step: stepOf[m.id] ?? -1 };
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x16171b, transparent: true, opacity: 0.35 }));
      mesh.add(edges);
      mesh.userData.edges = edges;
      scene.add(mesh);
      meshes.push(mesh);
    }
  }

  // 장비 위치 표시
  const equip = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 16), new THREE.MeshStandardMaterial({ color: COLORS.current, emissive: 0x9a450a, emissiveIntensity: 0.4 }));
  cone.rotation.x = Math.PI;
  cone.position.y = 1.2;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 40), new THREE.MeshBasicMaterial({ color: COLORS.current, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.95;
  equip.add(cone, ring);
  equip.visible = false;
  scene.add(equip);

  let mode = "grade";
  let current = 0;
  let selected = null;

  function colorFor(m) {
    if (mode === "type") return COLORS[m.type];
    return COLORS[evals[m.id]?.grade] ?? COLORS.dispose;
  }

  function apply() {
    for (const mesh of meshes) {
      const { m, step } = mesh.userData;
      const removed = step >= 0 && step < current;
      const active = step === current;
      mesh.visible = !removed;
      mesh.material.color.setHex(active ? COLORS.current : colorFor(m));
      mesh.material.emissive.setHex(active ? 0x7a3208 : mesh === selected ? 0x333333 : 0x000000);
      mesh.material.opacity = active || current === 0 || step < 0 ? 1 : 0.55;
      mesh.userData.edges.material.color.setHex(mesh === selected ? 0xffffff : 0x16171b);
      mesh.userData.edges.material.opacity = mesh === selected ? 1 : 0.35;
    }
    const s = steps[current];
    const zones = s?.zones || [];
    if (s && zones.length) {
      const [x, z] = ZONE[zones[0]];
      equip.position.set(x * 1.9, 0, z * 2.3);
      equip.visible = true;
    } else equip.visible = false;
  }

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(meshes.filter((m) => m.visible), false)[0];
    selected = hit ? hit.object : null;
    apply();
    onPick?.(selected ? selected.userData.m : null);
  });

  let raf;
  const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();

  const ro = new ResizeObserver(() => {
    const nw = container.clientWidth;
    if (!nw) return;
    renderer.setSize(nw, h);
    camera.aspect = nw / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  apply();
  return {
    setStep(i) { current = i; apply(); },
    setMode(m) { mode = m; apply(); },
    getView() { return { position: camera.position.toArray(), target: controls.target.toArray() }; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
