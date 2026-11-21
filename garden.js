if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("embed");
/* Vườn cây kiểu Forest Overview: tab Ngày/Tuần/Tháng/Năm, plot isometric và
   biểu đồ phân bố thời gian tập trung.
   Dữ liệu: serverPlants + pendingPlants; tự tải thêm khoảng ngày qua LOAD_RANGE. */

const $ = (sel, el = document) => el.querySelector(sel);
const send = (msg, timeoutMs = 12000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service worker không phản hồi (timeout)")), timeoutMs);
    chrome.runtime.sendMessage(msg).then(
      (r) => { clearTimeout(timer); resolve(r); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });

const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY_MS = 86400000;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const startOfWeek = (d) => {
  const x = startOfDay(d);
  const shift = (x.getDay() + 6) % 7; // thứ 2 = 0
  return addDays(x, -shift);
};

const MONTHS = ["tháng 1", "tháng 2", "tháng 3", "tháng 4", "tháng 5", "tháng 6",
  "tháng 7", "tháng 8", "tháng 9", "tháng 10", "tháng 11", "tháng 12"];
const DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

let state = null;
let mode = "day";
let anchor = startOfDay(new Date());
const loadedRanges = new Set();

const isToday = (d) => startOfDay(d).getTime() === startOfDay(new Date()).getTime();

function allPlants() {
  const saved = (state?.serverPlants || []).map((p) => ({ ...p, pending: false }));
  const pending = (state?.pendingPlants || []).map((p) => ({ ...p, pending: true }));
  return [...saved, ...pending].filter((p) => p.startTime);
}

const minutesOf = (p) => {
  if (!p.startTime || !p.endTime) return 0;
  return Math.max(0, (new Date(p.endTime) - new Date(p.startTime)) / 60000);
};

function bounds() {
  const a = anchor;
  if (mode === "day") return { from: startOfDay(a), to: endOfDay(a) };
  if (mode === "week") {
    const s = startOfWeek(a);
    return { from: s, to: endOfDay(addDays(s, 6)) };
  }
  if (mode === "month") {
    const s = new Date(a.getFullYear(), a.getMonth(), 1);
    const e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { from: startOfDay(s), to: endOfDay(e) };
  }
  return { from: new Date(a.getFullYear(), 0, 1), to: endOfDay(new Date(a.getFullYear(), 11, 31)) };
}

const inRange = (p, from, to) => {
  const t = new Date(p.startTime).getTime();
  return t >= from.getTime() && t <= to.getTime();
};

function labelFor() {
  const { from, to } = bounds();
  if (mode === "day") {
    const s = `${anchor.getDate()} ${MONTHS[anchor.getMonth()]}, ${anchor.getFullYear()}`;
    return isToday(anchor) ? `${s} (Hôm nay)` : s;
  }
  if (mode === "week") {
    const sameMonth = from.getMonth() === to.getMonth();
    const left = sameMonth ? `${from.getDate()}` : `${from.getDate()} ${MONTHS[from.getMonth()]}`;
    return `${left} – ${to.getDate()} ${MONTHS[to.getMonth()]}, ${to.getFullYear()}`;
  }
  if (mode === "month") return `${MONTHS[anchor.getMonth()].replace("tháng", "Tháng")}, ${anchor.getFullYear()}`;
  return String(anchor.getFullYear());
}

const tagTitle = (id) =>
  (state?.tags?.length ? state.tags : [{ tagId: 0, title: "Unset" }]).find((t) => Number(t.tagId) === Number(id))?.title || "Unset";
const treeOf = (gid) => state?.treeTypes?.find((t) => Number(t.gid) === Number(gid)) || null;

/* ---------- plot isometric ---------- */

function plotSvg(plants) {
  const N = 10;
  const ox = 320, oy = 62, ux = 26.5, uy = 13.7, vx = -26.5, vy = 13.7;
  const depth = 24;
  const P = (i, j) => ({ x: ox + i * ux + j * vx, y: oy + i * uy + j * vy });

  const cells = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      cells.push({ i, j, pts: [a, b, c, d] });
    }
  }
  const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const top = [P(0, 0), P(N, 0), P(N, N), P(0, N)];
  const leftSide = [P(0, N), P(N, N), { x: P(N, N).x, y: P(N, N).y + depth }, { x: P(0, N).x, y: P(0, N).y + depth }];
  const rightSide = [P(N, N), P(N, 0), { x: P(N, 0).x, y: P(N, 0).y + depth }, { x: P(N, N).x, y: P(N, N).y + depth }];

  const grid = [];
  for (let k = 0; k <= N; k++) {
    const a = P(k, 0), b = P(k, N), c = P(0, k), d = P(N, k);
    grid.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
    grid.push(`<line x1="${c.x}" y1="${c.y}" x2="${d.x}" y2="${d.y}"/>`);
  }

  // Rải cây từ giữa ra ngoài: sắp ô theo khoảng cách tới tâm (hash cố định để ổn định).
  const order = cells
    .map((c) => ({ c, d: Math.hypot(c.i - (N - 1) / 2, c.j - (N - 1) / 2) + ((c.i * 7 + c.j * 13) % 10) / 10 }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);
  // vẽ từ xa tới gần để cây phía trước che cây phía sau
  const placed = [...plants].sort((a, b) => new Date(a.startTime) - new Date(b.startTime)).slice(0, N * N);
  const extra = plants.length - placed.length;

  const treeEls = placed
    .map((p, idx) => ({ p, cell: order[idx] }))
    .sort((a, b) => (a.cell.i + a.cell.j) - (b.cell.i + b.cell.j))
    .map(({ p, cell }) => {
    const cx = (cell.pts[0].x + cell.pts[2].x) / 2;
    const cy = (cell.pts[0].y + cell.pts[2].y) / 2;
    const tree = treeOf(p.treeTypeGid);
    const dead = !p.isSuccess;
    const shadow = `<ellipse cx="${cx.toFixed(1)}" cy="${(cy + 2).toFixed(1)}" rx="9" ry="3.4" fill="rgba(0,0,0,.18)"/>`;
    const media = tree?.image
      ? `<image href="${esc(tree.image)}" x="${(cx - 17).toFixed(1)}" y="${(cy - 33).toFixed(1)}"
           width="34" height="34" preserveAspectRatio="xMidYMax meet"
           ${dead ? 'filter="url(#deadFilter)" opacity=".62"' : ""}/>`
      : `<text x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}" font-size="24" text-anchor="middle"
           ${dead ? 'opacity=".55"' : ""}>${dead ? "🥀" : "🌳"}</text>`;
    return `<g><title>${esc(`${tree?.title || "Cây"} · ${tagTitle(p.tag)} · ${Math.round(minutesOf(p))}′`)}</title>${shadow}${media}</g>`;
  });

  return `<svg viewBox="0 0 640 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vườn cây">
    <defs>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8ed15d"/><stop offset="1" stop-color="#6fbb46"/>
      </linearGradient>
      <filter id="deadFilter"><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <polygon points="${poly(leftSide)}" fill="#8a5a3b"/>
    <polygon points="${poly(rightSide)}" fill="#6f4630"/>
    <polygon points="${poly(top)}" fill="url(#grass)"/>
    <g stroke="rgba(255,255,255,.22)" stroke-width="1">${grid.join("")}</g>
    <g stroke="rgba(0,0,0,.10)" stroke-width="1" fill="none"><polygon points="${poly(top)}"/></g>
    ${treeEls.join("")}
    ${extra > 0 ? `<text x="16" y="386" font-size="12" fill="rgba(255,255,255,.85)">+${extra} cây nữa</text>` : ""}
  </svg>`;
}

/* ---------- chart ---------- */

function bucketize(plants) {
  const { from, to } = bounds();
  let buckets, labels, every;

  if (mode === "day") {
    buckets = Array(24).fill(0);
    for (const p of plants) buckets[new Date(p.startTime).getHours()] += minutesOf(p);
    labels = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 || h === 23 ? `${pad(h)}:00` : ""));
    every = 1;
  } else if (mode === "week") {
    const start = startOfWeek(anchor);
    buckets = Array(7).fill(0);
    for (const p of plants) {
      const idx = Math.round((startOfDay(p.startTime) - start) / DAY_MS);
      if (idx >= 0 && idx < 7) buckets[idx] += minutesOf(p);
    }
    labels = DOW.slice();
    every = 1;
  } else if (mode === "month") {
    const days = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    buckets = Array(days).fill(0);
    for (const p of plants) {
      const d = new Date(p.startTime).getDate() - 1;
      if (d >= 0 && d < days) buckets[d] += minutesOf(p);
    }
    labels = Array.from({ length: days }, (_, i) => (i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ""));
    every = 1;
  } else {
    buckets = Array(12).fill(0);
    for (const p of plants) buckets[new Date(p.startTime).getMonth()] += minutesOf(p);
    labels = MONTHS.map((m) => m.replace("tháng ", "T"));
    every = 1;
  }

  return { buckets, labels };
}

function chartSvg(buckets, labels) {
  const W = 560, H = 190;
  const L = 36, R = 8, T = 10, B = 24;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const maxRaw = Math.max(5, ...buckets);
  // bước chia "đẹp" (5,10,20,25,50,100…) để tối đa ~6 vạch
  const rough = maxRaw / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const stepV = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= rough) || 10 * pow;
  const stepY = Math.max(5, Math.round(stepV));
  const max = Math.ceil(maxRaw / stepY) * stepY;
  const step = plotW / buckets.length;
  const yOf = (v) => T + plotH - (v / max) * plotH;

  const lines = [];
  for (let v = 0; v <= max; v += stepY) {
    const y = yOf(v);
    lines.push(`<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`);
    lines.push(`<text x="${L - 6}" y="${(y + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="var(--muted)">${v}</text>`);
  }

  const barW = Math.max(3, Math.min(14, step * 0.62));
  const bars = buckets.map((v, i) => {
    const x = L + i * step + (step - barW) / 2;
    const y = yOf(v);
    const h = Math.max(v > 0 ? 2 : 0, T + plotH - y);
    if (!h) return "";
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
      rx="2" fill="var(--accent)"/>`;
  }).join("");

  const ticks = labels.map((text, i) => {
    if (!text) return "";
    const x = L + i * step + step / 2;
    return `<text x="${x.toFixed(1)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="var(--muted)">${esc(text)}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto" role="img" aria-label="Phân bố thời gian tập trung">
    ${lines.join("")}${bars}${ticks}
  </svg>`;
}

/* ---------- render ---------- */

function render() {
  const { from, to } = bounds();
  const list = allPlants().filter((p) => inRange(p, from, to));
  const alive = list.filter((p) => p.isSuccess).length;
  const dead = list.length - alive;
  const total = Math.round(list.reduce((s, p) => s + minutesOf(p), 0));

  $("#label").textContent = labelFor();
  $("#cnt-alive").textContent = alive;
  $("#cnt-dead").textContent = dead;
  $("#plot").innerHTML = plotSvg(list);

  const { buckets, labels } = bucketize(list);
  $("#chart").innerHTML = chartSvg(buckets, labels);
  $("#total").textContent = `Tổng: ${total} phút`;
}

async function ensureRange() {
  const { from, to } = bounds();
  const key = `${from.getTime()}|${to.getTime()}`;
  if (loadedRanges.has(key)) return;
  loadedRanges.add(key);
  try {
    const r = await send({ cmd: "LOAD_RANGE", from: from.toISOString(), to: to.toISOString() });
    if (!r?.ok) throw new Error(r?.error || "load failed");
    const res = await send({ cmd: "GET_STATE" });
    if (res?.ok) state = res.state;
  } catch (e) {
    $("#note").hidden = false;
    $("#note").textContent = `Không tải thêm được dữ liệu: ${e.message}`;
  }
}

function shift(delta) {
  if (mode === "day") anchor = addDays(anchor, delta);
  else if (mode === "week") anchor = addDays(anchor, delta * 7);
  else if (mode === "month") anchor = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
  else anchor = new Date(anchor.getFullYear() + delta, 0, 1);
  refresh();
}

async function refresh() {
  render();
  await ensureRange();
  render();
}

$("#prev").onclick = () => shift(-1);
$("#next").onclick = () => shift(1);

for (const btn of document.querySelectorAll("#tabs button")) {
  btn.onclick = () => {
    mode = btn.dataset.mode;
    for (const b of document.querySelectorAll("#tabs button")) {
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    }
    refresh();
  };
}

async function load() {
  try {
    const res = await send({ cmd: "GET_STATE" });
    if (!res?.ok) throw new Error(res?.error || "service worker trả lỗi");
    state = res.state;
    render();
    await ensureRange();
    render();
  } catch (e) {
    $("#note").hidden = false;
    $("#note").textContent = e.message;
  }
}

load();
