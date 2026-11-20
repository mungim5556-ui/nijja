// 화면과 상태. 계산은 scenario.js / sensitivity.js / classify.js가 한다.
import { compare, paramValues, quantitiesFromArea, paperMode, STREAMS, STREAM_LABEL, SEPARATED } from "./scenario.js";
import { variables, tornado, breakEven, simulate, histogram } from "./sensitivity.js";
import { classify, quantitiesFromElements, supplement, checkAgainstUnits, elementResults, toCsv, groupKey, CATEGORY_LABEL } from "./classify.js";
import { stackedBars, tornadoChart, histChart, legend, mil, num } from "./charts.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const json = async (f) => (await fetch(`assets/data/${f}`)).json();
const [rates, paper] = await Promise.all([json("rates.json"), json("paper2023_case.json")]);
const defaults = paramValues(rates);

const TABS = [["model", "모델"], ["rates", "단가"], ["compare", "비교"], ["export", "내보내기"]];
const STREAM_COLOR = { concrete: "#9c9084", metal: "#4a6fa5", wood: "#b0783c", resin: "#c05a9a", glass: "#58b8d8", board: "#d9b23a", mixed: "#6f747d", copper: "#c8642a", aluminum: "#b8c4d0" };
const METHOD_COLOR = { 분별: "#1baf7a", 압쇄: "#9c9084" };

const saved = (() => { try { return JSON.parse(localStorage.getItem("rc.state")) || {}; } catch { return {}; } })();
const state = {
  tab: "model", source: null, fileName: "", model: null, elements: [], overrides: {},
  area: saved.area || 2400, usage: saved.usage || "공동주택", supplement: true,
  p: { ...defaults, ...saved.p }, seed: 1, colorMode: "stream", busy: "", error: "",
};
let viewer = null, sim = null;
// 계산에 쓰는 단가: 저장된 단가 + (계획서를 열었을 때만) 그 계획서의 철근량. 계획서 값은 저장하지 않아 다음 IFC에 섞이지 않는다.
const effP = () => (state.planP ? { ...state.p, ...state.planP } : state.p);
const changedParams = () => Object.keys(defaults).filter((k) => state.p[k] !== defaults[k]);
const save = () => { try { localStorage.setItem("rc.state", JSON.stringify({ area: state.area, usage: state.usage, p: state.p })); } catch { /* 저장 불가여도 계산은 된다 */ } };

function derive() {
  if (!state.source) return null;
  let classified = [], q;
  if (state.source === "ifc") {
    classified = state.elements.map((e) => classify(e, rates, state.overrides));
    const raw = quantitiesFromElements(classified, state.area);
    q = state.supplement ? supplement(raw, state.usage, rates) : { ...raw, added: {} };
    q.raw = raw;
  } else q = { ...quantitiesFromArea(state.area, state.usage, rates), added: {} };
  return { classified, q, cmp: compare(q, effP()) };
}

/* ---------------- 모델 ---------------- */
// 해체계획서 데이터(JSON) → 구조체 IFC를 만들어 그대로 읽어 들인다
async function loadPlan(plan, name) {
  try {
    if (plan.schema !== "reclaim-plan/1") throw new Error('schema가 "reclaim-plan/1"이 아닙니다');
    const { planToIfc } = await import("./plan.js");
    const b = plan.building || {};
    if (rates.wasteUnits[b.wasteUnit]) state.usage = b.wasteUnit;
    state.planP = plan.rebar_kg_per_m3?.value ? { rebar_kg_per_m3: plan.rebar_kg_per_m3.value } : null;
    await loadIfc(new TextEncoder().encode(planToIfc(plan)).buffer, `${name} → 자동 생성 구조체 모델`, b.demolition_area_m2 || b.area_m2, plan);
  } catch (e) {
    state.error = `계획서 데이터를 읽지 못했습니다: ${e.message}`; render();
  }
}

async function fileHash(buf) {
  try { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  catch { return ""; }
}
// IFC를 열 때 용도를 묻는다 (같은 파일에서 마지막으로 고른 값을 기본으로, 매번 확인)
function askUsage(hash, name) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("rc.useByFile") || "{}"); } catch { /* 없으면 기본값 */ }
  const def = (hash && saved[hash]) || "공동주택";
  const dlg = $("#use-dlg");
  dlg.innerHTML = `<form method="dialog" class="use-form">
      <h2 id="use-title">건물 용도·구조</h2>
      <p class="caption muted"><strong>${esc(name)}</strong>의 용도를 골라 주세요. 원단위 보충과 검산 기준이 됩니다.${hash && saved[hash] ? " 이 파일에서 지난번에 고른 값을 미리 골라 두었습니다." : ""}</p>
      <select class="select">${Object.keys(rates.wasteUnits).map((u) => `<option ${u === def ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" value="ok">확인</button></div>
    </form>`;
  return new Promise((resolve) => {
    dlg.onclose = () => {
      const u = dlg.querySelector("select").value;
      if (hash) { saved[hash] = u; try { localStorage.setItem("rc.useByFile", JSON.stringify(saved)); } catch { /* 저장 불가 */ } }
      resolve(u);
    };
    dlg.showModal();
  });
}

let loading = false;
async function loadIfc(buffer, name, area, plan = null) {
  if (loading) return;
  loading = true;
  state.plan = plan;
  if (!plan) state.planP = null;
  state.busy = "IFC를 읽는 중입니다…"; state.error = ""; render();
  try {
    const { parseIfc } = await import("./ifc.js");
    const hash = await fileHash(buffer.slice(0));
    const model = await parseIfc(buffer);
    if (!plan) { state.busy = "용도를 골라 주세요"; render(); state.usage = await askUsage(hash, name); }
    Object.assign(state, { source: "ifc", model, elements: model.elements, fileName: name, fileHash: hash, overrides: {},
      area: area || Math.round(model.size[0] * model.size[2] * model.floors) });
  } catch (e) {
    state.error = `IFC를 읽지 못했습니다: ${e.message}`;
  }
  state.busy = ""; loading = false; sim = null; save(); render();
}

function modelTab(d) {
  const input = `
    <section class="card">
      <h2>1. 물량 입력</h2>
      <div class="drop" id="drop">
        <p><strong>Revit에서 내보낸 IFC 파일</strong>을 여기에 끌어 놓거나 고르세요. (Revit: 파일 › 내보내기 › IFC)</p>
        <div class="row no-print">
          <label class="btn btn-primary">IFC 파일 고르기<input type="file" id="file" accept=".ifc" hidden></label>
          <button class="btn btn-outline" data-act="sample">예시 모델 불러오기</button>
          <button class="btn btn-outline" data-act="area">IFC 없이 면적만으로 계산</button>
        </div>
        <p style="margin-top:8px"><strong>Revit 모델이 없으면</strong> 해체계획서의 구조도면을 옮긴 데이터(JSON)로 구조체 모델을 자동 생성합니다.</p>
        <div class="row no-print">
          <label class="btn btn-outline">계획서 데이터(JSON) 고르기<input type="file" id="planfile" accept=".json" hidden></label>
          <button class="btn btn-outline" data-act="plan-sample">계획서 예시 (가상 건물)</button>
        </div>
        ${state.busy ? `<p class="badge badge-info">${esc(state.busy)}</p>` : ""}
        ${state.error ? `<p class="badge badge-danger">${esc(state.error)}</p>` : ""}
        ${state.source ? `<p class="caption muted">현재: ${state.source === "ifc" ? `IFC · ${esc(state.fileName)} · 부재 ${num(state.elements.length)}개 · ${state.model.floors}개 층` : "면적 × 표준품셈 원단위 (간이 계산)"}</p>` : ""}
      </div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field"><label>연면적 (㎡)</label><input class="input" type="number" min="1" data-set="area" value="${state.area}"></div>
        <div class="field"><label>용도·구조 (원단위 기준)</label><select class="select" data-set="usage">${Object.keys(rates.wasteUnits).map((u) => `<option ${u === state.usage ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        ${state.source === "ifc" ? `<div class="field"><label>모델에 없는 내장재</label><label class="row"><input type="checkbox" data-set="supplement" ${state.supplement ? "checked" : ""}> 원단위로 보충한다</label></div>` : ""}
      </div>
      ${state.source === "ifc" ? `<p class="caption muted" style="margin-top:8px">연면적은 모델의 바닥 크기 × 층수로 넣어 두었습니다. 실제 값과 다르면 고치세요.</p>` : ""}
    </section>`;
  if (!d) return input;

  const { q, classified } = d;
  const total = STREAMS.reduce((s, k) => s + q.t[k], 0);
  const units = rates.wasteUnits[state.usage];
  const check = state.source === "ifc" ? checkAgainstUnits(q.raw, state.usage, rates) : [];
  const off = check.filter((c) => c.ratio < 0.5 || c.ratio > 2);
  const streamRows = STREAMS.filter((s) => q.t[s] > 0).map((s) => {
    const added = q.added[s] || 0, u = units[s];
    return `<tr><td><i class="dot" style="background:${STREAM_COLOR[s]}"></i> ${STREAM_LABEL[s]}</td>
      <td class="r">${num(q.t[s] - added, 1)}</td><td class="r">${added ? num(added, 1) : "–"}</td><td class="r">${num(q.t[s], 1)}</td>
      <td class="r">${num(q.t[s] / q.area_m2, 4)}</td><td class="r">${u != null ? num(u, 4) : "–"}</td>
      <td>${SEPARATED.has(s) ? '<span class="badge badge-success">분별 대상</span>' : ""}</td></tr>`;
  }).join("");

  let groups = "";
  if (state.source === "ifc") {
    const g = new Map();
    for (const el of classified) {
      const k = groupKey(el), x = g.get(k) || { el, n: 0, tons: 0, guessed: false };
      x.n++; x.tons += el.tons; x.guessed ||= el.guessed;
      g.set(k, x);
    }
    groups = `<section class="card"><h2>부재 그룹별 성상</h2>
      <p class="lead" style="margin-bottom:12px">재료 이름으로 성상을 자동 분류했습니다. 틀린 곳은 직접 고치세요. <span class="badge badge-warning">추정</span>은 재료 이름으로 알 수 없어 부재 종류로 정한 것입니다.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>부재</th><th>재료 (IFC)</th><th class="r">개수</th><th class="r">톤</th><th>성상</th></tr></thead><tbody>
      ${[...g].sort((a, b) => b[1].tons - a[1].tons).map(([k, x]) => `<tr><td>${CATEGORY_LABEL[x.el.category]}</td><td>${esc(x.el.layers.map((l) => l.name).join(" + ") || "(재료 없음)")} ${x.guessed ? '<span class="badge badge-warning">추정</span>' : ""}</td>
        <td class="r">${num(x.n)}</td><td class="r">${num(x.tons, 2)}</td>
        <td><select class="select sm" data-override="${esc(k)}"><option value="">자동 (${x.el.parts.length > 1 && !state.overrides[k] ? "층별" : STREAM_LABEL[x.el.stream]})</option>${STREAMS.map((s) => `<option value="${s}" ${state.overrides[k] === s ? "selected" : ""}>${STREAM_LABEL[s]}</option>`).join("")}</select></td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  return `${input}
    <section class="kpis">
      <div class="card kpi"><div class="v">${num(total)} t</div><div class="l">예상 폐기물·자재 총량</div></div>
      <div class="card kpi"><div class="v">${num(total / q.area_m2, 3)}</div><div class="l">t/㎡ (원단위 합계 ${num(Object.values(units).reduce((a, b) => a + b, 0), 3)})</div></div>
      <div class="card kpi"><div class="v">${num(q.concrete_m3)} ㎥</div><div class="l">구조체 콘크리트 부피</div></div>
      <div class="card kpi"><div class="v">${num(STREAMS.filter((s) => SEPARATED.has(s)).reduce((s, k) => s + q.t[k], 0), 1)} t</div><div class="l">분별 대상 물량</div></div>
    </section>
    ${off.length ? `<div class="disclaimer"><div><strong>원단위 검산:</strong> ${off.map((c) => `${STREAM_LABEL[c.stream]} ${num(c.ratio * 100)}%`).join(", ")} — 모델 물량이 표준품셈 원단위와 2배 이상 차이 납니다. 모델에 해당 자재가 빠졌거나 분류가 틀렸을 수 있습니다.${state.supplement ? " 목재·합성수지·혼합폐기물의 부족분은 원단위로 채웠습니다." : ""}</div></div>` : ""}
    ${planCard(q)}
    ${state.source === "ifc" ? `<section class="card"><h2>3D 모델</h2>${viewerBox()}</section>` : ""}
    <section class="card"><h2>성상별 물량</h2>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>성상</th><th class="r">${state.source === "ifc" ? "모델 (t)" : "원단위 (t)"}</th><th class="r">보충 (t)</th><th class="r">합계 (t)</th><th class="r">t/㎡</th><th class="r">표준품셈 원단위</th><th></th></tr></thead>
      <tbody>${streamRows}</tbody><tfoot><tr><td>합계</td><td></td><td></td><td class="r">${num(total, 1)}</td><td class="r">${num(total / q.area_m2, 4)}</td><td></td><td></td></tr></tfoot></table></div>
      ${q.rebarFromConcrete ? `<p class="caption muted" style="margin-top:8px">철근은 모델에 없어 콘크리트 1㎥당 ${num(effP().rebar_kg_per_m3)}kg으로 추정해 고철 수익에 넣습니다 (약 ${num((q.concrete_m3 * effP().rebar_kg_per_m3) / 1000, 1)} t).</p>` : ""}
    </section>
    ${groups}`;
}

// 계획서에서 만든 모델이면 계획서 내용과 검산 결과를 보여준다
function planCard(q) {
  const plan = state.plan;
  if (!plan || state.source !== "ifc") return "";
  const b = plan.building, d = plan.demolition || {}, model = (q.raw || q).t.concrete, want = plan.check?.waste_concrete_t;
  const assumed = Object.entries(plan.sections).filter(([, s]) => s.assumed).map(([k]) => k);
  return `<section class="card"><h2>해체계획서에서 읽은 정보</h2>
    <div class="table-wrap"><table class="tbl"><tbody>
      <tr><th>건물</th><td>${esc(b.name)} · ${esc(b.usage)} · ${esc(b.structure)} · ${b.built}년 · 지하 ${b.floors_below} / 지상 ${b.floors_above}층</td></tr>
      <tr><th>면적</th><td>연면적 ${num(b.area_m2, 1)}㎡ · 해체 연면적 ${num(b.demolition_area_m2, 2)}㎡</td></tr>
      <tr><th>해체</th><td>${esc(d.scope || "–")} · ${esc(d.method || "–")}${d.period ? ` · ${d.period.join(" ~ ")}` : ""}</td></tr>
      <tr><th>재료</th><td>콘크리트 ${plan.materials.concrete_fck_MPa}MPa · 철근 ${plan.materials.rebar_fy_MPa}MPa · 철근량 ${num(plan.rebar_kg_per_m3?.value || 0)}kg/㎥ (${esc(plan.rebar_kg_per_m3?.note || "")})</td></tr>
      <tr><th>유해물질</th><td>석면 ${plan.hazards?.asbestos ? "검출" : "불검출"}</td></tr>
      <tr><th>부재</th><td class="mono">${Object.entries(plan.sections).map(([k, s]) => `${k} ${s.t ? "T" + s.t : s.b + "×" + s.h}`).join(" · ")}</td></tr>
    </tbody></table></div>
    ${want ? `<p style="margin-top:12px"><strong>검산:</strong> 생성한 모델의 콘크리트 ${num(model)}t ÷ 계획서 폐콘크리트 약 ${num(want)}t = <strong>${num((model / want) * 100)}%</strong>. 차이는 구조도면에 없는 조적벽·계단·외벽 마감으로 보입니다.</p>` : ""}
    <p class="caption muted" style="margin-top:8px">구조체(기둥·보·벽·슬래브)와 바닥 마감 몰탈만 들어 있습니다. 내장재·창호·설비는 계획서에 없어 원단위로 보충합니다.${assumed.length ? ` 치수를 가정한 부재: ${assumed.join(", ")}.` : ""} ${esc(plan.source?.note || "")}</p>
  </section>`;
}

function viewerBox() {
  const items = state.colorMode === "stream" ? STREAMS.map((s) => [STREAM_LABEL[s], STREAM_COLOR[s]]) : [["분별해체 대상", METHOD_COLOR.분별], ["구조체와 함께 압쇄 (반투명)", METHOD_COLOR.압쇄]];
  return `<div class="viewer" id="viewer"><div class="modes no-print">
      <button class="btn btn-sm ${state.colorMode === "stream" ? "btn-secondary" : "btn-outline"}" data-color="stream">성상별</button>
      <button class="btn btn-sm ${state.colorMode === "method" ? "btn-secondary" : "btn-outline"}" data-color="method">분별 / 압쇄</button>
    </div><div class="pick" id="pick">부재를 누르면 정보가 나옵니다. 끌어서 돌리고, 휠로 확대합니다.</div></div>${legend(items)}`;
}

async function mountViewer(d) {
  viewer?.dispose(); viewer = null;
  const box = $("#viewer");
  if (!box || !state.model) return;
  const byId = new Map(d.classified.map((e) => [e.expressID, e]));
  const color = (id) => { const e = byId.get(id); if (!e) return null; if (state.colorMode === "stream") return STREAM_COLOR[e.stream]; return SEPARATED.has(e.stream) ? METHOD_COLOR.분별 : [METHOD_COLOR.압쇄, 0.06]; }; // 압쇄 대상은 비쳐 보이게 해서 안쪽 내장재가 드러난다
  const { createViewer } = await import("./viewer3d.js");
  viewer = createViewer(box, state.model, color, (id) => {
    const e = byId.get(id);
    $("#pick").innerHTML = e ? `<strong>${CATEGORY_LABEL[e.category]}</strong> ${esc(e.name)} · ${e.floor}층 · ${num(e.tons, 3)} t · ${STREAM_LABEL[e.stream]} · ${SEPARATED.has(e.stream) ? "분별" : "압쇄"}<br><span class="muted">${esc(e.layers.map((l) => l.name).join(" + ") || "재료 없음")} · Revit ID ${esc(e.tag || "–")}</span>` : "부재를 누르면 정보가 나옵니다.";
  });
}

/* ---------------- 단가 ---------------- */
function ratesTab() {
  const r = paperMode(paper), ok = r.delta === paper.expected.delta;
  let last = "", rows = "";
  for (const [k, v] of Object.entries(rates.params)) {
    if (v.group !== last) { rows += `<tr class="grp"><td colspan="5">${v.group}</td></tr>`; last = v.group; }
    const changed = state.p[k] !== v.value;
    rows += `<tr><td>${esc(v.label)} ${v.assumed ? '<span class="badge badge-warning">가정</span>' : ""} ${changed ? '<span class="badge badge-info">수정됨</span>' : ""}</td>
      <td class="r"><input class="input sm" type="number" step="any" data-p="${k}" value="${state.p[k]}"></td><td>${v.unit}</td>
      <td class="muted">${v.min != null ? `${num(v.min, v.min < 10 ? 2 : 0)} ~ ${num(v.max, v.max < 10 ? 2 : 0)}` : "–"}</td>
      <td class="muted">${esc(rates.sources[v.source] || "출처 없음 (잠정값)")}${v.date ? ` · ${v.date}` : ""}</td></tr>`;
  }
  return `<section class="card"><div class="row" style="justify-content:space-between"><h2>단가·품·회수율</h2><button class="btn btn-outline btn-sm no-print" data-act="reset">기본값으로 되돌리기</button></div>
      <p class="lead" style="margin-bottom:12px">값을 고치면 비교 결과가 바로 다시 계산됩니다. "범위"가 있는 항목은 민감도 분석과 몬테카를로에서 그 범위 안에서 움직입니다.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="r">값</th><th>단위</th><th>범위 (최소 ~ 최대)</th><th>출처 · 기준</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    <section class="card"><h2>엔진 검증: 기준 논문 재현 <span class="badge ${ok ? "badge-success" : "badge-danger"}">${ok ? "일치" : "불일치"}</span></h2>
      <p class="lead" style="margin-bottom:12px">${esc(rates.sources.paper)}의 5층 공동주택 2,400㎡ 사례를 같은 식으로 계산한 결과입니다 (단위: 천원).</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="r">일반 해체</th><th class="r">분별 해체</th><th class="r">논문 값</th></tr></thead><tbody>
        <tr><td>시공비</td><td class="r">${num(r.construction[0])}</td><td class="r">${num(r.construction[1])}</td><td class="r">${paper.expected.construction.map((x) => num(x)).join(" / ")}</td></tr>
        <tr><td>폐기물 처리비</td><td class="r">${num(r.disposal[0])}</td><td class="r">${num(r.disposal[1])}</td><td class="r">${paper.expected.disposal.map((x) => num(x)).join(" / ")}</td></tr>
        <tr><td>재활용 수익</td><td class="r">–</td><td class="r">${num(r.revenue)}</td><td class="r">${num(paper.expected.revenue)}</td></tr>
        </tbody><tfoot><tr><td>Δ (분별 − 일반)</td><td></td><td class="r">${num(r.delta)}</td><td class="r">${num(paper.expected.delta)}</td></tr></tfoot></table></div>
      <p class="caption muted" style="margin-top:8px">논문은 재활용 수익을 제품 판매가(합판 4,000원/장, 그래뉼 850천원/t)로 잡았습니다. 이 프로그램의 비교는 폐자재 매각가를 기본으로 씁니다.</p>
    </section>`;
}

/* ---------------- 비교 ---------------- */
function compareTab(d) {
  if (!d) return empty();
  const { q, cmp } = d, { crush, selective, delta } = cmp, p = effP();
  const vars = variables(rates);
  sim ||= simulate(q, p, vars, { n: 5000, seed: state.seed });
  const better = delta < 0 ? "전면 분별해체" : "일괄 압쇄";
  const torn = tornado(q, p, vars).filter((t) => t.span > 1).slice(0, 10);

  const be = vars.map((v) => {
    const x = breakEven(q, p, v.key, v.min, v.max); // 범위 밖에서만 뒤집히는 변수는 뺀다
    if (x == null) return "";
    const up = compare(q, { ...p, [v.key]: x * 1.01 + 1e-9 }).delta < 0;
    const f = (n) => num(n, v.unit === "비율" ? 2 : v.unit === "인/㎡" ? 3 : 0);
    return `<li><strong>${esc(v.label)}</strong>: <strong>${f(x)} ${v.unit === "비율" ? "" : v.unit}</strong> ${up ? "이상" : "이하"}이면 분별해체가 유리 <span class="muted">(현재 ${f(p[v.key])}, 범위 ${f(v.min)} ~ ${f(v.max)})</span></li>`;
  }).filter(Boolean).join("");

  // 내역: 두 안의 같은 항목을 한 줄에
  const ORDER = ["인건비", "장비비", "처리비", "간접비", "매각수익"];
  const keys = [...new Set([...crush.rows, ...selective.rows].map((r) => `${r.group}|${r.item}`))]
    .sort((a, b) => ORDER.indexOf(a.split("|")[0]) - ORDER.indexOf(b.split("|")[0]));
  const find = (s, k) => s.rows.find((r) => `${r.group}|${r.item}` === k);
  let last = "", detail = "";
  for (const k of keys) {
    const a = find(crush, k), b = find(selective, k), r = a || b;
    if (r.group !== last) { detail += `<tr class="grp"><td colspan="7">${r.group}</td></tr>`; last = r.group; }
    const cell = (x) => x ? `<td class="r">${num(x.qty, x.qty < 100 ? 1 : 0)} ${x.unit}</td><td class="r">${mil(x.amount, 2)}</td>` : `<td class="r">–</td><td class="r">–</td>`;
    detail += `<tr><td>${esc(r.item)}</td><td class="r">${a && b && a.price !== b.price ? `${num(a.price)} / ${num(b.price)}` : num(r.price)}</td>${cell(a)}${cell(b)}<td class="r">${mil((b?.amount || 0) - (a?.amount || 0), 2)}</td></tr>`;
  }

  return `<section class="card">
      <p class="verdict">기본 단가로는 <span class="badge ${delta < 0 ? "badge-success" : "badge-neutral"}" style="font-size:16px">${better}</span>가 ${mil(Math.abs(delta))}백만원 (${num((Math.abs(delta) / crush.total) * 100, 1)}%) 더 쌉니다.${Math.abs(delta) / crush.total < 0.01 ? " 차이가 1% 미만이라 사실상 같은 수준입니다." : ""}</p>
      <p>단가 불확실성을 넣으면 분별해체가 더 쌀 확률은 <strong>${num(sim.pSelective * 100, 1)}%</strong>입니다.</p>
      <p class="caption muted">기본 단가 기준 확정값입니다. 단가가 범위 안에서 움직일 때의 확률은 아래 몬테카를로를 보세요. ${q.basis === "원단위" ? "물량은 면적 × 원단위 추정입니다." : ""}</p>
    </section>
    <section class="kpis">
      <div class="card kpi"><div class="v">${mil(crush.total)}</div><div class="l">일괄 압쇄 순비용 (백만원)</div><div class="s">공기 ${num(crush.days)}일</div></div>
      <div class="card kpi"><div class="v">${mil(selective.total)}</div><div class="l">전면 분별해체 순비용 (백만원)</div><div class="s">공기 ${num(selective.days)}일 (+${num(cmp.deltaDays, 1)}일)</div></div>
      <div class="card kpi"><div class="v">${delta > 0 ? "+" : "−"}${mil(Math.abs(delta))}</div><div class="l">Δ = 분별 − 압쇄 (백만원)</div><div class="s">음수면 분별이 유리</div></div>
      <div class="card kpi"><div class="v">${num(sim.pSelective * 100, 1)}%</div><div class="l">분별해체가 더 경제적일 확률</div><div class="s">${num(sim.n)}회 시뮬레이션</div></div>
    </section>
    <section class="card"><h2>비용 구성</h2>${stackedBars([{ ...crush, name: "일괄 압쇄" }, { ...selective, name: "전면 분별" }])}</section>
    <section class="card"><h2>견적 내역</h2>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>항목</th><th class="r">단가 (원, 다르면 압쇄 / 분별)</th><th class="r">압쇄 수량</th><th class="r">압쇄 (백만원)</th><th class="r">분별 수량</th><th class="r">분별 (백만원)</th><th class="r">차이</th></tr></thead>
      <tbody>${detail}</tbody><tfoot><tr><td>순비용 (비용 − 매각수익)</td><td></td><td></td><td class="r">${mil(crush.total, 2)}</td><td></td><td class="r">${mil(selective.total, 2)}</td><td class="r">${mil(delta, 2)}</td></tr></tfoot></table></div>
    </section>
    <div class="grid-2">
      <section class="card"><h2>손익분기</h2>${be ? `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px">${be}</ul>` : `<p class="muted">범위 안에서 결과를 뒤집는 변수가 없습니다.</p>`}
        <p class="caption muted" style="margin-top:12px">다른 값은 그대로 두고 한 변수만 바꿨을 때 두 안의 비용이 같아지는 지점입니다. 조사 범위 안에서 결과를 뒤집을 수 있는 변수만 보여줍니다.</p></section>
      <section class="card"><h2>몬테카를로 확률</h2>${histChart(histogram(sim.sorted))}
        <div class="row" style="margin-top:12px;justify-content:space-between"><span class="num">P10 ${mil(sim.p10)} · P50 ${mil(sim.p50)} · P90 ${mil(sim.p90)} 백만원</span>
        <label class="row no-print caption muted">seed <input class="input sm" style="width:80px" type="number" min="1" data-set="seed" value="${state.seed}"></label></div>
        <p class="caption muted" style="margin-top:8px">범위가 있는 단가 ${vars.length}개를 삼각분포로 뽑아 Δ를 ${num(sim.n)}번 계산했습니다. seed가 같으면 결과가 같습니다.</p></section>
    </div>
    <section class="card"><h2>민감도 (토네이도)</h2>${tornadoChart(torn, delta)}</section>
    ${state.source === "ifc" ? `<section class="card"><h2>3D: 분별 대상과 압쇄 대상</h2>${viewerBox()}</section>` : ""}`;
}

const empty = () => `<section class="card"><p>먼저 <strong>모델</strong> 단계에서 IFC를 올리거나 면적을 넣어 주세요.</p><p style="margin-top:12px"><button class="btn btn-primary" data-tab="model">모델 단계로</button></p></section>`;

/* ---------------- 내보내기 ---------------- */
function summary(d) {
  const { crush, selective, delta, deltaDays } = d.cmp;
  sim ||= simulate(d.q, effP(), variables(rates), { n: 5000, seed: state.seed });
  return { source: state.source === "ifc" ? state.fileName : "area", file_sha256: state.fileHash || null, area_m2: state.area, usage: state.usage,
    changed_params: Object.fromEntries(changedParams().map((k) => [k, state.p[k]])), plan_params: state.planP || null,
    crush_total_won: Math.round(crush.total), selective_total_won: Math.round(selective.total), delta_won: Math.round(delta),
    crush_days: +crush.days.toFixed(1), selective_days: +selective.days.toFixed(1), delta_days: +deltaDays.toFixed(1),
    p_selective_cheaper: +sim.pSelective.toFixed(4), seed: state.seed, recommended: delta < 0 ? "selective" : "crush" };
}

function exportTab(d) {
  if (!d) return empty();
  const res = elementResults(d.classified, effP());
  return `<section class="card"><h2>결과 내보내기</h2>
      <div class="row no-print">
        ${state.source === "ifc" ? `<button class="btn btn-primary" data-act="csv">부재별 결과 CSV</button>` : ""}
        <button class="btn btn-outline" data-act="json">요약 JSON</button>
        <button class="btn btn-outline" data-act="print">보고서 인쇄 · PDF</button>
      </div>
      <pre class="mono" style="margin-top:16px;white-space:pre-wrap">${esc(JSON.stringify(summary(d), null, 2))}</pre>
    </section>
    ${state.source === "ifc" ? `<section class="card"><h2>Revit에 결과 넣기</h2>
      <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
        <li><strong>부재별 결과 CSV</strong>와 <strong>요약 JSON</strong>을 내려받습니다.</li>
        <li>Revit에서 원본 모델을 열고, 저장소의 <span class="mono">revit/ReClaim_SharedParams.txt</span>를 공유 매개변수 파일로 지정합니다.</li>
        <li>pyRevit으로 <span class="mono">revit/write_results.py</span>를 실행해 CSV를 고릅니다. 부재마다 <span class="mono">RC_Waste, RC_Method, RC_Tons, RC_DisposalCost, RC_Revenue</span>가 기록됩니다.</li>
        <li>.rvt로 저장합니다. <span class="mono">RC_Method</span>로 필터를 만들면 분별 대상만 색으로 볼 수 있습니다.</li>
      </ol>
      <h2 style="margin-top:20px">부재별 결과 미리보기 <span class="caption muted">(${num(res.length)}개 중 12개, 전면 분별 기준)</span></h2>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Revit ID</th><th>부재</th><th>층</th><th>성상</th><th>방법</th><th class="r">톤</th><th class="r">처리비 (원)</th><th class="r">매각수익 (원)</th></tr></thead><tbody>
      ${[...res].sort((a, b) => b.revenue - a.revenue).slice(0, 12).map((r) => `<tr><td class="mono">${esc(r.tag || r.globalId)}</td><td>${CATEGORY_LABEL[r.category]}</td><td>${r.floor}</td><td>${STREAM_LABEL[r.stream]}</td><td>${r.method}</td><td class="r">${num(r.tons, 3)}</td><td class="r">${num(r.disposal)}</td><td class="r">${num(r.revenue)}</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}
    <div class="disclaimer"><div>이 결과는 견적 검토를 돕는 1차 비교 자료입니다. "가정"으로 표시된 단가는 출처가 없는 잠정값이므로 실제 견적·반출 기록으로 보정해야 합니다.</div></div>`;
}

function download(name, text, type) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- 그리기와 이벤트 ---------------- */
const HEAD = {
  model: ["모델과 물량", "Revit에서 내보낸 IFC에서 부재·재료별 물량을 뽑고, 폐기물 성상으로 분류합니다."],
  rates: ["단가", "노임, 품, 처리비, 매각가, 회수율입니다. 모든 값에 출처와 기준 연도를 표시합니다."],
  compare: ["공법 비교", "일괄 압쇄와 전면 분별해체의 인건비·장비비·처리비·매각수익·간접비를 비교합니다."],
  export: ["내보내기", "부재별 결과를 CSV로 내보내 Revit 모델에 기록합니다."],
};

// 이 결과를 만든 입력. 같은 줄이면 같은 결과다.
function calcLine(d) {
  if (!d) return "";
  const ch = changedParams();
  const parts = [
    state.source === "ifc" ? `${esc(state.fileName)}${state.fileHash ? ` · ${state.fileHash.slice(0, 8)}` : ""}` : "면적만 (간이 계산)",
    esc(state.usage), `연면적 ${num(state.area)}㎡`,
    ch.length ? `<strong>기본값과 다른 단가 ${ch.length}개</strong> <button class="btn btn-outline" style="min-height:28px;padding:0 10px;font-size:13px" data-act="reset">되돌리기</button>` : "단가 기본값",
    state.planP ? `계획서 철근량 ${num(state.planP.rebar_kg_per_m3)}kg/㎥ (이 계획서에만)` : "",
    state.source === "ifc" ? `내장재 보충 ${state.supplement ? "켬" : "끔"}` : "",
  ].filter(Boolean);
  return `<p class="caption calc-line" aria-label="계산 조건">계산 조건: ${parts.join(" · ")}</p>`;
}

function render() {
  const d = derive();
  $("#tabs").innerHTML = TABS.map(([k, l], i) => `<button data-tab="${k}" ${k === state.tab ? 'aria-current="step"' : ""}><span>${i + 1}</span>${l}</button>`).join("");
  const body = { model: modelTab, rates: ratesTab, compare: compareTab, export: exportTab }[state.tab](d);
  $("#content").innerHTML = `<div><h1>${HEAD[state.tab][0]}</h1><p class="lead">${HEAD[state.tab][1]}</p></div>${calcLine(d)}${body}`;
  if (d) mountViewer(d);
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab],[data-act],[data-color]");
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; if (state.tab === "compare") state.colorMode = "method"; window.scrollTo(0, 0); return render(); }
  if (t.dataset.color) { state.colorMode = t.dataset.color; return render(); }
  const act = t.dataset.act, d = derive();
  if (act === "sample") return loadIfc(await (await fetch("assets/data/sample.ifc")).arrayBuffer(), "sample.ifc (예시 5층 공동주택)", 2400);
  if (act === "plan-sample") return loadPlan(await json("plans/example.json"), "계획서 예시");
  if (act === "area") { Object.assign(state, { source: "area", model: null, elements: [], error: "" }); sim = null; return render(); }
  if (act === "reset") { state.p = { ...defaults }; sim = null; save(); return render(); }
  if (act === "csv") return download("reclaim_elements.csv", "﻿" + toCsv(elementResults(d.classified, effP())), "text/csv");
  if (act === "json") return download("reclaim_summary.json", JSON.stringify(summary(d), null, 2), "application/json");
  if (act === "print") return window.print();
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "file" && t.files[0]) return loadIfc(await t.files[0].arrayBuffer(), t.files[0].name);
  if (t.id === "planfile" && t.files[0]) {
    try { return loadPlan(JSON.parse(await t.files[0].text()), t.files[0].name); }
    catch (e) { state.error = `JSON을 읽지 못했습니다: ${e.message}`; return render(); }
  }
  if (t.dataset.p) { const v = Number(t.value); if (Number.isFinite(v)) state.p[t.dataset.p] = v; }
  else if (t.dataset.set === "supplement") state.supplement = t.checked;
  else if (t.dataset.set === "usage") state.usage = t.value;
  else if (t.dataset.set) { const v = Number(t.value); if (v > 0) state[t.dataset.set] = v; }
  else if (t.dataset.override != null) { if (t.value) state.overrides[t.dataset.override] = t.value; else delete state.overrides[t.dataset.override]; }
  else return;
  sim = null; save(); render();
});

document.addEventListener("dragover", (e) => { if ($("#drop")) { e.preventDefault(); $("#drop").classList.add("over"); } });
document.addEventListener("dragleave", () => $("#drop")?.classList.remove("over"));
document.addEventListener("drop", async (e) => {
  if (!$("#drop")) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) loadIfc(await f.arrayBuffer(), f.name);
});

const tip = $("#tip");
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = e.clientY + 16 + "px";
});

render();
