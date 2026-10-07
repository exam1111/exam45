/* إدارة بيانات دخول الأستاذ المخزّنة في ملف .env (كهاش scrypt + salt، بدون نص صريح). */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENV_PATH = path.join(__dirname, ".env");

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
/* يقرأ من ملف .env إن وُجد، وإلا من متغيرات البيئة (مثل إعدادات Render/Railway). */
const KEYS = ["PORT", "TEACHER_USER_SALT", "TEACHER_USER_HASH", "TEACHER_PASS_SALT", "TEACHER_PASS_HASH"];
function loadEnv() {
  const fromFile = fs.existsSync(ENV_PATH) ? parseEnv(fs.readFileSync(ENV_PATH, "utf8")) : {};
  const out = {};
  for (const k of KEYS) { const v = fromFile[k] || process.env[k]; if (v) out[k] = v; }
  return out;
}
function saveEnv(values) {
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.writeFileSync(ENV_PATH, body, { mode: 0o600 });
}
function hashText(text, saltHex) {
  return crypto.scryptSync(String(text), Buffer.from(saltHex, "hex"), 32).toString("hex");
}
function safeEqualHex(a, b) {
  const x = Buffer.from(a || "", "hex"), y = Buffer.from(b || "", "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const normUser = (u) => String(u).trim().toLowerCase();

function buildCredentialValues(username, password, extra = {}) {
  const userSalt = crypto.randomBytes(16).toString("hex");
  const passSalt = crypto.randomBytes(16).toString("hex");
  return {
    PORT: extra.PORT || "3000",
    TEACHER_USER_SALT: userSalt,
    TEACHER_USER_HASH: hashText(normUser(username), userSalt),
    TEACHER_PASS_SALT: passSalt,
    TEACHER_PASS_HASH: hashText(password, passSalt),
  };
}
function verifyLogin(env, username, password) {
  const userOk = safeEqualHex(hashText(normUser(username), env.TEACHER_USER_SALT), env.TEACHER_USER_HASH);
  const passOk = safeEqualHex(hashText(password, env.TEACHER_PASS_SALT), env.TEACHER_PASS_HASH);
  return userOk && passOk; // الاثنان يُحسبان دائمًا لمنع كشف أيهما الخطأ
}
function verifyPassword(env, password) {
  return safeEqualHex(hashText(password, env.TEACHER_PASS_SALT), env.TEACHER_PASS_HASH);
}
function updatePassword(newPassword) {
  const env = loadEnv();
  env.TEACHER_PASS_SALT = crypto.randomBytes(16).toString("hex");
  env.TEACHER_PASS_HASH = hashText(newPassword, env.TEACHER_PASS_SALT);
  saveEnv(env);
  return env;
}
module.exports = { loadEnv, saveEnv, buildCredentialValues, verifyLogin, verifyPassword, updatePassword };
