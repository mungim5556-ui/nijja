// 작은 SVG 차트: 묶음 막대, 히스토그램, 토네이도. 값은 tooltip과 표로도 읽을 수 있어야 한다.
const tip = () => document.getElementById("tip");

export function bindTips(root) {
  const t = tip();
  if (!t) return;
  root.querySelectorAll("[data-tip]").forEach((g) => {
    const show = (e) => {
      const [title, ...lines] = g.dataset.tip.split("\n");
      t.replaceChildren();
      const s = document.createElement("strong");
      s.textContent = title;
      t.append(s);
      for (const l of lines) { const d = document.createElement("div"); d.textContent = l; t.append(d); }
      t.style.display = "block";
      const r = t.getBoundingClientRect();
      const x = Math.min(window.innerWidth - r.width - 8, (e.clientX ?? g.getBoundingClientRect().right) + 12);
      const y = Math.max(8, (e.clientY ?? g.getBoundingClientRect().top) - r.height - 8);
      t.style.left = x + "px";
      t.style.top = y + "px";
      g.classList.add("hover");
    };
    const hide = () => { t.style.display = "none"; g.classList.remove("hover"); };
    g.addEventListener("pointermove", show);
    g.addEventListener("pointerleave", hide);
    g.addEventListener("focus", show);
    g.addEventListener("blur", hide);
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// 위쪽 모서리만 둥근 막대 (기준선 쪽은 각지게)
function barPath(x, y, w, h, r = 3) {
  if (h <= 0 || w <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// categories: [{label, values:[...]}], series: [{label, color}]
export function groupedBars({ categories, series, unit = "", fmt = (v) => v.toLocaleString(), height = 220 }) {
  const W = 360, H = height, L = 44, B = 28, T = 8;
  const max = niceMax(Math.max(...categories.flatMap((c) => c.values), 0));
  const plotW = W - L - 4, plotH = H - B - T;
  const gw = plotW / categories.length;
  const bw = Math.min(26, (gw - 16) / series.length - 2);
  const y = (v) => T + plotH - (v / max) * plotH;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="시나리오별 비용 막대 차트">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    s += `<line class="axis" x1="${L}" x2="${W}" y1="${yy}" y2="${yy}" stroke-width="1"/>`;
    s += `<text x="${L - 6}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  categories.forEach((c, ci) => {
    const gx = L + gw * ci + (gw - (bw + 2) * series.length) / 2;
    c.values.forEach((v, si) => {
      const x = gx + si * (bw + 2);
      const yy = y(Math.max(0, v));
      const h = T + plotH - yy;
      const tipText = `${fmt(v)} ${unit}\n${series[si].label} · ${c.label}`;
      s += `<g data-tip="${esc(tipText)}" tabindex="0"><rect class="hit" x="${x - 1}" y="${T}" width="${bw + 2}" height="${plotH}"/>`;
      s += `<path class="bar" d="${barPath(x, yy, bw, h)}" fill="${series[si].color}"/></g>`;
    });
    s += `<text x="${L + gw * ci + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(c.label)}</text>`;
  });
  s += `<line class="zero" x1="${L}" x2="${W}" y1="${T + plotH}" y2="${T + plotH}" stroke-width="1"/>`;
  return s + "</svg>";
}

export function histogram(values, { bins = 24, color = "var(--series-1)", fmt = (v) => v.toFixed(0), unit = "", zeroLabel = "0" } = {}) {
  const W = 360, H = 170, L = 8, B = 30, T = 18;
  let lo = Math.min(...values, 0), hi = Math.max(...values, 0);
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / step))]++;
  const maxC = Math.max(...counts);
  const plotW = W - L * 2, plotH = H - B - T;
  const bw = plotW / bins;
  const x = (v) => L + ((v - lo) / (hi - lo)) * plotW;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Δ 분포 히스토그램">`;
  counts.forEach((c, i) => {
    const h = maxC ? (c / maxC) * plotH : 0;
    const a = lo + step * i, b = a + step;
    const tipText = `${c}회 (${((c / values.length) * 100).toFixed(1)}%)\n${fmt(a)} ~ ${fmt(b)} ${unit}`;
    s += `<g data-tip="${esc(tipText)}" tabindex="0"><rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${plotH}"/>`;
    s += `<path class="bar" d="${barPath(L + i * bw + 1, T + plotH - h, bw - 2, h, 2)}" fill="${color}"/></g>`;
  });
  const zx = x(0);
  s += `<line class="zero" x1="${zx}" x2="${zx}" y1="${T - 6}" y2="${T + plotH}" stroke-dasharray="3 3"/>`;
  s += `<text x="${zx}" y="${T - 8}" text-anchor="middle">${esc(zeroLabel)}</text>`;
  s += `<line class="axis" x1="${L}" x2="${W - L}" y1="${T + plotH}" y2="${T + plotH}"/>`;
  s += `<text x="${L}" y="${H - 10}">${fmt(lo)}</text><text x="${W - L}" y="${H - 10}" text-anchor="end">${fmt(hi)} ${unit}</text>`;
  return s + "</svg>";
}

// rows: [{label, low, high}] — 한 변수만 최소·최대로 바꿨을 때 Δ
export function tornado(rows, { base, fmt = (v) => v.toFixed(0), unit = "", color = "var(--series-1)" } = {}) {
  const W = 360, rowH = 38, T = 6, L = 8;
  const H = T + rows.length * rowH + 20;
  const all = rows.flatMap((r) => [r.low, r.high]).concat([base, 0]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const plotW = W - L * 2;
  const x = (v) => L + ((v - lo) / ((hi - lo) || 1)) * plotW;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="변수별 영향 토네이도 차트">`;
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    const a = Math.min(r.low, r.high), b = Math.max(r.low, r.high);
    const tipText = `${fmt(r.low)} ~ ${fmt(r.high)} ${unit}\n${r.label}\n최소값일 때 ${fmt(r.low)}, 최대값일 때 ${fmt(r.high)}`;
    s += `<text x="${L}" y="${y + 12}">${esc(r.label)}</text>`;
    s += `<g data-tip="${esc(tipText)}" tabindex="0"><rect class="hit" x="${L}" y="${y}" width="${plotW}" height="${rowH - 4}"/>`;
    s += `<rect class="bar" x="${x(a)}" y="${y + 18}" width="${Math.max(2, x(b) - x(a))}" height="12" rx="3" fill="${color}"/></g>`;
  });
  const zx = x(0), bx = x(base);
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    s += `<line class="zero" x1="${zx}" x2="${zx}" y1="${y + 16}" y2="${y + 32}" stroke-dasharray="2 2"/>`;
    s += `<line x1="${bx}" x2="${bx}" y1="${y + 15}" y2="${y + 33}" stroke="var(--text)" stroke-width="1.5"/>`;
  });
  s += `<text x="${zx}" y="${H - 4}" text-anchor="${zx < 30 ? "start" : "middle"}">0</text>`;
  return s + "</svg>";
}
