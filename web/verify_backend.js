// CAST LIGHT 后端集成验证（node web/verify_backend.js）
// 覆盖：在线数据源 / 提交→pending / 审核通过→自动入库 / 拒绝不写入 / 前端可见 / 匿名隔离
// 前置：PocketBase 已在 http://127.0.0.1:8090 运行（start_all.bat），且已导入数据
//       （首次需 python import_pocketbase.py）。未运行时本脚本自动跳过。
// 管理员账号从环境变量读取：PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD（默认 admin@test.local / test1234）
let chromium;
try { chromium = require("playwright").chromium; }
catch (e) {
  chromium = require("C:/Users/Hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright").chromium;
}
const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const FILE_URL = "file:///E:/AI%20VibeCoding%20Project/MusicGraph/web/index.html";
const PB = "http://127.0.0.1:8090";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || "admin@test.local";
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || "test1234";

const TEST_ACTOR = "\u5728\u7ebf\u6d4b\u8bd5\u6f14\u5458";        // 在线测试演员
const TEST_TITLE = "\u300a\u7efc\u5408\u68c0\u9a8c\u300b\u6f14\u5531\u7247\u6bb5";  // 《综合检验》演唱片段
const TEST_URL = "https://bilibili.com/video/BVverifybackend" + Date.now();
const REJECT_ACTOR = "\u62d2\u7edd\u6d4b\u8bd5\u6f14\u5458";      // 拒绝测试演员
const OK_STR = "\u63d0\u4ea4\u6210\u529f";

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  [PASS] " + name); }
  else { failed++; console.log("  [FAIL] " + name + (extra ? " -> " + extra : "")); }
}

async function pb(method, path, body, token) {
  const r = await fetch(PB + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
}

(async () => {
  // 0) 探测后端是否运行
  let health;
  try {
    const r = await fetch(PB + "/api/health", { signal: AbortSignal.timeout(1500) });
    health = r.status;
  } catch (e) { health = 0; }
  if (health !== 200) {
    console.log("PocketBase 未运行（" + PB + "），跳过后端验证。请先运行 start_all.bat。");
    process.exit(0);
  }
  const admin = await pb("POST", "/api/collections/_superusers/auth-with-password", { identity: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (admin.status !== 200) {
    console.log("管理员登录失败：请检查 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD");
    process.exit(1);
  }
  const token = admin.json.token;
  console.log("后端已连接，开始验证...");

  const exe = CHROME_CANDIDATES.find(p => require("fs").existsSync(p));
  if (!exe) { console.log("未找到 Chrome/Edge，无法验证。"); process.exit(1); }
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));

  // 1) 在线数据源
  await page.goto(FILE_URL + "?v=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(9000);
  const mode = await page.evaluate(() => window.MG_DATA_MODE);
  check("在线数据源 (MG_DATA_MODE=api)", mode === "api", "mode=" + mode);
  const actorN = await page.evaluate(() => Object.keys(window.MUSIC_GRAPH.actors).length);
  check("演员数据来自后端", actorN > 4000, "n=" + actorN);

  // 2) Contribute 提交精彩片段（走 UI）
  await page.goto(FILE_URL + "#/contribute", { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.selectOption("#c-category", "moment");
  await page.waitForTimeout(300);
  await page.fill("#c-moment input[name=actorName]", TEST_ACTOR);
  await page.fill("#c-moment input[name=title]", TEST_TITLE);
  await page.fill("#c-moment input[name=url]", TEST_URL);
  await page.selectOption("#c-moment select[name=platform]", "bilibili");
  await page.fill("#c-ref", "https://example.com/verify-src");
  await page.click("#contribute-form button[type=submit]");
  await page.waitForTimeout(1500);
  const toast = await page.evaluate(() => document.getElementById("toast").textContent);
  check("提交成功提示", toast.indexOf(OK_STR) >= 0, "toast=" + toast);

  // 3) 服务端：submissions pending + 结构化字段
  const qs = "perPage=100&filter=" + encodeURIComponent("url='" + TEST_URL + "'");
  const subs = await pb("GET", "/api/collections/submissions/records?" + qs, null, token);
  const mySub = (subs.json.items || []).find(s => s.title === TEST_TITLE);
  check("submissions 收到提交", !!mySub);
  check("提交为 pending 且字段结构化",
    mySub && mySub.status === "pending" && mySub.actor_a === TEST_ACTOR && mySub.platform === "bilibili");
  const subId = mySub ? mySub.id : null;

  // 4) 审核通过 -> 自动写入 moments + 占位演员
  const upd = await pb("PATCH", "/api/collections/submissions/records/" + subId, { status: "approved" }, token);
  check("审核通过 applied=true", upd.json && upd.json.applied === true, upd.status);
  const moms = await pb("GET", "/api/collections/moments/records?perPage=100&filter=" + encodeURIComponent("url='" + TEST_URL + "'"), null, token);
  const mom = (moms.json.items || []).find(m => m.url === TEST_URL);
  check("moment 自动写入", !!mom);
  const actorRow = await pb("GET", "/api/collections/actors/records?perPage=100&filter=" + encodeURIComponent("name='" + TEST_ACTOR + "'"), null, token);
  check("缺失演员自动创建占位档案", (actorRow.json.items || []).length >= 1);

  // 5) 拒绝 -> 不写正式数据
  const rej = await pb("POST", "/api/collections/submissions/records", {
    submission_type: "relation_update", actor_a: REJECT_ACTOR,
    actor_b: "\u62d2\u7edd\u6d4b\u8bd5\u6f14\u5458B", relation_type: "co_work",
    source_url: "https://example.com/reject",
  });
  const rejUpd = await pb("PATCH", "/api/collections/submissions/records/" + rej.json.id, { status: "rejected" }, token);
  check("拒绝后 status=rejected", rejUpd.json && rejUpd.json.status === "rejected");
  const rejActors = await pb("GET", "/api/collections/actors/records?perPage=100&filter=" + encodeURIComponent("name='" + REJECT_ACTOR + "'"), null, token);
  check("拒绝不创建任何数据", (rejActors.json.items || []).length === 0);

  // 6) 匿名读 submissions 为空、匿名可读正式数据
  const anonSubs = await pb("GET", "/api/collections/submissions/records?perPage=100", null, null);
  check("匿名看不到提交列表", anonSubs.json && anonSubs.json.totalItems === 0);
  const anonActors = await pb("GET", "/api/collections/actors/records?perPage=1", null, null);
  check("匿名可读正式数据", anonActors.json && anonActors.json.totalItems > 4000);

  // 7) 刷新页面 -> 新片段前端可见
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(9000);
  const actorId = await page.evaluate((name) => {
    const a = window.MUSIC_GRAPH.actors;
    for (const k in a) if (a[k].name === name) return k;
    return null;
  }, TEST_ACTOR);
  check("刷新后新演员进入图谱", !!actorId);
  if (actorId) {
    await page.goto(FILE_URL + "#/actor/" + actorId, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    const titles = await page.$$eval("#ap-moments .mom-title", els => els.map(e => e.textContent));
    check("新精彩片段展示在详情页", titles.indexOf(TEST_TITLE) >= 0, JSON.stringify(titles));
  }

  // 8) 清理测试数据
  try {
    if (mom) await pb("DELETE", "/api/collections/moments/records/" + mom.id, null, token);
    if (subId) await pb("DELETE", "/api/collections/submissions/records/" + subId, null, token);
    if (actorRow.json && actorRow.json.items[0]) await pb("DELETE", "/api/collections/actors/records/" + actorRow.json.items[0].id, null, token);
    if (rej.json && rej.json.id) await pb("DELETE", "/api/collections/submissions/records/" + rej.json.id, null, token);
    console.log("  [OK] 测试数据已清理");
  } catch (e) { console.log("  [WARN] 清理失败: " + e.message); }

  console.log("JS errors:", errors.length ? errors : "none");
  console.log("结果: " + passed + " 通过, " + failed + " 失败");
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
