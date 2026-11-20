/* Popup: card xanh kiểu Forest — gear, Blocklist mode, +, cây tròn, timer lớn,
   chọn cây (hiển thị tên), chip thời lượng. Không dùng inline handler (CSP MV3). */

const $ = (sel, el = document) => el.querySelector(sel);
const send = (msg, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service worker không phản hồi (timeout)")), timeoutMs);
    chrome.runtime.sendMessage(msg).then(
      (r) => { clearTimeout(timer); resolve(r); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });

const currentId = () => {
  try { return chrome.runtime.id || null; } catch { return null; }
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DURATIONS = [10, 15, 25, 30, 35, 45, 60];
const PHASES = [
  { max: 1 / 3, icon: "🌱", label: "Hạt mầm" },
  { max: 2 / 3, icon: "🌿", label: "Nảy mầm" },
  { max: 0.9, icon: "🪴", label: "Cây non" },
  { max: Infinity, icon: "🌳", label: "Sắp lớn" },
];
const DEFAULT_TREE = { gid: 0, title: "Cây mặc định" };

let ticker = null;
let state = null;
let selectedDuration = 25;
let durationTouched = false;
let catalogRequested = false;

const phaseOf = (ratio) => PHASES.find((p) => ratio < p.max);

function fmtRemain(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const tagTitle = (s, id) =>
  (s.tags?.length ? s.tags : [{ tagId: 0, title: "Unset" }]).find((t) => t.tagId === id)?.title || "Unset";

const treeList = (s) => (s.treeTypes?.length ? s.treeTypes : [DEFAULT_TREE]);

function selectedTree(s) {
  const list = treeList(s);
  const gid = Number(s.selectedTreeGid ?? list[0].gid);
  return list.find((t) => Number(t.gid) === gid) || list[0];
}

const treeImg = (t, cls = "treeImg") =>
  t.image
    ? `<img class="${cls}" src="${esc(t.image)}" alt="${esc(t.title)}" loading="lazy">`
    : `<span class="tree">🌳</span>`;

/* Ảnh là URL remote; nếu lỗi (offline/hotlink chặn) thì quay về emoji. */
function wireTreeImages(root = document) {
  for (const img of root.querySelectorAll("img.treeImg")) {
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "tree";
      span.textContent = "🌳";
      img.replaceWith(span);
    });
  }
  for (const img of root.querySelectorAll("img.thumb")) {
    img.addEventListener("error", () => img.remove());
  }
}

const boostActive = (user) => {
  const end = user?.boost?.end;
  return !!end && new Date(end).getTime() > Date.now();
};

/* ---------- views ---------- */

function bar(s, { planting }) {
  return `<div class="bar">
    <button class="icon" id="gear" title="Cài đặt / Lịch sử">⚙</button>
    <button class="switch" id="blockSwitch" data-on="${s.blockEnabled ? 1 : 0}"
      title="Blocklist mode" aria-label="Blocklist mode"></button>
    <span class="mode">Blocklist mode</span>
    ${planting ? "" : `<button class="icon plus" id="add" title="Trồng cây">+</button>`}
  </div>`;
}

const card = (inner) => `<div class="card">${inner}</div>`;

function idleView(s) {
  const living = (s.serverPlants || []).filter((p) => p.isSuccess).length;
  const coins = s.user?.coin ?? 0;
  const tree = selectedTree(s);
  const reward = s.lastReward && Date.now() - s.lastReward.at < 10 * 60 * 1000
    ? `<div class="note">🌳 Cây đã lớn! <b>+${s.lastReward.coins} xu</b> · tổng ${s.lastReward.coin}</div>`
    : "";
  return card(`
    ${bar(s, { planting: false })}
    <div class="msg">Click the tree to start planting!</div>
    <div class="stage">
      <div class="halo" id="tree" role="button" tabindex="0" title="Trồng ${esc(tree.title)} trong ${selectedDuration} phút">
        ${treeImg(tree)}
      </div>
    </div>
    <div class="timer" id="timer">${String(selectedDuration).padStart(2, "0")}:00</div>
    <div class="treebar">
      <button class="treeName" id="pickTree" title="Chọn loại cây">
        <span>🌲</span><span class="n">${esc(tree.title)}</span><span>▾</span>
      </button>
    </div>
    <div class="durations" id="durations">
      ${DURATIONS.map((d) => `<button class="chip" data-d="${d}" data-sel="${d === selectedDuration ? 1 : 0}">${d}′</button>`).join("")}
    </div>
    <div class="foot">
      <span>🪙 ${coins}${boostActive(s.user) ? ` · x${s.user.boost.rate ?? 2}` : ""}${s.user ? "" : " · chưa đăng nhập"}</span>
      <button class="link" id="garden" title="Xem vườn cây">🌳 ${living}</button>
    </div>
    ${reward}
    ${notifyWarning(s)}
  `);
}

function notifyWarning(s) {
  const ln = s.lastNotify;
  if (s.notifyEnabled === false || !ln || ln.ok) return "";
  const msg = ln.reason === "no_permission"
    ? "Thông báo chưa hoạt động: chưa cấp quyền. Mở ⚙ → Thông báo hệ thống → Gửi thử → Allow."
    : "Lần thông báo gần nhất không gửi được. Mở ⚙ → Thông báo hệ thống để xem lý do.";
  return `<div class="note warn">🔔 ${esc(msg)}</div>`;
}

function plantingView(s) {
  const p = s.planting;
  const total = p.durationMin * 60 * 1000;
  const remain = new Date(p.endTime).getTime() - Date.now();
  const ratio = Math.min(1, Math.max(0, 1 - remain / total));
  const ph = phaseOf(ratio);
  const tree = s.treeTypes?.find((t) => Number(t.gid) === Number(p.treeTypeGid)) || DEFAULT_TREE;
  return card(`
    ${bar(s, { planting: true })}
    <div class="msg">${ph.icon} ${ph.label} · ${esc(tagTitle(s, p.tag))}</div>
    <div class="stage">
      <div class="halo" id="tree" title="${esc(tree.title)}">
        ${tree.image ? treeImg(tree) : `<span class="tree">${ph.icon}</span>`}
      </div>
    </div>
    <div class="timer" id="timer">${fmtRemain(remain)}</div>
    <div class="treebar">
      <span class="treeName" style="cursor:default"><span>🌲</span><span class="n">${esc(tree.title)}</span></span>
    </div>
    <div class="foot">
      <span>${p.durationMin}′ · ${esc(tagTitle(s, p.tag))}</span>
      <button class="warn" id="giveUp">Bỏ cuộc</button>
    </div>
  `);
}

function loggedOutView() {
  return card(`
    <div class="bar">
      <button class="icon" id="gear" title="Cài đặt">⚙</button>
    </div>
    <div class="msg">Đăng nhập để bắt đầu trồng cây</div>
    <div class="stage">
      <div class="halo" id="tree"><span class="tree">🌳</span></div>
    </div>
    <div class="timer">00:00</div>
    <div class="foot"><button class="solid" id="login">Mở cài đặt</button></div>
  `);
}

function errorView(err) {
  const stale = !currentId();
  return card(`
    <div class="bar"><button class="icon" id="gear">⚙</button></div>
    <div class="note warn">⚠️ ${stale
      ? "Trang thuộc phiên bản extension cũ — hãy đóng và mở lại popup."
      : "Không tải được trạng thái từ background."}</div>
    <div class="note">${esc(err?.message || err)}</div>
    <div class="foot"><button class="solid" id="retry">${stale ? "Mở lại popup" : "Thử lại"}</button></div>
  `);
}

/* ---------- tree picker ---------- */

function openTreePicker() {
  const cardEl = $(".card");
  if (!cardEl || $(".sheet")) return;
  const list = treeList(state);
  const current = Number(selectedTree(state).gid);

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = `
    <div class="sheetBar">
      <h3 id="sheetTitle">Chọn loại cây (${list.length})</h3>
      <button class="icon" id="closeSheet" title="Đóng">✕</button>
    </div>
    <input id="treeSearch" class="search" type="search" placeholder="Tìm theo tên hoặc #gid"
      autocomplete="off" spellcheck="false">
    <div class="list" role="listbox">
      ${list.map((t) => `
        <button class="item" data-gid="${t.gid}"
          data-text="${esc(`${t.title} #${t.gid}`.toLowerCase())}"
          aria-selected="${Number(t.gid) === current ? "true" : "false"}">
          ${t.image ? `<img class="thumb" loading="lazy" src="${esc(t.image)}" alt="">` : ""}
          <span class="n">${esc(t.title)}</span><span class="gid">#${t.gid}</span>
        </button>`).join("")}
    </div>`;

  cardEl.appendChild(sheet);
  wireTreeImages(sheet);

  const search = sheet.querySelector("#treeSearch");
  const title = sheet.querySelector("#sheetTitle");
  const items = Array.from(sheet.querySelectorAll(".item"));

  const applyFilter = () => {
    const q = search.value.trim().toLowerCase().replace(/^#/, "");
    let shown = 0;
    for (const it of items) {
      const hit = !q || it.dataset.text.includes(q);
      it.hidden = !hit;
      if (hit) shown++;
    }
    title.textContent = q ? `Chọn loại cây (${shown}/${list.length})` : `Chọn loại cây (${list.length})`;
    return shown;
  };

  search.addEventListener("input", applyFilter);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { sheet.remove(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = items.find((it) => !it.hidden);
      if (first) first.click();
    }
  });

  sheet.addEventListener("click", async (e) => {
    if (e.target.closest("#closeSheet") || e.target === sheet) { sheet.remove(); return; }
    const item = e.target.closest(".item");
    if (!item) return;
    const gid = Number(item.dataset.gid);
    await send({ cmd: "UPDATE_SETTINGS", patch: { selectedTreeGid: gid } });
    state.selectedTreeGid = gid;
    sheet.remove();
    render();
  });

  search.focus();
}

/* ---------- render ---------- */

async function render() {
  const app = $("#app");
  let res;
  try {
    res = await send({ cmd: "GET_STATE" });
    if (!res?.ok) throw new Error(res?.error || "service worker trả lỗi");
  } catch (e) {
    app.innerHTML = errorView(e);
    stopTicker();
    const retry = $("#retry");
    if (retry) retry.onclick = () => (currentId() ? render() : location.reload());
    return;
  }

  state = res.state;
  if (!durationTouched && DURATIONS.includes(Number(state.selectedDuration))) {
    selectedDuration = Number(state.selectedDuration);
  }
  send({ cmd: "ACK_BADGE" }).catch(() => {});
  const stale = res.build !== 3;
  const staleNote = stale
    ? `<div class="note warn">⚠️ Background đang chạy code cũ — reload extension ở <code>brave://extensions</code>.</div>`
    : "";

  if (!state.user) {
    app.innerHTML = loggedOutView();
    $("#gear").onclick = () => chrome.runtime.openOptionsPage();
    $("#login").onclick = () => chrome.runtime.openOptionsPage();
    $("#tree").onclick = () => chrome.runtime.openOptionsPage();
    if (staleNote) $(".card").insertAdjacentHTML("beforeend", staleNote);
    stopTicker();
    return;
  }

  if (state.planting) {
    app.innerHTML = plantingView(state);
    wireCommon();
    if (staleNote) $(".card").insertAdjacentHTML("beforeend", staleNote);
    wireTreeImages();
    const give = $("#giveUp");
    if (give) give.onclick = async () => {
      if (!confirm("Bỏ giữa chừng? Cây sẽ chết và được ghi lại.")) return;
      await send({ cmd: "GIVE_UP" });
      render();
    };
    startTicker();
    return;
  }

  stopTicker();
  app.innerHTML = idleView(state);
  wireCommon();
  if (staleNote) $(".card").insertAdjacentHTML("beforeend", staleNote);

  $("#tree").onclick = () => start();
  wireTreeImages();
  const add = $("#add");
  if (add) add.onclick = () => start();
  const garden = $("#garden");
  if (garden) garden.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("garden.html") });
  const pick = $("#pickTree");
  if (pick) pick.onclick = () => openTreePicker();

  for (const chip of document.querySelectorAll("#durations .chip")) {
    chip.onclick = () => {
      selectedDuration = Number(chip.dataset.d);
      durationTouched = true;
      send({ cmd: "UPDATE_SETTINGS", patch: { selectedDuration } }).catch(() => {});
      for (const c of document.querySelectorAll("#durations .chip")) {
        c.dataset.sel = c === chip ? "1" : "0";
      }
      const t = $("#timer");
      if (t) t.textContent = `${String(selectedDuration).padStart(2, "0")}:00`;
    };
  }

  // Lần đầu đăng nhập: chưa có catalog thì xin background tải (tags + loại cây).
  if (!state.treeTypes?.length && !catalogRequested) {
    catalogRequested = true;
    const r = await send({ cmd: "LOAD_CATALOG" }).catch(() => null);
    if (r?.ok) render();
  }
}

function wireCommon() {
  const gear = $("#gear");
  if (gear) gear.onclick = () => chrome.runtime.openOptionsPage();

  const sw = $("#blockSwitch");
  if (sw) sw.onclick = async () => {
    const next = sw.dataset.on !== "1";
    sw.dataset.on = next ? "1" : "0";
    await send({ cmd: "UPDATE_SETTINGS", patch: { blockEnabled: next } });
  };
}

async function start() {
  const gid = Number(selectedTree(state).gid);
  const r = await send({
    cmd: "START_PLANTING",
    treeTypeGid: gid,
    tag: 1,
    note: "",
    durationMin: selectedDuration,
  });
  if (!r?.ok) {
    if (r?.error === "already_planting") return render();
    alert(`Không bắt đầu được: ${r?.error || "lỗi không rõ"}`);
    return;
  }
  render();
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const t = $("#timer");
    if (!t || !state?.planting) { stopTicker(); return; }
    const p = state.planting;
    const total = p.durationMin * 60 * 1000;
    const remain = new Date(p.endTime).getTime() - Date.now();
    if (remain <= 0) { render(); return; }
    const ratio = Math.min(1, Math.max(0, 1 - remain / total));
    const ph = phaseOf(ratio);
    t.textContent = fmtRemain(remain);
    const img = $("img.treeImg");
    if (img) {
      img.style.transform = `scale(${0.6 + ratio * 0.4})`;
    } else {
      const tree = $(".tree");
      if (tree && tree.textContent !== ph.icon) tree.textContent = ph.icon;
    }
  }, 1000);
}

function stopTicker() {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "PLANTING_DONE" || m?.type === "PLANTING_GAVE_UP") render();
});

render();
