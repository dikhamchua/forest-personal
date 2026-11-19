/* Helper extension: poll watcher và bật/tắt Forest Personal để Chrome nạp lại.
 *
 * Chạy song song với `node dev/watch.js`. Target tìm theo tên + phải là bản
 * unpacked (installType "development"), nên không bao giờ đụng Forest gốc
 * (ID kjacjjdnoddnpbbcjilcajfhhbdhkpgk, cài từ store).
 */

const WATCHER_URL = "http://127.0.0.1:35730/check";
const TARGET_NAME = "Forest Personal";
const STORAGE_KEY = "fpDevReloaderVersion";
const ALARM_NAME = "fp-dev-reloader-poll";

let pollInFlight = false;
let reloadInFlight = false;
let cachedVersion;
let aliveTimer = null;

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) poll();
});

start();

function start() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  // Timers giữ service worker thức trong lúc dev → reload ~1s thay vì chờ alarm.
  if (!aliveTimer) {
    aliveTimer = setInterval(poll, 1000);
    poll();
  }
}

async function poll() {
  if (pollInFlight || reloadInFlight) return;
  pollInFlight = true;
  try {
    const response = await fetch(WATCHER_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();

    if (cachedVersion === undefined) {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      cachedVersion = stored[STORAGE_KEY];
    }
    if (cachedVersion === undefined) {
      cachedVersion = data.version;
      await chrome.storage.local.set({ [STORAGE_KEY]: cachedVersion });
      return; // lần đầu chỉ lấy baseline, không reload
    }
    if (data.version !== cachedVersion) {
      cachedVersion = data.version;
      await chrome.storage.local.set({ [STORAGE_KEY]: cachedVersion });
      await reloadTarget(data);
    }
  } catch {
    // watcher chưa chạy — lần poll sau thử lại
  } finally {
    pollInFlight = false;
  }
}

async function reloadTarget(data) {
  if (reloadInFlight) return;
  reloadInFlight = true;
  try {
    const extensions = await managementGetAll();
    const target = extensions.find(
      (e) => e.name === TARGET_NAME && e.installType === "development" && e.id !== chrome.runtime.id,
    );
    if (!target) {
      console.warn("[fp dev reloader] Không thấy extension " + TARGET_NAME + ". Đã Load unpacked chưa?");
      return;
    }
    console.info(`[fp dev reloader] reload ${target.name} (v${data.version}) ← ${(data.files || []).join(", ")}`);
    if (target.enabled) {
      await managementSetEnabled(target.id, false);
      await sleep(250);
    }
    await managementSetEnabled(target.id, true);
  } catch (error) {
    console.error("[fp dev reloader]", error);
  } finally {
    reloadInFlight = false;
  }
}

function managementGetAll() {
  return new Promise((resolve, reject) => {
    chrome.management.getAll((items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items);
    });
  });
}

function managementSetEnabled(id, enabled) {
  return new Promise((resolve, reject) => {
    chrome.management.setEnabled(id, enabled, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
