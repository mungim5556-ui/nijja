// 예시 프로젝트: 1994년 준공 5층 철근콘크리트 상가 (옥탑·일부 층 철골 보강)
import { DEFAULT_PRICES, DEFAULT_DESTINATIONS, DEFAULT_VEHICLES } from "./engine.js";

// 실제 현장 사진 대신 쓰는 합성 이미지 (콘크리트/강재 질감)
function fakePhoto(label, kind, { crack = false, rust = false } = {}) {
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 900;
  const g = c.getContext("2d");
  const base = kind === "steel" ? ["#5E6B7A", "#3F4A57"] : ["#B2ABA1", "#8A8177"];
  const grd = g.createLinearGradient(0, 0, 1200, 900);
  grd.addColorStop(0, base[0]); grd.addColorStop(1, base[1]);
  g.fillStyle = grd; g.fillRect(0, 0, 1200, 900);
  let seed = label.length * 97;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(${rnd() > .5 ? 255 : 0},${rnd() > .5 ? 255 : 0},${rnd() > .5 ? 255 : 0},0.05)`;
    g.fillRect(rnd() * 1200, rnd() * 900, 2 + rnd() * 6, 2 + rnd() * 6);
  }
  if (kind === "steel") {
    g.fillStyle = "#2E3640"; g.fillRect(0, 380, 1200, 60); g.fillRect(0, 560, 1200, 60); g.fillRect(560, 380, 30, 240);
  }
  if (rust) {
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(156,57,1,${0.15 + rnd() * 0.3})`;
      g.beginPath(); g.arc(200 + rnd() * 800, 350 + rnd() * 300, 10 + rnd() * 50, 0, Math.PI * 2); g.fill();
    }
  }
  if (crack) {
    g.strokeStyle = "rgba(30,25,20,.85)"; g.lineWidth = 4;
    for (let k = 0; k < 3; k++) {
      g.beginPath(); let x = 200 + rnd() * 800, y = 80;
      g.moveTo(x, y);
      while (y < 860) { x += (rnd() - 0.5) * 70; y += 30 + rnd() * 30; g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.fillStyle = "rgba(22,23,27,.7)"; g.fillRect(0, 820, 1200, 80);
  g.fillStyle = "#fff"; g.font = "600 34px sans-serif"; g.fillText(`예시 사진 · ${label}`, 32, 872);
  return c.toDataURL("image/jpeg", 0.6);
}

export function demoState() {
  const photos = [
    { id: "p1", name: "5F_슬래브_남측.jpg", kind: "concrete", crack: true },
    { id: "p2", name: "5F_옥탑_철골보.jpg", kind: "steel" },
    { id: "p3", name: "5F_철골기둥_부식.jpg", kind: "steel", rust: true },
    { id: "p4", name: "4F_벽체_균열.jpg", kind: "concrete", crack: true },
    { id: "p5", name: "3F_기둥.jpg", kind: "concrete" },
    { id: "p6", name: "1F_벽체_박락.jpg", kind: "concrete", crack: true },
    { id: "p7", name: "1F_철골기둥.jpg", kind: "steel", rust: true },
  ].map((p) => ({
    id: p.id, name: p.name,
    dataUrl: fakePhoto(p.name.replace(".jpg", ""), p.kind, p),
    quality: { w: 1200, h: 900, lowRes: false, dark: false, brightness: 0.55 },
  }));

  const M = (id, type, member, spec, floor, zone, qty, condition, damage, photoId, note = "") =>
    ({ id, label: `M-${String(id).padStart(2, "0")}`, type, member, spec, floor, zone, qty, condition, damage, photoId, note });

  const materials = [
    M(1, "concrete", "슬래브", "RC t=150, 24MPa", 5, "A", 38, "fair", ["crack"], "p1"),
    M(2, "concrete", "슬래브", "RC t=150, 24MPa", 5, "B", 36, "good", [], "p1"),
    M(3, "steel", "보", "H-400×200×8×13 (SS275)", 5, "A", 4.2, "good", [], "p2", "옥탑 증축부"),
    M(4, "steel", "기둥", "H-300×300×10×15 (SS275)", 5, "C", 3.1, "fair", ["corrosion"], "p3", "옥탑 증축부"),
    M(5, "concrete", "슬래브", "RC t=150, 24MPa", 4, "C", 40, "fair", [], "p1"),
    M(6, "concrete", "벽", "RC t=200", 4, "D", 22, "poor", ["crack", "spalling"], "p4"),
    M(7, "concrete", "기둥", "RC 600×600", 3, "A", 18, "good", [], "p5"),
    M(8, "steel", "보", "H-350×175×7×11 (SS275)", 3, "B", 2.6, "good", [], null, "리모델링 보강 보"),
    M(9, "concrete", "슬래브", "RC t=180", 2, "A", 42, "fair", ["discolor"], null),
    M(10, "concrete", "기둥", "RC 700×700", 1, "B", 26, "good", [], "p5"),
    M(11, "concrete", "벽", "RC t=250", 1, "C", 24, "poor", ["crack", "spalling"], "p6"),
    M(12, "steel", "기둥", "H-300×300×10×15 (SS275)", 1, "D", 3.4, "poor", ["corrosion", "deform"], "p7", "필로티 보강 기둥"),
    M(13, "concrete", "기초", "매트 기초 t=800", 0, "A", 120, "fair", [], null),
  ];

  return {
    version: 1,
    project: {
      name: "성수동 근린생활시설 해체",
      address: "서울특별시 성동구 성수이로 00",
      use: "근린생활시설(상가)",
      structure: "철근콘크리트조 (일부 철골 보강)",
      floors: 5,
      area: 1850,
      year: 1994,
      demoDate: "2026-12-01",
    },
    photos,
    materials,
    prices: { ...DEFAULT_PRICES },
    destinations: DEFAULT_DESTINATIONS.map((d) => ({ ...d })),
    vehicles: DEFAULT_VEHICLES.map((v) => ({ ...v })),
    logistics: { selected: null },
    plan: null,
    review: {
      status: "draft",
      history: [{ at: new Date().toISOString(), role: "해체계획 담당자", action: "프로젝트 생성", text: "예시 데이터로 프로젝트를 만들었습니다." }],
    },
  };
}
