import {
  MEMBERS, ZONES, CONDITIONS, DAMAGE, METHODS, EQUIPMENT,
  DEFAULT_PRICES, DEFAULT_DESTINATIONS, DEFAULT_VEHICLES,
  checkInputQuality, evaluateAll, compareLogistics, allocateTransport, economics, generatePlan,
} from "./engine.js";

const STORE_KEY = "reclaim.project.v1";
const THEME_KEY = "reclaim.theme";
const ROLES = ["해체계획 담당자", "해체업체 관리자", "구조·건설 기술자", "공공기관 검토자", "건물 소유자", "승인권자", "시스템 관리자"];
const REVIEWER_ROLES = ["구조·건설 기술자", "공공기관 검토자", "승인권자"];
const STEPS = [
  { key: "building", label: "건물 정보", icon: "building" },
  { key: "materials", label: "현장 사진·자재", icon: "camera" },
  { key: "evaluate", label: "자재 평가", icon: "recycle" },
  { key: "logistics", label: "경제성·운송", icon: "truck" },
  { key: "plan", label: "해체 계획·3D", icon: "box" },
  { key: "review", label: "검토·보고서", icon: "shield" },
];
const STATUS = {
  draft: { label: "초안", cls: "badge-neutral" },
  review: { label: "검토 중", cls: "badge-info" },
  changes: { label: "수정 요청", cls: "badge-warning" },
  approved: { label: "승인", cls: "badge-success" },
  rejected: { label: "반려", cls: "badge-danger" },
};
const GRADE = {
  reuse: { label: "재사용 가능", cls: "badge-success", color: "var(--state-reuse)" },
  review: { label: "검토 필요", cls: "badge-warning", color: "var(--state-review)" },
  dispose: { label: "폐기·재활용", cls: "badge-danger", color: "var(--state-dispose)" },
};
const CONF = { high: ["높음", "badge-success"], mid: ["보통", "badge-neutral"], low: ["낮음", "badge-warning"] };
const TYPE_LABEL = { concrete: "콘크리트·골재", steel: "구조용 강재" };

/* ---------------- state ---------------- */

function emptyState() {
  return {
    version: 1,
    project: { name: "", address: "", use: "", structure: "", floors: "", area: "", year: "", demoDate: "" },
    photos: [],
    materials: [],
    prices: { ...DEFAULT_PRICES },
    destinations: DEFAULT_DESTINATIONS.map((d) => ({ ...d })),
    vehicles: DEFAULT_VEHICLES.map((v) => ({ ...v })),
    logistics: { selected: null },
    plan: null,
    review: { status: "draft", history: [] },
  };
}

let state = load() || emptyState();
const session = window.auth?.get();
const ui = { step: stepFromHash(), role: sessionGet("role") || session?.role || ROLES[0], viewer: null, planIndex: 0, playTimer: null, typeFilter: "all" };

function load() {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast("브라우저 저장 공간이 부족해 자동 저장하지 못했습니다. 사진 수를 줄여 주세요."); }
}
function sessionGet(k) { try { return sessionStorage.getItem("reclaim." + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem("reclaim." + k, v); } catch {} }

// 결과에 영향을 주는 변경. 검토·승인 중이던 결과는 초안으로 돌아간다.
function mutate(fn, { affectsResults = true } = {}) {
  fn(state);
  if (affectsResults && ["review", "approved", "changes"].includes(state.review.status)) {
    const prev = STATUS[state.review.status].label;
    state.review.status = "draft";
    log("시스템", "상태 변경", `${prev} 상태에서 입력값이 바뀌어 초안으로 돌아갔습니다.`);
  }
  save();
}
function log(role, action, text = "") {
  state.review.history.unshift({ at: new Date().toISOString(), role, action, text });
}

/* ---------------- helpers ---------------- */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const I = (n) => window.icon(n);
const man = (won) => `${Math.round(won / 10000).toLocaleString("ko-KR")}만원`;
const ton = (t) => `${(+t).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}t`;
const fmtDate = (iso) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const uid = () => Math.random().toString(36).slice(2, 10);

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}
function stepFromHash() {
  const k = location.hash.replace("#/", "");
  const i = STEPS.findIndex((s) => s.key === k);
  return i < 0 ? 0 : i;
}
function go(i) { location.hash = "#/" + STEPS[i].key; }

function disclaimer(extra = "") {
  return `<div class="disclaimer" role="note">${I("alert")}<div>이 결과는 전문가 검토용 <strong>1차 스크리닝 자료</strong>이며, 최종 해체 지시나 정밀 진단이 아닙니다. ${extra}</div></div>`;
}

// 평가·물류 결과를 매번 계산 (입력 크기가 작아 즉시 계산 가능)
function computeAll() {
  const evals = evaluateAll(state);
  const logi = compareLogistics(state, evals);
  const selected = logi.options.find((o) => o.key === state.logistics.selected) || logi.best;
  const transport = allocateTransport(state, evals, selected);
  const econ = state.materials.length ? economics(state, evals, transport) : [];
  return { evals, logi, selected, transport, econ };
}
function planSignature(evals) {
  return JSON.stringify(state.materials.map((m) => [m.id, m.floor, m.zone, m.member, m.type, evals[m.id]?.grade]).concat([state.project.floors]));
}

/* ---------------- shell ---------------- */

function renderShell() {
  const q = checkInputQuality(state);
  const done = [q.ready && !!state.project.name, state.materials.length > 0, state.materials.length > 0, !!state.logistics.selected, !!state.plan, state.review.status === "approved"];
  $("#steps").innerHTML = STEPS.map((s, i) => `
    <li><button type="button" data-step="${i}" ${i === ui.step ? 'aria-current="step"' : ""}>
      <span class="step-num ${done[i] && i !== ui.step ? "done" : ""}">${done[i] && i !== ui.step ? I("check") : i + 1}</span>${s.label}
    </button></li>`).join("");
  $("#project-title").textContent = state.project.name || "새 프로젝트";
  const st = STATUS[state.review.status];
  $("#status-badge").innerHTML = `<span class="badge ${st.cls}">${st.label}</span>`;
  const roleSel = $("#role");
  if (!roleSel.options.length) roleSel.innerHTML = ROLES.map((r) => `<option>${r}</option>`).join("");
  roleSel.value = ui.role;
}

function render() {
  if (ui.viewer) { ui.view = ui.viewer.getView(); ui.viewer.dispose(); ui.viewer = null; }
  clearTimeout(ui.playTimer); ui.playTimer = null;
  if (STEPS[ui.step].key !== "plan") { ui.playing = false; ui.view = null; }
  renderShell();
  const el = $("#content");
  const key = STEPS[ui.step].key;
  el.innerHTML = PAGES[key]();
  BIND[key]?.(el);
  $("#side").classList.remove("open");
}

function pageHead(title, desc, actions = "") {
  return `<div class="page-head"><div><span class="caption muted">${ui.step + 1} / ${STEPS.length} 단계</span><h1>${title}</h1><p>${desc}</p></div><div class="actions">${actions}</div></div>`;
}
function navFoot() {
  const prev = ui.step > 0 ? `<button class="btn btn-outline" data-go="${ui.step - 1}">${I("chevron-left")} ${STEPS[ui.step - 1].label}</button>` : "<span></span>";
  const next = ui.step < STEPS.length - 1 ? `<button class="btn btn-primary" data-go="${ui.step + 1}">${STEPS[ui.step + 1].label} ${I("chevron-right")}</button>` : "";
  return `<div style="display:flex;justify-content:space-between;gap:12px">${prev}${next}</div>`;
}

/* ---------------- pages ---------------- */

const PAGES = {};
const BIND = {};

PAGES.building = () => {
  const p = state.project;
  const q = checkInputQuality(state);
  const f = (key, label, type = "text", req = true, extra = "") =>
    `<div class="field"><label for="f-${key}">${label}${req ? '<span class="req">*</span>' : ""}</label><input class="input" id="f-${key}" name="${key}" type="${type}" value="${esc(p[key])}" ${extra}></div>`;
  return `
  ${pageHead("건물 정보", "해체할 건물의 기본 정보를 입력하세요. 건축 연도는 자재 노후도 평가에, 층수는 해체 순서와 장비 선정에 쓰입니다.")}
  <div class="grid-2" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr)">
    <form class="card" id="building-form" autocomplete="off">
      <div class="card-head"><h3>${I("building")} 기본 정보</h3></div>
      <div class="form-grid">
        ${f("name", "프로젝트 이름")}
        ${f("address", "주소")}
        ${f("use", "용도", "text", true, 'placeholder="예: 근린생활시설"')}
        ${f("structure", "구조 형식", "text", false, 'placeholder="예: 철근콘크리트조"')}
        ${f("floors", "지상 층수", "number", true, 'min="1" max="60"')}
        ${f("area", "연면적 (㎡)", "number", false, 'min="0"')}
        ${f("year", "건축 연도", "number", true, `min="1900" max="${new Date().getFullYear()}"`)}
        ${f("demoDate", "해체 예정일", "date")}
      </div>
    </form>
    <div class="card" id="quality">${qualityCard()}</div>
  </div>
  ${navFoot()}`;
};
function qualityCard() {
  const q = checkInputQuality(state);
  return `
    <div class="card-head"><h3>${I("list")} 입력 데이터 점검</h3>${q.ready ? '<span class="badge badge-success">분석 가능</span>' : `<span class="badge badge-danger">필수 ${q.errors}건 누락</span>`}</div>
    ${q.issues.length ? `<ul class="issues">${q.issues.slice(0, 10).map((i) => `<li><span class="dot ${i.level}"></span><span><span class="where">${esc(i.where)}</span>${esc(i.text)}</span></li>`).join("")}</ul>${q.issues.length > 10 ? `<p class="caption muted" style="margin-top:8px">외 ${q.issues.length - 10}건</p>` : ""}` : '<p class="muted">누락된 항목이 없습니다.</p>'}
    ${q.needsSurvey ? `<div class="disclaimer" style="margin-top:16px">${I("info")}<div>사진이 없거나 품질이 낮은 항목이 있어 <strong>추가 현장 조사</strong>를 권장합니다.</div></div>` : ""}`;
}
BIND.building = (el) => {
  $("#building-form", el).addEventListener("change", (e) => {
    const t = e.target;
    const v = t.type === "number" ? (t.value === "" ? "" : Number(t.value)) : t.value.trim();
    mutate((s) => { s.project[t.name] = v; });
    renderShell();
    $("#quality", el).innerHTML = qualityCard();
  });
};

PAGES.materials = () => {
  const linked = (pid) => state.materials.filter((m) => m.photoId === pid).length;
  return `
  ${pageHead("현장 사진·자재 정보", "현장 사진을 올리고, 콘크리트·골재와 구조용 강재의 재질·규격·위치·외관 상태를 입력하세요.",
    `<button class="btn btn-primary" id="add-material">${I("plus")} 자재 추가</button>`)}
  <div class="card">
    <div class="card-head"><h3>${I("camera")} 현장 사진 <span class="badge badge-neutral">${state.photos.length}장</span></h3></div>
    <label class="dropzone" id="dropzone">
      <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple hidden>
      ${I("upload")}<div><strong>사진을 끌어다 놓거나 클릭해서 올리세요</strong></div>
      <div class="caption">JPG, PNG, WEBP · 파일당 15MB 이하 · 짧은 변 720px 이상 권장</div>
    </label>
    ${state.photos.length ? `<div class="photos">${state.photos.map((p) => `
      <div class="photo">
        <img src="${p.dataUrl}" alt="${esc(p.name)}" loading="lazy">
        <div class="meta">
          <div class="name" title="${esc(p.name)}">${esc(p.name)}</div>
          <div class="row">
            <span class="chips">
              ${p.quality.lowRes ? '<span class="badge badge-warning">해상도 낮음</span>' : ""}
              ${p.quality.dark ? '<span class="badge badge-warning">어두움</span>' : ""}
              ${!p.quality.lowRes && !p.quality.dark ? '<span class="badge badge-success">품질 양호</span>' : ""}
            </span>
            <button class="icon-btn" data-del-photo="${p.id}" aria-label="${esc(p.name)} 삭제">${I("trash")}</button>
          </div>
          <span class="caption muted">${p.quality.w}×${p.quality.h} · 연결 자재 ${linked(p.id)}개</span>
        </div>
      </div>`).join("")}</div>` : ""}
  </div>

  <div class="card">
    <div class="card-head"><h3>${I("box")} 자재 목록 <span class="badge badge-neutral">${state.materials.length}건 · ${ton(state.materials.reduce((s, m) => s + (+m.qty || 0), 0))}</span></h3></div>
    ${state.materials.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>번호</th><th>자재</th><th>부재</th><th>규격</th><th>위치</th><th class="r">수량</th><th>외관 상태</th><th>손상</th><th>사진</th><th></th></tr></thead>
      <tbody>${state.materials.map((m) => `
        <tr>
          <td class="mono">${m.label}</td>
          <td><span class="type-dot ${m.type}"></span>${TYPE_LABEL[m.type]}</td>
          <td>${esc(m.member)}</td>
          <td>${esc(m.spec) || '<span class="badge badge-warning">미입력</span>'}</td>
          <td>${m.member === "기초" ? "기초" : `${m.floor}층`} · ${m.zone}구역</td>
          <td class="r">${ton(m.qty || 0)}</td>
          <td>${CONDITIONS[m.condition] || '<span class="badge badge-warning">미입력</span>'}</td>
          <td>${(m.damage || []).map((d) => DAMAGE[d]).join(", ") || '<span class="muted">없음</span>'}</td>
          <td>${m.photoId ? I("check") : '<span class="badge badge-neutral">없음</span>'}</td>
          <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-edit="${m.id}">수정</button><button class="icon-btn" data-del="${m.id}" aria-label="${m.label} 삭제">${I("trash")}</button></td>
        </tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">${I("box")}<p>등록된 자재가 없습니다.</p><button class="btn btn-outline" id="add-material-2">${I("plus")} 첫 자재 추가</button></div>`}
  </div>
  ${navFoot()}`;
};
BIND.materials = (el) => {
  const input = $("#photo-input", el);
  const dz = $("#dropzone", el);
  input.addEventListener("change", () => addPhotos([...input.files]));
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); addPhotos([...e.dataTransfer.files]); });
  $$("[data-del-photo]", el).forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.delPhoto;
    const p = state.photos.find((x) => x.id === id);
    if (!confirm(`'${p.name}' 사진을 삭제할까요? 연결된 자재의 사진 연결도 해제됩니다.`)) return;
    mutate((s) => { s.photos = s.photos.filter((x) => x.id !== id); s.materials.forEach((m) => { if (m.photoId === id) m.photoId = null; }); });
    render();
  }));
  $("#add-material", el)?.addEventListener("click", () => materialModal());
  $("#add-material-2", el)?.addEventListener("click", () => materialModal());
  $$("[data-edit]", el).forEach((b) => b.addEventListener("click", () => materialModal(state.materials.find((m) => String(m.id) === b.dataset.edit))));
  $$("[data-del]", el).forEach((b) => b.addEventListener("click", () => {
    const m = state.materials.find((x) => String(x.id) === b.dataset.del);
    if (!confirm(`${m.label} ${m.member} 자재를 삭제할까요?`)) return;
    mutate((s) => { s.materials = s.materials.filter((x) => x !== m); });
    render();
  }));
};

const OK_TYPES = ["image/jpeg", "image/png", "image/webp"];
async function addPhotos(files) {
  const rejected = [];
  for (const file of files) {
    if (!OK_TYPES.includes(file.type)) { rejected.push(`${file.name} (지원하지 않는 형식)`); continue; }
    if (file.size > 15 * 1024 * 1024) { rejected.push(`${file.name} (15MB 초과)`); continue; }
    try {
      const photo = await processPhoto(file);
      mutate((s) => s.photos.push(photo));
    } catch { rejected.push(`${file.name} (손상되었거나 열 수 없는 파일)`); }
  }
  render();
  if (rejected.length) toast(`등록하지 못한 파일: ${rejected.join(", ")}`);
}
function processPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, 1280 / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, c.width, c.height);
      // 밝기 측정 (64×64 샘플)
      const s = document.createElement("canvas"); s.width = s.height = 64;
      s.getContext("2d").drawImage(img, 0, 0, 64, 64);
      const d = s.getContext("2d").getImageData(0, 0, 64, 64).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const brightness = sum / (d.length / 4);
      URL.revokeObjectURL(url);
      resolve({
        id: "p" + uid(), name: file.name, dataUrl: c.toDataURL("image/jpeg", 0.72),
        quality: { w, h, lowRes: Math.min(w, h) < 720, dark: brightness < 0.22, brightness: +brightness.toFixed(2) },
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

function materialModal(m) {
  const isNew = !m;
  const d = m || { type: "concrete", member: "슬래브", spec: "", floor: 1, zone: "A", qty: "", condition: "", damage: [], photoId: null, note: "" };
  const dlg = $("#modal");
  dlg.innerHTML = `
  <form method="dialog" id="mat-form">
    <div class="modal-head"><h3>${isNew ? "자재 추가" : `${m.label} 수정`}</h3><button class="icon-btn" value="cancel" aria-label="닫기">${I("x")}</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="field"><label>자재 종류<span class="req">*</span></label><select class="select" name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${d.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>부재<span class="req">*</span></label><select class="select" name="member">${MEMBERS.map((x) => `<option ${d.member === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div class="field"><label>규격</label><input class="input" name="spec" value="${esc(d.spec)}" placeholder="예: H-400×200×8×13, RC t=150"></div>
        <div class="field"><label>층<span class="req">*</span></label><input class="input" name="floor" type="number" min="0" max="60" value="${esc(d.floor)}"><span class="caption muted">기초는 0</span></div>
        <div class="field"><label>구역<span class="req">*</span></label><select class="select" name="zone">${ZONES.map((z) => `<option ${d.zone === z ? "selected" : ""}>${z}</option>`).join("")}</select></div>
        <div class="field"><label>수량 (t)<span class="req">*</span></label><input class="input" name="qty" type="number" min="0" step="0.1" value="${esc(d.qty)}" required></div>
        <div class="field"><label>외관 상태</label><select class="select" name="condition"><option value="">선택</option>${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}" ${d.condition === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>연결 사진</label><select class="select" name="photoId"><option value="">없음</option>${state.photos.map((p) => `<option value="${p.id}" ${d.photoId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><span class="label">외관 손상 (사진을 보고 선택)</span>
        <div class="chips">${Object.entries(DAMAGE).map(([k, v]) => `<label class="chip"><input type="checkbox" name="damage" value="${k}" ${(d.damage || []).includes(k) ? "checked" : ""}>${v}</label>`).join("")}</div>
        <span class="caption muted">경량 이미지 분류 모델의 자동 손상 인식은 연동 예정입니다. 지금은 사진을 보고 직접 선택합니다.</span>
      </div>
      <div class="field"><label>메모</label><input class="input" name="note" value="${esc(d.note)}"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-outline" value="cancel">취소</button><button class="btn btn-primary" value="ok" id="mat-ok">${isNew ? "추가" : "저장"}</button></div>
  </form>`;
  dlg.showModal();
  $("#mat-ok", dlg).addEventListener("click", (e) => {
    const fd = new FormData($("#mat-form", dlg));
    const qty = Number(fd.get("qty"));
    const floor = Number(fd.get("floor"));
    if (!qty || qty <= 0) { e.preventDefault(); $('[name="qty"]', dlg).classList.add("invalid"); toast("수량을 입력하세요."); return; }
    const member = fd.get("member");
    if (member !== "기초" && (!floor || floor < 1)) { e.preventDefault(); $('[name="floor"]', dlg).classList.add("invalid"); toast("층을 1 이상으로 입력하세요. (기초만 0)"); return; }
    const data = {
      type: fd.get("type"), member, spec: fd.get("spec").trim(), floor: member === "기초" ? 0 : floor, zone: fd.get("zone"),
      qty, condition: fd.get("condition"), damage: fd.getAll("damage"), photoId: fd.get("photoId") || null, note: fd.get("note").trim(),
    };
    mutate((s) => {
      if (isNew) {
        const id = Math.max(0, ...s.materials.map((x) => +x.id || 0)) + 1;
        s.materials.push({ id, label: `M-${String(id).padStart(2, "0")}`, ...data });
      } else Object.assign(s.materials.find((x) => x.id === m.id), data);
    });
    setTimeout(render);
  });
}

PAGES.evaluate = () => {
  if (!state.materials.length) return emptyPage("평가할 자재가 없습니다.", 1);
  const { evals } = computeAll();
  const sum = (g) => state.materials.filter((m) => evals[m.id].grade === g).reduce((s, m) => s + (+m.qty || 0), 0);
  const total = state.materials.reduce((s, m) => s + (+m.qty || 0), 0);
  const value = state.materials.reduce((s, m) => s + evals[m.id].value, 0);
  const lowConf = state.materials.filter((m) => evals[m.id].confLevel === "low").length;
  const list = state.materials.filter((m) => ui.typeFilter === "all" || m.type === ui.typeFilter);
  return `
  ${pageHead("자재 평가", "입력한 자재 정보와 외관 손상 태그로 재사용 가능성, 예상 가치, 해체 난이도, 처리비를 규칙 기반 점수로 계산합니다.")}
  ${disclaimer("외관 정보만으로는 콘크리트 내부 상태나 강재의 부식 깊이를 알 수 없습니다.")}
  <div class="grid-4">
    <div class="card kpi dark"><div class="stat-value">${ton(total)}</div><div class="stat-label">전체 자재 ${state.materials.length}건</div></div>
    <div class="card kpi"><div class="stat-value" style="color:var(--color-success)">${ton(sum("reuse"))}</div><div class="stat-label">재사용 가능 · ${total ? Math.round(sum("reuse") / total * 100) : 0}%</div></div>
    <div class="card kpi"><div class="stat-value" style="color:var(--color-warning)">${ton(sum("review"))}</div><div class="stat-label">검토 필요 · 신뢰도 낮음 ${lowConf}건</div></div>
    <div class="card kpi"><div class="stat-value">${man(value)}</div><div class="stat-label">예상 회수 가치 (운송·해체비 제외)</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>자재별 평가 결과</h3>
      <div class="chips" role="radiogroup" aria-label="자재 종류 필터">
        ${[["all", "전체"], ["concrete", "콘크리트·골재"], ["steel", "구조용 강재"]].map(([k, v]) => `<label class="chip"><input type="radio" name="tf" value="${k}" ${ui.typeFilter === k ? "checked" : ""}>${v}</label>`).join("")}
      </div>
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>자재</th><th>위치</th><th class="r">수량</th><th>재사용 점수</th><th>판정</th><th>처리 경로</th><th class="r">예상 가치</th><th>해체 난이도</th><th class="r">해체·처리비</th><th>신뢰도</th><th>판단 근거</th></tr></thead>
      <tbody>${list.map((m) => {
        const e = evals[m.id];
        const g = GRADE[e.grade];
        return `<tr>
          <td><span class="type-dot ${m.type}"></span><span class="mono">${m.label}</span> ${esc(m.member)}<div class="caption muted">${esc(m.spec)}</div></td>
          <td>${m.member === "기초" ? "기초" : m.floor + "층"} ${m.zone}</td>
          <td class="r">${ton(m.qty)}</td>
          <td><div class="score-cell"><span class="num">${e.score}</span><div class="bar" style="flex:1"><span style="width:${e.score}%;background:${g.color}"></span></div></div></td>
          <td><span class="badge ${g.cls}">${g.label}</span></td>
          <td class="caption">${e.route}</td>
          <td class="r">${man(e.value)}</td>
          <td><span class="diff" title="난이도 ${e.difficulty}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= e.difficulty ? "on" : ""}"></i>`).join("")}</span></td>
          <td class="r">${man(e.dismantleCost + e.disposalCost)}</td>
          <td><span class="badge ${CONF[e.confLevel][1]}">${CONF[e.confLevel][0]}</span></td>
          <td><details class="why"><summary>근거 보기</summary><ul>
            ${e.reasons.map((r) => `<li>${esc(r)}</li>`).join("") || "<li>감점 요인 없음</li>"}
            ${e.diffNotes.map((r) => `<li>난이도: ${esc(r)}</li>`).join("")}
            ${e.confNotes.map((r) => `<li>신뢰도: ${esc(r)}</li>`).join("")}
          </ul></details></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    <p class="caption muted" style="margin-top:12px">점수 70점 이상 재사용 가능, 45~69점 검토 필요, 45점 미만 폐기·재활용. 가격 기준일 ${state.prices.basisDate} (가정값, 다음 단계에서 수정 가능)</p>
  </div>
  ${navFoot()}`;
};
BIND.evaluate = (el) => {
  $$('input[name="tf"]', el).forEach((r) => r.addEventListener("change", () => { ui.typeFilter = r.value; render(); }));
};

function emptyPage(msg, stepIdx) {
  return `${pageHead(STEPS[ui.step].label, "")}<div class="card empty">${I("info")}<p>${msg}</p><button class="btn btn-primary" data-go="${stepIdx}">${STEPS[stepIdx].label}(으)로 이동</button></div>`;
}

PAGES.logistics = () => {
  if (!state.materials.length) return emptyPage("운송 계획을 세울 자재가 없습니다.", 1);
  const { logi, selected, econ } = computeAll();
  if (!selected) {
    mutate((s) => { s.vehicles = DEFAULT_VEHICLES.map((v) => ({ ...v })); }, { affectsResults: false });
    return PAGES.logistics();
  }
  const numIn = (path, v, attrs = "") => `<input class="input num" style="min-height:34px;padding:4px 8px" data-path="${path}" type="number" value="${v}" ${attrs}>`;
  return `
  ${pageHead("경제성·운송 물류", "차량과 목적지 조건을 입력하면 차량경로최적화(VRP)로 운송 경로와 적재 계획을 만들고, 기본안과 비교합니다.")}
  <div class="grid-4">
    <div class="card kpi dark"><div class="stat-value accent">${Math.round(logi.saving * 100)}%</div><div class="stat-label">최적안의 기본안 대비 운송비 절감</div></div>
    <div class="card kpi"><div class="stat-value">${man(selected.cost)}</div><div class="stat-label">선택안 운송비</div></div>
    <div class="card kpi"><div class="stat-value">${selected.trips}회</div><div class="stat-label">운행 횟수 · ${Math.round(selected.km)}km</div></div>
    <div class="card kpi"><div class="stat-value">${selected.days}일</div><div class="stat-label">예상 운송 기간 · 적재율 ${Math.round(selected.utilization * 100)}%</div></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>${I("truck")} 운송 대안 비교</h3><span class="caption muted">선택한 안이 자재별 운송비와 보고서에 쓰입니다.</span></div>
    <div class="options">
      ${[logi.baseline, ...logi.options].map((o) => `
      <label class="option">
        <input type="radio" name="opt" value="${o.key}" ${o.key === selected.key ? "checked" : ""} ${o.key === "baseline" ? "disabled" : ""}>
        <div><strong>${esc(o.label)}</strong> ${o.key === logi.best.key ? '<span class="badge badge-primary">최저 비용</span>' : ""} ${o.key === "baseline" ? '<span class="badge badge-neutral">비교 기준</span>' : ""}</div>
        <div class="v">${man(o.cost)}<small>운송비</small></div>
        <div class="v">${o.trips}회<small>운행</small></div>
        <div class="v">${Math.round(o.km)}km<small>총 거리</small></div>
        <div class="v">${o.days}일<small>기간</small></div>
      </label>`).join("")}
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h4>경로 지도 · ${esc(selected.label)}</h4></div>
      ${routeMap(selected, logi.demands)}
    </div>
    <div class="card">
      <div class="card-head"><h4>운행·적재 계획</h4></div>
      <div class="table-wrap" style="max-height:380px;overflow:auto"><table class="tbl">
        <thead><tr><th>경로</th><th class="r">횟수</th><th class="r">회당 적재</th><th class="r">회당 거리</th></tr></thead>
        <tbody>${groupRoutes(selected.routes).map(({ r, n }) => `<tr><td>현장 → ${r.stops.map((s) => `${esc(s.name)} <span class="muted">(${ton(s.load)})</span>`).join(" → ")} → 현장 ${r.combined ? '<span class="badge badge-info">합적</span>' : ""}${r.vehicle ? `<div class="caption muted">${esc(r.vehicle)}</div>` : ""}</td><td class="r">${n}회</td><td class="r">${ton(r.load)}</td><td class="r">${Math.round(r.km)}km</td></tr>`).join("")}</tbody>
      </table></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h3>${I("chart")} 우선 회수 순위</h3><span class="caption muted">톤당 순경제성 ÷ 해체 난이도 순</span></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>순위</th><th>자재</th><th>판정</th><th class="r">회수 가치</th><th class="r">해체비</th><th class="r">처리비</th><th class="r">운송비</th><th class="r">순경제성</th></tr></thead>
      <tbody>${econ.map((r, i) => `<tr>
        <td class="mono">${i + 1}</td>
        <td><span class="type-dot ${r.m.type}"></span><span class="mono">${r.m.label}</span> ${esc(r.m.member)} · ${r.m.member === "기초" ? "기초" : r.m.floor + "층"} ${r.m.zone} · ${ton(r.m.qty)}</td>
        <td><span class="badge ${GRADE[r.e.grade].cls}">${GRADE[r.e.grade].label}</span></td>
        <td class="r">${man(r.e.value)}</td><td class="r">${man(r.e.dismantleCost)}</td><td class="r">${man(r.e.disposalCost)}</td><td class="r">${man(r.transport)}</td>
        <td class="r" style="font-weight:700;color:${r.net >= 0 ? "var(--color-success)" : "var(--color-danger)"}">${r.net >= 0 ? "+" : ""}${man(r.net)}</td>
      </tr>`).join("")}</tbody>
      <tfoot><tr><th colspan="7">합계</th><th class="r">${man(econ.reduce((s, r) => s + r.net, 0))}</th></tr></tfoot>
    </table></div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h4>차량 조건</h4><button class="btn btn-ghost btn-sm" id="reset-vehicles">기본값</button></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>차종</th><th>적재 한도(t)</th><th>대수</th><th>km당 비용(원)</th><th>회당 기본비(원)</th></tr></thead>
        <tbody>${state.vehicles.map((v, i) => `<tr><td>${esc(v.name)}</td><td>${numIn(`vehicles.${i}.capacity`, v.capacity, 'min="1" step="0.5"')}</td><td>${numIn(`vehicles.${i}.count`, v.count, 'min="0"')}</td><td>${numIn(`vehicles.${i}.costPerKm`, v.costPerKm, 'min="0" step="100"')}</td><td>${numIn(`vehicles.${i}.baseCost`, v.baseCost, 'min="0" step="1000"')}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="card-head" style="margin:20px 0 12px"><h4>목적지 (현장 기준)</h4></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>목적지</th><th>거리(km)</th><th>방위(°)</th><th class="r">반입 물량</th></tr></thead>
        <tbody>${state.destinations.map((d, i) => `<tr><td>${esc(d.name)}</td><td>${numIn(`destinations.${i}.distance`, d.distance, 'min="1"')}</td><td>${numIn(`destinations.${i}.angle`, d.angle, 'min="0" max="359"')}</td><td class="r">${ton(logi.demands[d.id] || 0)}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-head"><h4>단가 가정</h4><button class="btn btn-ghost btn-sm" id="reset-prices">기본값</button></div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="field"><label>가격 기준일</label><input class="input" type="date" data-path="prices.basisDate" value="${state.prices.basisDate}"></div>
        ${[["steelReuse", "재사용 강재 매각 (원/t)"], ["steelScrap", "고철 매각 (원/t)"], ["concreteRecycle", "순환골재 원료 가치 (원/t)"], ["concreteRecycleFee", "순환골재 반입비 (원/t)"], ["mixedWasteFee", "혼합폐기물 처리비 (원/t)"], ["dismantlePerLevel", "해체비 (원/t · 난이도 1당)"]]
          .map(([k, l]) => `<div class="field"><label>${l}</label>${numIn(`prices.${k}`, state.prices[k], 'min="0" step="1000"')}</div>`).join("")}
      </div>
      <p class="caption muted" style="margin-top:16px">모든 단가는 기본 가정값입니다. 지역 시세와 규정에 맞게 바꿔 쓰세요. 운송 시간은 평균 40km/h, 상하차 30분, 하루 8시간 기준입니다.</p>
    </div>
  </div>
  ${navFoot()}`;
};
BIND.logistics = (el) => {
  $$('input[name="opt"]', el).forEach((r) => r.addEventListener("change", () => { mutate((s) => { s.logistics.selected = r.value; }); render(); }));
  $$("[data-path]", el).forEach((inp) => inp.addEventListener("change", () => {
    const path = inp.dataset.path.split(".");
    const v = inp.type === "number" ? Number(inp.value) : inp.value;
    if (inp.type === "number" && (isNaN(v) || v < 0)) { toast("0 이상의 숫자를 입력하세요."); render(); return; }
    mutate((s) => { let o = s; for (const k of path.slice(0, -1)) o = o[k]; o[path.at(-1)] = v; });
    render();
  }));
  $("#reset-vehicles", el).addEventListener("click", () => { mutate((s) => { s.vehicles = DEFAULT_VEHICLES.map((v) => ({ ...v })); s.destinations = DEFAULT_DESTINATIONS.map((d) => ({ ...d })); }); render(); });
  $("#reset-prices", el).addEventListener("click", () => { mutate((s) => { s.prices = { ...DEFAULT_PRICES }; }); render(); });
};

function groupRoutes(routes) {
  const groups = new Map();
  for (const r of routes) {
    const k = [r.vehicle, ...r.stops.map((s) => `${s.id}:${s.load}`)].join("|");
    const g = groups.get(k);
    if (g) g.n++; else groups.set(k, { r, n: 1 });
  }
  return [...groups.values()];
}

function routeMap(option, demands) {
  const W = 420, H = 320, cx = W / 2, cy = H / 2;
  const maxD = Math.max(...state.destinations.map((d) => d.distance), 1);
  const R = 130 / maxD;
  const pos = Object.fromEntries(state.destinations.map((d) => {
    const a = (d.angle * Math.PI) / 180;
    return [d.id, { x: cx + Math.cos(a) * d.distance * R, y: cy - Math.sin(a) * d.distance * R * 0.9, d }];
  }));
  const paths = {};
  for (const r of option.routes) {
    const k = r.stops.map((s) => s.id).join(">");
    paths[k] = (paths[k] || 0) + 1;
  }
  const lines = Object.entries(paths).map(([k, n]) => {
    const ids = k.split(">");
    const pts = [[cx, cy], ...ids.map((id) => [pos[id].x, pos[id].y]), [cx, cy]];
    return `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--route)" stroke-width="${Math.min(2 + n, 8)}" stroke-opacity=".7" stroke-linejoin="round" ${ids.length > 1 ? 'stroke-dasharray="6 4"' : ""}><title>${ids.map((id) => pos[id].d.name).join(" → ")} · ${n}회</title></polyline>`;
  }).join("");
  const nodes = Object.values(pos).map(({ x, y, d }) => `
    <g><circle cx="${x}" cy="${y}" r="${demands[d.id] ? 8 : 5}" fill="${demands[d.id] ? "var(--color-secondary)" : "var(--gray-400)"}" stroke="var(--surface)" stroke-width="2"/>
    <text x="${x}" y="${y - 14}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text)">${esc(d.name)}</text>
    <text x="${x}" y="${y + 22}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${d.distance}km · ${ton(demands[d.id] || 0)}</text></g>`).join("");
  return `<svg class="route-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="운송 경로 지도">
    ${[0.33, 0.66, 1].map((f) => `<circle cx="${cx}" cy="${cy}" r="${130 * f}" fill="none" stroke="var(--border)" stroke-dasharray="2 4"/>`).join("")}
    ${lines}${nodes}
    <rect x="${cx - 14}" y="${cy - 14}" width="28" height="28" rx="6" fill="var(--color-primary)"/>
    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#1C1D22">현장</text>
  </svg>
  <p class="caption muted" style="margin-top:8px">선 굵기는 운행 횟수, 점선은 여러 목적지를 한 번에 도는 합적 운행입니다. 위치는 거리·방위로 그린 개략도입니다.</p>`;
}

PAGES.plan = () => {
  if (!state.materials.length) return emptyPage("해체 계획을 만들 자재가 없습니다.", 1);
  const { evals, selected } = computeAll();
  if (!state.plan) {
    return `${pageHead("해체 계획·3D 검토", "자재 위치·상태와 평가 결과로 단계별 해체 순서, 공법, 장비를 만듭니다.")}
    <div class="card empty">${I("list")}<p>아직 해체 계획이 없습니다.</p><button class="btn btn-primary" id="gen-plan">${I("hammer")} 해체 계획 생성</button></div>`;
  }
  const steps = state.plan.steps;
  const stale = state.plan.signature !== planSignature(evals);
  const idx = Math.min(ui.planIndex, steps.length);
  const byId = Object.fromEntries(state.materials.map((m) => [m.id, m]));
  const cur = steps[idx];
  const curMats = cur ? cur.materialIds.map((id) => byId[id]).filter(Boolean) : [];
  const curTon = curMats.reduce((s, m) => s + (+m.qty || 0), 0);
  const cap = selected?.vehicle?.capacity || state.vehicles[0]?.capacity || 15;
  return `
  ${pageHead("해체 계획·3D 검토", "위층부터 아래로, 재사용 강재를 먼저 회수하는 규칙으로 순서를 만들었습니다. 순서·공법·장비는 직접 바꿀 수 있습니다.",
    `<button class="btn btn-outline" id="regen">${I("recycle")} 다시 생성</button>`)}
  ${disclaimer("구조 안전성 시뮬레이션은 포함되지 않으므로, 해체 순서는 반드시 구조 기술자가 검토해야 합니다.")}
  ${stale ? `<div class="disclaimer" style="border-color:var(--color-danger);background:var(--color-danger-soft)">${I("alert")}<div>계획을 만든 뒤 자재 정보나 평가 결과가 바뀌었습니다. <button class="btn btn-ghost btn-sm" id="regen-2">계획 다시 생성</button></div></div>` : ""}
  <div class="plan-layout">
    <div class="card" style="padding:16px">
      <div class="card-head" style="margin-bottom:12px"><h4>${I("list")} 해체 단계 <span class="badge badge-neutral">${steps.length}</span></h4>${state.plan.edited ? '<span class="badge badge-info">사용자 수정됨</span>' : ""}</div>
      <ol class="step-list">${steps.map((s, i) => `
        <li class="step-item ${i === idx ? "active" : ""} ${s.warning ? "warn" : ""}" data-sel="${i}">
          <div class="top">
            <span class="idx">${String(i + 1).padStart(2, "0")}</span>
            <span class="t">${esc(s.title)}</span>
            ${s.warning ? '<span class="badge badge-warning">검토 필요</span>' : ""}
            <span class="ctrl">
              <button class="icon-btn" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="위로">${I("chevron-up")}</button>
              <button class="icon-btn" data-down="${i}" ${i === steps.length - 1 ? "disabled" : ""} aria-label="아래로">${I("chevron-down")}</button>
            </span>
          </div>
          ${i === idx ? `
          <div class="edit">
            <select class="select" data-method="${i}" aria-label="공법">${METHODS.map((m) => `<option ${s.method === m ? "selected" : ""}>${m}</option>`).join("")}</select>
            <select class="select" data-equip="${i}" aria-label="장비">${EQUIPMENT.map((m) => `<option ${s.equipment === m ? "selected" : ""}>${m}</option>`).join("")}</select>
          </div>
          <ul>${s.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<span class="caption muted">${esc(s.method)} · ${esc(s.equipment)}</span>`}
        </li>`).join("")}</ol>
    </div>
    <div style="display:grid;gap:16px;min-width:0">
      <div class="viewer" id="viewer">
        <div class="legend" id="legend"></div>
        <div class="mode" role="group" aria-label="색상 기준"><button type="button" data-mode="grade" class="on">평가 결과</button><button type="button" data-mode="type">자재 종류</button></div>
        <div class="pick" id="pick" hidden></div>
        <div class="overlay">
          <button class="icon-btn" id="prev" aria-label="이전 단계">${I("chevron-left")}</button>
          <button class="icon-btn" id="play" aria-label="${ui.playing ? "일시정지" : "재생"}">${I(ui.playing ? "pause" : "play")}</button>
          <button class="icon-btn" id="next" aria-label="다음 단계">${I("chevron-right")}</button>
          <input type="range" id="scrub" min="0" max="${steps.length}" value="${idx}" aria-label="해체 단계">
          <span class="step-label">${idx < steps.length ? `${idx + 1}/${steps.length} · ${esc(cur.title)}` : "해체 완료"}</span>
        </div>
      </div>
      <div class="grid-3">
        <div class="card kpi"><div class="stat-value" style="font-size:24px">${cur ? esc(cur.zones?.join(", ") || "전체") : "—"}</div><div class="stat-label">작업 구역 · 장비 위치</div></div>
        <div class="card kpi"><div class="stat-value" style="font-size:24px">${ton(curTon)}</div><div class="stat-label">이 단계 반출 물량 · ${curMats.length}건</div></div>
        <div class="card kpi"><div class="stat-value" style="font-size:24px">${curTon ? Math.ceil(curTon / cap) : 0}회</div><div class="stat-label">적재 단위 (${cap}t 차량 기준)</div></div>
      </div>
      ${curMats.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>대상 자재</th><th>판정</th><th class="r">수량</th><th>반출 목적지</th><th>신뢰도</th></tr></thead><tbody>
        ${curMats.map((m) => { const e = evals[m.id]; return `<tr><td><span class="type-dot ${m.type}"></span><span class="mono">${m.label}</span> ${esc(m.member)} ${m.zone}구역</td><td><span class="badge ${GRADE[e.grade].cls}">${GRADE[e.grade].label}</span></td><td class="r">${ton(m.qty)}</td><td>${esc(state.destinations.find((d) => d.id === e.destination)?.name)}</td><td><span class="badge ${CONF[e.confLevel][1]}">${CONF[e.confLevel][0]}</span></td></tr>`; }).join("")}
      </tbody></table></div>` : ""}
    </div>
  </div>
  ${navFoot()}`;
};
BIND.plan = (el) => {
  const gen = () => {
    const { evals } = computeAll();
    mutate((s) => { s.plan = { steps: generatePlan(s, evals), signature: planSignature(evals), edited: false, createdAt: new Date().toISOString() }; });
    ui.planIndex = 0;
    render();
  };
  $("#gen-plan", el)?.addEventListener("click", gen);
  $("#regen", el)?.addEventListener("click", () => { if (!state.plan.edited || confirm("직접 수정한 순서·공법·장비가 사라집니다. 다시 생성할까요?")) gen(); });
  $("#regen-2", el)?.addEventListener("click", gen);
  if (!state.plan) return;

  const steps = state.plan.steps;
  const setIdx = (i) => { ui.planIndex = Math.max(0, Math.min(steps.length, i)); render(); };
  $$("[data-sel]", el).forEach((li) => li.addEventListener("click", (e) => { if (e.target.closest("button,select")) return; setIdx(+li.dataset.sel); }));
  const move = (i, d) => mutate((s) => { const st = s.plan.steps; [st[i], st[i + d]] = [st[i + d], st[i]]; s.plan.edited = true; });
  $$("[data-up]", el).forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.up; move(i, -1); ui.planIndex = i - 1; render(); }));
  $$("[data-down]", el).forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.down; move(i, 1); ui.planIndex = i + 1; render(); }));
  $$("[data-method]", el).forEach((sel) => sel.addEventListener("change", () => { mutate((s) => { s.plan.steps[+sel.dataset.method].method = sel.value; s.plan.edited = true; }); render(); }));
  $$("[data-equip]", el).forEach((sel) => sel.addEventListener("change", () => { mutate((s) => { s.plan.steps[+sel.dataset.equip].equipment = sel.value; s.plan.edited = true; }); render(); }));

  $("#prev", el).addEventListener("click", () => setIdx(ui.planIndex - 1));
  $("#next", el).addEventListener("click", () => setIdx(ui.planIndex + 1));
  $("#scrub", el).addEventListener("change", (e) => setIdx(+e.target.value));
  $("#play", el).addEventListener("click", () => {
    ui.playing = !ui.playing;
    if (ui.playing && ui.planIndex >= steps.length) ui.planIndex = 0;
    render();
  });
  if (ui.playing) {
    ui.playTimer = setTimeout(() => {
      ui.planIndex++;
      if (ui.planIndex >= steps.length) ui.playing = false;
      render();
    }, 1400);
  }

  mountViewer(el);
};

async function mountViewer(el) {
  const box = $("#viewer", el);
  const { evals } = computeAll();
  const legend = (mode) => mode === "grade"
    ? [["#2F7D4F", "재사용 가능"], ["#D9B23A", "검토 필요"], ["#B2ABA1", "폐기·재활용"], ["#E8742A", "현재 단계"]]
    : [["#9C9084", "콘크리트·골재"], ["#4A6FA5", "구조용 강재"], ["#E8742A", "현재 단계"]];
  const setLegend = (mode) => { $("#legend", el).innerHTML = legend(mode).map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join(""); };
  setLegend(ui.viewMode || "grade");
  $$("[data-mode]", el).forEach((b) => b.classList.toggle("on", b.dataset.mode === (ui.viewMode || "grade")));
  try {
    const { createViewer } = await import("./viewer3d.js");
    if (!document.body.contains(box)) return;
    ui.viewer = createViewer(box, {
      materials: state.materials, evals, steps: state.plan.steps, floors: state.project.floors, view: ui.view,
      onPick: (m) => {
        const pick = $("#pick", el);
        if (!m) { pick.hidden = true; return; }
        const e = evals[m.id];
        const stepNo = state.plan.steps.findIndex((s) => s.materialIds.includes(m.id)) + 1;
        pick.hidden = false;
        pick.innerHTML = `<strong><span class="type-dot ${m.type}"></span>${m.label} ${esc(m.member)}</strong>
          <dl><dt>종류</dt><dd>${TYPE_LABEL[m.type]}</dd><dt>규격</dt><dd>${esc(m.spec) || "-"}</dd><dt>위치</dt><dd>${m.member === "기초" ? "기초" : m.floor + "층"} ${m.zone}구역</dd>
          <dt>수량</dt><dd>${ton(m.qty)}</dd><dt>예상 가치</dt><dd>${man(e.value)}</dd><dt>해체 단계</dt><dd>${stepNo || "-"}단계</dd>
          <dt>판정</dt><dd><span class="badge ${GRADE[e.grade].cls}">${GRADE[e.grade].label}</span></dd><dt>신뢰도</dt><dd>${CONF[e.confLevel][0]}</dd></dl>`;
      },
    });
    ui.viewer.setMode(ui.viewMode || "grade");
    ui.viewer.setStep(Math.min(ui.planIndex, state.plan.steps.length));
    $$("[data-mode]", el).forEach((b) => b.addEventListener("click", () => {
      ui.viewMode = b.dataset.mode;
      $$("[data-mode]", el).forEach((x) => x.classList.toggle("on", x === b));
      setLegend(ui.viewMode);
      ui.viewer?.setMode(ui.viewMode);
    }));
  } catch (err) {
    console.error(err);
    box.insertAdjacentHTML("afterbegin", `<div class="fallback">3D 화면을 불러오지 못했습니다 (WebGL 또는 네트워크 문제). 아래 단계 목록과 대상 자재 표로 계획을 확인하세요.</div>`);
  }
}

PAGES.review = () => {
  const r = state.review;
  const { evals, selected, econ, logi } = computeAll();
  const order = ["draft", "review", "changes", "approved"];
  const isReviewer = REVIEWER_ROLES.includes(ui.role);
  const isApprover = ui.role === "승인권자";
  const actions = {
    draft: [["review", "검토 요청", "btn-primary", true]],
    review: [["changes", "수정 요청", "btn-outline", isReviewer], ["rejected", "반려", "btn-outline", isApprover], ["approved", "승인", "btn-primary", isApprover]],
    changes: [["review", "재검토 요청", "btn-primary", true]],
    approved: [["draft", "승인 취소", "btn-outline", isApprover]],
    rejected: [["draft", "초안으로 되돌리기", "btn-outline", true]],
  }[r.status];
  const approvedEntry = r.status === "approved" ? r.history.find((h) => h.action === "승인") : null;
  return `
  ${pageHead("검토·승인 및 보고서", "분석 결과를 초안 → 검토 중 → 승인 흐름으로 관리하고, 승인된 결과를 보고서로 내보냅니다.")}
  <div class="grid-2" style="grid-template-columns:minmax(0,2fr) minmax(0,3fr);align-items:start">
    <div class="card" style="display:grid;gap:16px">
      <div class="card-head" style="margin:0"><h3>${I("shield")} 검토 상태</h3><span class="badge ${STATUS[r.status].cls}">${STATUS[r.status].label}</span></div>
      <div class="status-flow">${order.map((s, i) => `<span class="s ${r.status === s ? "on" : ""}">${STATUS[s].label}</span>${i < order.length - 1 ? I("chevron-right") : ""}`).join("")}</div>
      ${r.status !== "approved" ? `<div class="disclaimer">${I("alert")}<div><strong>업무 적용 전 전문가 검토 필요</strong> — 승인되지 않은 결과는 실제 해체 작업에 쓸 수 없습니다.</div></div>` : ""}
      <div class="field"><label for="comment">검토 의견 <span class="muted">(수정 요청·반려 시 필수)</span></label><textarea class="textarea" id="comment" placeholder="예: 4층 D구역 벽체는 비내력벽 여부 현장 확인 후 순서 조정 필요"></textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" id="add-comment">${I("message")} 의견만 남기기</button>
        ${actions.map(([to, label, cls, ok]) => `<button class="btn ${cls}" data-to="${to}" ${ok ? "" : "disabled"} title="${ok ? "" : "현재 역할로는 할 수 없습니다"}">${label}</button>`).join("")}
      </div>
      <p class="caption muted">현재 역할: <strong>${esc(ui.role)}</strong> · 승인·반려는 '승인권자', 수정 요청은 기술자·공공기관 검토자·승인권자만 할 수 있습니다.</p>
      <h4 style="margin-top:8px">이력</h4>
      <ul class="timeline">${r.history.map((h) => `<li><span class="av">${esc(h.role.slice(0, 2))}</span><div><span class="who">${esc(h.role)}</span> · ${esc(h.action)}<span class="when">${fmtDate(h.at)}</span>${h.text ? `<div class="muted" style="font-size:13px">${esc(h.text)}</div>` : ""}</div></li>`).join("") || '<li class="muted">이력이 없습니다.</li>'}</ul>
    </div>
    <div style="display:grid;gap:12px;min-width:0">
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-outline" id="csv" ${state.materials.length ? "" : "disabled"}>${I("download")} 자재 목록 CSV</button>
        <button class="btn ${r.status === "approved" ? "btn-primary" : "btn-outline"}" id="print">${I("printer")} ${r.status === "approved" ? "보고서 PDF 저장" : "검토용 초안 인쇄"}</button>
      </div>
      ${report(evals, selected, econ, logi, approvedEntry)}
    </div>
  </div>
  ${navFoot()}`;
};
BIND.review = (el) => {
  const text = () => $("#comment", el).value.trim();
  $("#add-comment", el).addEventListener("click", () => {
    if (!text()) { toast("의견을 입력하세요."); return; }
    log(ui.role, "의견", text()); save(); render();
  });
  $$("[data-to]", el).forEach((b) => b.addEventListener("click", () => {
    const to = b.dataset.to;
    if (["changes", "rejected"].includes(to) && !text()) { toast("수정 요청·반려에는 검토 의견이 필요합니다."); $("#comment", el).focus(); return; }
    if (to === "review" && !checkInputQuality(state).ready) { toast("필수 입력이 누락되어 검토를 요청할 수 없습니다. 건물 정보 단계를 확인하세요."); return; }
    if (to === "review" && !state.plan) { toast("해체 계획을 먼저 생성하세요."); return; }
    const labels = { review: "검토 요청", changes: "수정 요청", rejected: "반려", approved: "승인", draft: "초안으로 변경" };
    state.review.status = to;
    log(ui.role, labels[to], text());
    save(); render();
  }));
  $("#print", el).addEventListener("click", () => window.print());
  $("#csv", el).addEventListener("click", exportCsv);
};

function report(evals, selected, econ, logi, approvedEntry) {
  const p = state.project;
  const approved = state.review.status === "approved";
  const total = state.materials.reduce((s, m) => s + (+m.qty || 0), 0);
  const net = econ.reduce((s, r) => s + r.net, 0);
  const sums = econ.reduce((a, r) => ({ v: a.v + r.e.value, d: a.d + r.e.dismantleCost, f: a.f + r.e.disposalCost, t: a.t + r.transport }), { v: 0, d: 0, f: 0, t: 0 });
  const conf = { high: 0, mid: 0, low: 0 };
  state.materials.forEach((m) => conf[evals[m.id].confLevel]++);
  const byId = Object.fromEntries(state.materials.map((m) => [m.id, m]));
  // 좁은 화면에서는 표만 가로 스크롤되도록 감싼다
  return reportHtml(p, approved, total, net, sums, conf, byId, evals, selected, econ, logi, approvedEntry)
    .replaceAll('<table class="tbl">', '<div class="report-scroll"><table class="tbl">')
    .replaceAll("</table>", "</table></div>");
}

function reportHtml(p, approved, total, net, sums, conf, byId, evals, selected, econ, logi, approvedEntry) {
  return `<article class="report" id="print-area">
    ${approved ? "" : '<div class="watermark">검토용 · 업무 적용 불가</div>'}
    <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div><span class="caption muted">해체 계획 검토 보고서</span><h2>${esc(p.name || "이름 없는 프로젝트")}</h2></div>
      <span class="badge ${STATUS[state.review.status].cls}" style="align-self:flex-start">${STATUS[state.review.status].label}</span>
    </div>
    <div class="meta-grid">
      <div><b>주소</b>${esc(p.address) || "-"}</div><div><b>용도 · 구조</b>${esc(p.use) || "-"} · ${esc(p.structure) || "-"}</div><div><b>규모</b>지상 ${p.floors || "-"}층 · ${p.area ? (+p.area).toLocaleString() + "㎡" : "-"}</div>
      <div><b>건축 연도</b>${p.year || "-"}</div><div><b>해체 예정일</b>${p.demoDate || "-"}</div><div><b>분석 일시</b>${fmtDate(new Date().toISOString())}</div>
      <div><b>가격 기준일</b>${state.prices.basisDate} (가정값)</div><div><b>승인</b>${approvedEntry ? `${esc(approvedEntry.role)} · ${fmtDate(approvedEntry.at)}` : "미승인"}</div><div><b>데이터 신뢰도</b>높음 ${conf.high} · 보통 ${conf.mid} · 낮음 ${conf.low}</div>
    </div>

    <h3>1. 요약</h3>
    <table class="tbl"><tbody>
      <tr><th>전체 자재</th><td class="r">${ton(total)} (${state.materials.length}건)</td><th>예상 회수 가치</th><td class="r">${man(sums.v)}</td></tr>
      <tr><th>해체비</th><td class="r">${man(sums.d)}</td><th>처리비</th><td class="r">${man(sums.f)}</td></tr>
      <tr><th>운송비 (${esc(selected?.label || "-")})</th><td class="r">${man(sums.t)}</td><th>순경제성</th><td class="r"><strong>${man(net)}</strong></td></tr>
      <tr><th>기본안 대비 운송비 절감</th><td class="r">${Math.round((logi.saving || 0) * 100)}%</td><th>운송</th><td class="r">${selected?.trips ?? 0}회 · ${Math.round(selected?.km || 0)}km · ${selected?.days ?? 0}일</td></tr>
    </tbody></table>

    <h3>2. 자재 평가</h3>
    <table class="tbl"><thead><tr><th>자재</th><th>위치</th><th class="r">수량</th><th class="r">점수</th><th>판정</th><th>처리 경로</th><th class="r">순경제성</th><th>신뢰도</th></tr></thead><tbody>
      ${econ.map((r) => `<tr><td>${r.m.label} ${esc(r.m.member)} (${TYPE_LABEL[r.m.type]})</td><td>${r.m.member === "기초" ? "기초" : r.m.floor + "층"} ${r.m.zone}</td><td class="r">${ton(r.m.qty)}</td><td class="r">${r.e.score}</td><td>${GRADE[r.e.grade].label}</td><td>${r.e.route}</td><td class="r">${man(r.net)}</td><td>${CONF[r.e.confLevel][0]}</td></tr>`).join("")}
    </tbody></table>

    <h3>3. 해체 순서·공법·장비</h3>
    ${state.plan ? `<table class="tbl"><thead><tr><th>#</th><th>단계</th><th>대상</th><th>공법</th><th>장비</th><th>비고</th></tr></thead><tbody>
      ${state.plan.steps.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${s.materialIds.map((id) => byId[id]?.label).filter(Boolean).join(", ") || "-"}</td><td>${esc(s.method)}</td><td>${esc(s.equipment)}</td><td>${s.warning ? "검토 필요" : ""}</td></tr>`).join("")}
    </tbody></table>${state.plan.edited ? '<p class="caption muted" style="margin-top:6px">사용자가 추천 계획을 수정했습니다.</p>' : ""}` : '<p class="muted">해체 계획이 아직 생성되지 않았습니다.</p>'}

    <h3>4. 물류 계획</h3>
    ${selected ? `<table class="tbl"><thead><tr><th>목적지</th><th class="r">거리</th><th class="r">반입 물량</th></tr></thead><tbody>
      ${state.destinations.filter((d) => logi.demands[d.id]).map((d) => `<tr><td>${esc(d.name)}</td><td class="r">${d.distance}km</td><td class="r">${ton(logi.demands[d.id])}</td></tr>`).join("")}
    </tbody></table>` : ""}

    <h3>5. 주요 가정과 제한 사항</h3>
    <ul style="font-size:13px;line-height:1.8;padding-left:18px;margin:0">
      <li>자재 평가는 사용자 입력과 사진을 보고 선택한 외관 손상 태그를 바탕으로 한 규칙 기반 점수입니다.</li>
      <li>단가는 기본 가정값입니다: 재사용 강재 ${state.prices.steelReuse.toLocaleString()}원/t, 고철 ${state.prices.steelScrap.toLocaleString()}원/t, 순환골재 반입비 ${state.prices.concreteRecycleFee.toLocaleString()}원/t, 혼합폐기물 ${state.prices.mixedWasteFee.toLocaleString()}원/t.</li>
      <li>운송 시간은 평균 40km/h, 상하차 30분, 하루 8시간 기준입니다. 목적지 위치는 거리·방위로 단순화했습니다.</li>
      <li><strong>분석 범위의 제한:</strong> CAD 도면 자동 인식, 3D 스캔 기반 정밀 진단·부식 추정, 내부 결함 탐지, 구조 안전성 시뮬레이션은 포함되지 않습니다.</li>
      <li>이 보고서는 1차 스크리닝 자료이며, 실제 착공 전 자격을 갖춘 전문가 검토와 관계기관 승인이 필요합니다.</li>
    </ul>

    <h3>6. 검토 이력</h3>
    <table class="tbl"><tbody>${state.review.history.slice(0, 12).map((h) => `<tr><td style="white-space:nowrap">${fmtDate(h.at)}</td><td>${esc(h.role)}</td><td>${esc(h.action)}</td><td>${esc(h.text)}</td></tr>`).join("") || '<tr><td class="muted">이력 없음</td></tr>'}</tbody></table>
  </article>`;
}

function exportCsv() {
  const { evals, transport } = computeAll();
  const approved = state.review.status === "approved";
  const rows = [
    approved ? ["승인된 결과"] : ["검토용 초안 - 업무 적용 전 전문가 검토 필요"],
    [`가격 기준일 ${state.prices.basisDate} (가정값)`],
    [],
    ["번호", "자재", "부재", "규격", "층", "구역", "수량(t)", "외관 상태", "손상", "재사용 점수", "판정", "처리 경로", "예상 가치(원)", "해체 난이도", "해체비(원)", "처리비(원)", "운송비(원)", "신뢰도"],
    ...state.materials.map((m) => {
      const e = evals[m.id];
      return [m.label, TYPE_LABEL[m.type], m.member, m.spec, m.floor, m.zone, m.qty, CONDITIONS[m.condition] || "", (m.damage || []).map((d) => DAMAGE[d]).join("/"),
        e.score, GRADE[e.grade].label, e.route, Math.round(e.value), e.difficulty, Math.round(e.dismantleCost), Math.round(e.disposalCost), Math.round(transport[m.id] || 0), CONF[e.confLevel][0]];
    }),
  ];
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${state.project.name || "reclaim"}_자재평가${approved ? "" : "_검토용"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- global events ---------------- */

document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-step]");
  if (s) { go(+s.dataset.step); return; }
  const g = e.target.closest("[data-go]");
  if (g) { go(+g.dataset.go); window.scrollTo(0, 0); }
});
window.addEventListener("hashchange", () => { ui.step = stepFromHash(); render(); });
$("#role").addEventListener("change", (e) => { ui.role = e.target.value; sessionSet("role", ui.role); render(); });
$("#menu").addEventListener("click", () => $("#side").classList.toggle("open"));
$("#load-demo").addEventListener("click", async () => {
  if (state.materials.length && !confirm("현재 프로젝트를 예시 프로젝트로 바꿀까요? 입력한 내용은 사라집니다.")) return;
  await loadDemo();
});
if (session) {
  $("#user").innerHTML = `
    <span class="avatar" aria-hidden="true">${esc(session.name.slice(0, 1).toUpperCase())}</span>
    <span class="who"><strong>${esc(session.name)}</strong><span>${esc(session.email)}</span></span>
    <button class="btn btn-outline btn-sm" id="logout" type="button">로그아웃</button>`;
  $("#logout").addEventListener("click", () => { window.auth.logout(); location.href = "login.html"; });
}
$("#reset").addEventListener("click", () => {
  if (!confirm("새 프로젝트를 시작할까요? 현재 입력한 내용은 사라집니다.")) return;
  state = emptyState(); ui.planIndex = 0; save(); go(0); render();
});
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme); } catch {}
});

async function loadDemo() {
  const { demoState } = await import("./demo.js");
  state = demoState();
  ui.planIndex = 0;
  save();
  toast("예시 프로젝트를 불러왔습니다.");
  render();
}

try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.dataset.theme = t; } catch {}
if (new URLSearchParams(location.search).get("demo") === "1" && !state.materials.length) {
  await loadDemo();
  history.replaceState(null, "", location.pathname + location.hash);
} else render();
