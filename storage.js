/* Lưu trữ + đồng bộ, bám đúng storage schema và luồng sync của Forest 6.6.1:
   cây hoàn thành được ghi vào `pendingPlants` rồi đẩy lên server từng cây một
   (POST /plants { plant }), sau đó kéo lịch sử bằng GET /plants?from_date=… */

import { api, configure, regionHosts } from "./api.js";

const KEY = "fpState";

export const DEFAULT_STATE = {
  version: 3,
  region: "global",
  // token chỉ tồn tại với luồng OAuth/PKCE; luồng email dùng cookie remember_token
  auth: { accessToken: null, refreshToken: null },
  user: null,            // { id, name, email, coin, ..., rememberToken, boost }
  tags: [],              // [{ tagId, title }]
  treeTypes: [],         // [{ gid, title, image }]
  selectedTreeGid: 0,    // loại cây đang chọn ở popup
  selectedDuration: 25,  // thời lượng (phút) lần trồng gần nhất / đang chọn
  lastNotify: null,      // { at, ok, reason } kết quả gửi thông báo gần nhất
  planting: null,        // { treeTypeGid, tag, note, startTime, endTime, durationMin }
  pendingPlants: [],     // cây chưa đẩy được lên server
  serverPlants: [],      // cache lịch sử server
  lastSyncedAt: null,
  lastReward: null,      // { at, coins, coin }
  syncError: null,
  // chặn trang
  blocklist: ["facebook.com", "twitter.com", "youtube.com", "tiktok.com"],
  allowlist: [],
  whitelistMode: false,
  blockEnabled: true,
  floatEnabled: false,   // widget always-on-top (float/)
  notifyEnabled: true,   // toast hệ thống khi cây lớn / cây chết
};

export async function loadState() {
  const stored = (await chrome.storage.local.get(KEY))[KEY];
  const state = { ...DEFAULT_STATE, ...(stored || {}) };
  state.auth = { ...DEFAULT_STATE.auth, ...(stored?.auth || {}) };
  configure({
    region: state.region,
    accessToken: state.auth.accessToken,
    refreshToken: state.auth.refreshToken,
    onTokens: (tokens) => {
      chrome.storage.local.get(KEY).then(({ [KEY]: s }) => {
        chrome.storage.local.set({ [KEY]: { ...s, auth: { ...s?.auth, ...tokens } } });
      });
    },
  });
  return state;
}

export async function saveState(patch) {
  const state = await loadState();
  const next = { ...state, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function clearSession() {
  const s = await loadState();
  await saveState({
    user: null,
    auth: { accessToken: null, refreshToken: null },
    planting: null,
    lastSyncedAt: null,
    serverPlants: [],
    lastReward: null,
    syncError: null,
  });
  configure({ region: s.region, accessToken: null, refreshToken: null });
}

/* ---------- Đăng nhập / phiên ---------- */

export async function signIn(email, password, region) {
  const before = await loadState();
  const reg = region || before.region;
  // api.signin dùng base URL theo region → phải configure trước khi gọi
  configure({ region: reg, accessToken: before.auth.accessToken, refreshToken: before.auth.refreshToken });
  if (reg !== before.region) await saveState({ region: reg });

  const res = await api.signin(email, password);
  if (!res.userId) {
    throw new Error("Server không trả userId — kiểm tra lại email/mật khẩu hoặc region");
  }

  const state = await loadState();
  const auth = {
    accessToken: res.accessToken || state.auth.accessToken,
    refreshToken: res.refreshToken || state.auth.refreshToken,
  };
  configure({ accessToken: auth.accessToken, refreshToken: auth.refreshToken });
  await saveState({ auth });

  // Cookie remember_token đã được server đặt; đọc profile ngay.
  let user = null;
  try {
    user = await api.getUser(res.userId);
  } catch (e) {
    user = { id: res.userId, name: "", email, coin: 0, boost: {}, rememberToken: null };
  }
  await saveState({ user });
  return user;
}

export async function signOut() {
  try { await api.signout(); } catch { /* cookie có thể đã hết hạn */ }
  await clearSession();
}

/* Nếu cookie remember_token bị xoá (clear cookies, profile mới) mà vẫn còn
   rememberToken trong state thì đặt lại cookie để phiên tiếp tục. */
export async function restoreCookie() {
  const s = await loadState();
  const token = s.user?.rememberToken;
  if (!token) return false;
  const url = regionHosts(s.region).api;
  try {
    const existing = await chrome.cookies.get({ url, name: "remember_token" });
    if (existing?.value === token) return false;
    await chrome.cookies.set({
      url,
      name: "remember_token",
      value: token,
      path: "/",
      secure: true,
      sameSite: "no_restriction",
    });
    return true;
  } catch {
    return false;
  }
}

/* ---------- Catalog (tags + loại cây) ---------- */

export async function loadCatalog() {
  const [tags, treeTypes] = await Promise.all([
    api.getTags().catch(() => []),
    api.getUnlockedTreeTypes().catch(() => []),
  ]);
  const patch = {};
  if (tags.length) patch.tags = tags;
  if (treeTypes.length) patch.treeTypes = treeTypes;
  if (Object.keys(patch).length) await saveState(patch);
  return patch;
}

export async function refreshProfile() {
  const s = await loadState();
  if (!s.user?.id) return null;
  const user = await api.getUser(s.user.id);
  if (user) await saveState({ user });
  return user;
}

/* ---------- Ghi cây ---------- */

/* Giống hàm `nt` của bản gốc: số cây = qe(planned) (1..4, mỗi 30 phút),
   cây sống = qe(elapsed) trừ trường hợp bỏ cuộc trước 30 phút → 0 cây sống. */
export function buildTrees(plannedSec, elapsedSec, treeTypeGid) {
  const total = Math.min(4, Math.max(1, Math.floor(plannedSec / 1800)));
  const reached = Math.min(4, Math.max(1, Math.floor(elapsedSec / 1800)));
  const gaveUp = elapsedSec < plannedSec;
  const alive = gaveUp && reached === 1 ? 0 : reached;

  const trees = [];
  for (let i = 0; i < alive; i++) trees.push({ isDead: false, phase: i + 4, treeType: treeTypeGid });
  for (let i = 0; i < total - alive; i++) trees.push({ isDead: true, phase: 8, treeType: treeTypeGid });
  return trees;
}

/* PlantRecord nội bộ → payload snake_case đúng schema server. */
export function toApiPlant(p) {
  return {
    start_time: p.startTime,
    end_time: p.endTime,
    tag: p.tag ?? 0,
    note: p.note ?? "",
    tree_type_gid: p.treeTypeGid ?? 0,
    is_success: !!p.isSuccess,
    updated_at: p.updatedAt || new Date().toISOString(),
    trees: (p.trees || []).map((t) => ({
      is_dead: !!t.isDead,
      phase: t.phase,
      tree_type: t.treeType,
    })),
  };
}

export function mergePlants(incoming, existing) {
  const byId = new Map();
  for (const p of [...existing, ...incoming]) {
    const key = p.id != null ? `id:${p.id}` : `k:${p.startTime}|${p.endTime}|${p.tag}`;
    byId.set(key, p);
  }
  return [...byId.values()]
    .sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
    .slice(0, 5000);
}

/* ---------- Sync 2 chiều ---------- */

export async function sync({ push = true } = {}) {
  const s = await loadState();
  const out = { pushed: 0, failed: 0, plants: (s.serverPlants || []).length, error: null };

  if (push && s.pendingPlants.length) {
    const remaining = [];
    for (const plant of s.pendingPlants) {
      try {
        await api.createPlant(toApiPlant(plant));
        out.pushed++;
      } catch (e) {
        remaining.push(plant);
        out.failed++;
        out.error = `${e.status || ""} ${e.message}`.trim();
        // lỗi mạng/5xx: dừng để lần sau thử lại; lỗi 4xx: giữ nguyên cây, đi tiếp
        if (!e.status || e.status >= 500) break;
      }
    }
    await saveState({ pendingPlants: remaining });
  }

  const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const pulled = await api.getPlants({ from });
  const merged = mergePlants(pulled, (await loadState()).serverPlants || []);
  await saveState({
    serverPlants: merged,
    lastSyncedAt: new Date().toISOString(),
    syncError: out.error,
  });
  out.plants = merged.length;

  if (s.user?.id) {
    try {
      const user = await api.getUser(s.user.id);
      if (user) await saveState({ user });
      out.coin = user?.coin ?? null;
    } catch (e) {
      out.error = out.error || `${e.status || ""} ${e.message}`.trim();
    }
  }
  return out;
}
