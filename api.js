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
    auth: "https://auth.seekrtech.com",
  },
  china: {
    api: "https://forest-china.upwardsware.com/api/v1",
    auth: "https://auth.upwardsware.com",
  },
};

const cfg = {
  region: "global",
  accessToken: null,
  refreshToken: null,
  onTokens: null, // (tokens) => void, gọi khi refresh thành công
};

export class ApiError extends Error {
  constructor(status, data, url) {
    super(`API ${status} ${url}`);
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

async function send(method, url, { json, token } = {}) {
  const headers = { accept: "application/json" };
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

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

async function request(method, path, { json, auth = true, retry = true } = {}) {
  const url = regionHosts().api + path;
  let token = auth ? cfg.accessToken : null;
  let out = await send(method, url, { json, token });

  if (retry && auth && (out.res.status === 401 || out.res.status === 403)) {
    try {
      token = await refreshToken();
      out = await send(method, url, { json, token });
    } catch { /* không có refresh token → trả lỗi gốc */ }
  }

  if (!out.res.ok) throw new ApiError(out.res.status, out.data, url);
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

/* --- Endpoints --- */

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
