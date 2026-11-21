/* Số build dùng chung. Background gửi giá trị nó đã nạp, các trang so với giá trị đọc từ
   file hiện tại: lệch nghĩa là service worker chưa được reload sau khi cập nhật file.
   Tăng số này mỗi khi thêm/đổi lệnh message. */
export const BUILD = 6;
