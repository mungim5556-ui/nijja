// 평가·물류·해체 계획 계산 엔진.
// 모든 단가와 규칙 값은 프로토타입용 가정값이며, 화면과 보고서에 "가정"으로 표시한다.

export const MEMBERS = ["슬래브", "보", "벽", "기둥", "기초"];
export const ZONES = ["A", "B", "C", "D"];
export const CONDITIONS = { good: "양호", fair: "보통", poor: "불량" };
export const DAMAGE = {
  crack: "균열",
  spalling: "박리·박락",
  discolor: "변색·백화",
  corrosion: "부식",
  deform: "변형",
};

export const DEFAULT_PRICES = {
  basisDate: "2026-09-01",
  steelReuse: 600000, // 원/t, 재사용 강재 부재 매각
  steelScrap: 380000, // 원/t, 고철 매각
  concreteRecycle: 5000, // 원/t, 순환골재 원료 가치
  concreteRecycleFee: 18000, // 원/t, 순환골재 처리장 반입비
  mixedWasteFee: 45000, // 원/t, 혼합 건설폐기물 처리비
  dismantlePerLevel: 12000, // 원/t × 난이도(1~5)
};

export const DEFAULT_DESTINATIONS = [
  { id: "recycle", name: "순환골재 처리장", distance: 14, angle: 40 },
  { id: "scrap", name: "고철 매입처", distance: 9, angle: 150 },
  { id: "reuseYard", name: "재사용 부재 야적장", distance: 22, angle: 260 },
  { id: "landfill", name: "건설폐기물 처리장", distance: 31, angle: 320 },
];

export const DEFAULT_VEHICLES = [
  { id: "v25", name: "25t 덤프트럭", capacity: 15, count: 2, costPerKm: 2600, baseCost: 90000 },
  { id: "v15", name: "15t 카고트럭", capacity: 9, count: 2, costPerKm: 2000, baseCost: 70000 },
  { id: "v5", name: "5t 카고트럭", capacity: 4, count: 1, costPerKm: 1300, baseCost: 50000 },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------------- 1. 입력 품질 점검 ---------------- */

export function checkInputQuality(state) {
  const issues = [];
  const p = state.project;
  const required = { name: "프로젝트 이름", address: "주소", use: "용도", floors: "지상 층수", year: "건축 연도", demoDate: "해체 예정일" };
  for (const [k, label] of Object.entries(required)) {
    if (!p[k]) issues.push({ level: "error", where: "건물 정보", text: `${label}이(가) 비어 있습니다.` });
  }
  const now = new Date().getFullYear();
  if (p.year && (p.year < 1900 || p.year > now)) issues.push({ level: "error", where: "건물 정보", text: `건축 연도(${p.year})가 올바르지 않습니다.` });
  if (!state.materials.length) issues.push({ level: "error", where: "자재", text: "등록된 자재가 없습니다." });
  if (!state.photos.length) issues.push({ level: "warning", where: "현장 사진", text: "현장 사진이 없습니다. 모든 자재의 신뢰도가 낮아집니다." });
  for (const ph of state.photos) {
    if (ph.quality?.lowRes) issues.push({ level: "warning", where: "현장 사진", text: `${ph.name}: 해상도가 낮습니다 (${ph.quality.w}×${ph.quality.h}).` });
    if (ph.quality?.dark) issues.push({ level: "warning", where: "현장 사진", text: `${ph.name}: 사진이 너무 어둡습니다.` });
  }
  for (const m of state.materials) {
    const miss = [];
    if (!m.spec) miss.push("규격");
    if (!m.qty || m.qty <= 0) miss.push("수량");
    if (!m.floor && m.floor !== 0) miss.push("층");
    if (!m.condition) miss.push("외관 상태");
    if (miss.length) issues.push({ level: miss.includes("수량") ? "error" : "warning", where: `자재 ${m.label}`, text: `${miss.join(", ")} 누락` });
    if (!m.photoId) issues.push({ level: "info", where: `자재 ${m.label}`, text: "연결된 사진이 없어 현장 확인이 필요합니다." });
  }
  const floors = Number(p.floors) || 0;
  for (const m of state.materials) {
    if (m.member !== "기초" && floors && m.floor > floors) issues.push({ level: "error", where: `자재 ${m.label}`, text: `층(${m.floor})이 건물 층수(${floors})보다 큽니다.` });
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const needsSurvey = issues.some((i) => i.level !== "info") || state.materials.some((m) => !m.photoId);
  return { issues, errors, ready: errors === 0, needsSurvey };
}

/* ---------------- 2. 자재 규칙 기반 평가 ---------------- */

export function evaluateMaterial(m, project, prices) {
  const reasons = [];
  let score = 100;
  const age = new Date().getFullYear() - (Number(project.year) || new Date().getFullYear());
  const isSteel = m.type === "steel";

  const agePenalty = isSteel ? clamp((age - 10) * 0.5, 0, 25) : clamp((age - 10) * 0.8, 0, 40);
  if (agePenalty > 0) { score -= agePenalty; reasons.push(`경과 연수 ${age}년 → -${agePenalty.toFixed(0)}점`); }

  const condPenalty = { good: 0, fair: 20, poor: 45 }[m.condition] ?? 20;
  if (condPenalty) { score -= condPenalty; reasons.push(`외관 상태 '${CONDITIONS[m.condition] ?? "미입력"}' → -${condPenalty}점`); }

  const dmgTable = isSteel
    ? { crack: 5, spalling: 5, discolor: 5, corrosion: 25, deform: 30 }
    : { crack: 15, spalling: 20, discolor: 5, corrosion: 10, deform: 25 };
  for (const d of m.damage || []) {
    score -= dmgTable[d];
    reasons.push(`외관 손상 '${DAMAGE[d]}' → -${dmgTable[d]}점`);
  }
  score = clamp(Math.round(score), 0, 100);

  let grade;
  if (score >= 70) grade = "reuse";
  else if (score >= 45) grade = "review";
  else grade = "dispose";

  // 신뢰도
  let conf = 0.9;
  const confNotes = [];
  if (!m.photoId) { conf -= 0.25; confNotes.push("연결된 사진 없음"); }
  if (!m.condition) { conf -= 0.15; confNotes.push("외관 상태 미입력"); }
  if (!m.spec) { conf -= 0.1; confNotes.push("규격 미입력"); }
  if (Number(project.year) && Number(project.year) < 1980) { conf -= 0.1; confNotes.push("1980년 이전 건물(자재 정보 불확실)"); }
  if (m.photoQualityLow) { conf -= 0.1; confNotes.push("사진 품질 낮음"); }
  conf = clamp(conf, 0.1, 0.95);
  const confLevel = conf >= 0.75 ? "high" : conf >= 0.5 ? "mid" : "low";
  if (confLevel === "low" && grade === "reuse") { grade = "review"; reasons.push("신뢰도가 낮아 '검토 필요'로 조정"); }

  // 해체 난이도 (1~5)
  let diff = { 기초: 5, 기둥: 4, 보: 3, 슬래브: 3, 벽: 2 }[m.member] ?? 3;
  const diffNotes = [`부재 '${m.member}' 기본 ${diff}`];
  if (Number(m.floor) >= 6) { diff += 1; diffNotes.push("6층 이상 고소 작업 +1"); }
  if (isSteel && grade === "reuse") { diff += 1; diffNotes.push("재사용을 위한 비파괴 해체 +1"); }
  diff = clamp(diff, 1, 5);

  // 가치·비용 (원)
  const qty = Number(m.qty) || 0;
  let unitValue, unitFee, destination, route;
  if (isSteel) {
    if (grade === "reuse") { unitValue = prices.steelReuse; destination = "reuseYard"; route = "재사용 부재 매각"; }
    else { unitValue = prices.steelScrap; destination = "scrap"; route = "고철 매각"; }
    unitFee = 0;
  } else {
    if (grade === "dispose") { unitValue = 0; unitFee = prices.mixedWasteFee; destination = "landfill"; route = "혼합 건설폐기물 처리"; }
    else { unitValue = prices.concreteRecycle; unitFee = prices.concreteRecycleFee; destination = "recycle"; route = "순환골재 재활용"; }
  }
  const value = qty * unitValue;
  const dismantleCost = qty * diff * prices.dismantlePerLevel;
  const disposalCost = qty * unitFee;

  return {
    score, grade, reasons,
    confidence: conf, confLevel, confNotes,
    difficulty: diff, diffNotes,
    value, dismantleCost, disposalCost, destination, route,
  };
}

export function evaluateAll(state) {
  const prices = state.prices;
  const results = {};
  for (const m of state.materials) {
    const photo = state.photos.find((p) => p.id === m.photoId);
    results[m.id] = evaluateMaterial({ ...m, photoQualityLow: photo?.quality?.lowRes || photo?.quality?.dark }, state.project, prices);
  }
  return results;
}

/* ---------------- 3. 운송 물류 (CVRP, Clarke-Wright savings) ---------------- */

function coords(dest) {
  const a = (dest.angle * Math.PI) / 180;
  return { x: Math.cos(a) * dest.distance, y: Math.sin(a) * dest.distance };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const STREAM = { recycle: "concrete", landfill: "concrete", scrap: "steel", reuseYard: "steel" };
const SITE = { x: 0, y: 0 };

// 목적지별 물량(t). 강재와 콘크리트는 같은 목적지로 가지 않으므로 목적지 단위로 합친다.
export function demandsByDestination(state, evals) {
  const d = {};
  for (const m of state.materials) {
    const e = evals[m.id];
    if (!e) continue;
    d[e.destination] = (d[e.destination] || 0) + (Number(m.qty) || 0);
  }
  return d;
}

// 한 차종으로 모든 물량을 나르는 경로 계산.
// 차량 용량을 꽉 채우는 왕복 운행은 직행으로 처리하고, 남은 물량만 savings 알고리즘으로 묶는다.
export function planRoutes(demands, destinations, vehicle, { combine = true } = {}) {
  const cap = Number(vehicle.capacity) || 1;
  const nodes = destinations.filter((d) => demands[d.id] > 0).map((d) => ({ ...d, p: coords(d), demand: demands[d.id] }));
  const routes = [];

  const remainders = [];
  for (const n of nodes) {
    const full = Math.floor(n.demand / cap);
    for (let i = 0; i < full; i++) routes.push({ stops: [{ id: n.id, name: n.name, load: cap }], km: 2 * n.distance, load: cap });
    const rest = +(n.demand - full * cap).toFixed(2);
    if (rest > 0) remainders.push({ ...n, rest });
  }

  if (combine && remainders.length > 1) {
    let rs = remainders.map((n) => ({ nodes: [n], load: n.rest }));
    const savings = [];
    for (let i = 0; i < remainders.length; i++)
      for (let j = i + 1; j < remainders.length; j++) {
        const a = remainders[i], b = remainders[j];
        savings.push({ a: a.id, b: b.id, s: dist(SITE, a.p) + dist(SITE, b.p) - dist(a.p, b.p) });
      }
    savings.sort((x, y) => y.s - x.s);
    const find = (id) => rs.find((r) => r.nodes.some((n) => n.id === id));
    for (const { a, b, s } of savings) {
      if (s <= 0) continue;
      const ra = find(a), rb = find(b);
      if (ra === rb || ra.load + rb.load > cap) continue;
      // 콘크리트와 강재는 같은 차량에 싣지 않는다
      if (STREAM[ra.nodes[0].id] !== STREAM[rb.nodes[0].id]) continue;
      const aEnd = ra.nodes[0].id === a || ra.nodes[ra.nodes.length - 1].id === a;
      const bEnd = rb.nodes[0].id === b || rb.nodes[rb.nodes.length - 1].id === b;
      if (!aEnd || !bEnd) continue;
      if (ra.nodes[ra.nodes.length - 1].id !== a) ra.nodes.reverse();
      if (rb.nodes[0].id !== b) rb.nodes.reverse();
      ra.nodes.push(...rb.nodes);
      ra.load += rb.load;
      rs = rs.filter((r) => r !== rb);
    }
    for (const r of rs) {
      let km = 0, prev = SITE;
      for (const n of r.nodes) { km += dist(prev, n.p); prev = n.p; }
      km += dist(prev, SITE);
      routes.push({ stops: r.nodes.map((n) => ({ id: n.id, name: n.name, load: n.rest })), km, load: r.load, combined: r.nodes.length > 1 });
    }
  } else {
    for (const n of remainders) routes.push({ stops: [{ id: n.id, name: n.name, load: n.rest }], km: 2 * n.distance, load: n.rest });
  }

  const km = routes.reduce((s, r) => s + r.km, 0);
  const cost = km * vehicle.costPerKm + routes.length * vehicle.baseCost;
  // 하루 8시간, 평균 40km/h, 1회 상하차 0.5시간 기준
  const hoursPerTrip = (r) => r.km / 40 + 0.5 + 0.25 * (r.stops.length - 1);
  const totalHours = routes.reduce((s, r) => s + hoursPerTrip(r), 0);
  const days = Math.ceil(totalHours / (8 * Math.max(1, Number(vehicle.count) || 1)) * 10) / 10;
  const totalLoad = routes.reduce((s, r) => s + r.load, 0);
  const utilization = routes.length ? totalLoad / (routes.length * cap) : 0;
  return { vehicle, routes, km, cost, trips: routes.length, days, utilization };
}

// 기본안(대형 차량, 목적지별 따로 운행) 과 VRP 대안들을 비교
export function compareLogistics(state, evals) {
  const demands = demandsByDestination(state, evals);
  const dests = state.destinations;
  const vehicles = state.vehicles.filter((v) => v.capacity > 0);
  if (!vehicles.length) return { demands, options: [], baseline: null, best: null };
  const baseVehicle = vehicles[0];
  const baseline = { key: "baseline", label: `기본안 · ${baseVehicle.name} 목적지별 개별 운행`, ...planRoutes(demands, dests, baseVehicle, { combine: false }) };
  const options = vehicles.map((v) => ({ key: v.id, label: `VRP · ${v.name}`, ...planRoutes(demands, dests, v) }));

  // 혼합안: 가득 찬 운행은 가장 큰 차량, 남은 물량은 가장 작은 차량으로 묶어서
  if (vehicles.length > 1) {
    const big = [...vehicles].sort((a, b) => b.capacity - a.capacity)[0];
    const small = [...vehicles].sort((a, b) => a.capacity - b.capacity)[0];
    const fullDemands = {}, restDemands = {};
    for (const [k, t] of Object.entries(demands)) {
      const full = Math.floor(t / big.capacity) * big.capacity;
      if (full) fullDemands[k] = full;
      if (t - full > 0) restDemands[k] = +(t - full).toFixed(2);
    }
    const a = planRoutes(fullDemands, dests, big);
    const b = planRoutes(restDemands, dests, small);
    options.push({
      key: "mixed",
      label: `VRP 혼합 · ${big.name} + ${small.name}`,
      vehicle: { name: `${big.name} + ${small.name}` },
      routes: [...a.routes.map((r) => ({ ...r, vehicle: big.name })), ...b.routes.map((r) => ({ ...r, vehicle: small.name }))],
      km: a.km + b.km, cost: a.cost + b.cost, trips: a.trips + b.trips,
      days: Math.max(a.days, b.days),
      utilization: (a.utilization * a.trips + b.utilization * b.trips) / Math.max(1, a.trips + b.trips),
    });
  }
  const best = options.reduce((m, o) => (o.cost < m.cost ? o : m), options[0]);
  return { demands, baseline, options, best, saving: baseline.cost ? 1 - best.cost / baseline.cost : 0 };
}

// 자재별 운송비: 선택된 안의 톤-km 당 비용을 물량·거리 비율로 배분
export function allocateTransport(state, evals, option) {
  const out = {};
  if (!option) return out;
  const dests = Object.fromEntries(state.destinations.map((d) => [d.id, d]));
  let tkm = 0;
  for (const m of state.materials) {
    const e = evals[m.id];
    if (e) tkm += (Number(m.qty) || 0) * (dests[e.destination]?.distance || 0);
  }
  for (const m of state.materials) {
    const e = evals[m.id];
    if (!e) continue;
    const share = tkm ? ((Number(m.qty) || 0) * (dests[e.destination]?.distance || 0)) / tkm : 0;
    out[m.id] = option.cost * share;
  }
  return out;
}

export function economics(state, evals, transport) {
  return state.materials
    .map((m) => {
      const e = evals[m.id];
      const t = transport[m.id] || 0;
      const net = e.value - e.dismantleCost - e.disposalCost - t;
      const qty = Number(m.qty) || 0;
      // 우선 회수 점수: 톤당 순가치를 난이도로 나눈 값
      const priority = qty ? net / qty / e.difficulty : 0;
      return { m, e, transport: t, net, priority };
    })
    .sort((a, b) => b.priority - a.priority);
}

/* ---------------- 4. 해체 순서·공법·장비 ---------------- */

export const METHODS = ["압쇄 공법", "절단 해체", "볼트 해체·크레인 인양", "브레이커 파쇄", "수작업 해체"];
export const EQUIPMENT = [
  "굴삭기 + 압쇄기",
  "롱붐 굴삭기 + 압쇄기",
  "굴삭기 + 절단기(시어)",
  "이동식 크레인 + 가스 절단기",
  "굴삭기 + 브레이커",
  "소형 장비·수공구",
];

function methodFor(m, e, floors) {
  if (m.member === "기초") return { method: "브레이커 파쇄", equipment: "굴삭기 + 브레이커", why: "지하 기초는 파쇄 후 반출" };
  if (m.type === "steel") {
    if (e.grade === "reuse") return { method: "볼트 해체·크레인 인양", equipment: "이동식 크레인 + 가스 절단기", why: "재사용 등급 강재는 손상 없이 분리" };
    return { method: "절단 해체", equipment: "굴삭기 + 절단기(시어)", why: "고철 매각 강재는 절단 후 반출" };
  }
  const high = Number(floors) >= 6;
  return {
    method: "압쇄 공법",
    equipment: high ? "롱붐 굴삭기 + 압쇄기" : "굴삭기 + 압쇄기",
    why: high ? "6층 이상 건물은 롱붐 장비로 상층부터 압쇄" : "저층 콘크리트는 일반 압쇄 장비로 처리",
  };
}

export function generatePlan(state, evals) {
  const floors = Number(state.project.floors) || 1;
  const steps = [{
    id: "prep",
    title: "사전 준비",
    floor: null,
    materialIds: [],
    method: "수작업 해체",
    equipment: "소형 장비·수공구",
    reasons: ["비구조 마감재·설비 철거, 비산 방지막·안전시설 설치", "석면 등 유해물질 사전 조사 결과 확인 필요"],
    warning: false,
  }];
  const order = ["슬래브", "보", "벽", "기둥"];
  const byFloor = {};
  for (const m of state.materials) {
    const key = m.member === "기초" ? "B" : Number(m.floor) || 1;
    (byFloor[key] ||= []).push(m);
  }
  for (let f = floors; f >= 1; f--) {
    const list = byFloor[f];
    if (!list) continue;
    // 같은 층에서는 재사용 강재를 먼저 회수한 뒤, 부재 순서(슬래브→보→벽→기둥)로 진행
    const reuseSteel = list.filter((m) => m.type === "steel" && evals[m.id]?.grade === "reuse");
    const rest = list.filter((m) => !reuseSteel.includes(m));
    if (reuseSteel.length) steps.push(makeStep(`${f}층 재사용 강재 선회수`, f, reuseSteel, evals, floors, ["재사용 가치가 높은 강재를 먼저 분리해 손상을 줄임"]));
    for (const member of order) {
      const group = rest.filter((m) => m.member === member);
      const groupsByMethod = {};
      for (const m of group) {
        const mf = methodFor(m, evals[m.id], floors);
        (groupsByMethod[mf.method] ||= []).push(m);
      }
      for (const g of Object.values(groupsByMethod)) steps.push(makeStep(`${f}층 ${member} 해체`, f, g, evals, floors, [`상부 하중을 먼저 제거하는 위→아래, ${order.join("→")} 순서`]));
    }
  }
  if (byFloor.B) steps.push(makeStep("기초 해체", 0, byFloor.B, evals, floors, ["지상 구조물 철거 후 기초 파쇄"]));
  return steps;
}

function makeStep(title, floor, mats, evals, floors, baseReasons) {
  const first = methodFor(mats[0], evals[mats[0].id], floors);
  const lowConf = mats.filter((m) => evals[m.id]?.confLevel === "low" || evals[m.id]?.grade === "review");
  const reasons = [...baseReasons, first.why];
  if (lowConf.length) reasons.push(`신뢰도 낮음·검토 필요 자재 ${lowConf.length}건 포함`);
  return {
    id: "s" + Math.random().toString(36).slice(2, 9),
    title, floor,
    materialIds: mats.map((m) => m.id),
    zones: [...new Set(mats.map((m) => m.zone))].sort(),
    method: first.method,
    equipment: first.equipment,
    reasons,
    warning: lowConf.length > 0,
  };
}
