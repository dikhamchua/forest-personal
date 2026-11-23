# Forest Focus Challenge API — extracted from `Forest_v5.3.1_MOD.apk`

Nguồn: smali decompile của `cc.forestapp` v5.3.1 (versionCode 50301000, minSdk 29, targetSdk 36). Hai backend **song song** phục vụ tính năng challenge:

| Backend | Client | Host | Mục đích |
|---|---|---|---|
| **Legacy** (Retrofit) | `cc.forestapp.feature.challenge.data.ChallengeApi` | `https://c88fef96.forestapp.cc` (REST_PRODUCTION_SG) | UI challenge hiện tại (daily check-in, monthly challenge, claim reward) |
| **Microservices** (Ktor) | `com.seekrtech.stforestkit.api.endpoints.microservices.ApiClientChallengeEndpoints` | `https://forest-api.seekrtech.com` (MicroServicesApiConfig.PRODUCTION) | New-user / starter challenge + ghi event |

Cả hai đều gọi qua `app_http_client` (OkHttp) với cookie session SeekrAuth. `user_id` là số user hiện tại (từ `GET /users` hoặc session).

---

## 1. Legacy API — `ChallengeApi` (Retrofit)

Định nghĩa đầy đủ (smali `smali_classes3/.../ChallengeApi.smali`). Tất cả path là relative tới `https://c88fef96.forestapp.cc` (base Retrofit cho qualifier `"challenge"`).

| Java name | HTTP | Path | Params | Trả về |
|---|---|---|---|---|
| `c(userId)` | **GET** | `challenge/users/{user_id}/progresses` | `@Path user_id: long` | `ChallengeProgressResponse` |
| `e(userId, progressId)` | **PUT** | `challenge/users/{user_id}/progresses/{progress_id}/reward` | `@Path user_id, progress_id: long` | `DeliverRewardResponse` |
| `b(userId)` | **GET** | `delivery/users/{user_id}/items/available` | `@Path user_id: long` | `DeliverRewardItemsResponse` |
| `a(userId)` | **GET** | `delivery/users/{user_id}/items/claimed` | `@Path user_id: long` | `DeliverRewardItemsResponse` |
| `d(userId, itemId)` | **PUT** | `delivery/users/{user_id}/items/{item_id}/claim` | `@Path user_id: long, item_id: int` | `DeliverRewardResponse` |

Ý nghĩa tên Kotlin (theo `kotlin.Metadata d2`): `a`=getClaimedItems, `b`=getAvailableItems, `c`=getUserProgresses, `d`=claimItem, `e`=deliverReward.

### Gọi qua wrapper
- `FetchChallengeUseCase.a(userId)` → `ChallengeRemoteDataSource.b(userId)` → `api.c(userId)` = GET progresses.
- `ClaimUseCase.a(entity, userId)` → `ChallengeRemoteDataSource.a(userId, progressId)` → `api.e(userId, progressId)` = PUT reward.
- `RewardDataSourceImpl` gọi `api.b/a/d` cho phần reward thường.

### DTO (Gson `@SerializedName`)

`ChallengeProgressResponse` → `{ "challenge_progresses": [ChallengeProgressDto] }`

`ChallengeProgressDto`:
```json
{
  "id": long,                      "user_id": int,
  "challenge_difficulty_id": int,  "target": int,           "progress": int,
  "status": string,                "created_at": string,    "updated_at": string,
  "available_at": string,          "completed_at": string,  "due_at": string,
  "challenge_difficulty": ChallengeDifficultyDto
}
```

`ChallengeDifficultyDto`:
```json
{ "id": int, "type": string, "challenge_id": int, "reward_type_id": int,
  "difficulty": int, "target_range": TargetRangeDto, "target_step_size": int,
  "tree_type": string, "created_at": string, "updated_at": string,
  "challenge": ChallengeDto }
```

`TargetRangeDto` → `{ "lower": int, "upper": int, "exclude_lower": bool, "exclude_upper": bool }`

`ChallengeDto` → `{ "id": long, "kind": string, "title_key": string, "subtitle_key": string,
  "image_url": string, "created_at": string, "updated_at": string }`

`DeliverRewardItemsResponse` → `{ "items": [RewardItemTypeDto] }`
`RewardItemTypeDto` → `{ "id": int, "content": [RewardContentDto], "title_key": string,
  "icon_image_url": string, "created_at": string, "updated_at": string }`
`RewardContentDto` → `{ "type": string, "value": int, "title_key": string, "icon_image_url": string }`

`DeliverRewardResponse` → `{ "reward": DeliverRewardDto }`
`DeliverRewardDto` → `(Long id, int …, int …, String …, long …, List<RewardContentDto>, String, String, RewardItemTypeDto itemType)` — inner `itemType` phải non-null; client reject khi `item`/`item.content`/`item.itemType` = null (`ApiException` code -2/-3/-4).

---

## 2. Microservices API — `ApiClientChallengeEndpoints` (Ktor)

Base URL: `https://forest-api.seekrtech.com` (prod SG). Client Ktor `HttpClient`, serialize bằng **kotlinx.serialization** (không phải Gson).

| Kotlin name | HTTP | Path (segment order) | Request body | Trả về |
|---|---|---|---|---|
| `getNewUserChallengeProgresses(userId: String)` | **GET** | `challenge/users/{userId}/progresses/new_user` | — | `GetNewUserChallengeProgressesResponse` → `{ "challenge_progresses": [ChallengeProgressDto] }` |
| `postChallengeProgressesEvent(event, userId: String)` | **POST** | `challenge/users/{userId}/progresses/events` | `ChallengeProgressesEventDto` | `Unit` |

Đường dẫn assemble từ `URLBuilderKt.k(URLBuilder, ["challenge","users",userId,"progresses","new_user"|"events"])`.

`ChallengeProgressesEventDto` (request):
```json
{ "event_name": string, "occurred_at": string(ISO instant) }
```

DTO mới (kotlinx `@SerialName`): `ChallengeProgressDto`, `ChallengeDifficultyDto`, `ChallengeDto`, `TargetRangeDto`, `InstantRangeDto`, `ChallengeKind`, `ChallengeType`, `PlantMode`, `PurchaseItemContentType`, `StreakType`. Field mở rộng so với bản legacy: `reward_delivered_at`, `event_name`, `plant_mode`, `is_deep_focus`, `purchase_item_content_type`, `streak_type`, `instant_range`, `times`, `target_minutes`, … (xem `smali_classes7/.../api/dto/Challenge*$$serializer.smali`).

---

## 3. Auth & headers

- Cookie session SeekrAuth sau `POST /sessions` trên host legacy, hoặc Bearer token OAuth `auth.seekrtech.com` (`seekrauth.v2`).
- Request ghi (POST/PUT) cần header `Origin` khớp origin đã đăng ký — extension `forest-personal` bypass bằng DNR rule gắn `Origin: chrome-extension://<forest-id>`; app Android gọi OkHttp trực tiếp nên không cần `Origin` trừ khi server enforce (kiểm chứng bằng cách thử).
- User-Agent của app: mặc định `okhttp` (không bắt buộc). Cookie jar lưu `_forest_session` qua `Cookie` interceptor (`NetworkConnectedInterceptor`, custom `CookieJar`).

## 4. Câu hỏi phổ biến

- **"Lấy challenge hiện tại của tôi"**: `GET https://c88fef96.forestapp.cc/challenge/users/{uid}/progresses` với cookie session.
- **"Nhận thưởng daily check-in"**: `PUT …/challenge/users/{uid}/progresses/{progress_id}/reward` (progress_id lấy từ `progresses[i].id` có `status` claimable).
- **"Xem quà có thể claim"**: `GET …/delivery/users/{uid}/items/available`.
- **"Claim item"**: `PUT …/delivery/users/{uid}/items/{item_id}/claim`.
- **"Starter challenge (màn intro mới)"**: `GET https://forest-api.seekrtech.com/challenge/users/{uid}/progresses/new_user`.
- **"Ghi event progress"**: `POST …/challenge/users/{uid}/progresses/events` body `{"event_name": "...", "occurred_at": "..."}`.

## 5. Nguồn bằng chứng

- `analysis/smali/smali_classes3/cc/forestapp/feature/challenge/data/ChallengeApi.smali` — Retrofit `@GET/@PUT/@Path`.
- `analysis/smali/smali_classes3/cc/forestapp/feature/challenge/data/ChallengeRemoteDataSource.smali` — call-site `api.c/b/e`.
- `analysis/smali/smali_classes7/com/seekrtech/stforestkit/api/endpoints/microservices/ApiClientChallengeEndpoints$*$2$1.smali` — URLBuilder segments + Ktor `HttpMethod.Companion.c()` (GET) / `.f()` (POST).
- `analysis/smali/smali_classes4/cc/forestapp/network/config/Url$REST$PRODUCTION_SG.smali` → host `c88fef96.forestapp.cc`; `Url$Delivery$ProductionSG`, `Url$Users$ProductionSG`, `Url$Store$ProductionSG`, `Url$PLANT_SYNC$PRODUCTION_SG` → `forest-api.seekrtech.com`.
- `analysis/smali/smali_classes7/com/seekrtech/stforestkit/api/config/MicroServicesApiConfig.smali` → `https://forest-api.seekrtech.com`.
- `analysis/smali/smali_classes4/cc/forestapp/modules/RetrofitModuleKt.smali` — qualifier `"challenge"` inject Retrofit chung `app_http_client`.
