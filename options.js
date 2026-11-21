import { BUILD } from "./build.js";
/* Trang cài đặt: đăng nhập, hồ sơ/xu, đồng bộ, chặn trang, lịch sử.
   Không dùng inline handler (CSP MV3). */

const $ = (sel, el = document) => el.querySelector(sel);
const EXPECTED_ID = "kjacjjdnoddnpbbcjilcajfhhbdhkpgk";
const EXPECTED_BUILD = BUILD;

/* Timeout để trang không kẹt "Đang tải…" khi service worker chết hoặc trang
   thuộc phiên bản extension cũ (context invalidated). */
function send(msg, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service worker không phản hồi (timeout)")), timeoutMs);
    chrome.runtime.sendMessage(msg).then(
      (r) => {
        clearTimeout(timer);
        if (r && r.ok === false && r.error === "unknown_cmd") {
          r.error = "Background chạy bản cũ — mở brave://extensions và bấm reload Forest Personal rồi thử lại";
        }
        resolve(r);
      },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function currentId() {
  try { return chrome.runtime.id || null; } catch { return null; }
}

const TAG_FALLBACK = [
  { tagId: 0, title: "Unset" },
  { tagId: 1, title: "Work" },
  { tagId: 2, title: "Study" },
  { tagId: 3, title: "Social" },
  { tagId: 4, title: "Rest" },
];

let busy = false;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");

const tagTitle = (state, id) =>
  (state.tags?.length ? state.tags : TAG_FALLBACK).find((t) => t.tagId === id)?.title || `Tag ${id}`;

function switchHtml(id, label, on) {
  return `<label class="switch"><input type="checkbox" id="${id}"${on ? " checked" : ""}><span class="track"></span><span>${label}</span></label>`;
}

function cardHead(icon, title, desc, right = "") {
  return `<div class="cardHead"><div class="ic">${icon}</div><div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ""}</div>${right ? `<div class="right">${right}</div>` : ""}</div>`;
}

function accountSection(state) {
  if (!state.user) {
    return `
      <div class="hero"><div class="login">
        <h2>Đăng nhập Forest</h2>
        <p>Dùng email và mật khẩu tài khoản Forest của bạn.</p>
        <select id="region">
          <option value="global"${state.region === "global" ? " selected" : ""}>Global (forestapp.cc)</option>
          <option value="china"${state.region === "china" ? " selected" : ""}>China (upwardsware.com)</option>
        </select>
        <input id="email" type="email" placeholder="Email" autocomplete="username">
        <input id="password" type="password" placeholder="Mật khẩu" autocomplete="current-password">
        <button id="signin">Đăng nhập</button>
        <span id="loginMsg"></span>
      </div></div>`;
  }

  const u = state.user;
  const boostEnd = u.boost?.end ? new Date(u.boost.end) : null;
  const boostActive = boostEnd && boostEnd.getTime() > Date.now();
  const hours = Math.floor((u.totalMinutes ?? 0) / 60);
  const initial = (u.name || u.email || "?").trim().charAt(0).toUpperCase();
  const tile = (k, v) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `
    <div class="hero">
      <div class="who">
        <div class="avatar">${esc(initial)}</div>
        <div>
          <div class="name">${esc(u.name || "—")}</div>
          <div class="meta">${esc(u.email || "")} · ID ${u.id ?? "?"}</div>
          ${boostActive ? `<span class="boost">Boost x${u.boost.rate ?? 2} đến ${fmtDate(u.boost.end)}</span>` : ""}
        </div>
      </div>
      <div class="tiles">
        ${tile("🪙 Xu", (u.coin ?? 0).toLocaleString("vi-VN"))}
        ${tile("🌳 Cây sống", (u.healthTreeCount ?? 0).toLocaleString("vi-VN"))}
        ${tile("🥀 Cây chết", (u.deadTreeCount ?? 0).toLocaleString("vi-VN"))}
        ${tile("⏱ Giờ tập trung", hours.toLocaleString("vi-VN"))}
        ${tile("💎 Gem", (u.gem ?? 0).toLocaleString("vi-VN"))}
      </div>
      <div class="heroActions">
        <button id="garden" class="solid">🌳 Vườn cây</button>
        <button id="refresh">Cập nhật hồ sơ</button>
        <button id="check">Kiểm tra kết nối</button>
        <button id="signout" class="out">Đăng xuất</button>
      </div>
      <div id="accountMsg" class="heroNote">Cookie phiên: <span id="cookieState">đang kiểm tra…</span></div>
    </div>`;
}

function syncSection(state) {
  const last = state.lastSyncedAt ? fmtDate(state.lastSyncedAt) : "chưa sync";
  return `
    <section class="card">
      ${cardHead("🔄", "Đồng bộ", "Đẩy cây đang chờ lên server rồi kéo lịch sử 30 ngày gần nhất. Xu được server cộng sau khi cây được ghi nhận.",
        `<button id="sync">Sync ngay</button>`)}
      <div class="stats">
        <div class="stat"><div class="k">Chờ đẩy</div><div class="v">${state.pendingPlants.length}</div></div>
        <div class="stat"><div class="k">Cây đã tải</div><div class="v">${(state.serverPlants || []).length}</div></div>
        <div class="stat"><div class="k">Lần cuối</div><div class="v small">${last}</div></div>
      </div>
      <div id="syncMsg" class="toast last"></div>
      ${state.syncError ? `<p class="bad last">Lỗi gần nhất: ${esc(state.syncError)}</p>` : ""}
    </section>`;
}

function blockSection(state) {
  return `
    <section class="card">
      ${cardHead("🚫", "Chặn trang khi tập trung", "Chuyển hướng các trang gây xao nhãng sang trang chặn. Whitelist chỉ bật khi allowlist có ít nhất một domain.")}
      <div class="row">
        ${switchHtml("blockEnabled", "Bật chặn", state.blockEnabled)}
        ${switchHtml("whitelistMode", "Whitelist (chặn tất cả trừ allowlist)", state.whitelistMode)}
      </div>
      <div class="grid2">
        <div class="field"><label>Blocklist — mỗi dòng một domain</label>
          <textarea id="blocklist" rows="8">${esc(state.blocklist.join("\n"))}</textarea></div>
        <div class="field"><label>Allowlist — chỉ dùng ở chế độ whitelist</label>
          <textarea id="allowlist" rows="8">${esc(state.allowlist.join("\n"))}</textarea></div>
      </div>
      <div class="row"><button id="saveBlock">Lưu</button><span id="blockMsg" class="toast"></span></div>
    </section>`;
}

function floatSection(state) {
  return `
    <section class="card">
      ${cardHead("🪟", "Widget nổi (always-on-top)", "App WPF riêng luôn nổi trên các cửa sổ khác, đồng bộ trạng thái và nhận lệnh Start / Give up. Chỉ Windows.")}
      <div class="row">${switchHtml("floatEnabled", "Bật widget nổi", state.floatEnabled)}<span id="floatMsg" class="toast"></span></div>
      <ol class="steps">
        <li>Bật công tắc trên và chọn <b>Allow</b> quyền localhost.</li>
        <li>Chạy <code>float\\start-float.bat</code> trong thư mục extension.</li>
        <li>Kéo vùng trống của widget để di chuyển; ✕ để đóng.</li>
      </ol>
    </section>`;
}

function telegramSection(state) {
  const t = state.telegram || {};
  const last = state.lastTelegram;
  const lastHtml = last
    ? `<div class="last">Lần gửi gần nhất (${esc(new Date(last.at).toLocaleString("vi-VN"))}): ${
        last.ok ? '<span class="ok">thành công</span>' : `<span class="bad">${esc(last.reason || "thất bại")}</span>`}</div>`
    : "";
  return `
    <section class="card">
      ${cardHead("✈️", "Telegram", "Nhận tin khi cây lớn hoặc chết qua bot Telegram của bạn (khuyến nghị).",
        switchHtml("tgEnabled", "", t.enabled))}
      <div class="field"><label>Bot token</label>
        <input id="tgToken" type="password" placeholder="123456:ABC… (từ @BotFather)" autocomplete="off" value="${esc(t.token || "")}"></div>
      <div class="row">
        <div class="field" style="flex:1 1 220px"><label>Chat ID</label>
          <input id="tgChat" type="text" placeholder="Bấm “Lấy chat ID” sau khi Start bot" autocomplete="off" value="${esc(t.chatId || "")}"></div>
        <button id="tgFind" class="ghost" style="align-self:flex-end">Lấy chat ID</button>
      </div>
      <div class="row">
        <button id="tgSave">Lưu</button>
        <button id="tgTest" class="ghost">Gửi thử</button>
        <span id="tgMsg" class="toast"></span>
      </div>
      ${lastHtml}
      <ol class="steps">
        <li>Chat với <code>@BotFather</code> → <code>/newbot</code> → copy token.</li>
        <li>Mở bot vừa tạo, bấm <b>Start</b>.</li>
        <li>Dán token → <b>Lấy chat ID</b> → bật công tắc → <b>Lưu</b> → <b>Gửi thử</b>.</li>
      </ol>
    </section>`;
}

function notifySection(state) {
  return `
    <section class="card">
      ${cardHead("🔔", "Thông báo hệ thống", "Toast Windows qua <code>chrome.notifications</code> (tuỳ chọn). Bấm toast để mở Vườn cây.",
        `<button id="notifyTest" class="ghost">Gửi thử</button>`)}
      <div class="row"><label class="switch"><input type="checkbox" id="notifyEnabled"><span class="track"></span><span>Hiện toast khi cây lớn / cây chết</span></label></div>
      <div id="notifyStatus" class="toast last">Đang kiểm tra quyền…</div>
      <p class="hint">Không thấy toast: Windows Settings → Hệ thống → Thông báo (bật cho Brave) và tắt Focus Assist.</p>
    </section>`;
}

const NOTIFY_REASONS = {
  no_permission: "Chưa cấp quyền thông báo cho extension.",
  no_api: "Chrome chưa nạp API thông báo — reload extension rồi thử lại.",
  blocked_by_browser: "Trình duyệt/Windows đang chặn thông báo của Brave (Settings → Notifications, hoặc Focus Assist).",
  disabled: "Thông báo đang tắt trong cài đặt.",
};

async function refreshNotifyStatus(state) {
  const box = $("#notifyEnabled");
  const status = $("#notifyStatus");
  if (!box || !status) return;
  const r = await send({ cmd: "NOTIFY_STATUS" }).catch(() => null);
  const granted = !!r?.granted;
  box.checked = granted && state.notifyEnabled !== false;
  if (!granted) {
    status.innerHTML = '<span class="bad">Chưa cấp quyền — bật công tắc hoặc bấm “Gửi thử” rồi chọn Allow.</span>';
  } else if (r.level && r.level !== "granted") {
    status.innerHTML = `<span class="bad">Đã cấp quyền nhưng Brave/Windows chặn thông báo (mức: ${esc(r.level)}).</span>`;
  } else if (state.notifyEnabled === false) {
    status.innerHTML = "Đã cấp quyền, nhưng đang tắt.";
  } else {
    status.innerHTML = '<span class="ok">Đang bật — quyền đã được cấp.</span>';
  }
  const ln = state.lastNotify;
  if (ln) {
    const when = new Date(ln.at).toLocaleString("vi-VN");
    status.innerHTML += `<br>Lần gửi gần nhất (${esc(when)}): ` +
      (ln.ok ? '<span class="ok">Chrome đã nhận lệnh hiển thị.</span>'
             : `<span class="bad">${esc(NOTIFY_REASONS[ln.reason] || ln.reason || "thất bại")}</span>`);
  }
}

async function ensureNotifyPermission() {
  try {
    if (await chrome.permissions.contains({ permissions: ["notifications"] })) return true;
    return await chrome.permissions.request({ permissions: ["notifications"] });
  } catch {
    return false;
  }
}

function gardenSection() {
  return `
    <section class="card">
      ${cardHead("🌳", "Vườn cây", "Cây đã trồng theo ngày, tuần, tháng, năm.", `<button id="garden2" class="ghost">Mở toàn trang</button>`)}
      <iframe id="gardenFrame" class="gardenFrame" src="garden.html?embed=1" title="Vườn cây"></iframe>
    </section>`;
}

/* iframe cùng origin → đo chiều cao nội dung để không có thanh cuộn kép */
function fitGardenFrame() {
  const f = $("#gardenFrame");
  if (!f) return;
  const fit = () => {
    const doc = f.contentDocument;
    if (doc?.body) f.style.height = `${doc.documentElement.scrollHeight}px`;
  };
  f.addEventListener("load", () => {
    fit();
    try { new ResizeObserver(fit).observe(f.contentDocument.body); } catch { /* ignore */ }
  });
}

function showError(err) {
  const id = currentId();
  const stale = !id;
  $("#app").innerHTML = `
    <section>
      <h2>${stale ? "Trang đã cũ" : "Không kết nối được service worker"}</h2>
      <p class="bad">${esc(err?.message || err)}</p>
      <p class="hint">${stale
        ? "Tab này được mở từ phiên bản extension trước khi reload. Hãy đóng tab và mở lại trang Options."
        : "Mở <code>brave://extensions</code>, bấm reload ở card Forest Personal rồi thử lại."}</p>
      <p class="hint">Extension ID: <code>${esc(id || "—")}</code></p>
      <div class="row"><button id="retry">Thử lại</button></div>
    </section>`;
  $("#retry").onclick = () => (currentId() ? render() : location.reload());
}

async function render() {
  try { await renderPage(); } catch (e) { showError(e); }
}

async function renderPage() {
  const res = await send({ cmd: "GET_STATE" });
  if (!res?.ok) throw new Error(res?.error || "service worker trả lỗi");
  const state = res.state;
  const app = $("#app");
  const hosts = res.hosts || { api: "(service worker cũ — chưa trả host)", auth: "" };
  const staleSw = res.build !== EXPECTED_BUILD;

  const pill = $("#syncPill"), pillText = $("#syncPillText");
  if (pill) {
    const pending = state.pendingPlants.length;
    pill.className = "pill " + (state.syncError ? "warn" : state.user ? "ok" : "");
    pillText.textContent = !state.user ? "Chưa đăng nhập"
      : state.syncError ? "Lỗi đồng bộ"
      : pending ? `${pending} cây chờ sync` : "Đã đồng bộ";
  }
  const ver = $("#ver");
  if (ver) ver.textContent = `v${chrome.runtime.getManifest().version} · bản dựng lại cho cá nhân`;

  const tabs = [
    ["overview", "Tổng quan", syncSection(state) + gardenSection()],
    ["notify", "Thông báo", telegramSection(state) + notifySection(state)],
    ["block", "Chặn trang", blockSection(state)],
    ["widget", "Widget nổi", floatSection(state)],
    ["advanced", "Nâng cao", `
      <section class="card">
        ${cardHead("🛠", "Thông tin kỹ thuật", "Dùng khi báo lỗi hoặc kiểm tra kết nối.")}
        <dl class="info">
          <dt>Phiên bản</dt><dd>${esc(chrome.runtime.getManifest().version)} (build ${EXPECTED_BUILD})</dd>
          <dt>Extension ID</dt><dd><code>${esc(currentId() || "—")}</code></dd>
          <dt>API</dt><dd><code>${esc(hosts.api)}</code></dd>
          <dt>Auth</dt><dd><code>${esc(hosts.auth)}</code></dd>
          <dt>Origin gửi kèm</dt><dd><code>chrome-extension://${EXPECTED_ID}</code> (rule DNR)</dd>
          <dt>Vùng</dt><dd>${esc(state.region)}</dd>
        </dl>
      </section>`],
  ];
  const wanted = (location.hash || "").slice(1);
  const active = tabs.some(([k]) => k === wanted) ? wanted : "overview";

  app.className = "";
  app.innerHTML =
    (staleSw ? `<section class="card danger-zone">
      ${cardHead("⚠️", "Service worker đang chạy code cũ",
        `Trang này là bản mới nhưng background chưa được nạp lại. Mở <code>brave://extensions</code> → bấm <b>reload</b> ở card Forest Personal.`)}
    </section>` : "") +
    accountSection(state) +
    (`<nav class="tabs" role="tablist">${tabs.map(([k, label]) =>
      `<button role="tab" data-tab="${k}" aria-selected="${k === active}">${label}</button>`).join("")}</nav>`) +
    tabs.map(([k, , html]) => `<div class="panel" data-panel="${k}"${k === active ? "" : " hidden"}>${html}</div>`).join("");

  for (const btn of app.querySelectorAll(".tabs button")) {
    btn.onclick = () => {
      const k = btn.dataset.tab;
      history.replaceState(null, "", `#${k}`);
      for (const b2 of app.querySelectorAll(".tabs button")) b2.setAttribute("aria-selected", String(b2 === btn));
      for (const p of app.querySelectorAll(".panel")) p.hidden = p.dataset.panel !== k;
    };
  }
  fitGardenFrame();
  const g2 = $("#garden2");
  if (g2) g2.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("garden.html") });

  if (!state.user) {
    $("#signin").onclick = doSignIn;
    $("#password").onkeydown = (e) => { if (e.key === "Enter") doSignIn(); };
  } else {
    $("#refresh").onclick = async () => {
      $("#accountMsg").textContent = "Đang cập nhật…";
      const r = await send({ cmd: "REFRESH_PROFILE" });
      $("#accountMsg").innerHTML = r?.ok
        ? `<span class="ok">Đã cập nhật · ${r.user?.coin ?? "?"} xu</span>`
        : `<span class="bad">Lỗi: ${esc(r?.error)}</span>`;
      render();
    };
    $("#garden").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("garden.html") });
    $("#check").onclick = async () => {
      $("#accountMsg").textContent = "Đang gọi server…";
      const r = await send({ cmd: "CHECK_CONNECTION" });
      $("#accountMsg").innerHTML = r?.ok
        ? `<span class="ok">Kết nối OK · ${esc(r.user?.name)} · ${r.user?.coin} xu</span>`
        : `<span class="bad">Lỗi ${r?.status ?? ""}: ${esc(r?.error)}</span>`;
    };
    $("#signout").onclick = async () => {
      if (!confirm("Đăng xuất và xoá phiên đã lưu?")) return;
      await send({ cmd: "SIGNOUT" });
      render();
    };
    checkCookie();
  }

  $("#sync").onclick = async () => {
    $("#syncMsg").textContent = "Đang sync…";
    const r = await send({ cmd: "SYNC" });
    $("#syncMsg").innerHTML = r?.ok
      ? `<span class="ok">Đã đẩy ${r.pushed}, lỗi ${r.failed}, server ${r.plants}</span>`
      : `<span class="bad">Lỗi: ${esc(r?.error)}</span>`;
    render();
  };

  refreshNotifyStatus(state);

  const tgMsg = (html) => { $("#tgMsg").innerHTML = html; };
  const tgInput = () => ({ token: $("#tgToken").value.trim(), chatId: $("#tgChat").value.trim() });
  $("#tgSave").onclick = async () => {
    const { token, chatId } = tgInput();
    const enabled = $("#tgEnabled").checked;
    if (enabled && (!token || !chatId)) { tgMsg('<span class="bad">Cần nhập token và chat ID.</span>'); return; }
    const r = await send({ cmd: "UPDATE_SETTINGS", patch: { telegram: { enabled, token, chatId } } });
    tgMsg(r?.ok ? '<span class="ok">Đã lưu.</span>' : `<span class="bad">Lỗi: ${esc(r?.error)}</span>`);
  };
  $("#tgEnabled").onchange = () => $("#tgSave").click();
  $("#tgFind").onclick = async () => {
    const { token } = tgInput();
    if (!token) { tgMsg('<span class="bad">Nhập token trước.</span>'); return; }
    tgMsg("Đang tìm…");
    const r = await send({ cmd: "TELEGRAM_FIND_CHAT", token });
    if (!r?.ok) { tgMsg(`<span class="bad">Lỗi: ${esc(r?.error)}</span>`); return; }
    if (!r.chats.length) { tgMsg('<span class="bad">Chưa thấy chat nào — mở bot, bấm Start/gửi 1 tin rồi thử lại.</span>'); return; }
    $("#tgChat").value = r.chats[0].id;
    tgMsg(`<span class="ok">Tìm thấy: ${esc(r.chats[0].name)} (${r.chats[0].id}). Bấm Lưu.</span>`);
  };
  $("#tgTest").onclick = async () => {
    const { token, chatId } = tgInput();
    if (!token || !chatId) { tgMsg('<span class="bad">Cần nhập token và chat ID.</span>'); return; }
    tgMsg("Đang gửi…");
    const r = await send({ cmd: "TEST_TELEGRAM", token, chatId });
    tgMsg(r?.ok ? '<span class="ok">Đã gửi — kiểm tra Telegram.</span>' : `<span class="bad">Không gửi được: ${esc(r?.reason)}</span>`);
  };

  $("#notifyEnabled").onchange = async () => {
    const on = $("#notifyEnabled").checked;
    if (on && !(await ensureNotifyPermission())) {
      $("#notifyEnabled").checked = false;
      await refreshNotifyStatus(state);
      return;
    }
    const r = await send({ cmd: "UPDATE_SETTINGS", patch: { notifyEnabled: on } });
    state.notifyEnabled = on;
    if (!r?.ok) $("#notifyStatus").innerHTML = `<span class="bad">Lỗi: ${esc(r?.error)}</span>`;
    else await refreshNotifyStatus(state);
  };

  $("#notifyTest").onclick = async () => {
    const status = $("#notifyStatus");
    status.textContent = "Đang gửi…";
    if (!(await ensureNotifyPermission())) {
      await refreshNotifyStatus(state);
      return;
    }
    const r = await send({ cmd: "TEST_NOTIFICATION" }).catch((e) => ({ ok: false, reason: `error:${e.message}` }));
    if (r?.ok) {
      status.innerHTML = '<span class="ok">Đã gửi. Nếu không thấy toast: kiểm tra Windows Settings → Thông báo (Brave) và Focus Assist.</span>';
    } else {
      const reason = r?.reason || "unknown";
      status.innerHTML = `<span class="bad">Không gửi được: ${esc(NOTIFY_REASONS[reason] || reason)}</span>`;
    }
    await send({ cmd: "UPDATE_SETTINGS", patch: { notifyEnabled: true } });
    state.notifyEnabled = true;
    const box = $("#notifyEnabled"); if (box && r?.ok) box.checked = true;
  };

  $("#floatEnabled").onchange = async () => {
    const on = $("#floatEnabled").checked;
    if (on) {
      // Quyền localhost là optional → phải xin trong user gesture, nếu xin lúc load
      // manifest sẽ bị Chrome disable extension.
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: ["http://127.0.0.1:35731/*"] });
      } catch (e) {
        granted = false;
      }
      if (!granted) {
        $("#floatEnabled").checked = false;
        $("#floatMsg").innerHTML = '<span class="bad">Chưa cấp quyền localhost — bấm lại và chọn Allow.</span>';
        return;
      }
    }
    const r = await send({ cmd: "SET_FLOAT", on });
    $("#floatMsg").innerHTML = r?.ok
      ? `<span class="ok">${on ? "Đã bật — mở float/start-float.bat nếu chưa" : "Đã tắt"}</span>`
      : `<span class="bad">Lỗi: ${esc(r?.error)}</span>`;
  };

  $("#saveBlock").onclick = async () => {
    const patch = {
      blockEnabled: $("#blockEnabled").checked,
      whitelistMode: $("#whitelistMode").checked,
      blocklist: $("#blocklist").value.split("\n").map((s) => s.trim()).filter(Boolean),
      allowlist: $("#allowlist").value.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    const r = await send({ cmd: "UPDATE_SETTINGS", patch });
    $("#blockMsg").innerHTML = r?.ok
      ? `<span class="ok">Đã lưu · ${r.rules} rule</span>`
      : `<span class="bad">Lỗi: ${esc(r?.error)}</span>`;
    render();
  };
}

async function doSignIn() {
  if (busy) return;
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const region = $("#region").value;
  if (!email || !password) {
    $("#loginMsg").innerHTML = '<span class="bad">Nhập email và mật khẩu</span>';
    return;
  }
  busy = true;
  $("#signin").disabled = true;
  $("#loginMsg").textContent = "Đang đăng nhập…";
  const r = await send({ cmd: "SIGNIN", email, password, region });
  busy = false;
  if (!r?.ok) {
    const hint = r?.status === 403
      ? " — sai email/mật khẩu, hoặc Origin/ID extension chưa khớp (xem dòng Extension ID bên dưới)."
      : r?.status === 488
        ? " — tài khoản cần chuyển vùng/khôi phục trên app Forest trước."
        : "";
    $("#loginMsg").innerHTML = `<span class="bad">Lỗi ${r?.status ?? ""}: ${esc(r?.error)}${esc(hint)}${r?.data ? " · " + esc(JSON.stringify(r.data)) : ""}</span>`;
    $("#signin").disabled = false;
    return;
  }
  await render();
}

async function checkCookie() {
  const el = $("#cookieState");
  if (!el) return;
  try {
    const res = await send({ cmd: "GET_STATE" });
    const region = res.state.region;
    const host = region === "china" ? "https://forest-china.upwardsware.com/api/v1" : "https://c88fef96.forestapp.cc/api/v1";
    const c = await chrome.cookies.get({ url: host, name: "remember_token" });
    el.innerHTML = c
      ? `<span class="ok">có (hết hạn ${c.expirationDate ? fmtDate(new Date(c.expirationDate * 1000).toISOString()) : "khi đóng trình duyệt"})</span>`
      : '<span class="bad">không có — phiên sẽ được khôi phục từ token đã lưu khi gọi API</span>';
  } catch (e) {
    el.textContent = `không đọc được (${e.message})`;
  }
}

render();
