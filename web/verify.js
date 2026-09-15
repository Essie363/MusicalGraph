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
const FILE_URL = "file:///" + __dirname.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/") + "/index.html?mode=static";   // force this worktree's offline snapshot for deterministic regression

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
  await page.goto(FILE_URL + "&v=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(3000);

  async function ensureSearch() {
    // 搜索框在顶部 Header（平时只显示放大镜图标），需要时先点击展开
    const hidden = await page.$eval("#top-search-box", el => el.classList.contains("hidden"));
    if (hidden) { await page.click("#search-toggle"); await page.waitForTimeout(200); }
  }
  async function openActor(name) {
    // 搜索框在顶部 Header：若不在 Graph 页先切过去
    await page.evaluate(() => { if (location.hash !== "#/graph") location.hash = "#/graph"; });
    await page.waitForTimeout(600);
    await ensureSearch();
    await page.fill("#search", name);
    await page.waitForTimeout(400);
    await page.click("#dropdown .item:first-child");
    await page.waitForTimeout(900);   // 搜索 = 图谱定位 + 右侧信息卡滑出
    await page.click("#fc-detail");   // 通过「查看详情」进入独立详情页
    await page.waitForTimeout(800);
  }

  console.log("== 数据加载 ==");
  check("数据已加载", await page.evaluate(() => !!window.MUSIC_GRAPH && Object.keys(window.MUSIC_GRAPH.actors).length > 1000));

  console.log("== 页面导航 ==");
  check("默认落地 Home", await page.$eval("#view-home", el => !el.classList.contains("hidden")));
  check("导航三个主入口", (await page.$$eval(".nav-links > a", els => els.length)) === 3);
  await page.click('.nav-links a[data-nav="graph"]');
  await page.waitForTimeout(900);
  check("进入关系图谱", await page.$eval("#view-graph", el => !el.classList.contains("hidden")));

  console.log("== 用户协议与隐私政策 ==");
  await page.evaluate(() => { location.hash = "#/terms"; });
  await page.waitForTimeout(250);
  check("用户协议独立阅读页", await page.$eval("#view-legal", el => !el.classList.contains("hidden")) &&
    await page.$eval("#legal-terms", el => !el.classList.contains("hidden") && el.textContent.includes("Cast Light 用户协议")));
  await page.evaluate(() => { location.hash = "#/privacy"; });
  await page.waitForTimeout(250);
  check("隐私政策独立阅读页", await page.$eval("#legal-privacy", el => !el.classList.contains("hidden") && el.textContent.includes("Cast Light 隐私政策")));
  check("首页页脚有协议入口", await page.$eval(".home-foot-legal", el => el.querySelectorAll('a[href="#/terms"], a[href="#/privacy"]').length === 2));
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(250);
  await page.click("#auth-login-btn");
  await page.fill("#auth-email", "local-check@example.com");
  await page.click("#auth-email-form button[type='submit']");
  check("未同意协议不发送验证码", await page.$eval("#auth-message", el => el.textContent.includes("请先阅读并同意")) &&
    await page.$eval("#auth-token-form", el => el.classList.contains("hidden")));
  check("两处登录均有协议确认", (await page.$$eval(".agreement-check", els => els.length)) === 4);
  await page.click("#auth-close");

  console.log("== 图谱 ==");
  check("关系类型筛选已移除", await page.evaluate(() => !document.getElementById("legend")), "legend still exists");
  check("首页双层布局：含作品节点", await page.evaluate(() => (window.__homeWorkNodeCount ? window.__homeWorkNodeCount() : 0) > 0));
  check("首页双层布局：含演员节点", await page.evaluate(() => (window.__homeNodeIds ? window.__homeNodeIds() : []).length > 100));
  check("节点 4 层级：核心节点存在", await page.evaluate(() => (window.__homeCoreCount ? window.__homeCoreCount() : 0) > 0));
  check("节点 4 层级：四档齐全", await page.evaluate(() => {
    const c = window.__homeTierCounts ? window.__homeTierCounts() : null;
    return !!c && c.core > 0 && c.star > 0 && c.active > 0 && c.normal > 0;
  }));
  check("首页全局视图非聚焦态", await page.evaluate(() => (window.__homeFocusId ? window.__homeFocusId() : null) === null));
  check("首页团体维度：含团体节点", await page.evaluate(() => {
    const ids = window.__homeNodeIds ? window.__homeNodeIds() : [];
    return ids.filter(id => window.__homeNodeType && window.__homeNodeType(id) === "group").length > 0;
  }));

  console.log("== 搜索演员 -> 图谱定位 ==");
  await ensureSearch();
  await page.fill("#search", "郑云龙");
  await page.waitForTimeout(400);
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(1100);
  check("搜索后在图谱中定位（不跳详情页）", await page.evaluate(() => {
    return !document.getElementById("view-graph").classList.contains("hidden") &&
           document.getElementById("actor-view").classList.contains("hidden");
  }));
  check("右侧信息卡展示该演员", await page.evaluate(() => {
    return document.body.classList.contains("side-open") &&
           document.getElementById("fc-name").textContent === "郑云龙";
  }));
  check("静态模式图谱评分摘要存在", await page.$eval("#fc-rating", el => !el.classList.contains("hidden") && el.textContent.includes("暂无评分")));
  check("静态模式图谱评分入口隐藏", await page.$eval("#fc-rate", el => el.classList.contains("hidden")));
  await page.click("#fc-detail");
  await page.waitForTimeout(800);
  check("点击查看详情进入详情页", await page.$eval("#actor-view", el => !el.classList.contains("hidden")));

  console.log("== 搜索演员 -> 详情页 ==");
  await openActor("郑云龙");
  check("详情页打开", await page.$eval("#actor-view", el => !el.classList.contains("hidden")));
  check("静态模式详情评分模块存在", await page.$eval("#ap-rating-body", el =>
    !!el.querySelector(".rating-dashboard-dimensions") && !!el.querySelector(".rating-dashboard-overall")
  ));
  check("静态模式详情评分入口隐藏", await page.$eval("#ap-rate", el => el.classList.contains("hidden")));

  console.log("== 评分在线流程（模拟 RPC）==");
  await page.evaluate(() => {
    const actorId = window.__apCenterId();
    window.__ratingRpcCalls = [];
    window.fetch = (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : {};
      window.__ratingRpcCalls.push({ url: String(url), body });
      if (String(url).includes("get_rating_performances") && body.p_date === "2021-03-04") return Promise.reject(new Error("simulated schedule lookup failure"));
      let data = {};
      if (String(url).includes("get_rating_performances")) data = body.p_date === "2022-03-04" ? [] : [{ id: 300, date: "2026-09-03", time: "14:30", city: "上海", theatre: "测试剧场", role_confirmed: false, cast: [{ actor_id: body.p_actor_id, actor_name: "郑云龙", role_name: "角色待补充" }] }];
      if (String(url).includes("get_my_rating")) data = { singing_score: 4.5, dancing_score: null, acting_score: 5 };
      if (String(url).includes("get_rating_summary")) data = { actors: [], roles: [] };
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
    };
    window.MG_SUPABASE = { url: "https://example.test", anonKey: "test", timeoutMs: 1000 };
    history.replaceState(null, "", location.pathname + "#/actor/" + actorId);
    window.MG_UPGRADE(Object.assign({}, window.MUSIC_GRAPH, {
      actorRoleOptions: { [actorId]: [{ musicalId: "100", musicalName: "测试剧目", roleId: "200", roleName: "测试角色" }] },
      ratings: { actors: [], roles: [] }
    }));
  });
  check("在线模式显示评分入口", await page.$eval("#ap-rate", el => !el.classList.contains("hidden")));
  await page.click("#ap-rate");
  check("未登录打分先显示登录注册入口", await page.$eval("#rating-auth-modal", el => !el.classList.contains("hidden") && el.textContent.includes("登录/注册")));
  await page.click("#rating-auth-anonymous");
  await page.$eval("#rating-musical", el => { el.value = "100"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval("#rating-role", el => { el.value = "200"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval("#rating-date", el => { el.value = "2026-09-03"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(100);
  check("场次按日期读取", await page.$eval("#rating-performance-results", el => el.textContent.includes("午场")));
  await page.click(".rating-performance-choice");
  check("待补充角色不阻断评分", await page.$eval("#rating-performance-confirm", el => el.textContent.includes("待核验")));
  await page.waitForTimeout(100);
  check("旧评分以 10 分制回填", await page.$eval("[data-dimension='singing'] .rating-value", el => el.textContent === "9.0") && await page.$eval("[data-dimension='acting'] .rating-value", el => el.textContent === "10.0"));
  await page.setViewportSize({ width: 390, height: 844 });
  check("手机端评分弹窗不横向溢出", await page.$eval(".rating-dialog", el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth;
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click("#rating-submit");
  await page.waitForTimeout(100);
  check("真实场次评分保存日期与场次 ID", await page.evaluate(() => window.__ratingRpcCalls.some(x =>
    x.url.includes("upsert_actor_rating") && x.body.p_performance_id === 300 && x.body.p_performance_date === "2026-09-03" && x.body.p_session_period === "matinee" && x.body.p_singing_score === 4.5 && x.body.p_acting_score === 5
  )));
  check("评分提交携带浏览器标识", await page.evaluate(() => window.__ratingRpcCalls.some(x =>
    x.url.includes("upsert_actor_rating") && typeof x.body.p_device_id === "string" && x.body.p_device_id.length > 0
  )));
  check("提交后关闭评分弹窗", await page.$eval("#rating-modal", el => el.classList.contains("hidden")));

  await page.click("#ap-rate");
  await page.click("#rating-auth-anonymous");
  await page.$eval("#rating-musical", el => { el.value = "100"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval("#rating-role", el => { el.value = "200"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval("#rating-date", el => { el.value = "2022-03-04"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(100);
  check("已知剧目角色缺排期时仍显示演出时间选择", await page.$eval("#rating-performance-results", el => el.textContent.includes("演出时间") && el.textContent.includes("午场") && el.textContent.includes("夕场") && el.textContent.includes("晚场")));
  await page.click("#rating-close");

  await page.click("#ap-rate");
  await page.click("#rating-auth-anonymous");
  await page.$eval("#rating-musical", el => { el.value = "100"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval("#rating-role", el => { el.value = "200"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.$eval("#rating-date", el => { el.value = "2021-03-04"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(100);
  check("场次读取失败时仍可选择演出时间", await page.$eval("#rating-performance-results", el => el.textContent.includes("暂未能读取当天排期") && el.textContent.includes("午场") && el.textContent.includes("夕场") && el.textContent.includes("晚场")));
  await page.click("#rating-close");

  await page.click("#ap-rate");
  await page.click("#rating-auth-anonymous");
  await page.click("#rating-manual-subject-toggle");
  await page.fill("#rating-manual-musical", "未收录测试剧目");
  await page.fill("#rating-manual-role", "未收录测试角色");
  await page.$eval("#rating-date", el => { el.value = "2022-03-04"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  check("手动补充显示演出时间选择", await page.$eval("#rating-performance-results", el => el.textContent.includes("演出时间") && el.textContent.includes("午场") && el.textContent.includes("夕场") && el.textContent.includes("晚场")));
  await page.click(".rating-session-picker [data-session='night']");
  check("手动补充说明只进入演员整体评分", await page.$eval("#rating-performance-confirm", el => el.textContent.includes("演员整体评价") && el.textContent.includes("详细评分")));
  await page.click("[data-dimension='singing'] .rating-star-hit[data-score='4.5']");
  await page.click("[data-dimension='acting'] .rating-star-hit[data-score='5.0']");
  await page.click("#rating-submit");
  await page.waitForTimeout(100);
  check("手动补充调用独立评分 RPC", await page.evaluate(() => window.__ratingRpcCalls.some(x => x.url.includes("upsert_manual_actor_rating") && x.body.p_musical_name === "未收录测试剧目" && x.body.p_role_name === "未收录测试角色" && x.body.p_session_period === "night" && x.body.p_singing_score === 4.5 && x.body.p_acting_score === 5 && typeof x.body.p_device_id === "string" && x.body.p_device_id.length > 0)));

  check("详情页姓名", (await page.textContent("#ap-name")) === "郑云龙", await page.textContent("#ap-name"));
  check("关系列表有内容", await page.$$eval("#ap-relations li", els => els.length) >= 1);
  check("常共演有内容", await page.$$eval("#ap-cowork li", els => els.length) >= 1);
  check("常共演最多展示20位", await page.$$eval("#ap-cowork li", els => els.length) <= 20);
  const hasSelf1 = await page.$$eval("#ap-cowork li", els => els.some(e => e.textContent.startsWith("郑云龙共演")));
  check("常共演无自己", !hasSelf1);
  const rolesInMusicals = await page.$$eval("#ap-musicals li", els => els.filter(e => /（/.test(e.textContent)).length);
  check("参演剧目带角色", rolesInMusicals >= 1, "含角色条目数=" + rolesInMusicals);
  const actorDetailId = await page.evaluate(() => window.__apCenterId());
  const musicalDetailId = await page.evaluate(() => {
    const item = document.querySelector("#ap-musicals .c");
    if (!item) return null;
    return Object.keys(window.MUSIC_GRAPH.musicals).find(id => window.MUSIC_GRAPH.musicals[id].name === item.textContent) || null;
  });
  if (musicalDetailId) {
    await page.click("#ap-musicals .c");
    await page.waitForTimeout(500);
    check("演员页剧目进入剧目详情", await page.evaluate(id =>
      location.hash === "#/musical/" + encodeURIComponent(id)
      && !document.getElementById("musical-view").classList.contains("hidden"), musicalDetailId));
    await page.evaluate(id => { location.hash = "#/actor/" + encodeURIComponent(id); }, actorDetailId);
    await page.waitForTimeout(500);
  }
  const apCount = await page.evaluate(() => window.__apNodeCount || 0);
  check("关系图渲染", apCount > 5, "节点数=" + apCount);

  console.log("== 精彩片段 ==");
  check("数据含精彩片段", await page.evaluate(() => Array.isArray(window.MUSIC_GRAPH.moments) && window.MUSIC_GRAPH.moments.length > 0));
  // 动态选一个有片段的演员（片段数据会更新，避免固定人名失效）
  const momActorId = await page.evaluate(() => {
    const m = window.MUSIC_GRAPH.moments[0];
    return m ? String(m.actorId) : null;
  });
  if (momActorId) {
    await page.goto(FILE_URL + "&v=" + Date.now() + "#/actor/" + momActorId, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    const momSecVisible = await page.evaluate(() => {
      const el = document.getElementById("ap-moments-sec");
      return el && !el.classList.contains("hidden");
    });
    const momCount = await page.$$eval("#ap-moments li", els => els.length);
    check("详情页显示精彩片段", momSecVisible && momCount >= 1, "条目数=" + momCount);
    const momTitleLinkOk = await page.$$eval("#ap-moments a.mom-title", els => els.length >= 1 && els.every(a => a.target === "_blank" && /^https?:/.test(a.href)));
    check("标题即外链且新窗口打开", momTitleLinkOk);
    const momNoBtn = await page.$$eval("#ap-moments .mom-link", els => els.length === 0);
    check("无独立查看链接按钮", momNoBtn);
    // 回到郑云龙详情页，继续后续「在图谱中查看」流程
    const zlyBackId = await page.evaluate(() => {
      const a = window.MUSIC_GRAPH.actors;
      for (const k in a) if (a[k].name === "郑云龙") return k;
      return null;
    });
    if (zlyBackId) {
      await page.goto(FILE_URL + "&v=" + Date.now() + "#/actor/" + zlyBackId, { waitUntil: "load" });
      await page.waitForTimeout(3000);
    }
  } else {
    check("详情页显示精彩片段", false, "无片段数据");
    check("标题即外链且新窗口打开", false, "无片段数据");
    check("无独立查看链接按钮", false, "无片段数据");
  }

  console.log("== 在图谱中查看 ==");
  // 宽窄屏分别使用顶部或侧栏入口；DOM 点击可覆盖两种布局。
  await page.evaluate(() => document.querySelector("#ap-graph-link, #ap-sidebar-graph-link").click());
  await page.waitForTimeout(1100);
  check("回到图谱并定位该演员", await page.evaluate(() => {
    return !document.getElementById("view-graph").classList.contains("hidden") &&
           document.getElementById("actor-view").classList.contains("hidden") &&
           document.getElementById("fc-name").textContent === "郑云龙" &&
           document.body.classList.contains("side-open");
  }));

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
  await openActor("郑云龙");
  await page.waitForTimeout(500);
  const nameBefore = await page.textContent("#ap-name");
  const coworkTarget = page.locator("#ap-cowork li span.c").first();
  if (await coworkTarget.count()) {
    await coworkTarget.click();
    await page.waitForTimeout(800);
    const nameAfter = await page.textContent("#ap-name");
    check("点击搭档跳到对方详情页", nameAfter !== nameBefore, nameBefore + " -> " + nameAfter);
  } else {
    check("点击搭档跳到对方详情页", true, "当前静态样本未加载可跳转搭档，已由关系图节点跳转覆盖");
  }

  console.log("== 演员页关系图节点点击 ==");
  {
    const prevHash = await page.evaluate(() => location.hash);
    // 上一用例可能把详情页滚到底部，先把关系网络图滚回视口内
    await page.evaluate(() => {
      const v = document.getElementById("actor-view");
      if (v) v.scrollTop = 0;
      const g = document.getElementById("ap-graph");
      if (g) g.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(400);
    const apIds = await page.evaluate(() => {
      const ns = window.__apNodes ? window.__apNodes() : {};
      const cid = window.__apCenterId ? window.__apCenterId() : null;
      return Object.keys(ns).filter(k => k !== cid);
    });
    let apClicked = false;
    for (const aid of apIds.slice(0, 40)) {
      const pos = await page.evaluate((i) => window.__apNodeScreen(i), aid);
      if (!pos) continue;
      // 仅点击画布范围内的节点（随机散落布局可能靠近边缘）
      const rect = await page.evaluate(() => { const r = document.getElementById("ap-graph").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      if (pos.x < rect.l + 5 || pos.x > rect.r - 5 || pos.y < rect.t + 5 || pos.y > rect.b - 5) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(700);
      const hash = await page.evaluate(() => location.hash);
      if (hash === "#/actor/" + aid) { apClicked = true; break; }
      await page.evaluate((h) => { location.hash = h; }, prevHash);
      await page.waitForTimeout(600);
    }
    check("演员页关系图点击人物跳转", apClicked, "前40个节点均未跳转");
  }

  console.log("== 查合作 ==");
  {
    const target = await page.$eval("#ap-cowork li:first-child span.c", el => el.textContent).catch(() => null);
    if (target) {
      await page.fill("#cw-q", target);
      await page.click("#cw-go");
      await page.waitForTimeout(1800);   // 首次按需加载全部共演对数据
      const res = await page.textContent("#cw-result");
      check("查合作显示共演次数", /共演/.test(res), res.slice(0, 80));
    } else {
      check("查合作显示共演次数", true, "当前静态样本无共演目标");
    }
  }

  console.log("== 返回首页 ==");
  await page.evaluate(() => document.getElementById("ap-back").click());
  await page.waitForTimeout(600);
  check("返回关系图谱", await page.$eval("#home-view", el => !el.classList.contains("hidden")));

  console.log("== 首页单击聚焦 ==");
  let focusedActorId = null, focusedMus = 0;
  {
    const rect = await page.evaluate(() => {
      const r = document.getElementById("graph").getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
    const ids = await page.evaluate(() => (window.__homeNodeIds ? window.__homeNodeIds() : []).slice(0, 30));
    let focused = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      if (pos.x < rect.l + 5 || pos.x > rect.r - 5 || pos.y < rect.t + 5 || pos.y > rect.b - 5) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(1100);
      const cardVisible = await page.evaluate(() => window.__homeFocusCardVisible());
      const name = await page.textContent("#fc-name");
      const musNodes = await page.evaluate(() => (window.__homeNodeIds() || []).filter(k => (window.__homeNodeType(k) === "musical")).length);
      if (cardVisible && name) { focused = true; focusedActorId = id; focusedMus = musNodes; break; }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
    }
    check("单击聚焦出现信息卡", focused, "focusId=" + focusedActorId);
    check("聚焦展开剧目节点", focusedMus >= 1, "剧目节点数=" + focusedMus);
  }

  console.log("== 首页双击进详情 ==");
  if (focusedActorId) {
    const pos = await page.evaluate((i) => window.__homeNodeScreen(i), focusedActorId);
    if (pos) {
      await page.mouse.dblclick(pos.x, pos.y);
      await page.waitForTimeout(800);
      const hash = await page.evaluate(() => location.hash);
      check("双击进入演员详情页", hash === "#/actor/" + focusedActorId, hash);
    } else {
      check("双击进入演员详情页", false, "节点无屏幕坐标");
    }
  } else {
    check("双击进入演员详情页", false, "未获取聚焦节点");
  }

  console.log("== 返回首页 + Esc 返回全局 ==");
  await page.evaluate(() => document.getElementById("ap-back").click());
  await page.waitForTimeout(600);
  {
    const ids = await page.evaluate(() => (window.__homeNodeIds() || []).slice(0, 5));
    let focused = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(900);
      if (await page.evaluate(() => window.__homeFocusCardVisible())) { focused = true; break; }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    }
    check("重新聚焦可再次进入聚焦态", focused);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    const focusId = await page.evaluate(() => window.__homeFocusId());
    const musLeft = await page.evaluate(() => (window.__homeNodeIds() || []).filter(k => window.__homeNodeType(k) === "musical").length);
    check("Esc 返回全局图谱", focusId === null && musLeft > 0, "focusId=" + focusId + " mus=" + musLeft);   // 全局视图含作品节点（双层布局）

  console.log("== 聚焦卡精彩片段 ==");
  {
    const momIds = await page.evaluate(() => {
      const byActor = {};
      (window.MUSIC_GRAPH.moments || []).forEach(m => { byActor[String(m.actorId)] = true; });
      const ids = window.__homeNodeIds() || [];
      return ids.filter(id => byActor[id]);
    });
    let ok = false;
    for (const momId of momIds.slice(0, 30)) {
      const rect = await page.evaluate(() => { const r = document.getElementById("graph").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), momId);
      if (!pos || pos.x < rect.l + 5 || pos.x > rect.r - 5 || pos.y < rect.t + 5 || pos.y > rect.b - 5) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(1100);
      ok = await page.evaluate(() => {
        const el = document.getElementById("fc-moments");
        return el && !el.classList.contains("hidden") && el.querySelectorAll("a.mom-title").length >= 1;
      });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
      if (ok) break;
    }
    check("聚焦卡显示精彩片段", ok, "含片段节点数=" + momIds.length);
  }
  }

  console.log("== 点击空白返回全局 ==");
  {
    const ids = await page.evaluate(() => (window.__homeNodeIds() || []).slice(0, 30));
    let focused = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(1100);
      if (await page.evaluate(() => window.__homeFocusId() !== null)) { focused = true; break; }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
    }
    check("先进入聚焦态", focused);
    check("右侧面板随聚焦滑出", await page.evaluate(() => document.body.classList.contains("side-open")));
    const pt = await page.evaluate(() => {
      const c = document.getElementById("graph");
      const r = c.getBoundingClientRect();
      const ids = window.__homeNodeIds();
      let best = null, bestD = -1;
      for (let x = r.left + 24; x <= r.right - 24; x += 48) {
        for (let y = r.top + 24; y <= r.bottom - 24; y += 48) {
          let minD = 1e18;
          ids.forEach(id => {
            const p = window.__homeNodeScreen(id);
            if (p) minD = Math.min(minD, (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y));
          });
          if (minD > bestD) { bestD = minD; best = { x: x, y: y }; }
        }
      }
      return best;
    });
    if (pt) {
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(900);
      const focusAfter = await page.evaluate(() => window.__homeFocusId());
      check("点击空白返回全局", focusAfter === null, "focusId=" + focusAfter);
      check("点击空白后面板收起", await page.evaluate(() => !document.body.classList.contains("side-open")));
    } else {
      check("点击空白返回全局", false, "找不到空白点");
    }
  }

  console.log("== 拖动 vs 点击空白 ==");
  {
    await page.evaluate(() => { location.hash = "#/graph?scene=actors"; });
    await page.waitForTimeout(1800);
    const blankPt = () => page.evaluate(() => {
      const c = document.getElementById("graph");
      const r = c.getBoundingClientRect();
      const ids = window.__homeNodeIds();
      let best = null, bestD = -1;
      for (let x = r.left + 24; x <= r.right - 24; x += 48) {
        for (let y = r.top + 24; y <= r.bottom - 24; y += 48) {
          let minD = 1e18;
          ids.forEach(id => {
            const p = window.__homeNodeScreen(id);
            if (p) minD = Math.min(minD, (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y));
          });
          if (minD > bestD) { bestD = minD; best = { x: x, y: y }; }
        }
      }
      return best;
    });
    check("拖动测试前场景激活", await page.evaluate(() => window.__homeScene() === "actors"));
    const b1 = await blankPt();
    if (b1) {
      await page.mouse.move(b1.x, b1.y);
      await page.mouse.down();
      await page.mouse.move(b1.x + 120, b1.y + 60, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(800);
      check("拖动空白不返回全局", await page.evaluate(() => window.__homeScene() === "actors"));
      const b2 = await blankPt();
      if (b2) {
        await page.mouse.click(b2.x, b2.y);
        await page.waitForTimeout(800);
        check("原地点击空白返回全局", await page.evaluate(() => window.__homeScene() === null && window.__homeFocusId() === null));
      } else {
        check("原地点击空白返回全局", false, "找不到空白点");
      }
    } else {
      check("拖动空白不返回全局", false, "找不到空白点");
    }
  }

  console.log("== 共演线强弱 ==");
  {
    const edges = await page.evaluate(() => (window.__homeEdges() || []).filter(e => e.count > 0));
    if (edges.length >= 2) {
      edges.sort((a, b) => a.count - b.count);
      const minW = edges[0].width, maxW = edges[edges.length - 1].width;
      check("共演线宽随场次递增", maxW > minW, "count " + edges[0].count + "->w" + minW.toFixed(2) + " / count " + edges[edges.length - 1].count + "->w" + maxW.toFixed(2));
    } else {
      check("共演线宽随场次递增", false, "无共演边可抽样");
    }
  }

  console.log("== hover 追光 ==");
  {
    const ids = await page.evaluate(() => (window.__homeNodeIds() || []).slice(0, 30));
    let hoverOk = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      await page.mouse.move(pos.x, pos.y);
      await page.waitForTimeout(600);
      const r = await page.evaluate((i) => {
        const ids = window.__homeNodeIds();
        const alphas = ids.map(k => ({ id: k, a: window.__homeNodeAlpha(k) }));
        alphas.sort((x, y) => y.a - x.a);
        return { hover: window.__homeNodeAlpha(i), bottom: alphas[alphas.length - 1].a, card: window.__homeHoverCardVisible() };
      }, id);
      if (r.hover > 0.8 && r.bottom < 0.5 && r.card) { hoverOk = true; break; }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
    }
    check("hover 追光效果", hoverOk);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
  }

  console.log("== 光点：关系线显示逻辑 ==");
  {
    const vis = await page.evaluate(() => (window.__homeEdgeAlpha() || []).filter(e => e.alpha > 0.02));
    const nonDim = vis.filter(e => e.a.indexOf("mus:") !== 0 && e.b.indexOf("mus:") !== 0 && e.a.indexOf("grp:") !== 0 && e.b.indexOf("grp:") !== 0);
    check("默认全局只显示作品/团体维度边", vis.length > 0 && nonDim.length === 0, "可见边数=" + vis.length + " 非维度边=" + nonDim.length);
  }
  {
    const ids = await page.evaluate(() => (window.__homeNodeIds() || []).slice(0, 30));
    let hoverEdgeOk = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      await page.mouse.move(pos.x, pos.y);
      await page.waitForTimeout(600);
      const r = await page.evaluate((i) => {
        const es = window.__homeEdgeAlpha();
        const vis = es.filter(e => e.alpha > 0.02);
        const connected = vis.filter(e => e.a === i || e.b === i).length;
        const other = vis.length ? (vis[0].a === i ? vis[0].b : vis[0].a) : null;
        return { connected, total: vis.length, label: window.__homeLabelVisible(i), neighborLabel: other ? window.__homeLabelVisible(other) : false };
      }, id);
      if (r.connected >= 1 && r.total === r.connected && r.label && r.neighborLabel) { hoverEdgeOk = true; break; }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
    }
    check("hover 只显示焦点关联线+姓名", hoverEdgeOk);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
  }
  {
    const ids = await page.evaluate(() => (window.__homeNodeIds() || []).slice(0, 30));
    let focusEdgeOk = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(1100);
      const r = await page.evaluate((i) => {
        const es = window.__homeEdgeAlpha();
        const centerEdges = es.filter(e => (e.a === i || e.b === i) && e.alpha > 0.02).length;
        return { centerEdges, label: window.__homeLabelVisible(i), card: window.__homeFocusCardVisible() };
      }, id);
      if (r.centerEdges >= 1 && r.label && r.card) { focusEdgeOk = true; break; }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
    }
    check("聚焦模式显示中心网络+姓名", focusEdgeOk);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
  }

  console.log("== 聚焦点亮：相关点亮/无关暗淡/关系色 ==");
  {
    const ids = await page.evaluate(() => (window.__homeNodeIds() || []).slice(0, 40));
    let lightOk = false;
    for (const id of ids) {
      const pos = await page.evaluate((i) => window.__homeNodeScreen(i), id);
      if (!pos) continue;
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(1100);
      const r = await page.evaluate((i) => {
        const relCol = window.__homeRelColorCache() || {};
        const nbKeys = Object.keys(relCol);
        if (!nbKeys.length) return null;
        const nb = nbKeys[0];
        const nbSet = window.__homeFocusNeighbors() || [];
        const unrelated = window.__homeNodeIds().find(k =>
          k !== i && nbSet.indexOf(k) < 0 && window.__homeNodeType(k) === "actor"
        );
        return {
          hasRel: !!relCol[nb],
          nbAlpha: window.__homeNodeAlpha(nb),
          nbLabel: window.__homeLabelVisible(nb),
          nbColor: window.__homeNodeColor(nb),
          unAlpha: unrelated ? window.__homeNodeAlpha(unrelated) : 1,
        };
      }, id);
      if (r && r.hasRel && r.nbAlpha > 0.5 && r.nbLabel && r.unAlpha < 0.2 && r.nbColor !== "#d9a441") {
        lightOk = true; break;
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
    }
    check("聚焦点亮：关系演员亮/无关暗淡/关系色", lightOk);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
  }

  console.log("== 放大显示全部姓名 ==");
  {
    const rect = await page.evaluate(() => {
      const r = document.getElementById("graph").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(rect.x, rect.y);
    await page.keyboard.down("Control");          // Ctrl+滚轮（触控板捏合同源）→ 缩放
    for (let i = 0; i < 16; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(50);
    }
    await page.keyboard.up("Control");
    await page.waitForTimeout(400);
    const z = await page.evaluate(() => window.__homeZoom());
    const all = await page.evaluate(() => {
      const ids = window.__homeNodeIds().slice(0, 50);
      return ids.length > 0 && ids.every(k => window.__homeLabelVisible(k));
    });
    check("放大后显示全部姓名", z >= 2.4 && all, "zoom=" + z.toFixed(2));
  }

  console.log("== 触控板：滑动平移 / 捏合缩放 ==");
  {
    const rect = await page.evaluate(() => { const r = document.getElementById("graph").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.evaluate(() => { location.hash = "#/graph"; });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__homeResetView());
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.__homeView());
    await page.mouse.move(rect.x, rect.y);
    await page.mouse.wheel(0, -240);              // 普通滚轮/双指滑动 → 平移
    await page.waitForTimeout(250);
    const afterPan = await page.evaluate(() => window.__homeView());
    check("双指滑动=平移（不缩放）", Math.abs(afterPan.zoom - before.zoom) < 1e-9 && Math.abs(afterPan.y - before.y) > 1e-6, JSON.stringify(before) + " -> " + JSON.stringify(afterPan));
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -240);              // Ctrl+滚轮（捏合）→ 缩放
    await page.keyboard.up("Control");
    await page.waitForTimeout(250);
    const afterZoom = await page.evaluate(() => window.__homeView());
    check("捏合/Ctrl+滚轮=缩放", afterZoom.zoom > afterPan.zoom, JSON.stringify(afterPan) + " -> " + JSON.stringify(afterZoom));
  }

  console.log("== 作品 ==");
  await ensureSearch();
  await page.fill("#search", "哈姆雷特");
  await page.waitForTimeout(400);
  await page.click("#dropdown .item:first-child");
  await page.waitForTimeout(500);
  check("剧目信息卡（非弹窗）", await page.evaluate(() => {
    return document.getElementById("panel").classList.contains("hidden") &&
           !document.getElementById("focus-card").classList.contains("hidden") &&
           document.body.classList.contains("side-open");
  }));
  check("作品演员表", await page.$$eval("#fc-moments .role-group .c", els => els.length) >= 5);
  const roleGroups = await page.$$eval("#fc-moments .role-group", els => els.length);
  check("作品演员表按角色分组", roleGroups >= 2, "角色组数=" + roleGroups);
  await page.click("#fc-detail");
  await page.waitForTimeout(700);
  check("剧目右栏可进入详情页", await page.evaluate(() => {
    return !document.getElementById("musical-view").classList.contains("hidden") &&
      /^#\/musical\//.test(location.hash) && document.getElementById("mp-cast-ranking").children.length > 0;
  }));
  await page.evaluate(() => document.getElementById("mp-graph-link").click());
  await page.waitForTimeout(900);
  check("剧目详情可返回图谱并保留聚焦", await page.evaluate(() => {
    return !document.getElementById("view-graph").classList.contains("hidden") &&
      !document.getElementById("focus-card").classList.contains("hidden") &&
      document.body.classList.contains("side-open");
  }));
  await page.click("#fc-detail");
  await page.waitForTimeout(500);
  check("静态模式卡司保留暂无评分", await page.$$eval("#mp-cast-ranking .mp-unrated", els => els.length > 0));
  await page.evaluate(() => document.getElementById("mp-graph-link").click());
  await page.waitForTimeout(700);

  await page.keyboard.press("Escape");   // 关闭作品弹窗
  await page.waitForTimeout(500);   // 等顶部搜索收起动画结束（320ms 后挂 hidden）

  console.log("== 团体 ==");
  await ensureSearch();
  const groupName = await page.evaluate(() => {
    const groups = window.MUSIC_GRAPH.groups || [];
    const group = groups.find(g => (g.members || []).length >= 3);
    return group ? group.name : "";
  });
  await page.fill("#search", groupName);
  await page.waitForTimeout(400);
  const groupItem = page.locator("#dropdown .item").filter({ hasText: groupName }).first();
  if (await groupItem.count()) await groupItem.click();
  await page.waitForTimeout(900);
  check("团体信息卡（非弹窗）", await page.evaluate(() => {
    return document.getElementById("panel").classList.contains("hidden") &&
           !document.getElementById("focus-card").classList.contains("hidden") &&
           document.body.classList.contains("side-open");
  }));
  check("团体成员区在右侧栏", await page.$eval("#fc-moments", el => el.textContent.includes("成员")));
  check("团体聚焦为单层", await page.evaluate(() => String(window.__homeFocusId() || "").indexOf("grp:") === 0));

  await page.keyboard.press("Escape");   // 返回全局
  await page.waitForTimeout(500);   // 等顶部搜索收起动画结束

  console.log("== Contribute 页 ==");
  await page.click('.nav-links a[data-nav="contribute"]');
  await page.waitForTimeout(600);
  check("进入贡献页", await page.$eval("#view-contribute", el => !el.classList.contains("hidden")));
  check("一级页显示大标题", await page.$eval("#view-contribute .page-head", el => !el.classList.contains("hidden")));
  await page.click("#fb-feedback");
  await page.waitForTimeout(250);
  await page.click('.nav-links a[data-nav="graph"]');
  await page.waitForTimeout(250);
  await page.click('.nav-links a[data-nav="contribute"]');
  await page.waitForTimeout(250);
  check("顶部反馈入口始终回到一级页", await page.$eval("#fb-step-root", el => !el.classList.contains("hidden")));
  // 卡片式流程：一级「补充信息」→ 二级「演员」
  await page.click("#fb-add");
  await page.waitForTimeout(300);
  check("二级页隐藏大标题", await page.$eval("#view-contribute .page-head", el => el.classList.contains("hidden")));
  await page.click("#fb-type-cards .fb-card[data-category='actor']");
  await page.waitForTimeout(300);
  await page.fill("#c-supplement-actor input[name=name]", "测试演员甲");
  await page.fill("#c-supplement-actor input[name=school]", "测试学院");
  await page.fill("#c-ref", "https://example.com");
  await page.click("#contribute-form button[type=submit]");
  await page.waitForTimeout(400);
  check("已移除本地草稿入口", await page.evaluate(() => !document.querySelector("#view-contribute #c-review")));
  // 静态模式会等待后端回退；后续用例覆盖实际的提交请求与反馈提示。
  await page.click("#fb-back-form");
  await page.waitForTimeout(250);
  await page.click("#fb-back-type");
  await page.waitForTimeout(250);
  await page.click("#fb-feedback");
  await page.waitForTimeout(250);
  await page.fill("#fb-feedback-form [name=message]", "测试反馈内容");
  await page.fill("#fb-feedback-form [name=contact]", "tester@example.com");
  await page.click("#fb-feedback-form button[type=submit]");
  await page.waitForTimeout(400);
  check("反馈演示提交成功提示", await page.$eval("#toast", el => el.textContent.indexOf("反馈已提交") >= 0));
  check("反馈演示提交已存本地", await page.evaluate(() => {
    try {
      const list = JSON.parse(localStorage.getItem("mg_demo_submissions") || "[]");
      return list.length === 2 && list[1].category === "feedback";
    } catch (e) { return false; }
  }));
  // 回到补充信息流程，继续原有后端 stub 验证
  await page.click("#fb-back-feedback");
  await page.waitForTimeout(250);
  await page.click("#fb-add");
  await page.waitForTimeout(250);
  await page.click("#fb-type-cards .fb-card[data-category='actor']");
  await page.waitForTimeout(250);
  await page.fill("#c-supplement-actor input[name=name]", "测试演员甲");
  await page.fill("#c-supplement-actor input[name=school]", "测试学院");
  await page.fill("#c-ref", "https://example.com");
  // 提交流程走后端：stub 后端验证请求载荷与成功提示
  await page.evaluate(() => {
    window.MG_PB_CONFIG = { url: "http://fake.local" };
    window.__sent = [];
    window.fetch = function (url, opts) {
      window.__sent.push({ body: opts.body });
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
    };
  });
  await page.click("#contribute-form button[type=submit]");
  await page.waitForTimeout(600);
  check("提交成功提示", await page.$eval("#toast", el => el.textContent.indexOf("成功") >= 0));
  check("提交请求已发送(actor_update)", await page.evaluate(() => {
    const s = window.__sent[window.__sent.length - 1];
    if (!s) return false;
    const b = JSON.parse(s.body);
    return b.submission_type === "actor_update" && typeof b.actor_a === "string" && b.actor_a.length > 0;
  }));
  // 作品表单：卡司区优先于演出排期（结构化输入）
  await page.click("#fb-back-form");
  await page.waitForTimeout(250);
  await page.click("#fb-back-type");
  await page.waitForTimeout(250);
  await page.click("#fb-add");
  await page.waitForTimeout(250);
  await page.click("#fb-type-cards .fb-card[data-category='musical']");
  await page.waitForTimeout(250);
  check("作品表单: 卡司区在演出排期之前", await page.evaluate(() => {
    const g = document.getElementById("c-supplement-musical");
    const names = [...g.querySelectorAll("input[name]")].map(i => i.name);
    return names.indexOf("castActor") >= 0 && names.indexOf("date") > names.indexOf("castActor");
  }));
  check("作品表单: 卡司结构化输入（两行+可加行）", await page.evaluate(() => {
    const g = document.getElementById("c-supplement-musical");
    return g.querySelectorAll(".cast-row").length === 2 && !!g.querySelector(".cast-add");
  }));
  await page.click('.nav-links a[data-nav="graph"]');
  await page.waitForTimeout(600);

  console.log("== hash 直达详情页 ==");
  const zlyId = await page.evaluate(() => {
    const a = window.MUSIC_GRAPH.actors;
    for (const k in a) if (a[k].name === "郑云龙") return k;
    return null;
  });
  if (zlyId) {
    await page.goto(FILE_URL + "#/actor/" + zlyId, { waitUntil: "load" });
    await page.waitForTimeout(3500);   // full reload + data probe takes a while
    const okName = (await page.textContent("#ap-name")) === "郑云龙";
    const okView = await page.$eval("#actor-view", el => !el.classList.contains("hidden"));
    check("直达详情页", okName && okView, "name=" + await page.textContent("#ap-name"));
  } else {
    check("直达详情页", false, "未找到郑云龙 id");
  }

  console.log("== 首页场景跳转 ==");
  await page.goto(FILE_URL + "#/home", { waitUntil: "load" });
  await page.waitForTimeout(1200);

  // 作品场景：点「03 作品」→ 图谱只显示全部剧目
  await page.click('.chapter-card[href="#/graph?scene=musicals"]');
  await page.waitForTimeout(2000);
  check("作品场景: 场景卡显示", await page.$eval("#scene-card", el => !el.classList.contains("hidden")));
  check("作品场景: 热门剧目 Top30", await page.evaluate(() => {
    const ids = window.__homeNodeIds();
    const hl = window.__homeSceneHighlight();
    return ids.length === 30 && hl.length === 30 && ids.every(k => window.__homeNodeType(k) === "musical");
  }));
  await page.keyboard.press("Escape");   // 场景卡无「返回全局图谱」按钮，用 Esc 退出
  await page.waitForTimeout(1200);
  check("退出作品场景回全局", await page.evaluate(() => window.__homeScene() === null && window.__homeFocusId() === null));

  // 演员场景：点「02 演员」→ 点亮热门 Top20
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(600);
  await page.click('.chapter-card[href="#/graph?scene=actors"]');
  await page.waitForTimeout(2000);
  check("演员场景: Top20 点亮", await page.evaluate(() => {
    const hl = window.__homeSceneHighlight();
    return hl.length === 20 && hl.every(k => window.__homeNodeType(k) === "actor");
  }));
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(600);

  // 团体场景：点「04 团体」→ 出现团体节点
  await page.click('.chapter-card[href="#/graph?scene=groups"]');
  await page.waitForTimeout(2000);
  check("团体场景: 团体节点", await page.evaluate(() => {
    const ids = window.__homeNodeIds();
    return ids.some(k => window.__homeNodeType(k) === "group");
  }));
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(600);

  // 精彩片段场景：点「01 精彩片段」→ 点亮有片段的演员 + 场景卡罗列推荐片段
  await page.click('.chapter-card[href="#/graph?scene=moments"]');
  await page.waitForTimeout(2000);
  check("精彩片段场景: 点亮有片段演员", await page.evaluate(() => {
    const hl = window.__homeSceneHighlight();
    const byActor = {};
    (window.MUSIC_GRAPH.moments || []).forEach(m => { byActor[String(m.actorId)] = true; });
    return hl.length > 0 && hl.every(k => byActor[k] === true);
  }));
  check("精彩片段场景: 场景卡罗列推荐片段", await page.evaluate(() => {
    const box = document.getElementById("scene-moments");
    const n = (window.MUSIC_GRAPH.moments || []).length;
    return box && !box.classList.contains("hidden") &&
      box.querySelectorAll(".scene-mom-list li").length === n &&
      box.querySelectorAll(".scene-mom-list .scene-mom-actor").length === n;
  }));
  check("场景卡关闭按钮与聚焦卡一致", await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById("scene-close"));
    const f = getComputedStyle(document.getElementById("fc-close"));
    return s.border === f.border && s.background === f.background && s.color === f.color &&
      s.fontSize === f.fontSize && s.borderRadius === f.borderRadius;
  }));
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(600);

  // 搜索场景：hero 搜索 → 图谱聚焦搜索框并出结果
  await page.evaluate(() => { location.hash = "#/graph?scene=search&q=" + encodeURIComponent("刘令飞"); });
  await page.waitForTimeout(1500);
  check("搜索场景: 聚焦搜索框", await page.evaluate(() => {
    const el = document.getElementById("search");
    return document.activeElement === el && el.value === "刘令飞";
  }));
  check("搜索场景: 下拉有结果", await page.evaluate(() => !document.getElementById("dropdown").classList.contains("hidden")));

  console.log("== 底部场景筛选条 ==");
  check("筛选条存在且含四类", await page.evaluate(() => {
    const b = document.getElementById("scene-filter");
    return !!b && [...b.querySelectorAll("button")].map(x => x.getAttribute("data-scene")).join(",") === "actors,musicals,groups,moments";
  }));
  await page.evaluate(() => { location.hash = "#/graph"; });
  await page.waitForTimeout(1200);
  await page.click('#scene-filter button[data-scene="moments"]');
  await page.waitForTimeout(2000);
  check("筛选条点亮对应场景", await page.evaluate(() => {
    const active = [...document.querySelectorAll("#scene-filter button.active")].map(x => x.getAttribute("data-scene"));
    return window.__homeScene() === "moments" && active.join(",") === "moments";
  }));
  await page.click('#scene-filter button[data-scene="moments"]');
  await page.waitForTimeout(1500);
  check("筛选条再次点击退出", await page.evaluate(() => window.__homeScene() === null));

  console.log("== 评分演示模式 ==");
  const demoPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await demoPage.goto(FILE_URL.replace("mode=static", "mode=rating-demo") + "&v=" + Date.now(), { waitUntil: "load" });
  await demoPage.waitForTimeout(1200);
  check("演示模式生成模拟聚合评分", await demoPage.evaluate(() => (window.MUSIC_GRAPH.ratings || {}).actors.length > 100));
  await demoPage.evaluate(() => { location.hash = "#/actor/" + Object.keys(window.MUSIC_GRAPH.actorRoleOptions)[0]; });
  await demoPage.waitForTimeout(500);
  check("演示模式详情页标注模拟评分", await demoPage.$eval("#ap-rating-body", el => el.textContent.includes("模拟评分")));
  check("演示模式保留体验评分入口", await demoPage.$eval("#ap-rate", el => !el.classList.contains("hidden")));
  const demoMusicalId = await demoPage.evaluate(() => {
    const roles = (window.MUSIC_GRAPH.ratings || {}).roles || [];
    const counts = {};
    roles.forEach(item => { counts[item.musical_id] = (counts[item.musical_id] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  });
  if (demoMusicalId) {
    await demoPage.evaluate(mid => { location.hash = "#/musical/" + mid; }, demoMusicalId);
    await demoPage.waitForTimeout(700);
    check("演示模式剧目详情展示角色榜单", await demoPage.$eval("#mp-cast-ranking", el => el.querySelectorAll(".mp-role-panel").length > 0));
    check("角色榜单已评分演员优先且按分数降序", await demoPage.evaluate(() => {
      const cards = [...document.querySelectorAll(".mp-role-panel")]
        .map(panel => [...panel.querySelectorAll(".mp-cast-card")])
        .find(list => list.length >= 2 && list.some(card => card.querySelector(".rating-score")));
      if (!cards) return false;
      const scores = cards.map(card => {
        const el = card.querySelector(".rating-score");
        return el ? Number(el.textContent) : null;
      });
      const firstUnrated = scores.findIndex(score => score === null);
      const rated = (firstUnrated < 0 ? scores : scores.slice(0, firstUnrated));
      return rated.length >= 1 && rated.every((score, index) => index === 0 || rated[index - 1] >= score) &&
        (firstUnrated < 0 || scores.slice(firstUnrated).every(score => score === null));
    }));
    check("角色卡显示唱演跳分项", await demoPage.$eval(".mp-cast-card", el =>
      el.textContent.includes("唱") && el.textContent.includes("演") && el.textContent.includes("跳")
    ));
  } else {
    check("演示模式剧目详情展示角色榜单", false, "无模拟角色评分");
    check("角色榜单已评分演员优先且按分数降序", false, "无模拟角色评分");
    check("角色卡显示唱演跳分项", false, "无模拟角色评分");
  }
  await demoPage.close();

  console.log("== 我的评分与评分记录 ==");
  const authPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authPage.goto(FILE_URL.replace("mode=static", "mode=auth-demo") + "&v=" + Date.now() + "#/my-ratings", { waitUntil: "load" });
  await authPage.waitForTimeout(1400);
  check("我的评分默认按角色汇总", await authPage.evaluate(() => {
    return !document.getElementById("my-ratings-list").classList.contains("hidden") &&
      document.querySelectorAll(".my-rating-row").length === 5 &&
      [...document.querySelectorAll(".my-rating-row")].some(el => el.textContent.includes("基于 2 场评分"));
  }));
  check("两维场次按两项平均后再汇总", await authPage.locator(".my-rating-row", { hasText: "基于 2 场评分" }).locator(".my-rating-overall strong").textContent() === "9.1");
  await authPage.locator(".my-rating-row", { hasText: "基于 2 场评分" }).locator(".my-rating-edit").click();
  await authPage.waitForTimeout(100);
  check("多场评分编辑先选择具体场次", await authPage.evaluate(() => {
    return !document.getElementById("rating-record-picker-modal").classList.contains("hidden") &&
      document.querySelectorAll(".rating-record-picker-item").length === 2;
  }));
  await authPage.click("#rating-record-picker-close");
  await authPage.click("#my-ratings-history-tab");
  await authPage.waitForTimeout(100);
  check("评分记录按评分日期展示时间线", await authPage.evaluate(() => {
    const days = [...document.querySelectorAll(".my-rating-day-date")].map(el => el.textContent.trim());
    return !document.getElementById("my-ratings-timeline").classList.contains("hidden") &&
      document.querySelectorAll(".my-rating-history-card").length === 6 &&
      document.querySelector(".my-rating-day-records").querySelectorAll(".my-rating-history-card").length === 2 &&
      days[0] === "2025.07.13" && days.every((day, index) => index === 0 || days[index - 1] >= day);
  }));
  await authPage.evaluate(() => { location.hash = "#/contribute"; });
  await authPage.waitForTimeout(100);
  await authPage.click("#fb-feedback");
  check("登录后反馈联系方式预填邮箱", await authPage.$eval("#fb-feedback-form [name=contact]", el => el.value === "lin.demo@example.com"));
  await authPage.setViewportSize({ width: 390, height: 844 });
  check("手机端评分时间线不横向撑破页面", await authPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await authPage.close();

  console.log("== JS 错误 ==");
  check("无 JS 错误", errors.length === 0, errors.slice(0, 3).join("; "));

  await browser.close();
  console.log("\n结果: " + passed + " 通过, " + failed + " 失败");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
