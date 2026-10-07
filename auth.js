/* مصادقة الأستاذ تتم على الخادم (server.js). بيانات الدخول في ملف .env على الخادم فقط،
   والمتصفح لا يحتوي على أي اسم مستخدم أو كلمة مرور أو هاش. الجلسة في كوكي HttpOnly لا تقرؤها الجافاسكربت. */
const STUDENT_SESSION_KEY = "exam_student_session";
const TEACHER_NAME_KEY = "exam_teacher_name";

async function _api(path, options) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}
function _post(path, body) {
  return _api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}
async function _isTeacherLoggedIn() {
  try { return !!(await _api("/api/session")).data.loggedIn; } catch { return false; }
}
function _teacherName() { return localStorage.getItem(TEACHER_NAME_KEY) || "الأستاذ"; }

const auth = {
  currentUser: null,
  async onAuthStateChanged(callback) {
    const studentUid = localStorage.getItem(STUDENT_SESSION_KEY);
    if (await _isTeacherLoggedIn()) {
      this.currentUser = { uid: "teacher-local-1", isAnonymous: false };
    } else if (studentUid) {
      this.currentUser = { uid: studentUid, isAnonymous: true };
    } else {
      this.currentUser = null;
    }
    if (typeof callback === "function") callback(this.currentUser);
    return () => {};
  }
};

async function teacherLogin(username, password) {
  let r;
  try { r = await _post("/api/login", { username, password }); }
  catch { throw { code: "network", message: "تعذر الاتصال بالخادم. تأكد من تشغيل server.js." }; }
  if (!r.ok) throw { code: "auth/wrong-password", message: r.data.message || "اسم المستخدم أو كلمة المرور غير صحيحة." };
  auth.currentUser = { uid: "teacher-local-1", isAnonymous: false };
  return { uid: "teacher-local-1", name: _teacherName() };
}
async function teacherLogout() {
  try { await _post("/api/logout"); } catch {}
  window.location.href = "teacher-login.html";
}
function changeTeacherDisplayName(newName) {
  localStorage.setItem(TEACHER_NAME_KEY, newName);
}
async function changeTeacherPassword(currentPassword, newPassword) {
  const r = await _post("/api/change-password", { currentPassword, newPassword });
  if (!r.ok) throw { code: "auth/wrong-password", message: r.data.message || "تعذر تغيير كلمة المرور." };
}
async function guardTeacherPage(onReady) {
  if (!(await _isTeacherLoggedIn())) {
    window.location.href = "teacher-login.html";
    return;
  }
  onReady({ uid: "teacher-local-1", name: _teacherName() });
}
/* ---------- هوية الجهاز (تُخزَّن في 3 أماكن حتى لا يكفي مسح واحد منها) ----------
   معرّف الطالب = معرّف الجهاز/المتصفح، وهو مفتاح المحاولة (امتحان + معرّف).
   لذلك لا يفيد تغيير الاسم في الدخول مرة ثانية بعد التسليم. */
const DEVICE_COOKIE = "exam_device_id";

function _cookieGet(name) {
  try {
    const row = document.cookie.split("; ").find((r) => r.startsWith(name + "="));
    return row ? decodeURIComponent(row.slice(name.length + 1)) : null;
  } catch { return null; }
}
function _cookieSet(name, value) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${60 * 60 * 24 * 365 * 3}; path=/; SameSite=Lax`;
  } catch {}
}
function _idbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("no-idb"));
    const req = indexedDB.open("exam_device_db", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function _withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((res) => setTimeout(() => res(null), ms))]);
}
async function _idbGet(key) {
  try {
    const d = await _idbOpen();
    return await new Promise((res) => {
      const r = d.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}
async function _idbSet(key, val) {
  try {
    const d = await _idbOpen();
    await new Promise((res) => {
      const tx = d.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = tx.onerror = tx.onabort = () => res();
    });
  } catch {}
}

async function ensureStudentSession() {
  let uid = null;
  try { uid = localStorage.getItem(STUDENT_SESSION_KEY); } catch {}
  if (!uid) uid = _cookieGet(DEVICE_COOKIE);
  if (!uid) uid = await _withTimeout(_idbGet(STUDENT_SESSION_KEY), 1500);
  if (!uid) uid = "student-" + simpleId();
  // أعد كتابة المعرّف في كل الأماكن (يستعيد ما تم مسحه منها)
  try { localStorage.setItem(STUDENT_SESSION_KEY, uid); } catch {}
  _cookieSet(DEVICE_COOKIE, uid);
  await _withTimeout(_idbSet(STUDENT_SESSION_KEY, uid), 1500);
  auth.currentUser = { uid, isAnonymous: true };
  return { uid, isAnonymous: true };
}
function upsertStudentProfile(uid, fullName) {
  return db.collection(COLLECTIONS.STUDENTS).doc(uid).set({ fullName, lastSeenAt: serverTimestamp() }, {merge:true});
}
function guardStudentSession() { return ensureStudentSession(); }
