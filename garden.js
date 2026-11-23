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
// Plant tải theo khoảng ngày (LOAD_RANGE) giữ trong bộ nhớ trang: cache storage của
// background bị cắt còn 5000 plant mới nhất nên không đủ cho các năm cũ.
const rangePlants = new Map();

const isToday = (d) => startOfDay(d).getTime() === startOfDay(new Date()).getTime();

const plantKey = (p) => (p.id != null ? `id:${p.id}` : `k:${p.startTime}|${p.endTime}|${p.tag}`);

function allPlants() {
  const byKey = new Map();
  for (const p of state?.serverPlants || []) byKey.set(plantKey(p), { ...p, pending: false });
  for (const p of rangePlants.values()) byKey.set(plantKey(p), { ...p, pending: false });
  for (const p of state?.pendingPlants || []) byKey.set(plantKey(p), { ...p, pending: true });
  return [...byKey.values()].filter((p) => p.startTime);
}

/* Một plant có thể gồm nhiều cây (plant.trees[]). App đếm và vẽ theo từng cây:
   SumHealthyAndDeadTreeUseCase lặp plant.trees và cộng theo TreeEntity.dead.
   Plant chưa có trees (cây tạo cục bộ chưa sync) tính là 1 cây theo isSuccess. */
function treesOf(p) {
  if (p.trees?.length) {
    return p.trees.map((t) => ({ plant: p, gid: t.treeType || p.treeTypeGid, dead: !!t.isDead }));
  }
  return [{ plant: p, gid: p.treeTypeGid, dead: !p.isSuccess }];
}

/* Load treeTypes nếu thiếu — cần ảnh cây từ atlas_image_url. */
let catalogLoaded = false;
async function ensureCatalog() {
  if (catalogLoaded) return;
  catalogLoaded = true;
  try {
    const r = await send({ cmd: "LOAD_CATALOG" }).catch(() => null);
    if (r?.ok) {
      const res = await send({ cmd: "GET_STATE" });
      if (res?.ok) state = res.state;
    }
  } catch { /* bỏ qua, hiển thị không có ảnh */ }
}

/* Sprite crop: nếu atlas_image_url là sprite sheet, cần atlas_json_url để biết
   frame rect. Cache canvas đã crop cho mỗi (gid, phase). */
const spriteCache = new Map();

async function treeSprite(tree, phase = 0) {
  if (!tree?.image) return null;
  const key = `${tree.gid}|${phase}`;
  if (spriteCache.has(key)) return spriteCache.get(key);

  try {
    // Thử tải atlas_json_url trước để xem có phải sprite sheet không
    if (tree.atlasJsonUrl) {
      const resp = await fetch(tree.atlasJsonUrl, { cache: "no-store" });
      if (resp.ok) {
        const atlas = await resp.json();
        const frame = selectFrame(atlas, phase);
        if (frame) {
          const img = await loadImage(tree.image);
          const canvas = document.createElement("canvas");
          canvas.width = frame.w;
          canvas.height = frame.h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
          const url = canvas.toDataURL();
          spriteCache.set(key, url);
          return url;
        }
      }
    }
    // Không có atlas_json_url hoặc không parse được → dùng ảnh toàn bộ
    spriteCache.set(key, tree.image);
    return tree.image;
  } catch {
    spriteCache.set(key, tree.image);
    return tree.image;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/* Phân tích atlas JSON để tìm frame rect cho phase.
   Hỗ trợ nhiều format phổ biến:
   - TexturePacker: { frames: { "frame_name": { frame: {x,y,w,h} } } }
   - Custom array: [{ x,y,w,h, phase: N }]
   - Grid: { cols, rows, frameWidth, frameHeight, frames: [...] } */
function selectFrame(atlas, phase) {
  // TexturePacker format
  if (atlas.frames && typeof atlas.frames === "object") {
    const entries = Object.entries(atlas.frames);
    // Tìm frame có phase matching hoặc frame_<n>
    for (const [name, data] of entries) {
      const match = name.match(/phase_?(\d+)/i) || name.match(/_(\d+)/);
      if (match && parseInt(match[1]) === phase) {
        const f = data.frame || data;
        return { x: f.x, y: f.y, w: f.w, h: f.h };
      }
    }
    // Lấy frame đầu tiên nếu không match
    const first = entries[0];
    if (first) {
      const f = first[1].frame || first[1];
      return { x: f.x, y: f.y, w: f.w, h: f.h };
    }
  }
  // Array format
  if (Array.isArray(atlas)) {
    const idx = Math.min(phase, atlas.length - 1);
    const f = atlas[idx];
    if (f && typeof f === "object") {
      return { x: f.x || 0, y: f.y || 0, w: f.w || f.width, h: f.h || f.height };
    }
  }
  // Grid format
  if (atlas.cols && atlas.rows && atlas.frameWidth && atlas.frameHeight) {
    const cols = atlas.cols;
    const idx = Math.min(phase, cols * atlas.rows - 1);
    return {
      x: (idx % cols) * atlas.frameWidth,
      y: Math.floor(idx / cols) * atlas.frameHeight,
      w: atlas.frameWidth,
      h: atlas.frameHeight,
    };
  }
  return null;
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
  const trees = plants
    .slice()
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .flatMap(treesOf);
  // Đất mặc định 10×10, nới ra khi số cây vượt diện tích (năm nhiều cây → đảo lớn hơn).
  const N = Math.max(10, Math.ceil(Math.sqrt(trees.length)));
  const ux = 300 / N, uy = ux * 0.517;
  const size = ux * 1.3;
  const ox = 320, oy = size + 8;
  const depth = 12 + 1.8 * uy;
  const lip = depth * 0.4;
  const P = (i, j) => ({ x: ox + (i - j) * ux, y: oy + (i + j) * uy });
  const poly = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const down = (p, h) => ({ x: p.x, y: p.y + h });

  const top = [P(0, 0), P(N, 0), P(N, N), P(0, N)];
  const L0 = P(0, N), C0 = P(N, N), R0 = P(N, 0);
  const leftGrass = [L0, C0, down(C0, lip), down(L0, lip)];
  const rightGrass = [C0, R0, down(R0, lip), down(C0, lip)];
  const leftSoil = [down(L0, lip), down(C0, lip), down(C0, depth), down(L0, depth)];
  const rightSoil = [down(C0, lip), down(R0, lip), down(R0, depth), down(C0, depth)];

  // Ô cỏ xen kẽ hai sắc như app.
  const tiles = [];
  for (let i = 0; i < N; i++) {
    for (let j = (i % 2); j < N; j += 2) {
      tiles.push(`<polygon points="${poly([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)])}"/>`);
    }
  }

  // Chọn ô theo thứ tự giả ngẫu nhiên cố định (xorshift), rồi xếp cây theo thời gian từ sau ra trước.
  const hash = (i, j) => {
    let x = (i * 7919 + j * 104729 + 12345) | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return x >>> 0;
  };
  const cells = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) cells.push({ i, j, h: hash(i, j) });
  const chosen = cells
    .sort((a, b) => a.h - b.h)
    .slice(0, trees.length)
    .sort((a, b) => (a.i + a.j) - (b.i + b.j) || a.i - b.i);

  const treeEls = chosen.map((cell, idx) => {
    const t = trees[idx];
    const c = P(cell.i + 0.5, cell.j + 0.5);
    const type = treeOf(t.gid);
    const imgUrl = type?.spriteUrl || type?.image;
    const tip = `${type?.title || "Cây"} · ${tagTitle(t.plant.tag)} · ${Math.round(minutesOf(t.plant))}′${t.dead ? " · chết" : ""}`;
    const media = imgUrl
      ? `<image href="${esc(imgUrl)}" x="${(c.x - size / 2).toFixed(1)}" y="${(c.y - size * 0.92).toFixed(1)}"
           width="${size.toFixed(1)}" height="${size.toFixed(1)}" preserveAspectRatio="xMidYMax meet"
           ${t.dead ? 'filter="url(#deadFilter)" opacity=".7"' : ""}/>`
      : `<text x="${c.x.toFixed(1)}" y="${(c.y + size * 0.05).toFixed(1)}" font-size="${(size * 0.8).toFixed(1)}" text-anchor="middle">${t.dead ? "🥀" : "🌳"}</text>`;
    return `<g><title>${esc(tip)}</title>${media}</g>`;
  });

  return `<svg viewBox="0 0 640 ${Math.ceil(oy + 2 * N * uy + depth + 6)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vườn cây">
    <defs><filter id="deadFilter"><feColorMatrix type="saturate" values="0.15"/></filter></defs>
    <polygon points="${poly(leftSoil)}" fill="#63502b"/>
    <polygon points="${poly(rightSoil)}" fill="#8e6e32"/>
    <polygon points="${poly(leftGrass)}" fill="#739d24"/>
    <polygon points="${poly(rightGrass)}" fill="#81a737"/>
    <polygon points="${poly(top)}" fill="#a3d044"/>
    <g fill="#aed950">${tiles.join("")}</g>
    ${treeEls.join("")}
  </svg>`;
}

/* ---------- chart ---------- */

function bucketize(plants) {
  let buckets, labels, names;

  if (mode === "day") {
    buckets = Array(24).fill(0);
    for (const p of plants) buckets[new Date(p.startTime).getHours()] += minutesOf(p);
    labels = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 || h === 23 ? `${pad(h)}:00` : ""));
    names = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`);
  } else if (mode === "week") {
    const start = startOfWeek(anchor);
    buckets = Array(7).fill(0);
    for (const p of plants) {
      const idx = Math.round((startOfDay(p.startTime) - start) / DAY_MS);
      if (idx >= 0 && idx < 7) buckets[idx] += minutesOf(p);
    }
    labels = DOW.slice();
    names = WEEKDAY_NAMES.map((n, i) => `${n} ${addDays(start, i).getDate()}/${addDays(start, i).getMonth() + 1}`);
  } else if (mode === "month") {
    const days = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    buckets = Array(days).fill(0);
    for (const p of plants) {
      const d = new Date(p.startTime).getDate() - 1;
      if (d >= 0 && d < days) buckets[d] += minutesOf(p);
    }
    labels = Array.from({ length: days }, (_, i) => (i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ""));
    names = Array.from({ length: days }, (_, i) => `${i + 1}/${anchor.getMonth() + 1}`);
  } else {
    buckets = Array(12).fill(0);
    for (const p of plants) buckets[new Date(p.startTime).getMonth()] += minutesOf(p);
    labels = MONTHS.map((m) => m.replace("tháng ", "T"));
    names = MONTHS.map((m) => m.replace("tháng", "Tháng"));
  }

  return { buckets: buckets.map(Math.round), labels, names };
}

/* Trục Y với bước chia "đẹp" (5,10,20,25,50,100…), tối đa ~6 vạch. */
function yAxis(maxRaw) {
  const rough = Math.max(5, maxRaw) / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const stepV = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= rough) || 10 * pow;
  const stepY = Math.max(5, Math.round(stepV));
  return { stepY, max: Math.ceil(Math.max(5, maxRaw) / stepY) * stepY };
}

function gridSvg(L, R, W, yOf, { stepY, max }) {
  const lines = [];
  for (let v = 0; v <= max; v += stepY) {
    const y = yOf(v);
    lines.push(`<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" stroke="#fff" stroke-opacity=".06" stroke-width="1"/>`);
    lines.push(`<text x="${L - 8}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="#6f7d8a">${v}</text>`);
  }
  return lines;
}

/* Đường cong monotone (Fritsch–Carlson): mượt nhưng không vọt quá điểm dữ liệu,
   nên không bao giờ võng xuống dưới 0. */
function smoothPath(p) {
  if (p.length < 2) return p.length ? `M${p[0].x},${p[0].y}` : "";
  const n = p.length;
  const m = [];
  for (let k = 0; k < n - 1; k++) m.push((p[k + 1].y - p[k].y) / (p[k + 1].x - p[k].x));
  const t = p.map((_, k) => (k === 0 ? m[0] : k === n - 1 ? m[n - 2] : m[k - 1] * m[k] <= 0 ? 0 : (m[k - 1] + m[k]) / 2));
  for (let k = 0; k < n - 1; k++) {
    if (m[k] === 0) { t[k] = 0; t[k + 1] = 0; continue; }
    const a = t[k] / m[k], b = t[k + 1] / m[k], s = a * a + b * b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); t[k] = tau * a * m[k]; t[k + 1] = tau * b * m[k]; }
  }
  const f = (v) => v.toFixed(1);
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let k = 0; k < n - 1; k++) {
    const dx = (p[k + 1].x - p[k].x) / 3;
    d += ` C${f(p[k].x + dx)},${f(p[k].y + t[k] * dx)} ${f(p[k + 1].x - dx)},${f(p[k + 1].y - t[k + 1] * dx)} ${f(p[k + 1].x)},${f(p[k + 1].y)}`;
  }
  return d;
}

const CHART_PALETTES = {
  green: { hi: "#45d4a8", lo: "#2d9cdb" },
  warm: { hi: "#f2e56b", lo: "#e47ba0" },
};

/* Biểu đồ đường dùng chung, kiểu thẻ tối: đường cong đổi màu theo độ cao, vùng tô
   gradient mờ dần. Rê chuột lên một mốc hiện cột sáng + chấm + giá trị; khi không rê,
   (các) mốc cao nhất được hiện sẵn. CSS .lc/.hov nằm trong garden.html. */
let chartSeq = 0;
function lineChartSvg({ values, labels, names, palette = "green", ariaLabel }) {
  const W = 560, H = 200;
  const L = 36, R = 16, T = 26, B = 26;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const n = values.length;
  const axis = yAxis(Math.max(...values));
  const yOf = (v) => T + plotH - (v / axis.max) * plotH;
  const pad = 18; // tách điểm đầu/cuối khỏi nhãn trục Y và mép
  const step = (plotW - 2 * pad) / Math.max(1, n - 1);
  const xOf = (i) => L + pad + step * i;
  const top = Math.max(...values);
  const { hi, lo } = CHART_PALETTES[palette];
  const id = `lc${++chartSeq}`;
  const base = T + plotH;

  const pts = values.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
  const line = smoothPath(pts);
  const area = `${line} L${xOf(n - 1).toFixed(1)},${base} L${xOf(0).toFixed(1)},${base} Z`;

  const ticks = labels.map((t, i) => (t
    ? `<text x="${xOf(i).toFixed(1)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#6f7d8a">${esc(t)}</text>`
    : "")).join("");

  const hovers = values.map((v, i) => {
    const x = xOf(i), y = yOf(v);
    const on = top > 0 && v === top ? " on" : "";
    const xl = labels[i] || names[i];
    const xlW = xl.length * 6.4 + 12; // nền che nhãn trục X bên cạnh khi bị đè
    return `<g class="hov${on}">
      <title>${esc(names[i])}: ${v} phút</title>
      <rect x="${(x - step / 2).toFixed(1)}" y="${T - 18}" width="${step.toFixed(1)}" height="${plotH + 18}" fill="#fff" fill-opacity=".05"/>
      <text x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" font-size="11" font-weight="600" text-anchor="middle" fill="#fff">${v}′</text>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#fff" stroke="url(#${id}s)" stroke-width="2.5"/>
      <rect x="${(x - xlW / 2).toFixed(1)}" y="${H - 21}" width="${xlW.toFixed(1)}" height="18" rx="9" fill="#3a4a5b"/>
      <text x="${x.toFixed(1)}" y="${H - 8}" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">${esc(xl)}</text>
    </g>`;
  }).join("");

  return `<svg class="lc" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto" role="img" aria-label="${esc(ariaLabel)}">
    <defs>
      <linearGradient id="${id}s" gradientUnits="userSpaceOnUse" x1="0" y1="${T}" x2="0" y2="${base}">
        <stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/>
      </linearGradient>
      <linearGradient id="${id}a" gradientUnits="userSpaceOnUse" x1="0" y1="${T}" x2="0" y2="${base}">
        <stop offset="0" stop-color="${hi}" stop-opacity=".35"/><stop offset="1" stop-color="${lo}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridSvg(L, R, W, yOf, axis).join("")}
    <path d="${area}" fill="url(#${id}a)"/>
    <path d="${line}" fill="none" stroke="url(#${id}s)" stroke-width="2.5" stroke-linecap="round"/>
    ${ticks}${hovers}
  </svg>`;
}

/* ---------- render ---------- */

function render() {
  const { from, to } = bounds();
  const list = allPlants().filter((p) => inRange(p, from, to));
  const trees = list.flatMap(treesOf);
  const dead = trees.filter((t) => t.dead).length;
  const total = Math.round(list.reduce((s, p) => s + minutesOf(p), 0));

  $("#label").textContent = labelFor();
  const now = Date.now();
  $("#today").hidden = now >= from.getTime() && now <= to.getTime();
  $("#cnt-alive").textContent = trees.length - dead;
  $("#cnt-dead").textContent = dead;
  $("#plot").innerHTML = plotSvg(list);

  const { buckets, labels, names } = bucketize(list);
  $("#chart").innerHTML = lineChartSvg({ values: buckets, labels, names, ariaLabel: "Phân bố thời gian tập trung" });
  $("#total").innerHTML = `Tổng thời gian tập trung: <b>${total}</b> phút`;

  // Ngày tập trung nhiều nhất trong tuần: không có nghĩa ở tab Ngày.
  $("#weekdayCard").hidden = mode === "day";
  if (mode !== "day") renderWeekday(list, from, to);
}

/* ---------- ngày tập trung nhiều nhất trong tuần ----------
   Như GroupTotalPlantingTimeByTimeUnitUseCase(average=true) của app: phút trung bình mỗi
   thứ = tổng phút của thứ đó / số lần thứ đó xuất hiện trong kỳ (tính tới hôm nay).
   Ngày cao nhất theo GetMaxPlantingTimeByTimeUnitUseCase (giữ mọi ngày bằng nhau). */

const WEEKDAY_NAMES = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"];
const weekdayIdx = (d) => (new Date(d).getDay() + 6) % 7; // thứ 2 = 0

function weekdayAverages(list, from, to) {
  const totals = Array(7).fill(0);
  for (const p of list) totals[weekdayIdx(p.startTime)] += minutesOf(p);

  const occur = Array(7).fill(0);
  const end = new Date(Math.min(to.getTime(), Date.now()));
  for (let d = startOfDay(from); d <= end; d = addDays(d, 1)) occur[weekdayIdx(d)]++;

  return totals.map((t, i) => Math.round(t / Math.max(1, occur[i])));
}

function weekdayDescription(avgs) {
  const top = Math.max(...avgs);
  if (top <= 0) return "Chưa có thời gian tập trung trong kỳ này.";
  const maxDays = avgs.flatMap((v, i) => (v === top ? [WEEKDAY_NAMES[i]] : []));
  if (maxDays.length === 1) return `Thường tập trung nhiều nhất vào <b>${maxDays[0]}</b> hằng tuần`;
  if (maxDays.length <= 3) return `Những ngày bạn tập trung nhiều nhất là <b>${maxDays.join(", ")}</b>!`;
  return "Bạn có hơn 3 ngày tập trung nhiều nhất trong tuần. Ngày nào cũng có thể là ngày tập trung!";
}

function weekdayChartSvg(avgs) {
  return lineChartSvg({ values: avgs, labels: DOW, names: WEEKDAY_NAMES, palette: "warm", ariaLabel: "Phút tập trung trung bình theo thứ" });
}

function renderWeekday(list, from, to) {
  const avgs = weekdayAverages(list, from, to);
  $("#weekdayDesc").innerHTML = weekdayDescription(avgs);
  $("#weekdayChart").innerHTML = weekdayChartSvg(avgs);
}

/* Crop sprite cho các cây trong list hiện tại (nếu có atlas_json_url).
   Chạy async sau render, cập nhật lại plot khi xong. */
let spriteCropRunning = false;
async function cropSprites(plants) {
  if (spriteCropRunning) return;
  spriteCropRunning = true;
  try {
    const types = new Map();
    for (const t of plants.flatMap(treesOf)) {
      const type = treeOf(t.gid);
      if (type && !type.spriteUrl && !spriteCache.has(`${type.gid}|0`)) types.set(type.gid, type);
    }
    if (!types.size) return;
    for (const type of types.values()) type.spriteUrl = await treeSprite(type, 0);
    render();
  } finally {
    spriteCropRunning = false;
  }
}

async function ensureRange() {
  const { from, to } = bounds();
  const key = `${from.getTime()}|${to.getTime()}`;
  if (loadedRanges.has(key)) return;
  loadedRanges.add(key);
  try {
    const r = await send({ cmd: "LOAD_RANGE", from: from.toISOString(), to: to.toISOString() });
    if (!r?.ok) throw new Error(r?.error || "load failed");
    for (const p of r.plants || []) rangePlants.set(plantKey(p), p);
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
  // Crop sprite async sau khi render — không chặn UI
  const { from, to } = bounds();
  const list = allPlants().filter((p) => inRange(p, from, to));
  cropSprites(list).catch(() => {});
}

$("#prev").onclick = () => shift(-1);
$("#next").onclick = () => shift(1);
$("#today").onclick = () => {
  anchor = startOfDay(new Date());
  refresh();
};

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
    // Crop sprite async — không chặn
    const { from, to } = bounds();
    const list = allPlants().filter((p) => inRange(p, from, to));
    cropSprites(list).catch(() => {});
  } catch (e) {
    $("#note").hidden = false;
    $("#note").textContent = e.message;
  }
}

load();
