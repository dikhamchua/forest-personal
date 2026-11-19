/* Trang chặn: không dùng inline script (CSP MV3). */
document.getElementById("back").addEventListener("click", () => {
  if (history.length > 1) history.back();
  else window.close();
});
