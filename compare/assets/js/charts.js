// 의존성 없는 SVG 차트. 색은 CSS 변수(--s1…)로 주고, 글자는 항상 본문 색을 쓴다.
// 막대마다 data-tip을 달아 app.js의 공용 툴팁이 보여준다.

export const mil = (won, digits = 1) => (won / 1e6).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const num = (x, digits = 0) => Number(x).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export function formatCostDifference(won, signed = false) {
  const amount = Math.trunc(Math.abs(won));
  if (!Number.isFinite(amount)) return "–";
  const sign = amount === 0 ? "" : won < 0 ? "−" : signed ? "+" : "";
  if (amount >= 100_000_000) {
    return `${sign}${num(Math.floor(amount / 100_000_000))}억 ${num(Math.floor((amount % 100_000_000) / 10_000))}만원`;
  }
  if (amount >= 10_000) return `${sign}${num(Math.floor(amount / 10_000))}만원`;
  return `${sign}${num(amount)}원`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const COST_PARTS = [
  ["labor", "인건비", "var(--s1)"], ["equipment", "장비비", "var(--s2)"], ["disposal", "처리비", "var(--s3)"], ["transport", "운반비", "var(--s5)"], ["indirect", "간접비", "var(--s4)"],
];
export const REVENUE_COLOR = "var(--s6)";

export const legend = (items) => `<div class="legend">${items.map(([label, color]) => `<span><i style="background:${color}"></i>${esc(label)}</span>`).join("")}</div>`;

// 두 안의 비용 구성: 0의 오른쪽에 비용을 쌓고, 왼쪽에 매각수익을 둔다
export function stackedBars(scenarios) {
  const W = 760, L = 96, R = 150, rowH = 44, gap = 22, top = 8;
  const maxCost = Math.max(0, ...scenarios.map((s) => COST_PARTS.reduce((sum, [key]) => sum + (s[key] ?? 0), 0)));
  const maxRev = Math.max(0, ...scenarios.map((s) => s.revenue ?? 0));
  const k = (W - L - R) / (maxCost + maxRev || 1), x0 = L + maxRev * k;
  const H = top + scenarios.length * (rowH + gap);
  const segment = (x, y, width, color, tip) => {
    const inset = Math.min(1, width / 8);
    return `<rect x="${x + inset}" y="${y}" width="${width - 2 * inset}" height="${rowH}" rx="3" fill="${color}" data-tip="${esc(tip)}"/>`;
  };
  let out = "";
  scenarios.forEach((s, i) => {
    const y = top + i * (rowH + gap);
    let x = x0;
    for (const [key, label, color] of COST_PARTS) {
      const w = (s[key] ?? 0) * k;
      if (w > 0) out += segment(x, y, w, color, `${s.name} · ${label} ${num(s[key])}원`);
      x += w;
    }
    const rw = (s.revenue ?? 0) * k;
    if (rw > 0) out += segment(x0 - rw, y, rw, REVENUE_COLOR, `${s.name} · 매각수익 −${num(s.revenue)}원`);
    out += `<text x="${L - 86}" y="${y + rowH / 2 + 5}" class="c-label">${esc(s.name)}</text>`;
    out += `<text x="${W - 12}" y="${y + rowH / 2 - 2}" text-anchor="end" class="c-value">${num(s.total)}원</text>`;
    out += `<text x="${W - 12}" y="${y + rowH / 2 + 14}" text-anchor="end" class="c-note">순비용 · ${num(s.days, 1)}일</text>`;
  });
  out += `<line x1="${x0}" x2="${x0}" y1="0" y2="${H - gap + 6}" class="c-axis"/>`;
  out += `<text x="${x0}" y="${H - 3}" text-anchor="middle" class="c-note">0원</text>`;
  const description = scenarios.map(s => `${s.name} 순비용 ${num(s.total)}원`).join(", ");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="비용 구성 비교 · ${esc(description)}">${out}</svg>`
    + legend([...COST_PARTS.map(([, l, c]) => [l, c]), ["매각수익 (비용에서 뺌)", REVENUE_COLOR]]);
}

// 토네이도: 변수를 최소·최대로 바꿨을 때 Δ가 어디까지 움직이는지
export function tornadoChart(items, base) {
  const W = 760, L = 230, R = 30, rowH = 22, gap = 10, top = 26;
  const vals = items.flatMap((d) => [d.lo, d.hi]).concat(base, 0);
  const lo = Math.min(...vals), hi = Math.max(...vals), k = (W - L - R) / (hi - lo || 1);
  const X = (v) => L + (v - lo) * k;
  const H = top + items.length * (rowH + gap) + 4;
  let out = "";
  items.forEach((d, i) => {
    const y = top + i * (rowH + gap);
    const bar = (v, color, which, at) => {
      const a = Math.min(X(base), X(v)), w = Math.abs(X(v) - X(base));
      return `<rect x="${a}" y="${y}" width="${Math.max(w, 1)}" height="${rowH}" rx="3" fill="${color}" data-tip="${esc(`${d.label} ${which} ${num(at, at < 10 ? 2 : 0)} ${d.unit} → Δ ${formatCostDifference(v, true)}`)}"/>`;
    };
    out += bar(d.lo, "var(--s1)", "최소", d.min) + bar(d.hi, "var(--s2)", "최대", d.max);
    out += `<text x="${L - 10}" y="${y + rowH / 2 + 4}" text-anchor="end" class="c-label">${esc(d.label)}</text>`;
  });
  const zero = X(0);
  out += `<line x1="${zero}" x2="${zero}" y1="${top - 6}" y2="${H}" class="c-zero"/><text x="${zero}" y="12" text-anchor="middle" class="c-note">Δ = 0 (같은 비용)</text>`;
  out += `<line x1="${X(base)}" x2="${X(base)}" y1="${top - 6}" y2="${H}" class="c-axis"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="민감도 토네이도 차트">${out}</svg>`
    + legend([["변수 최소값일 때", "var(--s1)"], ["변수 최대값일 때", "var(--s2)"]])
    + `<p class="caption muted">0의 왼쪽이면 분별해체가 유리하다. 가는 선은 기본 단가일 때의 Δ(${formatCostDifference(base, true)}).</p>`;
}

// 몬테카를로 Δ 분포
export function histChart(bins) {
  const W = 760, L = 12, R = 12, H = 230, base = 190, top = 10;
  const max = Math.max(...bins.map((b) => b.count)), n = bins.reduce((s, b) => s + b.count, 0);
  const lo = bins[0].x0, hi = bins.at(-1).x1, k = (W - L - R) / (hi - lo || 1);
  const X = (v) => L + (v - lo) * k;
  let out = "";
  for (const b of bins) {
    const h = (b.count / max) * (base - top), mid = (b.x0 + b.x1) / 2;
    out += `<rect x="${X(b.x0) + 1}" y="${base - h}" width="${Math.max(1, X(b.x1) - X(b.x0) - 2)}" height="${h}" rx="2" fill="${mid < 0 ? "var(--s1)" : "var(--s2)"}" data-tip="${esc(`Δ ${formatCostDifference(b.x0)} ~ ${formatCostDifference(b.x1)}: ${num((b.count / n) * 100, 1)}%`)}"/>`;
  }
  out += `<line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" class="c-axis"/>`;
  for (const v of [lo, hi]) out += `<text x="${X(v)}" y="${base + 18}" text-anchor="${v === lo ? "start" : "end"}" class="c-note">${formatCostDifference(v)}</text>`;
  if (lo < 0 && hi > 0) out += `<line x1="${X(0)}" x2="${X(0)}" y1="${top}" y2="${base}" class="c-zero"/><text x="${X(0)}" y="${base + 18}" text-anchor="middle" class="c-note">0원</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Δ 확률 분포">${out}</svg>`
    + legend([["분별해체가 유리 (Δ < 0)", "var(--s1)"], ["일괄 압쇄가 유리 (Δ ≥ 0)", "var(--s2)"]]);
}
