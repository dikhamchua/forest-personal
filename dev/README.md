# Dev auto-reload

Sửa file là extension tự nạp lại code — không cần bấm reload ở `brave://extensions`.

Cơ chế giống `Desktop\extension\dev`: một **helper extension** có quyền `management`
bật/tắt extension Forest Personal khi `node dev\watch.js` báo có file đổi.

## Cài một lần

1. `brave://extensions` → bật Developer mode → **Load unpacked** → chọn
   `forest-personal\dev\reloader`. Extension này tên **Forest Personal Dev Reloader**,
   cần quyền "Manage your apps, extensions, and themes" (chỉ để reload khi dev).
2. Chạy watcher: double-click `dev\start-reloader.bat` (hoặc `node dev\watch.js`).
   Cửa sổ console in `Reloader server: http://127.0.0.1:35730`.

Từ đó: lưu bất kỳ file nào trong `forest-personal` (trừ `dev/`) → sau ~1 giây
Forest Personal được tắt/bật lại → service worker và popup/options dùng code mới.
Tab Options đang mở nên đóng/mở lại (Chrome không tự reload trang extension).

## Tuỳ chỉnh

- Đổi port: đặt biến môi trường `FP_RELOAD_PORT` **và** sửa `WATCHER_URL` trong
  `dev/reloader/background.js` cho khớp.
- Target được tìm theo tên `Forest Personal` và chỉ lấy bản unpacked
  (`installType: "development"`), nên Forest gốc cài từ store không bao giờ bị tắt.

## Kiểm tra nhanh

```bash
curl http://127.0.0.1:35730/health     # {"ok":true,"version":N}
curl http://127.0.0.1:35730/check      # {"version":N,"changedAt":"...","files":[...]}
```

Sửa một file rồi gọi `/check` lần nữa — `version` phải tăng.

## Đóng gói

Xoá thư mục `dev/` khỏi bản phát hành; nó không ảnh hưởng extension chính.
