/* Watcher cho Forest Personal.
 *
 * Theo dõi toàn bộ thư mục extension; mỗi lần file nguồn đổi thì tăng version.
 * Helper extension ở dev/reloader/ poll http://127.0.0.1:35730/check và
 * bật/tắt extension Forest Personal để Chrome nạp lại code.
 *
 * Chạy:  node dev\watch.js   (hoặc double-click dev\start-reloader.bat)
 * Port:  đổi bằng biến môi trường FP_RELOAD_PORT.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.FP_RELOAD_PORT || 35730);
const ignoredPath = /(^|[\\/])(dev|node_modules|\.git)([\\/]|$)/;
const ignoredFile = /\.(zip|crx|pem|log|tmp|swp|map)$/i;

let version = 0;
let changedAt = new Date().toISOString();
let changedFiles = [];
let pendingTimer = null;
const pendingFiles = new Set();

function isIgnored(filename) {
  const normalized = String(filename || "").replace(/\\/g, "/");
  if (!normalized) return true;
  if (ignoredPath.test(normalized)) return true;
  if (ignoredFile.test(normalized)) return true;
  return false;
}

function notify(filename) {
  if (isIgnored(filename)) return;
  pendingFiles.add(filename || "(unknown)");
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    version += 1;
    changedAt = new Date().toISOString();
    changedFiles = Array.from(pendingFiles).slice(-10);
    pendingFiles.clear();
    pendingTimer = null;
    console.log("[" + version + "] " + changedFiles.join(", "));
  }, 180);
}

let watcher = null;
try {
  watcher = fs.watch(root, { recursive: true }, (_event, filename) => notify(filename));
  console.log("Đang theo dõi thay đổi trong: " + root);
} catch (error) {
  console.warn("Không dùng được recursive watch (" + error.message + "), theo dõi từng file chính.");
  for (const file of ["manifest.json", "background.js", "api.js", "storage.js", "popup.js", "options.js", "popup.html", "options.html", "blocked.html"]) {
    fs.watchFile(path.join(root, file), { interval: 400 }, () => notify(file));
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/check") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ version, changedAt, files: changedFiles }));
    return;
  }
  if (url.pathname === "/health") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, version }));
    return;
  }
  response.statusCode = 404;
  response.end("not found");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("Port " + port + " đang được dùng. Tắt tiến trình cũ hoặc đặt FP_RELOAD_PORT.");
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log("Reloader server: http://127.0.0.1:" + port);
  console.log("Nhớ Load unpacked thư mục dev\\reloader một lần trong brave://extensions");
  console.log("Đang chờ thay đổi file...");
});

process.on("SIGINT", () => {
  try {
    if (watcher) watcher.close();
    server.close();
  } finally {
    process.exit(0);
  }
});
