// MusicGraph 前端一键回归验证（需本机 Chrome + playwright 本地模块）
// 用法：node web/verify.js
// 自动检查：数据加载 / 首页统计 / 搜索演员 / 作品 / 团体 / 共演展开 / 类型筛选 / 无JS错误
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

  console.log("== 数据加载 ==");
  check("数据已加载", await page.evaluate(() => !!window.MUSIC_GRAPH && Object.keys(window.MUSIC_GRAPH.actors).length > 1000));

  console.log("== 首页 ==");
  const stats = await page.textContent("#stats");
  check("图谱统计显示", /节点/.test(stats), stats);
  check("热门演员入口", await page.$$eval("#hot-chips .chip", els => els.length) >= 5);

  console.log("== 搜索演员 ==");
  await page.fill("#search", "郑云龙");
  await page.waitForTimeout(400);
  const items = await page.$$eval("#dropdown .item", els => els.map(e => e.textContent));
  check("搜索有结果", items.length > 0, items.slice(0, 2).join(" | "));
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(700);
  check("档案面板打开", !(await page.$eval("#panel", el => el.classList.contains("hidden"))));
  check("关系列表有内容", await page.$$eval("#p-relations li", els => els.length) >= 1);
  check("常共演有内容", await page.$$eval("#p-cowork li", els => els.length) >= 1);
  const hasSelf = await page.$$eval("#p-cowork li", els => els.some(e => e.textContent.includes("郑云龙（共演")));
  check("常共演无自己", !hasSelf);

  console.log("== 作品 ==");
  await page.fill("#search", "哈姆雷特");
  await page.waitForTimeout(400);
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(500);
  check("作品演员表", await page.$$eval("#p-cast li", els => els.length) >= 5);

  console.log("== 团体 ==");
  await page.fill("#search", "中戏17");
  await page.waitForTimeout(400);
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(500);
  check("团体成员", await page.$$eval("#p-cast li", els => els.length) >= 3);

  console.log("== 共演展开 + 类型筛选 ==");
  await page.check("#expand-cowork");
  await page.fill("#search", "郑棋元");
  await page.waitForTimeout(400);
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(800);
  check("展开共演不报错", errors.length === 0);
  await page.click('.lg[data-type="cp"]');
  await page.waitForTimeout(500);
  const stats2 = await page.textContent("#stats");
  check("类型筛选生效", stats2 !== stats, stats2);
  await page.click('.lg[data-type="cp"]');
  await page.waitForTimeout(500);

  console.log("== JS 错误 ==");
  check("无 JS 错误", errors.length === 0, errors.slice(0, 2).join("; "));

  await browser.close();
  console.log("\n结果: " + passed + " 通过, " + failed + " 失败");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
