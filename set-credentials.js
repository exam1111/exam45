/* تشغيل: node set-credentials.js — لإنشاء/تغيير اليوزر نيم وكلمة المرور داخل .env */
const readline = require("readline");
const { loadEnv, saveEnv, buildCredentialValues } = require("./credentials");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q, hidden) {
  return new Promise((resolve) => {
    if (hidden) {
      const orig = rl._writeToOutput;
      rl._writeToOutput = (s) => { if (s.includes(q)) orig.call(rl, s); };
      rl.question(q, (a) => { rl._writeToOutput = orig; process.stdout.write("\n"); resolve(a); });
    } else rl.question(q, resolve);
  });
}
(async () => {
  const user = (await ask("اسم المستخدم الجديد: ")).trim();
  const pass = await ask("كلمة المرور الجديدة: ", true);
  rl.close();
  if (!user || pass.length < 6) { console.error("اسم المستخدم مطلوب وكلمة المرور 6 أحرف على الأقل."); process.exit(1); }
  saveEnv(buildCredentialValues(user, pass, { PORT: loadEnv().PORT }));
  console.log("تم الحفظ في .env (مشفّرة).");
})();
