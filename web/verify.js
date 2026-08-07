// MusicGraph 前端一键回归验证（需本机 Chrome + playwright 本地模块）
// 用法：node web/verify.js
// 自动检查：数据加载 / 首页统计 / 搜索进入演员详情页 / 常共演无"自己"(多人) / 详情页互相跳转 /
//          返回首页 / 作品 / 团体 / 类型筛选 / hash 直达详情页 / 无JS错误
// playwright 优先用项目 node_modules，找不到则回退到 Codex 运行时内置路径
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

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  [PASS] " + name); }
  else { failed++; console.log("  [FAIL] " + name + (extra ? "  -> " + extra : "")); }
}

(async () => {
  const exe = CHROME_CANDIDATES.find(p => require("fs").existsSync(p));
  if (!exe) { console.log("未找到 Chrome/Edge，无法验证。"); process.exit(1); }

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(FILE_URL + "?v=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(3000);

  async function openActor(name) {
    await page.fill("#search", name);
    await page.waitForTimeout(400);
    await page.click("#dropdown .item:first-child");
    await page.waitForTimeout(800);
  }

  console.log("== 数据加载 ==");
  check("数据已加载", await page.evaluate(() => !!window.MUSIC_GRAPH && Object.keys(window.MUSIC_GRAPH.actors).length > 1000));

  console.log("== 首页 ==");
  const stats = await page.textContent("#stats");
  check("图谱统计显示", /节点/.test(stats), stats);
  check("热门演员入口", await page.$$eval("#hot-chips .chip", els => els.length) >= 5);
  const legendTexts = await page.$$eval(".lg[data-type]", els => els.map(e => e.textContent));
  check("伴侣/情侣/前任三标签图例", ["伴侣", "情侣", "前任"].every(x => legendTexts.includes(x)), legendTexts.join(","));

  console.log("== 搜索演员 -> 详情页 ==");
  await openActor("郑云龙");
  check("详情页打开", await page.$eval("#actor-view", el => !el.classList.contains("hidden")));
  check("详情页姓名", (await page.textContent("#ap-name")) === "郑云龙", await page.textContent("#ap-name"));
  check("关系列表有内容", await page.$$eval("#ap-relations li", els => els.length) >= 1);
  check("常共演有内容", await page.$$eval("#ap-cowork li", els => els.length) >= 1);
  const hasSelf1 = await page.$$eval("#ap-cowork li", els => els.some(e => e.textContent.startsWith("郑云龙共演")));
  check("常共演无自己", !hasSelf1);
  const rolesInMusicals = await page.$$eval("#ap-musicals li", els => els.filter(e => /（/.test(e.textContent)).length);
  check("参演剧目带角色", rolesInMusicals >= 1, "含角色条目数=" + rolesInMusicals);
  const apCount = await page.evaluate(() => window.__apNodeCount || 0);
  check("关系图渲染", apCount > 5, "节点数=" + apCount);

  console.log("== 多人常共演无自己 ==");
  const names = ["许昌泰", "郑棋元", "金圣权", "毛二", "张泽", "汤佳明", "阿云嘎", "刘令飞"];
  const selfBad = [];
  for (const n of names) {
    await openActor(n);
    const bad = await page.$$eval("#ap-cowork li", (els, nm) => els.some(e => e.textContent.startsWith(nm + "共演")), n);
    if (bad) selfBad.push(n);
  }
  check("8人共演列表均无自己", selfBad.length === 0, "出现自己的人: " + selfBad.join("、"));

  console.log("== 详情页互相跳转 ==");
  const nameBefore = await page.textContent("#ap-name");
  await page.click("#ap-cowork li:first-child span.c");
  await page.waitForTimeout(800);
  const nameAfter = await page.textContent("#ap-name");
  check("点击搭档跳到对方详情页", nameAfter !== nameBefore, nameBefore + " -> " + nameAfter);

  console.log("== 演员页关系图节点点击 ==");
  {
    const prevHash = await page.evaluate(() => location.hash);
    const apIds = await page.evaluate(() => {
      const ns = window.__apNodes ? window.__apNodes() : {};
      const cid = window.__apCenterId ? window.__apCenterId() : null;
      return Object.keys(ns).filter(k => k !== cid);
    });
    let apClicked = false;
    for (const aid of apIds.slice(0, 25)) {
      const pos = await page.evaluate((i) => window.__apNodeScreen(i), aid);
      if (!pos) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(700);
      const hash = await page.evaluate(() => location.hash);
      if (hash === "#/actor/" + aid) { apClicked = true; break; }
      await page.evaluate((h) => { location.hash = h; }, prevHash);
      await page.waitForTimeout(600);
    }
    check("演员页关系图点击人物跳转", apClicked, "前25个节点均未跳转");
  }

  console.log("== 返回首页 ==");
  await page.click("#ap-back");
  await page.waitForTimeout(600);
  check("返回图谱首页", await page.$eval("#home-view", el => !el.classList.contains("hidden")));

  console.log("== 首页节点点击跳转 ==");
  {
    const rect = await page.evaluate(() => {
      const r = document.getElementById("graph").getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
    const ids = await page.evaluate(() => (window.__homeNodeIds ? window.__homeNodeIds() : []).slice(0, 40));
    let homeClicked = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      if (pos.x < rect.l + 5 || pos.x > rect.r - 5 || pos.y < rect.t + 5 || pos.y > rect.b - 5) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(700);
      const hash = await page.evaluate(() => location.hash);
      if (hash === "#/actor/" + id) { homeClicked = true; break; }
      await page.evaluate(() => { location.hash = "#/"; });
      await page.waitForTimeout(600);
    }
    check("首页点击人物进入详情页", homeClicked);
  }

  console.log("== 作品 ==");
  await page.fill("#search", "哈姆雷特");
  await page.waitForTimeout(400);
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(500);
  check("作品演员表", await page.$$eval("#p-cast li", els => els.length) >= 5);
  const castWithRole = await page.$$eval("#p-cast li", els => els.filter(e => /（/.test(e.textContent)).length);
  check("作品演员表带角色", castWithRole >= 3, "带角色条目数=" + castWithRole);

  console.log("== 团体 ==");
  await page.fill("#search", "中戏17");
  await page.waitForTimeout(400);
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(500);
  check("团体成员", await page.$$eval("#p-cast li", els => els.length) >= 3);

  console.log("== 类型筛选 ==");
  await page.click('.lg[data-type="cp"]');
  await page.waitForTimeout(500);
  const stats2 = await page.textContent("#stats");
  check("类型筛选生效", stats2 !== stats, stats2);

  console.log("== hash 直达详情页 ==");
  const zlyId = await page.evaluate(() => {
    const a = window.MUSIC_GRAPH.actors;
    for (const k in a) if (a[k].name === "郑云龙") return k;
    return null;
  });
  if (zlyId) {
    await page.goto(FILE_URL + "#/actor/" + zlyId, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const okName = (await page.textContent("#ap-name")) === "郑云龙";
    const okView = await page.$eval("#actor-view", el => !el.classList.contains("hidden"));
    check("直达详情页", okName && okView, "name=" + await page.textContent("#ap-name"));
  } else {
    check("直达详情页", false, "未找到郑云龙 id");
  }

  console.log("== JS 错误 ==");
  check("无 JS 错误", errors.length === 0, errors.slice(0, 3).join("; "));

  await browser.close();
  console.log("\n结果: " + passed + " 通过, " + failed + " 失败");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
