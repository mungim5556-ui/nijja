import { num } from "./charts.js";
import { normalizeConcreteCutPlan } from "./concrete-cut.js?v=concrete-cut-20261123";

const groups = [["both", "Common", "두 공법 공통"], ["crush", "Crush", "압쇄안만"], ["selective", "Sel", "분별안만"]];
const methods = groups.slice(1);
const tools = { "": "장비 선택", wire: "다이아몬드 와이어쏘", wall: "월쏘·원형날", other: "기타 절단 장비" };
const measures = { line: "절단선 길이 × 두께", section: "단면 폭 × 깊이", area: "확인한 절단면적 직접 입력" };
const lifting = { unknown: "미확인", none: "인양 불필요", included: "도급 견적에 인양 포함", extra: "별도 크레인 견적" };
const reasons = {
  basementBoundary: "지하 경계 · 존치부 확인",
  perimeter: "외곽 · 도로·보행로 및 인양 조건 확인",
  envelope: "형상상 외곽 · 실제 도로 및 작업 여건 확인",
  roof: "옥상·옥탑 · 낙하 및 인양 조건 확인",
  core: "코어·샤프트 · 부분 존치 확인",
  largeSection: "모델 내 큰 단면 · 정밀 분리 필요 확인",
};
const ref = {
  rate: 329037,
  subwayHours: 8 / 5.6,
  dryHours: 2.85,
  costUrl: "https://www.seongnam.go.kr/contents/down/public_works/10478_71_2.pdf",
  subwayUrl: "https://news.seoul.go.kr/citybuild/archives/235864?listPage=2",
  dryUrl: "https://www.codil.or.kr/filebank/files/201806/helpdesk/BBS_201806211120111581.pdf?atchFileId=FILE_000000000006598&fileSn=1",
};
const fields = groups.flatMap(([, suffix]) => ["Quote", "Reference", "Lift", "LiftCost"].map(field => "cut" + field + suffix));
export const cutProjectFields = ["cutRows", "cutScopeChecked", ...fields,
  ...methods.flatMap(([, suffix]) => ["cutNetDays" + suffix, "cutAvoidedHours" + suffix])];

export function concreteCutInput(state, candidates) {
  const plan = normalizeConcreteCutPlan(state.cutRows, candidates);
  const groupCosts = Object.fromEntries(groups.map(([method, suffix]) => {
    const rows = plan.rows.filter(row => row.method === method);
    const wireArea = rows.filter(row => row.tool === "wire").reduce((sum, row) => sum + row.cutArea, 0);
    const area = rows.reduce((sum, row) => sum + row.cutArea, 0);
    if (!area) return [method, { area: 0, wireArea: 0 }];
    const lift = state["cutLift" + suffix] ?? "unknown";
    const quote = state["cutQuote" + suffix];
    const reference = area > 0 && rows.every(row => row.tool === "wire") && quote == null && state["cutReference" + suffix] === true;
    const cutCost = reference ? Math.round(area * ref.rate) : quote;
    const liftingCost = lift === "extra" ? state["cutLiftCost" + suffix] : undefined;
    const quoteIncomplete = area > 0 && (cutCost == null || lift === "unknown"
      || (lift === "included" && quote == null) || (lift === "extra" && liftingCost == null));
    return [method, { area, wireArea, cutCost, liftingCost, quoteIncomplete, reference, lift }];
  }));
  const scenarios = Object.fromEntries(methods.map(([mode, suffix]) => {
    const active = [groupCosts.both, groupCosts[mode]].filter(group => group.area > 0);
    if (!active.length) return [mode, { area: 0 }];
    const totalOf = key => active.some(group => group[key] != null)
      ? active.reduce((sum, group) => sum + (group[key] ?? 0), 0) : undefined;
    const wireArea = totalOf("wireArea");
    return [mode, {
      area: totalOf("area"), cost: totalOf("cutCost"), liftingCost: totalOf("liftingCost"),
      liftingIncluded: active.every(group => group.lift === "none" || group.lift === "included") && active.some(group => group.lift === "included"),
      quoteIncomplete: active.some(group => group.quoteIncomplete),
      days: state["cutNetDays" + suffix], avoidedHours: state["cutAvoidedHours" + suffix],
      costBasis: active.some(group => group.reference) ? "reference" : "quote",
      hoursReference: wireArea > 0 ? { subway: wireArea * ref.subwayHours, dry: wireArea * ref.dryHours } : undefined,
    }];
  }));
  return { ...plan, groupCosts, scenarios };
}

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const options = (labels, value) => Object.entries(labels).map(([key, label]) =>
  `<option value="${esc(key)}"${value === key ? " selected" : ""}>${esc(label)}</option>`).join("");
const field = (label, control) => `<label class="field">${label}${control}</label>`;
const siteNumber = (state, key, label) => field(label, `<input class="input" type="number" min="0" step="any" data-set="${key}" value="${esc(state[key])}" placeholder="미입력">`);
const yes = value => value ? " checked" : "";

function candidateLabel(candidate) {
  const location = candidate.storey || (candidate.floor != null ? `층 인덱스 ${candidate.floor}` : "");
  return [location, candidate.name, candidate.expressID != null ? `#${candidate.expressID}` : null].filter(Boolean).join(" · ");
}

function rowFields(row, candidate, normalized) {
  const id = esc(row.id);
  const attr = key => `data-cut-row="${id}" data-cut-field="${key}"`;
  const select = (key, label, values) => field(label, `<select class="select" ${attr(key)}>${options(values, row[key])}</select>`);
  const number = (key, label, step = "any") => field(label, `<input class="input" type="number" min="0" step="${step}" ${attr(key)} value="${esc(row[key])}">`);
  const dimensions = row.measure === "line" ? number("length", "새로 자르는 길이 (m)") + number("thickness", "확인한 부재 두께 (m)") + number("count", "별개 절단면 수", "1")
    : row.measure === "section" ? number("width", "단면 폭 (m)") + number("depth", "단면 깊이 (m)") + number("count", "별개 절단면 수", "1")
      : number("area", "절단면적 합계 (㎡)");
  return `<fieldset><legend>${candidate ? esc(candidateLabel(candidate)) : "직접 등록한 절단면"}</legend>
    ${candidate ? `<p class="caption muted">${esc(reasons[candidate.reasonCode] ?? candidate.reason)}${candidate.thickness > 0 ? ` · 참고 두께 ${num(candidate.thickness, 3)}m` : ""}${candidate.massTons > 0 ? ` · IFC의 부재 전체 중량 참고 ${num(candidate.massTons, 2)}t` : ""}${candidate.materialUnverified ? " · 콘크리트 재질 확인 필요" : ""}</p>` : ""}
    <div class="form-grid">${field("절단 위치·구간 이름", `<input class="input" ${attr("label")} maxlength="140" value="${esc(row.label)}" placeholder="예) 옥상 동측 경계 A">`)}
      ${select("method", "적용 공법", Object.fromEntries(groups.map(([key, , label]) => [key, label])))}
      ${select("tool", "장비", tools)}${select("measure", "절단면 산정", measures)}${dimensions}
      ${number("blockVolume", "인양 조각 1개의 부피 (㎥, 선택)")}
    </div>
    <div class="row"><button class="btn btn-outline" data-act="cut-remove" data-cut-id="${id}">절단면 삭제</button>
      <span>${normalized ? `절단면적 ${num(normalized.cutArea, 3)}㎡` : "위치와 절단 치수 입력 필요"}</span>
      ${row.blockVolume > 0 ? `<span>조각당 약 ${num(row.blockVolume * 2.4, 2)}t (2.4t/㎥ 가정)</span>` : ""}</div>
  </fieldset>`;
}

export function concreteCutControls(state, d, legacy = "") {
  if (!state.source || d?.openSteelFrame) return "";
  const candidates = d.cutCandidates ?? [];
  const candidateMap = new Map(candidates.map(candidate => [String(candidate.id), candidate]));
  const plan = d.cutPlan;
  const rows = state.cutRows ?? [];
  const normalized = new Map(plan.rows.map(row => [row.id, row]));
  return `<section class="card" id="concrete-cut"><h2>콘크리트 절단·인양</h2>
    <p>존치부 접합, 낙하 통제, 또는 덩어리 인양이 필요한 구간을 확인해 등록하세요. 한 절단면을 한 번만 입력하고, 양쪽에 필요한 절단에는 두 공법 공통을 선택합니다.</p>
    ${state.source === "ifc" ? candidates.length ? `<div class="row">
      ${field(`IFC 검토 후보 ${num(candidates.length)}개`, `<select class="select" id="cut-candidate" aria-label="IFC 절단 검토 후보"><option value="">부재 선택</option>${candidates.map(candidate =>
        `<option value="${esc(candidate.id)}">${esc(candidateLabel(candidate))} · ${esc(reasons[candidate.reasonCode] ?? candidate.reason)}${candidate.thickness > 0 ? ` · 약 ${num(candidate.thickness * 1000)}mm` : ""}</option>`).join("")}</select>`)}
      <button class="btn btn-outline" data-act="cut-add-candidate">선택한 부재에 절단면 등록</button></div>
      <p class="caption muted">후보는 IFC의 형상과 층을 기준으로 표시합니다. 존치부·도로·보행로·인양 조건은 현장에서 확인하세요.</p>`
      : "<p>형상과 층으로 식별한 검토 후보가 없습니다. 확인한 절단면이 있으면 직접 등록하세요.</p>" : ""}
    <div class="row"><button class="btn btn-outline" data-act="cut-add">절단면 직접 등록</button>
    <label><input type="checkbox" data-set="cutScopeChecked"${yes(state.cutScopeChecked)}> 절단 대상 범위를 확인했습니다</label></div>
    ${rows.map(row => rowFields(row, candidateMap.get(String(row.candidateId)), normalized.get(row.id))).join("")}
    ${plan.issues.length ? `<ul role="alert">${plan.issues.map(issue => `<li>${esc(issue)}</li>`).join("")}</ul>` : ""}
    ${groups.filter(([method]) => plan.groupCosts[method].area > 0).map(([method, suffix, title]) => {
      const group = plan.groupCosts[method];
      return `<fieldset><legend>${title} · ${num(group.area, 3)}㎡</legend>
        ${group.wireArea > 0 ? `<p class="caption muted">와이어쏘 ${num(group.wireArea, 3)}㎡의 작업시간 참고값 · <a href="${ref.subwayUrl}" target="_blank" rel="noopener">서울시 도시철도</a> ${num(group.wireArea * ref.subwayHours, 1)}시간 · <a href="${esc(ref.dryUrl)}" target="_blank" rel="noopener">건식 신기술 품셈</a> ${num(group.wireArea * ref.dryHours, 1)}시간. 작업 범위가 서로 다릅니다.</p>` : ""}
        <div class="form-grid">
          ${siteNumber(state, "cutQuote" + suffix, "절단 도급비 (원, 반입·천공·절단에 필요한 장비·인력·소모품 포함)")}
          ${field("크레인 인양비", `<select class="select" data-set="cutLift${suffix}">${options(lifting, group.lift)}</select>`)}
          ${group.lift === "extra" ? siteNumber(state, "cutLiftCost" + suffix, "별도 인양 견적 (원)") : ""}
        </div>
        ${group.area === group.wireArea ? `<label><input type="checkbox" data-set="cutReference${suffix}"${yes(state["cutReference" + suffix])}> 견적이 비어 있을 때 <a href="${ref.costUrl}" target="_blank" rel="noopener">성남시 교량 계약 참고단가</a> ${num(ref.rate)}원/㎡ 적용 (인양 별도)</label>` : ""}
        ${group.quoteIncomplete ? `<p class="caption muted">절단 견적 또는 인양 조건이 미확정입니다.</p>` : ""}
      </fieldset>`;
    }).join("")}
    ${plan.rows.length ? `<div class="form-grid">${methods.filter(([method]) => plan.scenarios[method].area > 0).map(([method, suffix, title]) => `<fieldset><legend>${title.replace("안만", "안")} 일정·장비량</legend>
      ${siteNumber(state, "cutNetDays" + suffix, "절단·인양으로 실제 늘어나는 작업일 (일)")}
      ${siteNumber(state, "cutAvoidedHours" + suffix, "실제로 줄어드는 추정 굴착기 시간 (h)")}
      <p class="caption muted">${d.q.workSchedule[method].structureDays != null || d.q.workSchedule[method].totalDays != null ? "확인 공정표에 절단·인양 일정이 포함된 것으로 계산합니다." : "일정이 늘지 않으면 0일을 입력하세요."} ${d.q.workSchedule[method].equipmentQuote != null || d.q.workSchedule[method].excavatorHours != null || d.q.equipment === "mixed" ? "확인한 장비 시간·견적을 우선합니다." : "이후 지상 압쇄가 필요하면 필요한 굴착기 시간은 남겨 둡니다."}</p>
      </fieldset>`).join("")}</div>` : ""}
    ${legacy}</section>`;
}
