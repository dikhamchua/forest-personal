/* Forest API client — dựng lại từ bundle của extension gốc 6.6.1 và đã kiểm
   chứng trực tiếp với server thật.
 *
 * Xác thực:
 *  - Đăng nhập email/mật khẩu: POST /sessions { session: { email, password } }
 *    → server trả { userId } và đặt cookie `remember_token` (HttpOnly).
 *  - Mọi request sau đó xác thực bằng cookie đó, nên fetch phải dùng
 *    credentials: "include". Đây là lý do extension gốc không lưu token nào.
 *  - Luồng OAuth/PKCE (không dùng ở đây) trả access/refresh token; nếu có token
 *    thì gửi thêm Authorization: Bearer và tự refresh khi 401/403.
 *
 * Server chỉ chấp nhận Origin của extension gốc, nên manifest.json phải giữ
 * trường `key` của bản gốc để ID (và Origin) trùng khớp.
 */

const HOSTS = {
  global: {
    api: "https://c88fef96.forestapp.cc/api/v1",
    // Host gốc của API legacy (không /api/v1) — challenge/delivery chạy ở
    // forest-api.seekrtech.com; CDN c88fef96 chỉ phục vụ /api/v1.
    root: "https://forest-api.seekrtech.com",
    // Microservices (Ktor, forestapp v5.x) — starter challenge + event.
    micro: "https://forest-api.seekrtech.com",
    auth: "https://auth.seekrtech.com",
  },
  china: {
    api: "https://forest-china.upwardsware.com/api/v1",
    root: "https://forest-china.upwardsware.com",
    micro: "https://forest-api.upwardsware.com",
    auth: "https://auth.upwardsware.com",
  },
};

const cfg = {
  region: "global",
  accessToken: null,
  refreshToken: null,
  rememberToken: null, // header Remember-Token / X-Auth-Token cho host forest-api
  userId: null,        // seekruid query param
  onTokens: null, // (tokens) => void, gọi khi refresh thành công
};

export class ApiError extends Error {
  constructor(status, data, url, note = "") {
    const body = typeof data === "string" ? data : data ? JSON.stringify(data) : "";
    super(`API ${status} ${url}${body ? ` · ${body.slice(0, 200)}` : ""}${note ? ` [${note}]` : ""}`);
    this.status = status;
    this.data = data;
    this.url = url;
  }
}

export function configure(patch = {}) {
  Object.assign(cfg, patch);
}

export function regionHosts(region = cfg.region) {
  return HOSTS[region] || HOSTS.global;
}

async function send(method, url, { json, token, rememberHeader } = {}) {
  const headers = { accept: "application/json" };
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  // forest-api.* không đọc cookie remember_token; app gửi remember token qua header:
  //  - Retrofit (challenge/delivery): RememberTokenInterceptor → `Remember-Token`
  //  - Ktor microservices: PrioritizedAuthPlugin → `X-Auth-Token`
  // (chỉ khi không có OAuth token — người dùng đăng nhập email là trường hợp này).
  if (rememberHeader?.value) headers[rememberHeader.name] = rememberHeader.value;

  const res = await fetch(url, {
    method,
    headers,
    credentials: "include", // cookie remember_token
    cache: "no-store",
    body: json === undefined ? undefined : JSON.stringify(json),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { res, data };
}

/* --- refresh access token (chỉ dùng khi có refreshToken) --- */
let refreshing = null;

export function refreshToken() {
  if (!cfg.refreshToken) return Promise.reject(new ApiError(401, "no_refresh_token", cfg.region));
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const { auth } = regionHosts();
    const { res, data } = await send("POST", `${auth}/oauth/tokens`, {
      json: { grant_type: "refresh_token", refresh_token: cfg.refreshToken },
    });
    if (!res.ok) throw new ApiError(res.status, data, `${auth}/oauth/tokens`);
    if (!data?.access_token) throw new ApiError(500, data, `${auth}/oauth/tokens`);

    cfg.accessToken = data.access_token;
    if (data.refresh_token) cfg.refreshToken = data.refresh_token;
    cfg.onTokens?.({ accessToken: cfg.accessToken, refreshToken: cfg.refreshToken });
    return cfg.accessToken;
  })().finally(() => { refreshing = null; });

  return refreshing;
}

async function request(method, path, { json, auth = true, retry = true, base = "api" } = {}) {
  const hosts = regionHosts();
  let url = (base === "root" ? hosts.root : base === "micro" ? hosts.micro : hosts.api) + path;
  // SeekrInterceptor của app gắn ?seekrua=android-<ver>&seekruid=<userId> vào mọi
  // request Retrofit (cc.forestapp.network.config.interceptor.SeekrInterceptor).
  if (base === "root") {
    const sp = new URLSearchParams({ seekrua: "android-5.3.1" });
    if (cfg.userId) sp.set("seekruid", String(cfg.userId));
    url += (url.includes("?") ? "&" : "?") + sp.toString();
  }
  let token = auth ? cfg.accessToken : null;
  // Host forest-api dùng header remember token (xem send()).
  const rememberHeader =
    base === "api" || !cfg.rememberToken
      ? null
      : { name: base === "micro" ? "x-auth-token" : "remember-token", value: cfg.rememberToken };
  let out = await send(method, url, { json, token, rememberHeader });

  if (retry && auth && (out.res.status === 401 || out.res.status === 403)) {
    try {
      token = await refreshToken();
      out = await send(method, url, { json, token, rememberHeader });
    } catch { /* không có refresh token → trả lỗi gốc */ }
  }


  if (!out.res.ok) {
    const note = base === "api" ? "" : `${rememberHeader ? rememberHeader.name : "không có remember token"}`;
    throw new ApiError(out.res.status, out.data, url, note);
  }
  return out.data;
}

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
};

/* --- Chuẩn hoá dữ liệu server (snake_case) sang dạng dùng trong extension --- */

export function normalizeUser(u) {
  if (!u || typeof u !== "object") return null;
  return {
    id: u.id ?? u.user_id ?? u.userId,
    name: u.name ?? u.user_name ?? "",
    email: u.email ?? "",
    coin: u.coin ?? 0,
    gem: u.gem ?? 0,
    totalMinutes: u.total_minutes ?? u.totalMinutes ?? 0,
    healthTreeCount: u.health_tree_count ?? u.healthTreeCount ?? 0,
    deadTreeCount: u.dead_tree_count ?? u.deadTreeCount ?? 0,
    boost: {
      start: u.boost_start_time ?? u.boostStartTime ?? null,
      end: u.boost_end_time ?? u.boostEndTime ?? null,
      rate: u.boost_rate ?? u.boostRate ?? null,
    },
    rememberToken: u.remember_token ?? u.rememberToken ?? null,
    isPremium: !!(u.receipt_system_premium_rid || u.receiptSystemPremiumRid),
  };
}

export function normalizeTag(t) {
  return {
    tagId: t.tag_id ?? t.tagId ?? 0,
    title: t.title ?? "",
    deleted: !!t.deleted,
  };
}

export function normalizeTree(t) {
  return {
    gid: t.gid ?? t.id,
    title: t.title ?? `Cây #${t.gid}`,
    image: t.atlas_image_url ?? null,
    atlasJsonUrl: t.atlas_json_url ?? null, // sprite sheet JSON nếu cần crop
  };
}

export function normalizePlant(p) {
  if (!p || typeof p !== "object") return null;
  return {
    id: p.id ?? null,
    startTime: p.start_time ?? p.startTime ?? null,
    endTime: p.end_time ?? p.endTime ?? null,
    tag: p.tag ?? 0,
    note: p.note ?? "",
    treeTypeGid: p.tree_type_gid ?? p.treeTypeGid ?? 0,
    isSuccess: p.is_success ?? p.isSuccess ?? false,
    createdAt: p.created_at ?? p.createdAt ?? null,
    trees: (p.trees || []).map((t) => ({
      isDead: t.is_dead ?? t.isDead ?? false,
      phase: t.phase ?? 0,
      treeType: t.tree_type ?? t.treeType ?? 0,
    })),
  };
}

/* --- Challenge DTO (snake_case → camelCase) --- */

export function normalizeChallenge(c) {
  if (!c || typeof c !== "object") return null;
  return {
    id: c.id ?? null,
    kind: c.kind ?? null,
    titleKey: c.title_key ?? c.titleKey ?? "",
    subtitleKey: c.subtitle_key ?? c.subtitleKey ?? "",
    imageUrl: c.image_url ?? c.imageUrl ?? null,
    createdAt: c.created_at ?? c.createdAt ?? null,
    updatedAt: c.updated_at ?? c.updatedAt ?? null,
  };
}

export function normalizeTargetRange(r) {
  if (!r || typeof r !== "object") return null;
  return {
    lower: r.lower ?? 0,
    upper: r.upper ?? 0,
    excludeLower: !!r.exclude_lower,
    excludeUpper: !!r.exclude_upper,
  };
}

export function normalizeChallengeDifficulty(d) {
  if (!d || typeof d !== "object") return null;
  return {
    id: d.id ?? null,
    type: d.type ?? null,
    challengeId: d.challenge_id ?? d.challengeId ?? null,
    rewardTypeId: d.reward_type_id ?? d.rewardTypeId ?? null,
    difficulty: d.difficulty ?? 0,
    targetRange: normalizeTargetRange(d.target_range ?? d.targetRange),
    targetStepSize: d.target_step_size ?? d.targetStepSize ?? 0,
    treeType: d.tree_type ?? d.treeType ?? null,
    createdAt: d.created_at ?? d.createdAt ?? null,
    updatedAt: d.updated_at ?? d.updatedAt ?? null,
    challenge: normalizeChallenge(d.challenge),
  };
}

export function normalizeChallengeProgress(p) {
  if (!p || typeof p !== "object") return null;
  return {
    id: p.id ?? null,
    userId: p.user_id ?? p.userId ?? null,
    challengeDifficultyId: p.challenge_difficulty_id ?? p.challengeDifficultyId ?? null,
    target: p.target ?? 0,
    progress: p.progress ?? 0,
    status: p.status ?? null,
    createdAt: p.created_at ?? p.createdAt ?? null,
    updatedAt: p.updated_at ?? p.updatedAt ?? null,
    availableAt: p.available_at ?? p.availableAt ?? null,
    completedAt: p.completed_at ?? p.completedAt ?? null,
    rewardDeliveredAt: p.reward_delivered_at ?? p.rewardDeliveredAt ?? null,
    dueAt: p.due_at ?? p.dueAt ?? null,
    challengeDifficulty: normalizeChallengeDifficulty(p.challenge_difficulty ?? p.challengeDifficulty),
  };
}

export function normalizeRewardContent(r) {
  if (!r || typeof r !== "object") return null;
  return {
    type: r.type ?? null,
    value: r.value ?? 0,
    titleKey: r.title_key ?? r.titleKey ?? "",
    iconImageUrl: r.icon_image_url ?? r.iconImageUrl ?? null,
  };
}

export function normalizeRewardItemType(r) {
  if (!r || typeof r !== "object") return null;
  return {
    id: r.id ?? null,
    content: (r.content || []).map(normalizeRewardContent).filter(Boolean),
    titleKey: r.title_key ?? r.titleKey ?? "",
    iconImageUrl: r.icon_image_url ?? r.iconImageUrl ?? null,
    createdAt: r.created_at ?? r.createdAt ?? null,
    updatedAt: r.updated_at ?? r.updatedAt ?? null,
  };
}

export function normalizeDeliverReward(r) {
  if (!r || typeof r !== "object") return null;
  const item = r.item ?? r.reward ?? null;
  return {
    id: item?.id ?? r.id ?? null,
    itemType: normalizeRewardItemType(item?.item_type ?? item?.itemType ?? r.item_type ?? r.itemType),
    content: (item?.content || r.content || []).map(normalizeRewardContent).filter(Boolean),
    raw: r,
  };
}

/* --- Challenge API (legacy REST, xem docs/CHALLENGE_API.md) --- */

export const challengeApi = {
  // GET /challenge/users/{uid}/progresses — danh sách challenge + progress.
  getProgresses(userId) {
    return request("GET", `/challenge/users/${userId}/progresses`, { base: "root" }).then((d) =>
      (d?.challenge_progresses || d?.challengeProgresses || []).map(normalizeChallengeProgress).filter(Boolean),
    );
  },

  // PUT /challenge/users/{uid}/progresses/{pid}/reward — claim thưởng.
  claimProgressReward(userId, progressId) {
    return request("PUT", `/challenge/users/${userId}/progresses/${progressId}/reward`, { base: "root" }).then(
      normalizeDeliverReward,
    );
  },

  // GET /delivery/users/{uid}/items/available — item còn mở để claim.
  getAvailableItems(userId) {
    return request("GET", `/delivery/users/${userId}/items/available`, { base: "root" }).then((d) =>
      (d?.items || []).map(normalizeRewardItemType).filter(Boolean),
    );
  },

  // GET /delivery/users/{uid}/items/claimed — item đã claim.
  getClaimedItems(userId) {
    return request("GET", `/delivery/users/${userId}/items/claimed`, { base: "root" }).then((d) =>
      (d?.items || []).map(normalizeRewardItemType).filter(Boolean),
    );
  },

  // PUT /delivery/users/{uid}/items/{iid}/claim — claim một item.
  claimItem(userId, itemId) {
    return request("PUT", `/delivery/users/${userId}/items/${itemId}/claim`, { base: "root" }).then(
      normalizeDeliverReward,
    );
  },

  /* Microservices (starter challenge + event). userId là string ở backend mới. */
  getNewUserProgresses(userId) {
    return request("GET", `/challenge/users/${userId}/progresses/new_user`, { base: "micro" }).then((d) =>
      (d?.challenge_progresses || d?.challengeProgresses || []).map(normalizeChallengeProgress).filter(Boolean),
    );
  },

  postProgressEvent(userId, eventName, occurredAt = new Date().toISOString()) {
    return request("POST", `/challenge/users/${userId}/progresses/events`, {
      base: "micro",
      json: { event_name: eventName, occurred_at: occurredAt },
    });
  },
};

/* Chẩn đoán challenge: chạy GET progresses và trả mọi thứ cần để biết vì sao 401
   (không lộ giá trị token, chỉ độ dài). Dùng ở Options → Nâng cao. */
export async function diagnoseChallenge() {
  const info = {
    region: cfg.region,
    userId: cfg.userId,
    hasRememberToken: !!cfg.rememberToken,
    rememberTokenLen: cfg.rememberToken ? String(cfg.rememberToken).length : 0,
    hasAccessToken: !!cfg.accessToken,
    root: regionHosts().root,
  };
  if (!cfg.userId) return { ...info, ok: false, error: "chưa có userId (chưa đăng nhập?)" };
  try {
    const list = await challengeApi.getProgresses(cfg.userId);
    return { ...info, ok: true, count: list.length };
  } catch (e) {
    return { ...info, ok: false, status: e.status ?? null, url: e.url ?? null, data: e.data ?? null, error: e.message };
  }
}

export const api = {
  // Không gửi Bearer, không retry: đây là request tạo phiên.
  async signin(email, password) {
    const data = await request("POST", "/sessions", {
      json: { session: { email, password } },
      auth: false,
      retry: false,
    });
    const userId = data?.userId ?? data?.user_id ?? data?.user?.id ?? null;
    return {
      userId,
      accessToken: data?.accessToken ?? data?.access_token ?? null,
      refreshToken: data?.refreshToken ?? data?.refresh_token ?? null,
      raw: data,
    };
  },

  signout() {
    return request("DELETE", "/sessions/signout", { retry: false });
  },

  getUser(userId) {
    return request("GET", `/users/${userId}`).then(normalizeUser);
  },

  getBoost(userId) {
    return request("GET", `/users/${userId}/boost`);
  },

  getTags() {
    return request("GET", "/tags").then((d) =>
      (d?.tags || []).map(normalizeTag).filter((t) => !t.deleted),
    );
  },

  getUnlockedTreeTypes() {
    return request("GET", "/tree_types/unlocked").then((d) => (d || []).map(normalizeTree));
  },

  // GET /plants?from_date=<ISO>[&to_date=<ISO>] → mảng plant snake_case
  getPlants({ from, to } = {}) {
    return request("GET", `/plants${qs({ from_date: from, to_date: to })}`).then((d) =>
      (Array.isArray(d) ? d : d?.plants || []).map(normalizePlant).filter(Boolean),
    );
  },

  // POST /plants { plant: {...snake_case} } → plant đã lưu
  createPlant(plant) {
    return request("POST", "/plants", { json: { plant } }).then(normalizePlant);
  },

  updatePlant(id, plant) {
    return request("PUT", `/plants/${id}`, { json: { plant } }).then(normalizePlant);
  },
};
