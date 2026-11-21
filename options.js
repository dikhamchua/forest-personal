/* Trang cài đặt: đăng nhập, hồ sơ/xu, đồng bộ, chặn trang, lịch sử.
   Không dùng inline handler (CSP MV3). */

const $ = (sel, el = document) => el.querySelector(sel);
const EXPECTED_ID = "kjacjjdnoddnpbbcjilcajfhhbdhkpgk";
const EXPECTED_BUILD = 3;

/* Timeout để trang không kẹt "Đang tải…" khi service worker chết hoặc trang
   thuộc phiên bản extension cũ (context invalidated). */
function send(msg, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service worker không phản hồi (timeout)")), timeoutMs);
    chrome.runtime.sendMessage(msg).then(
      (r) => { clearTimeout(timer); resolve(r); },
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

function accountSection(state) {
  if (!state.user) {
    return `
      <section>
        <h2>Tài khoản</h2>
        <p class="hint">Đăng nhập bằng email/mật khẩu tài khoản Forest. Server trả cookie phiên
          <code>remember_token</code>; extension lưu lại token này để khôi phục phiên nếu cookie bị xoá.</p>
        <div class="row">
          <select id="region">
            <option value="global"${state.region === "global" ? " selected" : ""}>Global (forestapp.cc)</option>
            <option value="china"${state.region === "china" ? " selected" : ""}>China (upwardsware.com)</option>
          </select>
        </div>
        <div class="row"><input id="email" type="email" placeholder="Email" autocomplete="username"></div>
        <div class="row"><input id="password" type="password" placeholder="Mật khẩu" autocomplete="current-password"></div>
        <div class="row"><button id="signin">Đăng nhập</button><span id="loginMsg" class="toast"></span></div>
        <p class="hint">Chạy song song được với Forest gốc: extension tự gắn
          <code>Origin: chrome-extension://${EXPECTED_ID}</code> cho request API bằng rule DNR
          (chỉ áp cho request của chính nó).</p>
      </section>`;
  }

  const u = state.user;
  const boostEnd = u.boost?.end ? new Date(u.boost.end) : null;
  const boostActive = boostEnd && boostEnd.getTime() > Date.now();
  return `
    <section>
      <h2>Tài khoản</h2>
      <div class="stats">
        <span>🪙 Xu<br><b>${u.coin ?? 0}</b></span>
        <span>🌳 Cây sống<br><b>${u.healthTreeCount ?? 0}</b></span>
        <span>🥀 Cây chết<br><b>${u.deadTreeCount ?? 0}</b></span>
        <span>⏱ Tổng phút<br><b>${u.totalMinutes ?? 0}</b></span>
        <span>💎 Gem<br><b>${u.gem ?? 0}</b></span>
      </div>
      <p><b>${esc(u.name || "—")}</b> · ${esc(u.email || "")} · ID ${u.id ?? "?"}
        ${boostActive ? `<span class="ok">· Boost x${u.boost.rate ?? 2} đến ${fmtDate(u.boost.end)}</span>` : ""}</p>
      <div class="row">
        <button id="refresh" class="ghost">Cập nhật hồ sơ</button>
        <button id="garden" class="ghost">Vườn cây</button>
        <button id="check" class="ghost">Kiểm tra kết nối</button>
        <button id="signout" class="ghost danger-ghost">Đăng xuất</button>
      </div>
      <p id="accountMsg" class="toast hint">Cookie phiên: <span id="cookieState">đang kiểm tra…</span></p>
    </section>`;
}

function syncSection(state) {
  const last = state.lastSyncedAt ? fmtDate(state.lastSyncedAt) : "chưa sync";
  return `
    <section>
      <h2>Đồng bộ</h2>
      <p class="hint">Đẩy cây đang chờ lên server (từng cây một, <code>POST /plants</code>), rồi kéo 30 ngày
        gần nhất (<code>GET /plants?from_date=…</code>). Xu được server cộng sau khi cây được ghi nhận.</p>
      <div class="stats">
        <span>Chờ đẩy<br><b>${state.pendingPlants.length}</b></span>
        <span>Cây trên server<br><b>${(state.serverPlants || []).length}</b></span>
        <span>Lần cuối<br><b style="font-size:13px">${last}</b></span>
      </div>
      <div class="row">
        <button id="sync">Sync ngay</button>
        <span id="syncMsg" class="toast"></span>
      </div>
      ${state.syncError ? `<p class="bad">Lỗi gần nhất: ${esc(state.syncError)}</p>` : ""}
    </section>`;
}

function blockSection(state) {
  return `
    <section>
      <h2>Chặn trang khi tập trung</h2>
      <div class="row">
        <label><input type="checkbox" id="blockEnabled"${state.blockEnabled ? " checked" : ""}> Bật chặn</label>
        <label><input type="checkbox" id="whitelistMode"${state.whitelistMode ? " checked" : ""}> Whitelist (chặn tất cả trừ allowlist)</label>
      </div>
      <div class="grid2">
        <div>
          <p class="hint">Blocklist — mỗi dòng một domain</p>
          <textarea id="blocklist" rows="6">${esc(state.blocklist.join("\n"))}</textarea>
        </div>
        <div>
          <p class="hint">Allowlist — chỉ dùng ở chế độ whitelist</p>
          <textarea id="allowlist" rows="6">${esc(state.allowlist.join("\n"))}</textarea>
        </div>
      </div>
      <div class="row"><button id="saveBlock">Lưu</button><span id="blockMsg" class="toast"></span></div>
      <p class="hint">Chế độ whitelist chỉ bật khi allowlist có ít nhất một domain (tránh chặn toàn bộ trình duyệt).</p>
    </section>`;
}

function floatSection(state) {
  return `
    <section>
      <h2>Cửa sổ nổi (always-on-top)</h2>
      <div class="row">
        <label><input type="checkbox" id="floatEnabled"${state.floatEnabled ? " checked" : ""}> Bật widget nổi trên các app khác</label>
        <span id="floatMsg" class="toast"></span>
      </div>
      <p class="hint">Widget là app WPF riêng (không phải cửa sổ trình duyệt): chạy
        <code>float/start-float.bat</code> một lần, nó luôn nổi trên cửa sổ khác.
        Bật ô trên để extension đẩy trạng thái sang widget và nhận lệnh Start / Give up.</p>
    </section>`;
}

function telegramSection(state) {
  const t = state.telegram || {};
  const last = state.lastTelegram;
  const lastHtml = last
    ? `<p class="toast hint">Lần gửi gần nhất (${esc(new Date(last.at).toLocaleString("vi-VN"))}): ${
        last.ok ? '<span class="ok">thành công</span>' : `<span class="bad">${esc(last.reason || "thất bại")}</span>`}</p>`
    : "";
  return `
    <section>
      <h2>Thông báo Telegram</h2>
      <div class="row"><label><input type="checkbox" id="tgEnabled"${t.enabled ? " checked" : ""}> Gửi tin Telegram khi cây lớn / cây chết</label></div>
      <div class="row"><input id="tgToken" type="password" placeholder="Bot token (từ @BotFather)" autocomplete="off" value="${esc(t.token || "")}"></div>
      <div class="row">
        <input id="tgChat" type="text" placeholder="Chat ID" autocomplete="off" value="${esc(t.chatId || "")}">
        <button id="tgFind" class="ghost">Lấy chat ID</button>
      </div>
      <div class="row">
        <button id="tgSave">Lưu</button>
        <button id="tgTest" class="ghost">Gửi thử</button>
        <span id="tgMsg" class="toast"></span>
      </div>
      ${lastHtml}
      <p class="hint">Cách thiết lập: (1) mở Telegram, chat với <code>@BotFather</code> → <code>/newbot</code> → copy token;
        (2) mở bot vừa tạo và bấm <b>Start</b> (gửi 1 tin bất kỳ);
        (3) dán token rồi bấm <b>Lấy chat ID</b>; (4) <b>Lưu</b> và <b>Gửi thử</b>.
        Token lưu cục bộ trong trình duyệt, chỉ dùng để gọi <code>api.telegram.org</code>.</p>
    </section>`;
}

function notifySection(state) {
  return `
    <section>
      <h2>Thông báo hệ thống</h2>
      <div class="row">
        <label><input type="checkbox" id="notifyEnabled"> Hiện toast Windows khi cây lớn / cây chết</label>
        <button id="notifyTest" class="ghost">Gửi thử</button>
      </div>
      <p id="notifyStatus" class="toast hint">Đang kiểm tra quyền…</p>
      <p class="hint">Dùng <code>chrome.notifications</code> (quyền tuỳ chọn: Chrome sẽ hỏi khi bật).
        Toast vẫn hiện khi Brave bị thu nhỏ; bấm vào toast để mở Vườn cây.
        Nếu không thấy toast, kiểm tra Windows Settings → Hệ thống → Thông báo (bật cho Brave) và tắt Focus Assist.</p>
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
    status.innerHTML = '<span class="bad">Chưa cấp quyền — tick ô trên hoặc bấm “Gửi thử” rồi chọn Allow.</span>';
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

function historySection(state) {
  const plants = [...(state.serverPlants || [])]
    .sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
    .slice(0, 60);

  const rows = plants
    .map((p) => {
      const mins = p.startTime && p.endTime
        ? Math.round((new Date(p.endTime) - new Date(p.startTime)) / 60000)
        : 0;
      return `<tr>
        <td>${p.isSuccess ? "🌳" : "🥀"}</td>
        <td>${esc(tagTitle(state, p.tag))}</td>
        <td>${esc(p.note || "")}</td>
        <td class="num">${mins ? mins + "′" : ""}</td>
        <td>${fmtDate(p.startTime)}</td>
      </tr>`;
    })
    .join("");

  return `
    <section>
      <h2>Lịch sử (60 cây gần nhất)</h2>
      <table>
        <thead><tr><th></th><th>Tag</th><th>Ghi chú</th><th class="num">Thời lượng</th><th>Bắt đầu</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="hint">Chưa có dữ liệu — bấm Sync.</td></tr>`}</tbody>
      </table>
    </section>`;
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

  app.innerHTML =
    (staleSw ? `<section class="danger-zone">
      <h2>⚠️ Service worker đang chạy code cũ</h2>
      <p>Trang này là bản mới nhưng background chưa được nạp lại (response thiếu <code>build=${EXPECTED_BUILD}</code>).</p>
      <p class="hint">Mở <code>brave://extensions</code> → bấm <b>reload</b> trên card Forest Personal,
        hoặc dùng <code>dev/start-reloader.bat</code> cùng helper reloader để tự reload khi sửa file.</p>
    </section>` : "") +
    accountSection(state) +
    syncSection(state) +
    telegramSection(state) +
    notifySection(state) +
    floatSection(state) +
    blockSection(state) +
    historySection(state) +
    `<p class="hint">API: <code>${esc(hosts.api)}</code> · Auth: <code>${esc(hosts.auth)}</code><br>
      Extension ID: <code>${esc(currentId() || "—")}</code> ·
      Origin gửi kèm API: <code>chrome-extension://${EXPECTED_ID}</code>
      <span class="ok">(rule DNR)</span>
    </p>`;

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
