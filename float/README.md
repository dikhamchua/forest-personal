# Widget nổi (always-on-top)

Cửa sổ Forest luôn nổi trên các app khác. Không phải cửa sổ trình duyệt — là app
WPF riêng, nên không bị thu nhỏ khi chuyển app.

## Chạy

1. `brave://extensions` → Options → bật **"Bật widget nổi trên các app khác"**
   (extension bắt đầu poll `127.0.0.1:35731`).
2. Double-click `float\start-float.bat`:
   - `server.ps1` chạy ẩn, mở HTTP bridge ở `127.0.0.1:35731`.
   - `ForestFloat.ps1` mở widget trong suốt, `Topmost=True`, kéo được bằng chuột.

Nút trên widget: `⚙` mở Options, `✕` đóng, các chip 10–60 chọn thời lượng,
`Start` trồng cây, `Give up` bỏ cuộc (cây chết).

## Cơ chế

```
Widget (WPF)  --cmd.json-->  server.ps1  <--GET /poll--  extension (SW, 1s)
Widget        <--state.json-- server.ps1  <--POST /state-- extension
```

- Trạng thái đẩy sang: `{ id, loggedIn, coin, blockEnabled, planting{endTime,durationMin,tagTitle,treeTitle,treeImage}, lastReward }`.
  Widget hiển thị `phase - tên cây` và tải `treeImage` (PNG trong suốt từ
  forest-ops-assets.seekrtech.com); lỗi tải thì quay về emoji theo phase.
  Cần TLS 1.2 — script đã set `ServicePointManager.SecurityProtocol`.
- Lệnh nhận: `start` (kèm `duration`), `giveup`, `open-options`.
- File trao đổi nằm ở `%TEMP%\forest-float\`.
- Extension chỉ poll khi bật toggle; alarm 1 phút khởi động lại poll nếu service worker ngủ.
