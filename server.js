/* خادم صغير بدون مكتبات: يقدّم ملفات الموقع ويتحقق من دخول الأستاذ من جهة الخادم.
   بيانات الدخول في .env ولا تصل للمتصفح أبدًا. التشغيل: node server.js */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadEnv, verifyLogin, verifyPassword, updatePassword } = require("./credentials");

const ROOT = __dirname;
const PRIVATE_FILES = new Set(["server.js", "credentials.js", "set-credentials.js", "package.json", "package-lock.json", "env.example"]);
const env = loadEnv();
if (!env.TEACHER_USER_HASH || !env.TEACHER_PASS_HASH) {
  console.error("ملف .env غير موجود أو ناقص. شغّل: node set-credentials.js");
  process.exit(1);
}
const PORT = Number(process.env.PORT || env.PORT || 3000);
const COOKIE = "exam_teacher_sid";
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();           // token -> expiry
const failures = new Map();           // ip -> { count, until }
const PROTECTED_PAGES = new Set(["/teacher-dashboard.html", "/create-exam.html", "/results.html"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function sessionToken(req) {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + COOKIE + "=([a-f0-9]+)"));
  return m ? m[1] : null;
}
function isLoggedIn(req) {
  const t = sessionToken(req);
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function setCookie(res, token, maxAgeSec) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`);
}
function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 10_000) { reject(new Error("big")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("bad json")); } });
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/session") return json(res, 200, { loggedIn: isLoggedIn(req) });
  if (req.method !== "POST" || !(req.headers["content-type"] || "").startsWith("application/json"))
    return json(res, 405, { error: "method" });
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: "bad request" }); }
  const ip = req.socket.remoteAddress || "?";

  if (pathname === "/api/login") {
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return json(res, 429, { error: "locked", message: "محاولات كثيرة. حاول بعد قليل." });
    const ok = typeof body.username === "string" && typeof body.password === "string" && verifyLogin(env, body.username, body.password);
    if (!ok) {
      const c = (f && f.until <= Date.now() ? 0 : f?.count || 0) + 1;
      failures.set(ip, { count: c, until: c >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
      return json(res, 401, { error: "wrong", message: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    setCookie(res, token, SESSION_MS / 1000);
    return json(res, 200, { ok: true });
  }
  if (pathname === "/api/logout") {
    const t = sessionToken(req); if (t) sessions.delete(t);
    setCookie(res, "", 0);
    return json(res, 200, { ok: true });
  }
  if (pathname === "/api/change-password") {
    if (!isLoggedIn(req)) return json(res, 401, { error: "auth" });
    const { currentPassword, newPassword } = body;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 6)
      return json(res, 400, { error: "invalid", message: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف." });
    if (!verifyPassword(env, currentPassword)) return json(res, 401, { error: "wrong", message: "كلمة المرور الحالية غير صحيحة." });
    Object.assign(env, updatePassword(newPassword));
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "not found" });
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === "/") rel = "/index.html";
  const segs = rel.split("/").filter(Boolean);
  const blocked = segs.some((s) => s.startsWith(".") || s === "node_modules" || PRIVATE_FILES.has(s));
  const full = path.join(ROOT, rel);
  const ext = path.extname(full).toLowerCase();
  if (blocked || !full.startsWith(ROOT + path.sep) || !TYPES[ext]) { res.writeHead(404); return res.end("Not found"); }
  if (PROTECTED_PAGES.has(rel) && !isLoggedIn(req)) { res.writeHead(302, { Location: "/teacher-login.html" }); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[ext], "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
      "Cache-Control": PROTECTED_PAGES.has(rel) ? "no-store" : "no-cache" });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://x").pathname;
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname).catch(() => json(res, 500, { error: "server" }));
  serveStatic(req, res, pathname);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
