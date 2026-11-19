/* Service worker: state machine trồng cây, chặn trang, đồng bộ.
   Bám theo background của Forest 6.6.1: phiên trồng nằm trong storage.local,
   mốc kết thúc dùng chrome.alarms, popup/options nói chuyện qua runtime message. */

import { api, configure, regionHosts } from "./api.js";
import {
  loadState,
  saveState,
  signIn,
  signOut,
  restoreCookie,
  loadCatalog,
  refreshProfile,
  buildTrees,
  mergePlants,
  sync,
} from "./storage.js";

const BUILD = 3;                 // tăng khi đổi shape của message/response
// Server chỉ nhận Origin của extension gốc. ID thật của extension này có thể khác
// (Chrome giữ ID gán lần load đầu với bản unpacked), nên mọi request API được gắn
// thêm Origin gốc bằng DNR — chỉ áp cho request do chính extension này khởi tạo.
const ORIGIN_ID = "kjacjjdnoddnpbbcjilcajfhhbdhkpgk";
const ORIGIN_RULE_ID = 900;
const API_HOSTS = [
  "c88fef96.forestapp.cc",
  "forest-china.upwardsware.com",
  "auth.seekrtech.com",
  "auth.upwardsware.com",
];
const ALARM_DONE = "fpPlantingDone";
const ALARM_FLOAT = "fpFloat";
const FLOAT_URL = "http://127.0.0.1:35731";

/* ---------- Chặn trang bằng declarativeNetRequest ---------- */

const cleanHost = (raw) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\*?\./, "")
    .replace(/\.$/, "");

const validHost = (h) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+$/.test(h);

/* Chrome chạy init() ở top-level và ở onInstalled/onStartup → các lần cập nhật
   rule có thể chồng nhau và tranh id. Xếp hàng để mỗi lần remove+add là tuần tự. */
let ruleQueue = Promise.resolve();

function updateBlockRules(state) {
  ruleQueue = ruleQueue
    .then(() => applyBlockRules(state))
    .catch((e) => { console.error("updateBlockRules:", e); return 0; });
  return ruleQueue;
}

function originRule() {
  return {
    id: ORIGIN_RULE_ID,
    priority: 100,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "set", value: `chrome-extension://${ORIGIN_ID}` }],
    },
    condition: {
      requestDomains: API_HOSTS,
      resourceTypes: ["xmlhttprequest"],
      initiatorDomains: [chrome.runtime.id],
    },
  };
}

async function applyBlockRules(s) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  // Rule 0: luôn gắn Origin gốc cho request API (kể cả khi tắt chặn trang).
  const addRules = [originRule()];
  if (s.blockEnabled) {
    const redirect = { type: "redirect", redirect: { extensionPath: "/blocked.html" } };
    const protectedHosts = [
      "c88fef96.forestapp.cc",
      "forest-china.upwardsware.com",
      "auth.seekrtech.com",
      "auth.upwardsware.com",
    ];
    const usable = (list) =>
      [...new Set(list.map(cleanHost).filter((h) => validHost(h) && !protectedHosts.includes(h)))];

    if (s.whitelistMode) {
      // Chỉ bật chế độ này khi allowlist có ít nhất 1 domain, tránh chặn toàn bộ web.
      const allow = usable(s.allowlist || []);
      if (allow.length) {
        addRules.push({
          id: 1,
          priority: 1,
          action: redirect,
          condition: { resourceTypes: ["main_frame"], excludedRequestDomains: allow },
        });
      }
    } else {
      usable(s.blocklist || []).forEach((host, i) => {
        addRules.push({
          id: 1000 + i,
          priority: 1,
          action: redirect,
          condition: { requestDomains: [host], resourceTypes: ["main_frame"] },
        });
      });
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  return addRules.length;
}

/* ---------- Thông báo hệ thống ----------
   chrome.notifications hiện toast của Windows cả khi cửa sổ Brave bị thu nhỏ. */

/* ---------- Badge vàng trên icon khi hoàn thành ----------
   Dùng khi người dùng tắt thông báo hệ thống: icon có chấm vàng "+N" / "✓".
   Xoá badge khi mở popup (ACK_BADGE). */

const BADGE_GOLD = "#F4C542";
const BADGE_TEXT = "#3A2A00";

async function setDoneBadge(coins) {
  try {
    const text = coins != null && coins > 0 ? `+${Math.min(coins, 99)}` : "✓";
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_GOLD });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: BADGE_TEXT });
    }
    await chrome.action.setBadgeText({ text });
    await chrome.action.setTitle({
      title: `Forest Personal — cây đã lớn${coins > 0 ? ` · +${coins} xu` : ""}`,
    });
  } catch (e) {
    console.warn("badge:", e?.message || e);
  }
}

async function clearBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Forest Personal" });
  } catch { /* ignore */ }
}

async function notifySystem(title, message) {
  const s = await loadState();
  if (s.notifyEnabled === false) return null;
  try {
    const granted = await chrome.permissions.contains({ permissions: ["notifications"] });
    if (!granted) return null;
    const id = `fp-${Date.now()}`;
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/128.png"),
      title,
      message,
      priority: 2,
    });
    return id;
  } catch (e) {
    console.warn("notifications:", e?.message || e);
    return null;
  }
}

chrome.notifications?.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  chrome.tabs.create({ url: chrome.runtime.getURL("garden.html") }).catch(() => {});
});

/* ---------- Trồng cây ---------- */

async function startPlanting({ treeTypeGid, tag, note, durationMin }) {
  const s = await loadState();
  if (s.planting) return { ok: false, error: "already_planting" };

  const duration = Math.min(240, Math.max(5, Math.round(Number(durationMin) || 25)));
  const now = Date.now();
  const planting = {
    treeTypeGid: Number(treeTypeGid) || 0,
    tag: Number(tag) || 0,
    note: String(note || "").slice(0, 200),
    startTime: new Date(now).toISOString(),
    endTime: new Date(now + duration * 60_000).toISOString(),
    durationMin: duration,
  };
  await saveState({ planting });
  await chrome.alarms.create(ALARM_DONE, { when: now + duration * 60_000 });
  return { ok: true, planting };
}

function plantRecord(p, success) {
  const now = Date.now();
  const plannedSec = p.durationMin * 60;
  const elapsedSec = Math.max(0, Math.floor((now - new Date(p.startTime).getTime()) / 1000));
  return {
    startTime: p.startTime,
    endTime: success ? p.endTime : new Date(now).toISOString(),
    tag: p.tag,
    note: p.note,
    treeTypeGid: p.treeTypeGid,
    isSuccess: success,
    updatedAt: new Date(now).toISOString(),
    trees: buildTrees(plannedSec, success ? plannedSec : elapsedSec, p.treeTypeGid),
  };
}

async function finishPlanting(success) {
  const s = await loadState();
  const p = s.planting;
  if (!p) return { ok: false, error: "no_planting" };

  const record = plantRecord(p, success);
  const coinBefore = s.user?.coin ?? null;

  await saveState({ planting: null, pendingPlants: [record, ...s.pendingPlants] });
  await chrome.alarms.clear(ALARM_DONE);

  const elapsedMin = Math.max(1, Math.round((Date.now() - new Date(p.startTime).getTime()) / 60000));
  let result = { ok: true, record, coins: null };
  if (s.user?.id) {
    try {
      const info = await sync({ push: true });
      const after = await loadState();
      const coin = after.user?.coin ?? null;
      const coins = coinBefore != null && coin != null ? coin - coinBefore : null;
      result = { ok: true, record, coins, sync: info };
      if (coins != null && coins > 0) {
        await saveState({ lastReward: { at: Date.now(), coins, coin } });
      }
    } catch (e) {
      result = { ok: true, record, coins: null, error: e.message };
      await saveState({ syncError: e.message });
    }
  }

  if (success) {
    const coins = result.coins;
    await notifySystem(
      "🌳 Cây đã lớn!",
      `${p.durationMin} phút tập trung hoàn tất${coins != null && coins > 0 ? ` · +${coins} xu` : ""}`,
    );
    await setDoneBadge(coins);
  } else {
    await notifySystem("🥀 Cây đã chết", `Bạn bỏ cuộc sau ${elapsedMin} phút tập trung`);
  }
  return result;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_DONE) {
    const r = await finishPlanting(true);
    broadcast({ type: "PLANTING_DONE", record: r.record, coins: r.coins ?? null });
  }
});

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

/* ---------- Cầu nối widget nổi (float/) ----------
   Widget (WPF) chạy server.ps1 ở 127.0.0.1:35731. Extension poll lệnh rồi đẩy
   snapshot trạng thái; chỉ bật khi người dùng chọn trong Options. */

const tagOf = (s, id) =>
  (s.tags?.length ? s.tags : [{ tagId: 0, title: "Unset" }]).find((t) => t.tagId === id)?.title || "Unset";

function floatSnapshot(s) {
  const p = s.planting;
  return {
    id: chrome.runtime.id,
    loggedIn: !!s.user,
    coin: s.user?.coin ?? 0,
    blockEnabled: !!s.blockEnabled,
    planting: p
      ? {
          endTime: p.endTime,
          durationMin: p.durationMin,
          treeTypeGid: p.treeTypeGid,
          tagTitle: tagOf(s, p.tag),
          treeTitle:
            s.treeTypes?.find((t) => Number(t.gid) === Number(p.treeTypeGid))?.title ||
            `Cây #${p.treeTypeGid}`,
          treeImage:
            s.treeTypes?.find((t) => Number(t.gid) === Number(p.treeTypeGid))?.image || null,
        }
      : null,
    lastReward: s.lastReward || null,
  };
}

async function handleFloatCommand(cmd) {
  if (cmd.cmd === "start") {
    const s = await loadState();
    if (!s.user || s.planting) return;
    await startPlanting({
      treeTypeGid: s.treeTypes?.[0]?.gid ?? 0,
      tag: 1,
      note: "",
      durationMin: Number(cmd.duration) || 25,
    });
  } else if (cmd.cmd === "giveup") {
    const r = await finishPlanting(false);
    broadcast({ type: "PLANTING_GAVE_UP", record: r.record });
  } else if (cmd.cmd === "open-options") {
    chrome.runtime.openOptionsPage?.();
  }
}

let floatTimer = null;
let floatBusy = false;

async function floatTick() {
  if (floatBusy) return;
  floatBusy = true;
  try {
    const res = await fetch(`${FLOAT_URL}/poll`, { cache: "no-store" });
    if (res.ok) {
      const cmd = await res.json().catch(() => null);
      if (cmd?.cmd) await handleFloatCommand(cmd);
    }
    const s = await loadState();
    await fetch(`${FLOAT_URL}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(floatSnapshot(s)),
    });
  } catch {
    // widget chưa chạy — lần poll sau thử lại
  } finally {
    floatBusy = false;
  }
}

function setFloatEnabled(on) {
  if (on) {
    if (!floatTimer) floatTimer = setInterval(floatTick, 1000);
    floatTick();
  } else if (floatTimer) {
    clearInterval(floatTimer);
    floatTimer = null;
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_FLOAT) return;
  const s = await loadState();
  if (s.floatEnabled) setFloatEnabled(true);
});

/* ---------- Message bus ---------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.cmd) {
      case "GET_STATE": {
        const state = await loadState();
        sendResponse({ ok: true, build: BUILD, state, hosts: regionHosts(state.region) });
        break;
      }
      case "SIGNIN": {
        try {
          const user = await signIn(msg.email, msg.password, msg.region || "global");
          configure({ region: msg.region || "global" });
          await restoreCookie();
          await loadCatalog();
          let info = null;
          try { info = await sync({ push: true }); } catch (e) { info = { error: e.message }; }
          sendResponse({ ok: true, user, sync: info });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, status: e.status, data: e.data });
        }
        break;
      }
      case "SIGNOUT": {
        await signOut();
        await updateBlockRules(await loadState());
        sendResponse({ ok: true });
        break;
      }
      case "START_PLANTING": {
        sendResponse(await startPlanting(msg));
        break;
      }
      case "GIVE_UP": {
        const r = await finishPlanting(false);
        broadcast({ type: "PLANTING_GAVE_UP", record: r.record });
        sendResponse(r);
        break;
      }
      case "SYNC": {
        try {
          const info = await sync({ push: true });
          sendResponse({ ok: true, ...info });
        } catch (e) {
          await saveState({ syncError: e.message });
          sendResponse({ ok: false, error: e.message, status: e.status });
        }
        break;
      }
      case "REFRESH_PROFILE": {
        try {
          const user = await refreshProfile();
          sendResponse({ ok: true, user });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, status: e.status });
        }
        break;
      }
      case "CHECK_CONNECTION": {
        const s = await loadState();
        if (!s.user?.id) { sendResponse({ ok: false, error: "chưa đăng nhập" }); break; }
        try {
          const user = await api.getUser(s.user.id);
          sendResponse({ ok: true, user });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, status: e.status, data: e.data });
        }
        break;
      }
      case "ACK_BADGE": {
        await clearBadge();
        sendResponse({ ok: true });
        break;
      }
      case "LOAD_RANGE": {
        try {
          const list = await api.getPlants({ from: msg.from, to: msg.to });
          const st = await loadState();
          const merged = mergePlants(list, st.serverPlants);
          await saveState({ serverPlants: merged });
          sendResponse({ ok: true, count: list.length, total: merged.length });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, status: e.status });
        }
        break;
      }
      case "LOAD_CATALOG": {
        try {
          const catalog = await loadCatalog();
          const st = await loadState();
          sendResponse({ ok: true, ...catalog, treeTypes: st.treeTypes, tags: st.tags });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, status: e.status });
        }
        break;
      }
      case "SET_FLOAT": {
        const on = !!msg.on;
        await saveState({ floatEnabled: on });
        setFloatEnabled(on);
        sendResponse({ ok: true, on });
        break;
      }
      case "UPDATE_SETTINGS": {
        const next = await saveState(msg.patch || {});
        const rules = await updateBlockRules(next);
        sendResponse({ ok: true, state: next, rules });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown_cmd" });
    }
  })().catch((e) => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });
  return true; // giữ sendResponse cho async
});

/* ---------- Khởi tạo ---------- */

async function init() {
  const s = await loadState();
  await restoreCookie();
  await updateBlockRules(s);
  if (s.user?.id) refreshProfile().catch(() => {});
  chrome.alarms.create(ALARM_FLOAT, { periodInMinutes: 1 });
  if (s.floatEnabled) setFloatEnabled(true);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

init();
