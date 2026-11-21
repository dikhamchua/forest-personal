# Hướng dẫn cài đặt & phụ lục

Áp dụng cho Brave / Chrome / Edge (Chromium, Manifest V3). Widget nổi chỉ chạy trên Windows.

## Mục lục

1. [Cài từ bản Release](#1-cài-từ-bản-release)
2. [Cài từ mã nguồn](#2-cài-từ-mã-nguồn)
3. [Đăng nhập và dùng lần đầu](#3-đăng-nhập-và-dùng-lần-đầu)
4. [Widget nổi (tuỳ chọn)](#4-widget-nổi-tuỳ-chọn)
5. [Auto-reload khi phát triển (tuỳ chọn)](#5-auto-reload-khi-phát-triển-tuỳ-chọn)
6. [Cập nhật phiên bản](#6-cập-nhật-phiên-bản)
- [Phụ lục A — Xử lý sự cố](#phụ-lục-a--xử-lý-sự-cố)
- [Phụ lục B — Quyền và lý do](#phụ-lục-b--quyền-và-lý-do)
- [Phụ lục C — Dữ liệu lưu ở đâu](#phụ-lục-c--dữ-liệu-lưu-ở-đâu)
- [Phụ lục D — Cổng và địa chỉ mạng](#phụ-lục-d--cổng-và-địa-chỉ-mạng)
- [Phụ lục E — Phím tắt và thao tác nhanh](#phụ-lục-e--phím-tắt-và-thao-tác-nhanh)
- [Phụ lục F — Câu hỏi thường gặp](#phụ-lục-f--câu-hỏi-thường-gặp)
- [Phụ lục G — Gỡ cài đặt](#phụ-lục-g--gỡ-cài-đặt)
- [Phụ lục H — Lịch sử phiên bản](#phụ-lục-h--lịch-sử-phiên-bản)

---

## 1. Cài từ bản Release

1. Vào trang [Releases](https://github.com/dikhamchua/forest-personal/releases), tải `forest-personal-vX.Y.Z.zip`.
2. **Giải nén** vào một thư mục cố định, ví dụ `C:\Tools\forest-personal`. Không xoá hay di chuyển thư mục này sau khi cài: trình duyệt đọc trực tiếp từ đó.
3. Mở `brave://extensions` (Chrome: `chrome://extensions`, Edge: `edge://extensions`).
4. Bật **Developer mode** (góc phải trên).
5. Bấm **Load unpacked**, chọn thư mục vừa giải nén (thư mục chứa `manifest.json`).
6. Ghim icon sprout lên thanh công cụ: biểu tượng mảnh ghép → ghim **Forest Personal**.

## 2. Cài từ mã nguồn

```bash
git clone https://github.com/dikhamchua/forest-personal.git
```

Sau đó làm từ bước 3 của mục 1, chọn thư mục `forest-personal` vừa clone. Không cần build.

## 3. Đăng nhập và dùng lần đầu

1. Bấm icon → bấm ⚙ (hoặc click cây) để mở **Options**.
2. Chọn vùng (Global / China), nhập email và mật khẩu tài khoản Forest, bấm **Đăng nhập**.
3. Extension tự tải danh sách cây, tag và lịch sử 30 ngày gần nhất.
4. Mở popup: chọn thời lượng, chọn cây (nút tên cây, có ô tìm kiếm), bấm cây tròn hoặc `+` để trồng.
5. (Khuyến nghị) Thiết lập **Thông báo Telegram**: mở Telegram → chat với `@BotFather` → `/newbot` → copy token; mở bot vừa tạo và bấm **Start**; trong Options dán token, bấm **Lấy chat ID**, **Lưu**, rồi **Gửi thử**.
6. (Tuỳ chọn) Bật **Thông báo hệ thống** (toast Windows) và chọn **Allow** khi Chrome hỏi quyền.

Lưu ý: tài khoản đăng nhập bằng Google/Facebook/Apple cần có mật khẩu Forest (đặt trong app Forest) vì extension chưa hỗ trợ đăng nhập mạng xã hội.

## 4. Widget nổi (tuỳ chọn)

Yêu cầu Windows 10/11 có Windows PowerShell 5.1 (có sẵn), không cần cài thêm gì.

1. Options → tick **Bật widget nổi trên các app khác** → **Allow** quyền localhost.
2. Giải nén Release (hoặc dùng bản clone), mở thư mục `float`.
3. Double-click `start-float.bat`. Widget hiện ở giữa màn hình, luôn nổi trên cửa sổ khác; kéo bằng vùng trống để di chuyển.
4. Tắt: bấm ✕ trên widget. Tiến trình bridge chạy nền, tắt bằng Task Manager (`powershell.exe` chạy `server.ps1`) hoặc đăng xuất Windows.

Muốn tự chạy cùng Windows: bấm `Win+R` → `shell:startup` → tạo shortcut tới `float\start-float.bat`.

## 5. Auto-reload khi phát triển (tuỳ chọn)

1. Load unpacked thêm thư mục `dev\reloader` (extension "Forest Personal Dev Reloader").
2. Cài Node.js, chạy `dev\start-reloader.bat`.
3. Sửa file nào trong repo (trừ `dev/`) thì Forest Personal tự nạp lại sau ~1 giây.

## 6. Cập nhật phiên bản

- **Từ Release:** giải nén bản mới đè lên thư mục cũ (giữ nguyên đường dẫn), rồi vào `brave://extensions` bấm nút **reload** ở card Forest Personal. Dữ liệu và phiên đăng nhập được giữ.
- **Từ git:** `git pull` rồi bấm reload như trên.
- Nếu bản mới thêm quyền, Chrome có thể tắt extension; bật lại và chấp nhận quyền.

---

## Phụ lục A — Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Popup/Options kẹt “Đang tải…” | Tab được mở trước khi reload extension (context cũ) | Đóng tab/popup, mở lại; nếu có nút Thử lại thì bấm |
| Banner “Service worker đang chạy code cũ” | Chưa reload sau khi cập nhật file | `brave://extensions` → reload card; vẫn lỗi thì gỡ rồi Load unpacked lại |
| Đăng nhập lỗi 403 | Sai email/mật khẩu, hoặc tài khoản chỉ dùng đăng nhập mạng xã hội | Kiểm tra mật khẩu Forest; vùng đúng (Global/China) |
| Đăng nhập lỗi 488 | Tài khoản cần chuyển vùng/khôi phục trong app Forest | Xử lý trong app Forest rồi thử lại |
| Cây đã trồng nhưng không lên server | Mất mạng hoặc phiên hết hạn | Options → **Sync ngay**; cây chờ sẽ có viền nét đứt trong Vườn cây |
| Extension tự tắt sau khi reload | Chrome tắt extension khi manifest thêm quyền mới | Vào `brave://extensions`, bật lại và chấp nhận quyền |
| Options báo “Chưa cấp quyền” | Quyền thông báo là tuỳ chọn, chưa được cho phép | Bấm **Gửi thử** (hoặc tick ô) và chọn **Allow** |
| Telegram “Unauthorized” | Token sai hoặc đã bị thu hồi | Lấy lại token ở @BotFather |
| Telegram “chat not found” / không lấy được chat ID | Chưa Start bot | Mở bot, bấm Start, gửi 1 tin rồi bấm Lấy chat ID |
| Không thấy toast Windows | Focus Assist / Không làm phiền đang bật, hoặc chưa cấp quyền | Tắt Focus Assist; bấm **Gửi thử** trong Options để xem lý do cụ thể; bật thông báo cho Brave trong Windows Settings |
| Chỉ thấy badge, không có toast | Thông báo hệ thống đang tắt | Bình thường, badge vàng độc lập với toast |
| Icon vẫn là chữ “F” | Chrome giữ icon cũ | Reload card; nếu vẫn thế, gỡ và Load unpacked lại |
| Widget không hiện số xu/cây | Bridge chưa chạy hoặc toggle chưa bật | Chạy lại `start-float.bat`; kiểm tra `http://127.0.0.1:35731/health` trả `{"ok":true}` |
| Widget hiện emoji thay vì ảnh cây | Không tải được ảnh (mạng/TLS) | Kiểm tra mạng; script đã bật TLS 1.2, thử lại sau vài giây |
| `start-float.bat` báo cổng đang dùng | Bridge cũ còn chạy | Task Manager → kết thúc `powershell.exe` đang chạy `server.ps1` |
| Trang web trong blocklist không bị chặn | Chặn đang tắt, hoặc whitelist rỗng | Options → bật chặn; whitelist chỉ hoạt động khi allowlist có ít nhất 1 domain |
| Vườn cây trống ở kỳ cũ | Chưa tải kỳ đó | Mở kỳ đó, extension tự tải; lỗi mạng sẽ hiện ở cuối trang |

## Phụ lục B — Quyền và lý do

| Quyền | Dùng để |
|---|---|
| `storage` | Lưu trạng thái, cài đặt, cache cây |
| `alarms` | Hẹn giờ kết thúc phiên trồng, kiểm tra widget định kỳ |
| `cookies` | Đọc/đặt lại cookie phiên `remember_token` của Forest |
| `declarativeNetRequest` | Chặn trang; gắn header `Origin` cho request API |
| `host_permissions` (4 host Forest + `<all_urls>`) | Gọi API Forest; chặn trang bất kỳ |
| `optional: notifications` | Toast khi cây lớn/chết (xin khi bật toggle) |
| `optional: http://127.0.0.1:35731/*` | Nói chuyện với widget nổi (xin khi bật toggle) |

Quyền tuỳ chọn không đặt trong `permissions` vì thêm quyền lúc reload khiến Chrome tắt extension.

## Phụ lục C — Dữ liệu lưu ở đâu

- Tất cả nằm trong `chrome.storage.local` của extension, key `fpState`: người dùng, tag, loại cây, cây chờ sync, cache lịch sử, blocklist, cờ bật/tắt.
- Phiên đăng nhập là cookie `remember_token` trên domain API của Forest; extension giữ thêm bản sao trong `fpState.user.rememberToken` để khôi phục khi cookie bị xoá.
- Widget dùng thư mục `%TEMP%\forest-float\` (`state.json`, `cmd.json`), chỉ chứa trạng thái hiển thị, không có mật khẩu.
- Không có telemetry. Dữ liệu chỉ gửi tới server Forest, CDN ảnh cây (`forest-ops-assets.seekrtech.com`) và, nếu bạn bật, `api.telegram.org`.
- Token bot Telegram lưu dạng văn bản thường trong `chrome.storage.local`; nếu nghi lộ, thu hồi bằng `/revoke` ở @BotFather.
- Xoá toàn bộ dữ liệu: Options → **Đăng xuất**, hoặc gỡ extension.

## Phụ lục D — Cổng và địa chỉ mạng

| Địa chỉ | Dùng cho |
|---|---|
| `https://c88fef96.forestapp.cc/api/v1` | API Forest vùng Global |
| `https://forest-china.upwardsware.com/api/v1` | API Forest vùng China |
| `https://auth.seekrtech.com`, `https://auth.upwardsware.com` | Refresh token OAuth |
| `https://forest-ops-assets.seekrtech.com` | Ảnh cây |
| `http://127.0.0.1:35731` | Bridge widget nổi (chỉ localhost) |
| `http://127.0.0.1:35730` | Watcher auto-reload (chỉ dev) |

Đổi cổng watcher: đặt biến môi trường `FP_RELOAD_PORT` và sửa `WATCHER_URL` trong `dev/reloader/background.js`.

## Phụ lục E — Phím tắt và thao tác nhanh

| Nơi | Thao tác |
|---|---|
| Popup | Click cây hoặc `+`: bắt đầu trồng với thời lượng và cây đang chọn |
| Popup | Bấm tên cây: mở danh sách chọn cây |
| Chọn cây | Gõ để lọc theo tên hoặc `#gid`; `Enter` chọn kết quả đầu; `Esc` đóng |
| Popup | Bấm `🌳 N` ở góc dưới: mở Vườn cây |
| Vườn cây | `‹` `›` đổi kỳ; tab Ngày/Tuần/Tháng/Năm |
| Widget | Kéo vùng trống để di chuyển; ⚙ mở Options; ✕ đóng |
| Toast | Bấm vào toast để mở Vườn cây |

## Phụ lục F — Câu hỏi thường gặp

**Có chạy cùng extension Forest gốc được không?** Được. Bản này không dùng ID của bản gốc; nó tự gắn `Origin` của bản gốc cho request API bằng rule DNR (chỉ áp cho request do chính nó tạo).

**Cây trồng ở đây có tính vào tài khoản Forest không?** Có, cây được ghi bằng `POST /plants` như extension gốc, xu do server cộng. Hãy dùng bằng tài khoản của bạn và cân nhắc rủi ro vì đây là bản không chính thức.

**Vì sao phải đặt thư mục cố định?** Chrome đọc trực tiếp thư mục unpacked; xoá hoặc đổi tên thì extension biến mất. Đổi đường dẫn thì Chrome coi là extension mới.

**Đóng trình duyệt giữa chừng có mất cây?** Phiên trồng (giờ bắt đầu/kết thúc) được lưu trong storage nên không mất khi service worker bị tạm dừng. Nếu đóng hẳn trình duyệt qua mốc kết thúc, extension hiện chưa có bước tự ghi nhận bù khi mở lại; hãy giữ trình duyệt mở trong lúc trồng.

**Phải để widget chạy không?** Không, chỉ là tiện ích. Tắt toggle trong Options thì extension ngừng poll.

**Có hỗ trợ Firefox/Safari?** Chưa. Dùng API Chromium (`declarativeNetRequest`, `chrome.action`).

**Đăng nhập Google/Facebook?** Chưa. Cần luồng PKCE với `auth.seekrtech.com`.

## Phụ lục G — Gỡ cài đặt

1. `brave://extensions` → **Remove** ở Forest Personal (và Dev Reloader nếu có).
2. Widget: đóng cửa sổ, kết thúc tiến trình `powershell.exe` chạy `server.ps1`, xoá shortcut trong `shell:startup` nếu đã tạo.
3. Xoá thư mục `%TEMP%\forest-float` và thư mục extension.

## Phụ lục H — Lịch sử phiên bản

| Phiên bản | Nội dung chính |
|---|---|
| 0.8.0 | Thông báo Telegram (bot), toast hệ thống chuyển thành tuỳ chọn |
| 0.7.4 | Nhớ thời lượng đã chọn (không về 25′), popup cảnh báo khi thông báo không gửi được, ghi lại kết quả lần gửi gần nhất |
| 0.7.3 | Sửa thông báo: trạng thái phản ánh quyền thật, nút Gửi thử, chẩn đoán lý do |
| 0.7.2 | Badge vàng trên icon khi hoàn thành |
| 0.7.1 | Quyền `notifications` chuyển sang tuỳ chọn |
| 0.7.0 | Thông báo hệ thống khi cây lớn/chết |
| 0.6.2 | Thêm mốc 30 phút |
| 0.6.1 | Icon mới cho extension và Dev Reloader |
| 0.6.0 | Vườn cây dạng Overview (Ngày/Tuần/Tháng/Năm, plot isometric, biểu đồ) |
| 0.5.0 | Trang Vườn cây đầu tiên |
| 0.4.x | Widget nổi, chọn cây có ảnh, thanh tìm kiếm |
| 0.3.x | Dùng đúng API và xác thực cookie của Forest, rule Origin |
| 0.2.0 | Đăng nhập, trồng cây, chặn trang, sync |
