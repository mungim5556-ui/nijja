// IFC 형상을 색으로 구분해 보여주는 3D 화면 (three.js). 부재를 누르면 onPick(expressID)를 부른다.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createViewer(container, model, colorOf, onPick) {
  const w = container.clientWidth || 800, h = 440;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const [W, H, D] = model.size;
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 2000);
  const d = Math.max(H * 1.4, Math.max(W, D) * 1.1);
  camera.position.set(d, H * 0.9 + d * 0.35, d * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, H / 2, 0);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(30, 50, 20);
  scene.add(sun);
  const grid = new THREE.GridHelper(Math.ceil(Math.max(W, D) * 2), 20, 0x8a8f99, 0x8a8f99);
  grid.material.transparent = true; grid.material.opacity = 0.25;
  scene.add(grid);

  const meshes = [];
  for (const m of model.meshes) {
    const c = colorOf(m.expressID); // 색, 또는 [색, 불투명도]
    if (c == null) continue;
    const [color, opacity] = Array.isArray(c) ? c : [c, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity === 1 }));
    mesh.userData.expressID = m.expressID;
    scene.add(mesh);
    meshes.push(mesh);
  }

  const ray = new THREE.Raycaster(), pt = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || !onPick) return; // 끌어서 돌린 것은 선택이 아니다
    const r = renderer.domElement.getBoundingClientRect();
    pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pt, camera);
    const hit = ray.intersectObjects(meshes)[0];
    onPick(hit ? hit.object.userData.expressID : null);
  });

  let alive = true;
  (function tick() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();

  return {
    dispose() {
      alive = false;
      for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
