# Forest Personal — Spec

Tài liệu kỹ thuật của extension `forest-personal`, dựng lại từ extension Forest
gốc **6.6.1** (`kjacjjdnoddnpbbcjilcajfhhbdhkpgk`) và **đã kiểm chứng trực tiếp
với server thật** (không chỉ đọc bundle).

---

## 1. Origin và cách bù ID

Server kiểm tra header `Origin` với request ghi (POST/PUT/DELETE) và **chỉ chấp nhận
`chrome-extension://kjacjjdnoddnpbbcjilcajfhhbdhkpgk`**:

```
GET  /api/v1/users/12345678              (không có Origin)            → 200
POST /api/v1/plants  Origin: chrome-extension://<id khác>            → 403
POST /api/v1/plants  Origin: chrome-extension://kjac…pgk             → 400 (validate)
```

Chrome giữ ID đã gán cho extension unpacked ở lần load đầu, nên bản clone có thể chạy
dưới ID khác. Để không phụ thuộc vào việc gỡ Forest gốc, extension tự thêm một
**rule DNR `modifyHeaders` (id 900)** đặt `Origin` thành ID gốc cho request
`xmlhttprequest` tới 4 host API/auth, giới hạn bằng `initiatorDomains: [chrome.runtime.id]`
— chỉ request do chính extension này phát ra bị đổi, trang web khác không ảnh hưởng.

`manifest.json` **không** có trường `key`. Nếu dùng `key` của bản gốc trong khi
Forest gốc đang cài, Chrome tính ra ID trùng và lần reload thất bại (service worker
mới không lên, background cũ chạy tiếp) — đã tái hiện được. ID của bản unpacked là
ID theo đường dẫn thư mục (ví dụ `pagpjm…`), nên hai extension chạy song song được.

---

## 2. API

### Base URL

| Region | API | Auth |
|---|---|---|
| `global` | `https://c88fef96.forestapp.cc/api/v1` | `https://auth.seekrtech.com` |
| `china` | `https://forest-china.upwardsware.com/api/v1` | `https://auth.upwardsware.com` |

### Xác thực

Luồng email/mật khẩu (bản gốc gọi là legacy signin):

1. `POST /sessions` body `{ "session": { "email": "...", "password": "..." } }`
2. Server trả `{ "userId": 12345678 }` **và đặt cookie `remember_token`**.
3. Mọi request sau đó dùng cookie này → fetch phải có
   `credentials: "include"`.
4. Bản gốc **không lưu access token nào** trong `chrome.storage.local` — đây là
   bằng chứng cho thấy auth hoàn toàn bằng cookie.

Extension này lưu thêm `user.rememberToken` (server trả trong `GET /users/{id}`)
và tự đặt lại cookie bằng `chrome.cookies.set` nếu cookie bị xoá — tức "lưu lại
phiên" bền hơn bản gốc.

Luồng OAuth/PKCE (chưa port): `/oauth/tokens` với
`{ grant_type: "authorization_code", code, code_verifier }`, sau đó
`Authorization: Bearer <access_token>`. Refresh:
`POST {auth}/oauth/tokens` body `{ grant_type: "refresh_token", refresh_token }`.

### Endpoints (đã gọi thử, ghi lại response thật)

| Method | Path | Ghi chú |
|---|---|---|
| `POST` | `/sessions` | `{session:{email,password}}` → `{userId}` + cookie |
| `DELETE` | `/sessions/signout` | xoá phiên |
| `GET` | `/users/{id}` | user snake_case: `coin`, `health_tree_count`, `dead_tree_count`, `total_minutes`, `remember_token`, `boost_*` |
| `GET` | `/users/{id}/boost` | `{boost_start_time, boost_end_time, boost_rate}` |
| `GET` | `/tags` | `{update_since, tags:[{id,tag_id,title,deleted,tag_color_tcid,...}]}` |
| `GET` | `/tree_types/unlocked` | `[{gid,title,atlas_image_url,tier,...}]` |
| `GET` | `/plants?from_date=<ISO>` | **mảng** plant snake_case (không bọc `{plants}`) |
| `POST` | `/plants` | `{ plant: {...} }` → plant đã lưu (có `id`) |
| `PUT` | `/plants/{id}` | `{ plant: {...} }` |

`from_date` là tham số duy nhất bản gốc dùng khi pull; `to_date` là tuỳ chọn.

---

## 3. PlantRecord (schema thật của server)

Response `GET /plants`:

```json
{
  "id": 2104980499,
  "tag": 0,
  "note": "",
  "is_success": true,
  "start_time": "2026-11-19T16:07:43.739Z",
  "end_time": "2026-11-19T16:37:43.739Z",
  "created_at": "2026-11-19T16:37:50.313664Z",
  "updated_at": "2026-11-19T16:37:50.313664Z",
  "user_id": 12345678,
  "has_left": false,
  "deleted": false,
  "theme": 0,
  "cheating": false,
  "room_id": 0,
  "tree_type_gid": 124,
  "tree_count": 1,
  "mode": "countdown",
  "is_deep_focus": null,
  "total_focus_duration": 1800,
  "session_id": null,
  "session_participant_id": null,
  "title": null,
  "trees": [
    { "tree_type": 124, "is_dead": false, "phase": 4,
      "created_at": "...", "updated_at": "..." }
  ]
}
```

Payload `POST /plants` chỉ gồm các field client được phép gửi:

```json
{ "plant": {
  "start_time": "...", "end_time": "...", "tag": 1, "note": "",
  "tree_type_gid": 124, "is_success": true, "updated_at": "...",
  "trees": [{ "is_dead": false, "phase": 4, "tree_type": 124 }]
}}
```

### Sinh cây (`trees`) — copy đúng hàm `nt` của bản gốc

```js
const total  = min(4, max(1, floor(plannedSec / 1800)));  // mỗi 30 phút = 1 cây
const reached= min(4, max(1, floor(elapsedSec / 1800)));
const alive  = (elapsedSec < plannedSec && reached === 1) ? 0 : reached;
// cây sống: { is_dead:false, phase: i+4, tree_type }
// cây chết: { is_dead:true,  phase: 8,   tree_type }
```

`phase` dùng cho ảnh sinh trưởng: 1–3 mầm, 4–7 trưởng thành, 8 = cây chết.

---

## 4. Thưởng xu

Server tự cộng xu khi plant được ghi nhận; extension không gửi số xu. Cách đo
phần thưởng (giống bản gốc, gọi `GET /users/{id}` sau khi POST plant):

```
coinBefore = user.coin
POST /plants
GET /users/{id}  → coinAfter
reward     = coinAfter - coinBefore
```

Hiển thị banner `+N xu` trong popup và lưu `state.lastReward`.

Boost: `GET /users/{id}/boost` (hoặc `user.boost_*`) — nếu
`boost_end_time > now` thì phần thưởng hiển thị nhân `boost_rate` (bản gốc hiển
thị "+coins*2"). Extension chỉ hiển thị, không gọi endpoint kích hoạt boost.

---

## 5. State machine

```
idle --START_PLANTING--> planting --(alarm fpPlantingDone)--> success (POST)
                          |
                          +--GIVE_UP--> dead record (is_success=false), vẫn POST
```

- `planting = { treeTypeGid, tag, note, startTime, endTime, durationMin }`
  nằm trong `chrome.storage.local` → sống qua việc SW bị suspend.
- Alarm `fpPlantingDone` tại `endTime`.
- Bỏ cuộc: `endTime = now`, `trees` tính theo thời gian đã trôi.

---

## 6. Message protocol

| `msg.cmd` | Payload | Response |
|---|---|---|
| `GET_STATE` | — | `{ ok, state, hosts }` |
| `SIGNIN` | `{ email, password, region }` | `{ ok, user, sync }` / `{ ok:false, status, data }` |
| `SIGNOUT` | — | `{ ok }` |
| `START_PLANTING` | `{ treeTypeGid, tag, note, durationMin }` | `{ ok, planting }` |
| `GIVE_UP` | — | `{ ok, record, coins }` |
| `SYNC` | — | `{ ok, pushed, failed, plants }` |
| `REFRESH_PROFILE` | — | `{ ok, user }` |
| `CHECK_CONNECTION` | — | `{ ok, user }` / lỗi HTTP |
| `UPDATE_SETTINGS` | `{ patch }` | `{ ok, state, rules }` |
| `GET_CHALLENGES` | — | `{ ok, challenges, deliveryAvailable, deliveryClaimed, loadedAt }` |
| `CLAIM_CHALLENGE_REWARD` | `{ progressId }` | `{ ok, reward, challenges }` |
| `CLAIM_DELIVERY_ITEM` | `{ itemId }` | `{ ok, reward, deliveryAvailable, deliveryClaimed }` |

Broadcast: `PLANTING_DONE`, `PLANTING_GAVE_UP`.

---

## 7. Storage (`chrome.storage.local`, key `fpState`)

```js
{
  version: 3,
  region: "global" | "china",
  auth: { accessToken: null, refreshToken: null },   // chỉ dùng cho OAuth
  user: { id, name, email, coin, gem, totalMinutes,
          healthTreeCount, deadTreeCount, boost:{start,end,rate},
          rememberToken } | null,
  tags: [{ tagId, title }],
  treeTypes: [{ gid, title, image }],
  planting: {...} | null,
  pendingPlants: [PlantRecord],     // snake_case khi gửi
  serverPlants: [PlantRecord],      // đã chuẩn hoá camelCase
  lastSyncedAt: ISO | null,
  lastReward: { at, coins, coin } | null,
  syncError: string | null,
  blocklist: ["facebook.com", ...],
  allowlist: [],
  whitelistMode: false,
  blockEnabled: true,
  challenges: [ChallengeProgress],  // docs/CHALLENGE_API.md
  challengesLoadedAt: ISO | null,
  deliveryAvailable: [RewardItemType],
  deliveryClaimed: [RewardItemType],
}
```
Challenge API (legacy REST, cùng host `c88fef96.forestapp.cc` nhưng **không** qua
`/api/v1`): `GET /challenge/users/{uid}/progresses`, `PUT …/{pid}/reward`,
`GET /delivery/users/{uid}/items/{available|claimed}`, `PUT …/{iid}/claim`.
Microservices trên `forest-api.seekrtech.com`: starter challenge
`GET /challenge/users/{uid}/progresses/new_user` + `POST …/progresses/events`.
Chi tiết: `docs/CHALLENGE_API.md`.


---

## 8. Chặn trang — declarativeNetRequest

- Rule 900 (luôn bật, kể cả khi tắt chặn): `modifyHeaders` set `Origin` gốc cho API.
- Blocklist: mỗi domain hợp lệ → 1 dynamic rule id 1000+i,
  `{ action: redirect → /blocked.html, condition: { requestDomains:[host], resourceTypes:["main_frame"] } }`.
- Whitelist: 1 rule `excludedRequestDomains = allowlist`; **chỉ thêm khi
  allowlist không rỗng** (tránh chặn toàn bộ trình duyệt).
- Tên miền API/auth luôn bị loại khỏi danh sách chặn.
- `blocked.html` + `blocked.js` nằm trong `web_accessible_resources` (Chrome yêu
  cầu điều này cho `redirect.extensionPath`).
- Cập nhật rule được **xếp hàng tuần tự**: `init()` chạy ở top-level và ở
  `onInstalled`/`onStartup`, nếu chạy song song Chrome báo
  `Rule with id 1 does not have a unique ID`.

---

## 9. Dev auto-reload

Hai phần tách biệt (giống `Desktop\extension\dev`); extension chính không chứa
code reload:

- `dev/watch.js` — HTTP server `127.0.0.1:35730` (`FP_RELOAD_PORT`), `fs.watch`
  đệ quy, debounce 180 ms; mỗi lần file đổi tăng `version`, bỏ qua `dev/`.
  Endpoints: `/check` → `{version, changedAt, files}`, `/health`.
- `dev/reloader/` — helper extension ("Forest Personal Dev Reloader") quyền
  `management`; poll `/check` mỗi 1 s (timer giữ SW thức) + alarm 1 phút dự phòng.
  `version` đổi → `management.setEnabled(target,false)` → 250 ms →
  `setEnabled(target,true)`. Target = extension tên `Forest Personal` và
  `installType === "development"` → không bao giờ bật/tắt Forest gốc.
- Lần poll đầu chỉ ghi baseline → không reload khi khởi động, không vòng lặp.

---

## 10. Chưa port / giới hạn

- PKCE login Google/Facebook (`auth.seekrtech.com` + `launchWebAuthFlow`).
- Kích hoạt boost (chỉ hiển thị trạng thái; endpoint kích hoạt chưa dò được).
- Ảnh cây: dùng emoji theo phase; server có `atlas_image_url` cho từng loại cây.
- Content script phủ cây lên trang (bản gốc inject overlay).
- Thông báo hệ thống khi cây lớn / cây chết.

---

## 11. Widget nổi (always-on-top)

Cửa sổ Forest nằm ngoài trình duyệt, luôn nổi trên app khác (`float/`).

- `float/server.ps1` — `HttpListener` ở `127.0.0.1:35731`, trao đổi qua
  `%TEMP%\forest-float\state.json` và `cmd.json`:
  `GET /health`, `POST /state`, `GET /poll` (lấy và xoá lệnh đang chờ).
- `float/ForestFloat.ps1` — WPF, `WindowStyle=None`, `AllowsTransparency=True`,
  `Topmost=True`, `WindowStartupLocation=CenterScreen`, kéo bằng chuột; đọc
  `state.json` mỗi 500 ms, ghi `cmd.json` khi bấm Start / Give up / ⚙.
- `float/start-float.bat` — chạy server ẩn + mở widget.
- Extension (`background.js`): khi `state.floatEnabled` bật → poll `/poll` mỗi 1 s,
  áp lệnh (`start`, `giveup`, `open-options`) rồi `POST /state` với snapshot
  `{ id, loggedIn, coin, blockEnabled, planting{endTime,durationMin,tagTitle}, lastReward }`.
  Alarm `fpFloat` 1 phút khởi động lại poll nếu service worker bị sleep.
- Quyền: `optional_host_permissions` cho `http://127.0.0.1:35731/*` — xin cấp khi
  bật toggle (`chrome.permissions.request` trong user gesture). Không đặt ở
  `host_permissions` vì thêm quyền lúc reload khiến Chrome disable extension.

> Giới hạn của nền tảng: extension không thể tạo cửa sổ always-on-top trên HĐH,
> nên widget phải là app ngoài (WPF, không cần cài thêm runtime).

---

## 12. Giao diện

- Icon: `icons/{16,32,48,128}.png` — mầm cây (sprout) trên nền xanh bo tròn, khai
  báo ở `manifest.icons` và `action.default_icon`, để toolbar không còn hiện chữ “F”.
  Helper `dev/reloader` có bộ icon riêng (mũi tên reload) để không bị Chrome vẽ
  chữ “F” thứ hai trên toolbar.


- `ui.css` — design token dùng chung (light/dark) cho options và blocked.
- `popup.html` — card xanh gradient theo phong cách Forest: gear (⚙), công tắc
  "Blocklist mode", "+" (trồng), vòng tròn kem chứa cây, timer lớn, chip 10′/15′/25′/30′/35′/45′/60′,
  footer xu/cây sống. Giai đoạn cây: 🌱 → 🌿 → 🪴 → 🌳.
- **Chọn cây**: nút tên cây dưới timer mở sheet danh sách (tên + gid) từ
  `tree_types/unlocked`; lựa chọn lưu ở `selectedTreeGid` và được dùng khi
  `START_PLANTING`. Popup tự gọi `LOAD_CATALOG` nếu chưa có catalog (sau đăng nhập).
  Sheet có **thanh tìm kiếm** (lọc theo tên hoặc `#gid`, hiện `x/tổng`, Enter chọn
  kết quả đầu, Esc đóng) và tự focus khi mở.
- **Ảnh cây**: dùng `atlas_image_url` server trả trong `tree_types/unlocked`
  (PNG trong suốt ~630–960px). Popup vẽ `<img>` trong vòng tròn, thumbnail 22px
  trong danh sách, scale 0.6→1.0 theo tiến độ khi đang trồng; ảnh lỗi thì fallback
  về emoji. Widget tải cùng URL qua HttpClient (bật TLS 1.2), cache theo URL,
  fallback emoji nếu tải lỗi.

---

## 12b. Thông báo hệ thống

- `chrome.notifications` tạo toast Windows khi cây hoàn thành (`finishPlanting(true)`) hoặc
  khi bỏ cuộc (`finishPlanting(false)`), nội dung: số phút · số xu nhận được (nếu có).
- Quyền `notifications` nằm trong `optional_permissions`: bật lần đầu ở Options sẽ gọi
  `chrome.permissions.request` (phải trong user gesture). Không đặt ở `permissions`
  vì thêm quyền lúc reload khiến Chrome disable extension (`disable_reasons`).
- Trước khi tạo toast, background kiểm tra `chrome.permissions.contains` — chưa cấp
  quyền thì bỏ qua, không lỗi. (`chrome.notifications` là `undefined` khi chưa cấp.)
- Bấm toast → mở `garden.html`.

### Badge vàng trên icon

- Khi cây hoàn thành: `chrome.action.setBadgeText` = `+N` (xu nhận được, tối đa 99)
  hoặc `✓` nếu không rõ xu; nền vàng `#F4C542`, chữ `#3A2A00`, tooltip
  “Forest Personal — cây đã lớn · +N xu”.
- Hoạt động **độc lập với thông báo hệ thống** (dùng khi người dùng tắt toast).
- Xoá badge khi mở popup: popup gửi `ACK_BADGE` → `clearBadge()`, title trở lại
  “Forest Personal”.

---

## 12c. Thông báo Telegram

- `fpState.telegram = { enabled, token, chatId }` (lưu cục bộ). Gửi bằng
  `POST https://api.telegram.org/bot<token>/sendMessage` (`parse_mode=HTML`, tên cây được escape).
- Tin khi cây lớn: tên cây · phút · tag · `+N xu (tổng)` · “Hôm nay: k cây sống”; khi bỏ cuộc: tên cây ·
  `bỏ cuộc sau a/b phút`.
- Options: nhập token, **Lấy chat ID** (`getUpdates`, cần đã Start bot), **Gửi thử**, Lưu. Kết quả gần nhất lưu ở
  `lastTelegram`; popup cảnh báo nếu lần gửi gần nhất thất bại.
- Dùng `host_permissions: <all_urls>` nên không cần quyền mới. Toast hệ thống đổi mặc định thành tắt.

---

## 13. Vườn cây (`garden.html` + `garden.js`)

Mô phỏng màn **Overview** của Forest: tab kỳ, plot isometric và biểu đồ phân bố
thời gian tập trung.

- **Tab**: Ngày / Tuần / Tháng / Năm; nút `‹` `›` dịch kỳ, nhãn ngày dạng
  “20 tháng 11, 2026 (Hôm nay)”, tuần “16 – 22 tháng 11, 2026”.
- **Giao diện** bám màn Overview của app 5.3.1: nền `#214c3b`, tab pill `#1f4334`
  (ô chọn trắng), thẻ biểu đồ `#f4f4f4`, cột `#54a488`.
- **Plot isometric (SVG)**: đảo cỏ N×N với N = max(10, ⌈√số cây⌉), ô cỏ xen kẽ
  `#a3d044`/`#aed950`, viền cỏ + đất hai cạnh. Vẽ **mỗi cây** trong `plant.trees[]`
  (không phải mỗi plant), ảnh theo `trees[].treeType` (fallback `treeTypeGid`, emoji);
  ô chọn giả ngẫu nhiên cố định, vẽ từ sau ra trước; cây chết giảm bão hoà.
- **Số liệu kỳ**: đếm như `SumHealthyAndDeadTreeUseCase` của app — cộng từng
  `trees[]` theo `is_dead`; plant chưa có `trees` tính 1 cây theo `isSuccess`.
  Tổng phút = Σ(end − start).
- **Biểu đồ phân bố**: theo bucket — ngày 24 giờ (nhãn 00:00…23:00), tuần 7 ngày
  (T2…CN), tháng theo ngày (nhãn 1,5,10…), năm 12 tháng; dòng “Tổng thời gian tập
  trung: N phút”.
- **Kiểu biểu đồ** (`lineChartSvg`, dùng chung hai thẻ): thẻ tối navy
  `#2e3e4e→#263441`, đường cong monotone (không vọt dưới 0), màu đường và vùng tô
  gradient theo độ cao — phân bố xanh lá→xanh dương, ngày trong tuần vàng→hồng. Mốc
  cao nhất hiện sẵn cột sáng + chấm + số phút; rê chuột lên mốc khác để xem mốc đó.
- **Ngày tập trung nhiều nhất trong tuần** (ẩn ở tab Ngày): biểu đồ đường T2…CN,
  giá trị = phút trung bình mỗi thứ = tổng phút của thứ đó / số lần thứ đó xuất hiện
  trong kỳ tính tới hôm nay (như `GroupTotalPlantingTimeByTimeUnitUseCase`
  `average=true`). Ngày cao nhất (giữ mọi ngày bằng nhau) được tô đậm. Mô tả theo
  chuỗi app: 1 ngày → “Thường tập trung nhiều nhất vào **X** hằng tuần”; 2–3 ngày →
  “Những ngày bạn tập trung nhiều nhất là **X, Y**!”; >3 ngày → câu “hơn 3 ngày”.
- **Tải dữ liệu theo kỳ**: `LOAD_RANGE { from, to }` → `GET /plants?from_date&to_date`,
  trả `plants` cho trang (giữ trong bộ nhớ trang) và merge vào `serverPlants`
  (giới hạn 5000 bản ghi mới nhất), nên xem được tháng/năm cũ ngoài cửa sổ 30 ngày
  của `sync()` mà không bị cắt bởi giới hạn cache.
- Dữ liệu gồm cả `pendingPlants` (chưa sync). Mở từ popup (`🌳 N`) hoặc Options
  (nút **Vườn cây**).
