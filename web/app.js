/* MusicGraph 前端：零依赖 Canvas 关系图
   视图结构（hash 路由）：
   - 首页 (#/)        ：全局关系图谱，只显示人名与关系连线（不显示共演场次），点击人物进入详情页
   - 演员详情页 (#/actor/ID)：个人资料 + 以该演员为中心的关系网络 + 关系/共演/剧目/团体明细
*/
(function () {
  "use strict";
  var D = window.MUSIC_GRAPH;
  if (!D) { document.body.innerHTML = "<p style='padding:40px'>数据文件缺失：请先运行 python export_graph.py</p>"; return; }

  var TYPE_COLOR = {
    couple: "#c65b76", cp: "#9b6fa0", classmate: "#7e9259", friend: "#268c87",
    teacher_student: "#8678a3", same_company: "#64748b", co_work: "#8a8578", roommate: "#a08b5c",
    married: "#8c2f45", ex: "#8f8790"
  };
  // 点亮颜色优先级（数字越小越优先）：伴侣 > 情侣 > 前任 > CP > 同学 > 好友 > 师生 > 同公司
  var REL_TYPE_PRIORITY = {
    married: 1, couple: 2, ex: 3, cp: 4, classmate: 5,
    friend: 6, teacher_student: 7, same_company: 8
  };
  var TYPE_LABEL = {
    couple: "情侣", cp: "CP", classmate: "同学", friend: "好友",
    teacher_student: "师生", same_company: "同公司", co_work: "共演", roommate: "室友",
    married: "伴侣", ex: "前任"
  };
  function groupTypeLabel(t) {
    return { class: "同班同学", dorm: "室友", enrollment: "届别", cohort: "班/届", other: "其他" }[t] || t || "团体";
  }

  // ---- 数据准备：统一 id 为字符串，避免数字/字符串 === 比较失败导致"自己"错判 ----
  var actors = D.actors, relations = D.relations, coWork = D.coWork,
      actorMusicals = D.actorMusicals || {}, musicals = D.musicals || {}, groups = D.groups || [];
  function s(x) { return String(x); }
  relations.forEach(function (r) { r.a = s(r.a); r.b = s(r.b); });
  coWork.forEach(function (e) { e.a = s(e.a); e.b = s(e.b); });
  Object.keys(musicals).forEach(function (mid) {
    var m = musicals[mid];
    if (m.cast) m.cast = m.cast.map(s);
    if (m.roles) {
      var nr = {};
      Object.keys(m.roles).forEach(function (aid) { nr[s(aid)] = m.roles[aid]; });
      m.roles = nr;
    }
  });
  groups.forEach(function (g) { if (g.members) g.members = g.members.map(s); if (g.id !== undefined) g.id = s(g.id); });

  // ---- 精彩片段 moments（舞台高光片段：标题/外链/来源平台） ----
  var SOURCE_LABEL = { bilibili: "Bilibili", xiaohongshu: "小红书", youtube: "YouTube" };
  var moments = D.moments || [];
  var momentsByActor = {};
  moments.forEach(function (m) { var aid = s(m.actorId); (momentsByActor[aid] = momentsByActor[aid] || []).push(m); });
  var actorRoleOptions = D.actorRoleOptions || {};
  var ratingsByActor = {}, ratingsByRole = {};
  function ratingRoleKey(actorId, musicalId, roleId) { return s(actorId) + "|" + s(musicalId) + "|" + s(roleId); }
  function ratingDemoMode() { return /(^|[?&])mode=rating-demo(?:&|$)/.test(location.search); }
  function authDemoMode() { return /(^|[?&])mode=auth-demo(?:&|$)/.test(location.search); }
  function ratingPreviewMode() { return ratingDemoMode() || authDemoMode(); }
  document.querySelectorAll("#faq .faq-item").forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      document.querySelectorAll("#faq .faq-item[open]").forEach(function (other) {
        if (other !== item) other.open = false;
      });
      requestAnimationFrame(function () {
        item.querySelectorAll(".copy-reveal").forEach(function (copy) { copy.classList.add("is-revealed"); });
      });
    });
  });
  function initHomeCopyReveal() {
    if (!window.IntersectionObserver || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    var targets = document.querySelectorAll("#view-home .intro-heading > *, #view-home .feature-copy > *, #view-home .faq-head > *, #view-home .faq-item summary, #view-home .faq-answer p, #view-home .home-foot > *");
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    targets.forEach(function (target) {
      target.classList.add("copy-reveal");
      observer.observe(target);
    });
  }
  initHomeCopyReveal();
  function authDemoRatings() {
    return [
      { id: 1, actor_id: 29, actor_name: "阿云嘎", manual_musical_name: "剧院魅影", manual_role_name: "魅影", performance_date: "2025-07-12", session_period: "night", singing_score: 4.8, acting_score: 4.9, dancing_score: 4.2, updated_at: "2025-07-13T08:00:00Z" },
      { id: 2, actor_id: 29, actor_name: "阿云嘎", manual_musical_name: "剧院魅影", manual_role_name: "魅影", performance_date: "2025-06-20", session_period: "matinee", singing_score: 4.4, acting_score: 4.6, dancing_score: null, updated_at: "2025-06-21T08:00:00Z" },
      { id: 3, actor_id: 29, actor_name: "阿云嘎", manual_musical_name: "基督山伯爵", manual_role_name: "爱德蒙·唐泰斯", performance_date: "2025-05-03", session_period: "matinee", singing_score: 4.7, acting_score: 4.8, dancing_score: 4.5, updated_at: "2025-05-04T08:00:00Z" },
      { id: 4, actor_id: 29, actor_name: "阿云嘎", manual_musical_name: "伊丽莎白", manual_role_name: "死神", performance_date: "2025-03-22", session_period: "night", singing_score: 4.9, acting_score: 4.7, dancing_score: 4.4, updated_at: "2025-03-23T08:00:00Z" },
      { id: 5, actor_id: 30, actor_name: "刘令飞", manual_musical_name: "摇滚莫扎特", manual_role_name: "莫扎特", performance_date: "2025-07-12", session_period: "night", singing_score: 4.6, acting_score: 4.9, dancing_score: 4.1, updated_at: "2025-07-13T09:00:00Z" },
      { id: 6, actor_id: 30, actor_name: "刘令飞", manual_musical_name: "近乎正常", manual_role_name: "盖布", performance_date: "2025-04-19", session_period: "matinee", singing_score: 4.5, acting_score: 4.8, dancing_score: 4.0, updated_at: "2025-04-20T08:00:00Z" }
    ];
  }
  function ratingDemoNumber(text, offset) {
    var total = offset || 0;
    String(text).split("").forEach(function (ch) { total = (total * 31 + ch.charCodeAt(0)) % 997; });
    return total;
  }
  function applyRatingDemoData() {
    if (!ratingDemoMode()) return;
    var musicalIdByName = {};
    Object.keys(musicals).forEach(function (mid) { musicalIdByName[musicals[mid].name] = mid; });
    var demoOptions = {}, demoActors = [], demoRoles = [];
    Object.keys(actorMusicals).forEach(function (aid) {
      var works = actorMusicals[aid] || [], roleOptions = [];
      Object.keys(works).forEach(function (workName) {
        var mid = musicalIdByName[workName];
        if (!mid) return;
        (works[workName] || []).forEach(function (roleName, index) {
          roleOptions.push({ musicalId: mid, musicalName: workName, roleId: mid + "-demo-" + index, roleName: roleName });
        });
      });
      if (!roleOptions.length) return;
      demoOptions[aid] = roleOptions;
      var base = ratingDemoNumber(aid, 17);
      var singing = 3.7 + (base % 13) / 20;
      var dancing = 3.6 + ((base * 3) % 14) / 20;
      var acting = 3.8 + ((base * 7) % 12) / 20;
      var count = 12 + (base % 88);
      demoActors.push({ actor_id: aid, user_count: count, singing_avg: singing, dancing_avg: dancing, acting_avg: acting });
      roleOptions.forEach(function (option, index) {
        var n = ratingDemoNumber(aid + "|" + option.roleId, index);
        demoRoles.push({
          actor_id: aid, musical_id: option.musicalId, role_id: option.roleId, user_count: 10 + (n % 56),
          singing_avg: 3.7 + (n % 13) / 20,
          dancing_avg: 3.6 + ((n * 3) % 14) / 20,
          acting_avg: 3.8 + ((n * 7) % 12) / 20
        });
      });
    });
    actorRoleOptions = demoOptions;
    D.actorRoleOptions = demoOptions;
    D.ratings = { actors: demoActors, roles: demoRoles };
  }
  function rebuildRatingIndexes() {
    ratingsByActor = {}; ratingsByRole = {};
    var summary = D.ratings || {};
    (summary.actors || []).forEach(function (item) { ratingsByActor[s(item.actor_id)] = item; });
    (summary.roles || []).forEach(function (item) { ratingsByRole[ratingRoleKey(item.actor_id, item.musical_id, item.role_id)] = item; });
  }
  rebuildRatingIndexes();
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;"); }
  var nam2 = {};
  Object.keys(actorMusicals).forEach(function (aid) { nam2[s(aid)] = actorMusicals[aid]; });
  actorMusicals = nam2;
  Object.keys(actors).forEach(function (k) { if (actors[k].id !== undefined) actors[k].id = s(actors[k].id); });
  Object.keys(musicals).forEach(function (k) { if (musicals[k].id !== undefined) musicals[k].id = s(musicals[k].id); });
  applyRatingDemoData();
  rebuildRatingIndexes();

  var coWorkByActor = {};
  coWork.forEach(function (e) {
    if (e.a === e.b) return;                       // 防御：剔除"自己共演自己"的异常数据
    (coWorkByActor[e.a] = coWorkByActor[e.a] || []).push(e);
    (coWorkByActor[e.b] = coWorkByActor[e.b] || []).push(e);
  });
  function actorName(id) { var a = actors[id]; return a ? a.name : "?" + id; }
  // 同名演员自动加区分标识（昵称/备注，否则 #id），避免"看起来像自己"
  var nameCount = {};
  Object.keys(actors).forEach(function (k) { nameCount[actors[k].name] = (nameCount[actors[k].name] || 0) + 1; });
  function actorLabel(id) {
    var a = actors[id];
    if (!a) return "?" + id;
    if (nameCount[a.name] > 1) {
      var dis = a.nickname || a.note || "";
      if (dis) return a.name + "（" + dis.replace(/[\s/].*$/, "").slice(0, 6) + "）";
      return a.name + "(#" + id + ")";
    }
    return a.name;
  }
  // 画布文字：纯色填充、不描边（深色画布上保持干净质感）
  function fillLabel(c, text, x, y) {
    c.save();
    c.fillStyle = "#f2f2f2";
    c.fillText(text, x, y);
    c.restore();
  }
  // 十六进制颜色 -> [r,g,b]
  function hexToRgb(hex) {
    var s = String(hex).replace("#", "");
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  // 演员光点：外围柔光（radialGradient 渐隐）+ 中心亮点，无圆形边框
  function drawLightPoint(c, x, y, n, color) {
    var rgb = hexToRgb(color || n.color);
    var glowR = Math.max(4, n.glow || 12);
    var coreR = Math.max(1.2, n.core || 2);
    c.save();
    c.globalAlpha = n.alpha;
    var g = c.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.5)");
    g.addColorStop(0.35, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.16)");
    g.addColorStop(1, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0)");
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, glowR, 0, Math.PI * 2); c.fill();
    var cg = c.createRadialGradient(x, y, 0, x, y, coreR);
    cg.addColorStop(0, "#f2f2f2");
    cg.addColorStop(0.4, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.9)");
    cg.addColorStop(1, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.2)");
    c.fillStyle = cg;
    c.beginPath(); c.arc(x, y, coreR, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // ============ hash 路由 ============
  function currentActorId() {
    var m = location.hash.match(/^#\/actor\/([^/]+)(?:\/ratings)?$/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function currentMusicalId() {
    var m = location.hash.match(/^#\/musical\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  // 路由：home / graph / contribute / actor / musical / ratings / legal
  function currentRoute() {
    var h = location.hash || "";
    if (/^#\/terms/.test(h)) return "terms";
    if (/^#\/privacy/.test(h)) return "privacy";
    if (/^#\/actor\/[^/]+\/ratings$/.test(h)) return "actor-ratings";
    if (/^#\/actor\//.test(h)) return "actor";
    if (/^#\/musical\//.test(h)) return "musical";
    if (/^#\/my-ratings/.test(h)) return "my-ratings";
    if (/^#\/contribute/.test(h)) return "contribute";
    if (/^#\/graph/.test(h)) return "graph";
    return "home";
  }
  function setNavActive(route) {
    document.querySelectorAll(".nav-links a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === route);
    });
  }
  function goActor(id) {
    var str = String(id);
    if (currentRoute() === "actor" && currentActorId() === str) { showActorView(str); return; }
    location.hash = "#/actor/" + encodeURIComponent(str);
  }
  function goActorRatings(id) { location.hash = "#/actor/" + encodeURIComponent(String(id)) + "/ratings"; }
  function goMusicalDetail(id) {
    var str = String(id);
    if (currentMusicalId() === str) { showMusicalView(str); return; }
    location.hash = "#/musical/" + encodeURIComponent(str);
  }
  // 一级页面切换不产生新返回记录；二级内容（演员详情等）才进入返回历史
  function navTo(hash, replace) {
    if (replace) {
      history.replaceState(null, "", hash);
      applyRoute();
    } else {
      location.hash = hash;
    }
  }
  function goHome() {   // 返回关系图谱
    if (!/^#\/graph/.test(location.hash)) navTo("#/graph", true);
    else showGraphView();
  }
  function goGroup(gid) { goHome(); focusGroup(gid); }   // 点团体：图谱聚焦 + 右侧信息卡（不再弹窗）
  function goMusical(mid) { goHome(); focusMusical(mid); }   // 点剧目：图谱聚焦 + 右侧信息卡（不再弹窗）
  var lastRouteHash = location.hash || "#/home";
  var legalReturnHash = "";
  window.addEventListener("hashchange", function () {
    var nextHash = location.hash || "#/home";
    if (/^#\/(terms|privacy)/.test(nextHash) && !/^#\/(terms|privacy)/.test(lastRouteHash)) {
      legalReturnHash = lastRouteHash;
    }
    lastRouteHash = nextHash;
    applyRoute();
  });

  var viewHome = document.getElementById("view-home");
  var viewGraph = document.getElementById("view-graph");
  var viewContribute = document.getElementById("view-contribute");
  var viewMyRatings = document.getElementById("view-my-ratings");
  var viewActorRatings = document.getElementById("view-actor-ratings");
  var viewLegal = document.getElementById("view-legal");
  var legalTerms = document.getElementById("legal-terms");
  var legalPrivacy = document.getElementById("legal-privacy");
  var homeView = document.getElementById("home-view");
  var actorView = document.getElementById("actor-view");
  var musicalView = document.getElementById("musical-view");

  function showHomeView() {
    viewHome.classList.remove("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.add("hidden");
    if (viewMyRatings) viewMyRatings.classList.add("hidden");
    if (viewLegal) viewLegal.classList.add("hidden");
    homeView.classList.add("hidden");
    actorView.classList.add("hidden");
    musicalView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("home");
  }
  var pendingGraphFocus = null;   // 详情页「在图谱中查看」→ 返回图谱并聚焦该演员
  function goGraphFocus(id) {
    pendingGraphFocus = id;
    // hash 需要变化时交给 hashchange -> applyRoute 处理（避免同步再调一次 showGraphView，
    // 否则 applyRoute 的 side-open 清理会把刚弹出的信息面板又关掉）
    if (location.hash !== "#/graph") { location.hash = "#/graph"; return; }
    showGraphView();
  }
  var graphResumeVersion = 0;
  function showGraphView() {
    viewHome.classList.add("hidden");
    viewGraph.classList.remove("hidden");
    viewContribute.classList.add("hidden");
    if (viewMyRatings) viewMyRatings.classList.add("hidden");
    if (viewLegal) viewLegal.classList.add("hidden");
    homeView.classList.remove("hidden");
    actorView.classList.add("hidden");
    musicalView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("graph");
    // 移动端从详情页返回时，浏览器需要一帧完成视图切换，下一帧才能读到真实画布尺寸。
    // 等布局稳定后再恢复图谱，避免把隐藏状态的画布错误地重置为 100 × 100。
    var resumeVersion = ++graphResumeVersion;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (resumeVersion !== graphResumeVersion || homeView.classList.contains("hidden")) return;
        resizeHome();
        if (!homeLaidOut) { homeLaidOut = true; buildGraph(); layoutAndCenter(); playEntrance(); }
        requestAnimationFrame(draw);
        maybeShowFirstHint();
        if (pendingGraphFocus) {
          var f = pendingGraphFocus;
          pendingGraphFocus = null;
          if (scene) { scene = null; sceneHighlight = {}; hideSceneCard(); stripSceneFromHash(); }
          restoreFocus(f);
        } else {
          handleSceneFromHash();
        }
      });
    });
  }
  function showContributeView() {
    viewHome.classList.add("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.remove("hidden");
    if (viewMyRatings) viewMyRatings.classList.add("hidden");
    if (viewLegal) viewLegal.classList.add("hidden");
    homeView.classList.add("hidden");
    actorView.classList.add("hidden");
    musicalView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("contribute");
    // 顶部 Feedback 入口始终回到一级页；已填写内容仍由草稿机制保留。
    if (fbRoot) fbShow(fbRoot);
  }
  function showActorView(id) {
    viewHome.classList.add("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.add("hidden");
    if (viewMyRatings) viewMyRatings.classList.add("hidden");
    if (viewLegal) viewLegal.classList.add("hidden");
    homeView.classList.add("hidden");
    actorView.classList.remove("hidden");
    musicalView.classList.add("hidden");
    document.body.classList.add("actor-mode");
    setNavActive("graph");
    hidePanel();
    renderActorPage(id);
  }
  function showMusicalView(id) {
    viewHome.classList.add("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.add("hidden");
    if (viewMyRatings) viewMyRatings.classList.add("hidden");
    if (viewLegal) viewLegal.classList.add("hidden");
    homeView.classList.add("hidden");
    actorView.classList.add("hidden");
    musicalView.classList.remove("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("graph");
    hidePanel();
    renderMusicalPage(id);
  }
  function showMyRatingsView() {
    viewHome.classList.add("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.add("hidden");
    if (viewMyRatings) viewMyRatings.classList.remove("hidden");
    if (viewLegal) viewLegal.classList.add("hidden");
    homeView.classList.add("hidden");
    actorView.classList.add("hidden");
    musicalView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("");
    renderMyRatingsPage();
  }
  function showActorRatingsView(id) {
    viewHome.classList.add("hidden"); viewGraph.classList.add("hidden"); viewContribute.classList.add("hidden");
    if (viewMyRatings) viewMyRatings.classList.add("hidden");
    if (viewLegal) viewLegal.classList.add("hidden");
    if (viewActorRatings) viewActorRatings.classList.remove("hidden");
    homeView.classList.add("hidden"); actorView.classList.add("hidden"); musicalView.classList.add("hidden");
    document.body.classList.remove("actor-mode"); setNavActive("graph"); hidePanel();
    renderActorRatingsPage(id);
  }
  function showLegalView(kind) {
    viewHome.classList.add("hidden"); viewGraph.classList.add("hidden"); viewContribute.classList.add("hidden");
    if (viewMyRatings) viewMyRatings.classList.add("hidden");
    if (viewActorRatings) viewActorRatings.classList.add("hidden");
    homeView.classList.add("hidden"); actorView.classList.add("hidden"); musicalView.classList.add("hidden");
    if (viewLegal) viewLegal.classList.remove("hidden");
    if (legalTerms) legalTerms.classList.toggle("hidden", kind !== "terms");
    if (legalPrivacy) legalPrivacy.classList.toggle("hidden", kind !== "privacy");
    if (viewLegal) viewLegal.setAttribute("aria-labelledby", kind === "terms" ? "legal-title" : "legal-privacy-title");
    document.body.classList.remove("actor-mode"); setNavActive(""); hidePanel();
    window.scrollTo(0, 0);
  }
  function applyRoute() {
    document.body.classList.remove("side-open");   // 切页时收起右侧信息面板
    if (viewActorRatings) viewActorRatings.classList.add("hidden");
    var route = currentRoute();
    if (route === "terms" || route === "privacy") showLegalView(route);
    else if (route === "actor") showActorView(currentActorId());
    else if (route === "actor-ratings") showActorRatingsView(currentActorId());
    else if (route === "musical") showMusicalView(currentMusicalId());
    else if (route === "my-ratings") showMyRatingsView();
    else if (route === "graph") showGraphView();
    else if (route === "contribute") showContributeView();
    else showHomeView();
    syncSceneFilter();
  }

  // ============ 首页：全局图谱（舞台追光互动） ============
  var canvas = document.getElementById("graph"), ctx = canvas.getContext("2d");
  var view = { x: 0, y: 0, zoom: 1 };
  var nodes = {}, edges = [];
  var visibleTypes = {};
  ["couple", "cp", "classmate", "co_work", "married", "ex"]
    .forEach(function (ty) { visibleTypes[ty] = true; });

  // ============ 首页：全局图谱（舞台追光互动） ============
  var MUS_COLOR = "#5d9187";            // 剧目节点颜色（青绿，与金色演员节点区分）
  var FOCUS_COWORK_N = 15;              // 聚焦展开：常共演人数
  var FOCUS_MUSICAL_N = 8;              // 聚焦展开：剧目数
  var MAX_NODES = 420;                  // 聚焦展开后的节点上限
  var NODE_R_MIN = 6, NODE_R_MAX = 18;  // 演员节点半径范围（按影响力）
  var LERP = 0.18;                      // alpha/半径平滑系数（约 300-500ms 收敛）

  // ---- 节点 4 层级（imp 分位）：普通/活跃/明星/核心，用「尺寸 + 光晕 + 亮度」拉开层级 ----
  var IMP_TIER_P = [0.35, 0.60, 0.85];  // 分位阈值（核心 >= P85 / 明星 P60-85 / 活跃 P35-60 / 普通 < P35）
  var HOME_WORK_N = 48;                 // 首页全局图谱展示的作品数（Top N）
  var TIER_SPEC = {
    core:   { core: 4.6, glow: 38, hitR: 26 },   // 核心：最大最亮的星点（强光晕）
    star:   { core: 3.6, glow: 22, hitR: 20 },
    active: { core: 2.8, glow: 14, hitR: 18 },
    normal: { core: 1.8, glow: 8,  hitR: 15 }
  };
  var impTierThresholds = null;         // 缓存：按首页关系演员集合的 imp 分位计算，全站一致
  function computeImpTierThresholds() {
    if (impTierThresholds) return impTierThresholds;
    var vals = [];
    var active = {};
    relations.forEach(function (r) { if (visibleTypes[r.type]) { active[r.a] = true; active[r.b] = true; } });
    Object.keys(active).forEach(function (id) {
      var c = D.actorCounts && D.actorCounts[id];
      if (c && typeof c.imp === "number") vals.push(c.imp);
    });
    vals.sort(function (a, b) { return a - b; });
    function pct(p) { return vals.length ? vals[Math.floor(p * (vals.length - 1))] : 0; }
    impTierThresholds = { p35: pct(IMP_TIER_P[0]), p60: pct(IMP_TIER_P[1]), p85: pct(IMP_TIER_P[2]) };
    return impTierThresholds;
  }
  function tierOf(imp) {
    var t = computeImpTierThresholds();
    if (imp >= t.p85) return "core";
    if (imp >= t.p60) return "star";
    if (imp >= t.p35) return "active";
    return "normal";
  }

  var focusId = null;                   // 当前聚焦演员 id（null=全局视图）
  var backHistory = [];                 // 聚焦历史（单击空白返回上一级，双击空白回默认）
  var hoverId = null;                   // 当前悬停节点 key
  var depthCenterId = null;             // 景深中心节点 key
  var maxDepth = 0;                     // 距景深中心的最大距离（每帧重算）
  var viewTween = null;                 // 视图动画：聚焦时把目标演员送到画面中心
  var scene = null;                     // 场景模式：null=全局 / actors=热门演员Top20 / musicals=全部剧目 / groups=团体一览 / search=聚焦搜索
  var sceneHighlight = {};              // 场景模式下被点亮的节点 key 集合
  var homeLaidOut = false;               // 图谱是否已用真实画布尺寸完成首次布局（隐藏画布时布局尺寸为 0）

  // ---- 演员影响力统计：出演剧目数 / 合作人数 / 关系度 ----
  var actorStats = {};
  function computeStats(id) {
    if (actorStats[id]) return actorStats[id];
    var c = (D.actorCounts && D.actorCounts[id]) || {};
    var musicalsN = c.musicals || Object.keys(actorMusicals[id] || {}).length;
    var partnersN = c.partners || (coWorkByActor[id] || []).length;
    var deg = 0;
    relations.forEach(function (r) { if (r.a === id || r.b === id) deg++; });
    actorStats[id] = {
      musicals: musicalsN,
      partners: partnersN,
      degree: deg,
      weight: Math.log1p(0.4 * musicalsN + 0.4 * partnersN + 1.0 * deg)
    };
    return actorStats[id];
  }

  function ensureActorNode(id) {
    if (nodes[id]) return nodes[id];
    var a = actors[id] || { name: actorName(id) };
    nodes[id] = {
      id: id, key: id, type: "actor",
      x: Math.random() * 1000 - 500, y: Math.random() * 1000 - 500,
      vx: 0, vy: 0, r: 3, core: 3, coreBase: 3, glow: 16, glowBase: 16,
      importance: 0.5, hitR: 18, alpha: 0, targetAlpha: 1,
      color: "#c9a961", label: a.name, deg: 0, fixed: false   // 舞台暖金（演员光点保持金色）
    };
    return nodes[id];
  }
  function ensureMusicalNode(mid) {
    var key = "mus:" + mid;
    if (nodes[key]) return nodes[key];
    var m = musicals[mid];
    nodes[key] = {
      id: mid, key: key, type: "musical",
      x: Math.random() * 1000 - 500, y: Math.random() * 1000 - 500,
      vx: 0, vy: 0, r: 3, core: 3, coreBase: 3, glow: 20, glowBase: 20,
      importance: 0.6, hitR: 16, alpha: 0, targetAlpha: 1,
      color: MUS_COLOR, label: m ? m.name : "?" + mid, fixed: false
    };
    return nodes[key];
  }
  function ensureGroupNode(g) {
    var key = "grp:" + g.id;
    if (nodes[key]) return nodes[key];
    nodes[key] = {
      id: g.id, key: key, type: "group",
      x: Math.random() * 1000 - 500, y: Math.random() * 1000 - 500,
      vx: 0, vy: 0, r: 4, core: 4, coreBase: 4, glow: 22, glowBase: 22,
      importance: 0.7, hitR: 18, alpha: 0, targetAlpha: 1,
      color: "#8a7bb5", label: g.name, fixed: false
    };
    return nodes[key];
  }

  // 新节点放在焦点演员周围的随机环带，等待力导向收敛
  function placeNewNode(n) {
    var angle = Math.random() * Math.PI * 2;
    var rad = 130 + Math.random() * 220;
    n.x = Math.cos(angle) * rad;
    n.y = Math.sin(angle) * rad;
  }

  // 聚焦展开：追加常共演前 N 人 + 参演剧目前 N 部
  function addFocusExpansions(id) {
    (coWorkByActor[id] || []).slice().sort(function (x, y) { return y.count - x.count; })
      .forEach(function (e) {
        if (Object.keys(nodes).length >= MAX_NODES) return;
        var o = e.a === id ? e.b : e.a;
        if (o === id) return;
        if (!nodes[o]) placeNewNode(ensureActorNode(o));
      });
    var mids = (D.actorMusicalIds && D.actorMusicalIds[id]) || [];
    mids.slice(0, FOCUS_MUSICAL_N).forEach(function (mid) {
      if (Object.keys(nodes).length >= MAX_NODES) return;
      if (!nodes["mus:" + mid]) placeNewNode(ensureMusicalNode(mid));
    });
  }

  // 重建关系边：共演线（按场次显粗细/浓淡）+ 明确关系线 + 演员-剧目线
  function rebuildEdges() {
    edges = [];
    if (visibleTypes["co_work"]) {
      coWork.forEach(function (e) {
        if (!nodes[e.a] || !nodes[e.b]) return;
        var t = Math.min(1, e.count / 350);
        edges.push({
          a: e.a, b: e.b, type: "co_work", color: TYPE_COLOR["co_work"], dashed: true,
          width: 0.35 + t * 0.6, alphaBase: 0.10 + t * 0.22, alpha: 0, count: e.count
        });
      });
    }
    relations.forEach(function (r) {
      if (!visibleTypes[r.type]) return;
      if (!nodes[r.a] || !nodes[r.b]) return;
      edges.push({
        a: r.a, b: r.b, type: r.type, color: TYPE_COLOR[r.type] || "#999", dashed: false,
        width: 0.7, alphaBase: 0.34, alpha: 0, count: 0,
        label: r.typeName + (r.detail ? " · " + r.detail : "")
      });
      nodes[r.a].deg++; nodes[r.b].deg++;
    });
    if (D.actorMusicalIds) {
      Object.keys(nodes).forEach(function (k) {
        var n = nodes[k];
        if (n.type !== "actor") return;
        var mids = D.actorMusicalIds[n.id] || [];
        mids.forEach(function (mid) {
          var mk = "mus:" + mid;
          if (nodes[mk]) edges.push({ a: k, b: mk, type: "musical", color: MUS_COLOR, dashed: false, width: 0.45, alphaBase: 0.28, alpha: 0, count: 0 });
        });
      });
    }
    // 团体-成员边（团体维度）
    groups.forEach(function (g) {
      var gk = "grp:" + g.id;
      if (!nodes[gk]) return;
      (g.members || []).forEach(function (aid) {
        if (!nodes[aid]) return;
        edges.push({ a: gk, b: aid, type: "group", color: "#8a7bb5", dashed: true, width: 0.6, alphaBase: 0.22, alpha: 0, count: 0 });
      });
    });
  }

  // 影响力由光效表达：核心亮点与光晕半径随 importance 递增（不再用大尺寸区分）
  function applyNodeRadii() {
    var ws = [];
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (n.type === "musical") {
        n.coreBase = 4; n.glowBase = 20; n.importance = 0.6; n.hitR = 16;
        n.core = 4; n.glow = 20;
        return;
      }
      if (n.type === "group") return;
      n.w = computeStats(n.id).weight;
      ws.push(n.w);
    });
    if (!ws.length) return;
    var minW = Math.min.apply(null, ws), maxW = Math.max.apply(null, ws);
    var span = (maxW - minW) || 1;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (n.type === "musical") return;
      // 优先使用导出的重要度 imp（大剧场经历 / 剧目多样性 / 角色深耕）；无则退回旧权重归一化
      var c = D.actorCounts && D.actorCounts[n.id];
      var imp = (c && typeof c.imp === "number") ? c.imp : (n.w - minW) / span;
      n.importance = imp;
      var tier = tierOf(imp);
      n.tier = tier;
      var spec = TIER_SPEC[tier];
      n.coreBase = spec.core;            // 4 层级：核心=圆环+亮点 / 明星=大亮点 / 活跃=中点 / 普通=小点
      n.glowBase = spec.glow;
      n.hitR = spec.hitR;             // 命中区域随层级放大，保证小光点易点
      n.core = n.coreBase;
      n.glow = n.glowBase;
    });
  }

  // 首页全局图谱：补充作品节点（Top N，按「参演演员数 > 演出场次 > 巡演城市数」排序）
  function addHomeWorkNodes() {
    var stat = {};
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (n.type !== "actor") return;
      var mids = (D.actorMusicalIds && D.actorMusicalIds[n.id]) || [];
      mids.forEach(function (mid) {
        if (!stat[mid]) stat[mid] = { actors: 0, shows: 0, cities: 0 };
        stat[mid].actors++;
        var ms = (D.musicalStats && D.musicalStats[mid]) || {};
        stat[mid].shows = ms.shows || 0;
        stat[mid].cities = ms.cities || 0;
      });
    });
    var ranked = Object.keys(stat).sort(function (a, b) {
      return (stat[b].actors - stat[a].actors) || (stat[b].shows - stat[a].shows) || (stat[b].cities - stat[a].cities);
    }).slice(0, HOME_WORK_N);
    ranked.forEach(function (mid) { ensureMusicalNode(mid); });
  }

  // 首页全局图谱：补充团体节点（团体维度，进入图谱即展示）
  function addHomeGroupNodes() {
    groups.forEach(function (g) { ensureGroupNode(g); });
  }

  // 构建图谱：base 为参与可见类型关系的演员；focusId 存在时以其为中心展开
  function buildGraph(focusId) {
    nodes = {}; edges = [];
    var active = {};
    relations.forEach(function (r) {
      if (visibleTypes[r.type]) { active[r.a] = true; active[r.b] = true; }
    });
    Object.keys(active).forEach(function (id) { ensureActorNode(id); });
    if (!focusId && !scene) { addHomeWorkNodes(); addHomeGroupNodes(); }   // 首页全局图谱：作品维度 + 团体维度
    if (focusId) {
      ensureActorNode(focusId);
      addFocusExpansions(focusId);
    }
    rebuildEdges();
    applyNodeRadii();
  }

  // ---- 布局与入场动效 ----
  var entranceT = 1, entranceStart = 0;   // entranceT: 0→1 入场进度

  function physicsStep() {
    var list = Object.keys(nodes).map(function (k) { return nodes[k]; });
    var ks = 0.02, kr = 1400, kd = 0.85, dt = 0.3;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
        var f = kr / (d * d);
        var fx = dx / d * f, fy = dy / d * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    edges.forEach(function (e) {
      var a = nodes[e.a], b = nodes[e.b];
      if (!a || !b) return;
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
      var f = (d - 130) * ks;
      var fx = dx / d * f, fy = dy / d * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    });
    list.forEach(function (n) {
      if (n.fixed) return;
      n.vx *= kd; n.vy *= kd;
      n.x += n.vx * dt; n.y += n.vy * dt;
    });
  }

  // ---- 首页 Actor+Work 双层布局：作品层聚簇 → 演员层环绕 → 团体第三层约束 ----
  function homeWorkLayout() {
    var KEYS = Object.keys(nodes);
    var works = [], actors = [], grps = [];
    KEYS.forEach(function (k) { var n = nodes[k]; if (n.type === "musical") works.push(n); else if (n.type === "actor") actors.push(n); else if (n.type === "group") grps.push(n); });
    if (!works.length) { for (var i = 0; i < 320; i++) physicsStep(); return; }
    // 作品 -> 参演演员（仅当前可见的演员）
    var workActors = {};
    actors.forEach(function (a) {
      var mids = (D.actorMusicalIds && D.actorMusicalIds[a.id]) || [];
      mids.forEach(function (mid) { if (nodes["mus:" + mid]) (workActors[mid] = workActors[mid] || []).push(a.id); });
    });
    // 共享演员 -> 作品对互相吸引（作品聚类）
    var sharePair = {};
    for (var i = 0; i < works.length; i++) {
      for (var j = i + 1; j < works.length; j++) {
        var ai = workActors[works[i].id], aj = workActors[works[j].id];
        if (!ai || !aj) continue;
        var shared = false;
        for (var s = 0; s < ai.length; s++) { if (aj.indexOf(ai[s]) >= 0) { shared = true; break; } }
        if (shared) sharePair[works[i].id + "|" + works[j].id] = true;
      }
    }
    var KR = 2800, KD = 0.85, DT = 0.3, KS = 0.02, REST_WW = 180, REST_AW = 100, K_CENTER = 0.01, K_ACTOR_WORK = 0.05, K_GROUP_NODE = 0.06, REST_AG = 90, K_ACTOR_GROUP = 0.02;
    var grpData = {};
    groups.forEach(function (x) { grpData["grp:" + x.id] = x; });
    var WORK_LAYOUT_ITERS = 150, ACTOR_LAYOUT_ITERS = 120, GROUP_LAYOUT_ITERS = 60;
    function applyForces(moveActors) {
      // 排斥（作品-作品 / 作品-演员 / 演员-演员）
      var all = moveActors ? actors.concat(works).concat(grps) : works;
      for (var i = 0; i < all.length; i++) {
        for (var j = i + 1; j < all.length; j++) {
          var a = all[i], b = all[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          var f = KR / (d * d);
          var fx = dx / d * f, fy = dy / d * f;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      // 作品-作品：共享演员的作品互相吸引（聚类）
      for (var i = 0; i < works.length; i++) {
        for (var j = i + 1; j < works.length; j++) {
          if (!sharePair[works[i].id + "|" + works[j].id]) continue;
          var a = works[i], b = works[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          var f = (d - REST_WW) * KS;
          var fx = dx / d * f, fy = dy / d * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      if (moveActors) {
        // 演员 -> 自己参演作品的质心（环绕作品；共享演员被多簇拉扯形成桥梁）
        actors.forEach(function (n) {
          var mids = (D.actorMusicalIds && D.actorMusicalIds[n.id]) || [];
          var cx = 0, cy = 0, cnt = 0;
          mids.forEach(function (mid) { var w = nodes["mus:" + mid]; if (!w) return; cx += w.x; cy += w.y; cnt++; });
          if (cnt) {
            var dx = (cx / cnt) - n.x, dy = (cy / cnt) - n.y;
            var dd = Math.sqrt(dx * dx + dy * dy) + 1e-6;
            var f = (dd - REST_AW) * K_ACTOR_WORK;   // 保持一定距离环绕，避免贴脸
            n.vx += dx / dd * f; n.vy += dy / dd * f;
          } else {    // 无作品：轻微吸向画面中心，防止漂走
            n.vx -= n.x * K_CENTER; n.vy -= n.y * K_CENTER;
          }
        });
        // 团体维度：团体节点吸向成员质心；成员轻微环绕团体节点
        grps.forEach(function (g) {
          var gd = grpData[g.key];
          var ms = (gd && gd.members || []).filter(function (id) { return nodes[id]; });
          if (!ms.length) return;
          var cx = 0, cy = 0;
          ms.forEach(function (id) { cx += nodes[id].x; cy += nodes[id].y; });
          cx /= ms.length; cy /= ms.length;
          g.vx += (cx - g.x) * K_GROUP_NODE; g.vy += (cy - g.y) * K_GROUP_NODE;
          ms.forEach(function (id) {
            var n = nodes[id];
            var dx = g.x - n.x, dy = g.y - n.y;
            var dd = Math.sqrt(dx * dx + dy * dy) + 1e-6;
            var f = (dd - REST_AG) * K_ACTOR_GROUP;
            n.vx += dx / dd * f; n.vy += dy / dd * f;
          });
        });
      }
      // 积分 + 阻尼
      var moving = moveActors ? actors.concat(grps) : works;
      moving.forEach(function (n) { n.vx *= KD; n.vy *= KD; n.x += n.vx * DT; n.y += n.vy * DT; });
    }
    // 阶段 1：作品层聚簇（演员不动）；阶段 2：演员层环绕；阶段 3：团体约束加强
    for (var i = 0; i < WORK_LAYOUT_ITERS; i++) applyForces(false);
    for (var i = 0; i < ACTOR_LAYOUT_ITERS; i++) applyForces(true);
    for (var i = 0; i < GROUP_LAYOUT_ITERS; i++) applyForces(true);
    Object.keys(nodes).forEach(function (k) { var n = nodes[k]; n.vx = 0; n.vy = 0; });
  }

  // 同步快速收敛得到稳定的"网络形状"，做归一化 + 重叠消除；最高关联人物落在中心（景深中心）
  function layoutAndCenter() {
    if (!focusId && !scene) homeWorkLayout();   // 首页：Actor+Work 双层布局（作品簇 -> 演员环绕 -> 团体约束）
    else for (var i = 0; i < 320; i++) physicsStep();
    Object.keys(nodes).forEach(function (k) { var n = nodes[k]; n.vx = 0; n.vy = 0; });
    var deg = {};
    // 中心 = 关系度数最高的演员（只统计明确关系，避免落到作品节点上）
    relations.forEach(function (r) {
      if (!visibleTypes[r.type]) return;
      if (nodes[r.a] && nodes[r.b]) { deg[r.a] = (deg[r.a] || 0) + 1; deg[r.b] = (deg[r.b] || 0) + 1; }
    });
    var best = null, bestDeg = -1;
    Object.keys(deg).forEach(function (id) { if (deg[id] > bestDeg) { bestDeg = deg[id]; best = id; } });
    if (!best && Object.keys(nodes).length) best = Object.keys(nodes)[0];
    if (best && nodes[best]) {
      var cx = nodes[best].x, cy = nodes[best].y;
      Object.keys(nodes).forEach(function (k) { nodes[k].x -= cx; nodes[k].y -= cy; });
      depthCenterId = best;
    }
    var KEYS = Object.keys(nodes);
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    KEYS.forEach(function (k) {
      var n = nodes[k];
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    });
    var w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    var TW = canvas.clientWidth - 160, TH = canvas.clientHeight - 160;
    var s = Math.min(1, TW / w, TH / h) * 1.414;
    KEYS.forEach(function (k) { nodes[k].x *= s; nodes[k].y *= s; });
    var MIN_D = 62;
    for (var it = 0; it < 100; it++) {
      var moved = false;
      for (var i = 0; i < KEYS.length; i++) {
        for (var j = i + 1; j < KEYS.length; j++) {
          var a = nodes[KEYS[i]], b = nodes[KEYS[j]];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          if (d < MIN_D) {
            var push = (MIN_D - d) / 2;
            var ux = dx / d, uy = dy / d;
            a.x -= ux * push; a.y -= uy * push;
            b.x += ux * push; b.y += uy * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    view.zoom = 0.92;
    view.x = 0; view.y = 0;
  }

  // 场景进入后：把被点亮的节点适配进视口（默认只保证约 70% 落在视口内，留出可拖动的边缘）
  function fitViewToHighlights() {
    var ks = Object.keys(sceneHighlight).filter(function (k) { return !!nodes[k]; });
    if (!ks.length) return;
    // 按到质心的距离排序，取最近的一部分（默认 70%）计算适配框，避免为了包住离群点而缩得太小
    var cx0 = 0, cy0 = 0;
    ks.forEach(function (k) { cx0 += nodes[k].x; cy0 += nodes[k].y; });
    cx0 /= ks.length; cy0 /= ks.length;
    var ordered = ks.slice().sort(function (a, b) {
      var da = (nodes[a].x - cx0) * (nodes[a].x - cx0) + (nodes[a].y - cy0) * (nodes[a].y - cy0);
      var db = (nodes[b].x - cx0) * (nodes[b].x - cx0) + (nodes[b].y - cy0) * (nodes[b].y - cy0);
      return da - db;
    });
    var take = Math.max(1, Math.round(ordered.length * 0.7));
    var subset = ordered.slice(0, take);
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    subset.forEach(function (k) {
      var n = nodes[k];
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    });
    var w = Math.max(60, maxX - minX), h = Math.max(60, maxY - minY);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var pad = 40;
    var zoom = Math.min(2.0, Math.max(0.3,
      Math.min((canvas.clientWidth - pad * 2) / w, (canvas.clientHeight - pad * 2) / h) * 1.2));
    view.zoom = zoom;
    view.x = -cx * zoom;
    view.y = -cy * zoom;
  }

  // 0.8 秒入场动效：节点从中心平滑展开到各自位置
  function playEntrance() {
    entranceT = 0;
    entranceStart = performance.now();
  }
  function updateEntrance(now) {
    if (entranceT >= 1) return;
    var t = Math.min(1, (now - entranceStart) / 800);
    entranceT = 1 - Math.pow(1 - t, 3);   // easeOutCubic
  }

  // ---- 视图动画：聚焦时把原点（焦点演员）平滑送到画面中心 ----
  function animateViewTo(tx, ty, tz, ms) {
    viewTween = { fx: view.x, fy: view.y, fz: view.zoom, tx: tx, ty: ty, tz: tz, start: performance.now(), ms: ms || 500 };
  }
  function updateViewTween(now) {
    if (!viewTween) return;
    var t = Math.min(1, (now - viewTween.start) / viewTween.ms);
    var e = 1 - Math.pow(1 - t, 3);
    view.x = viewTween.fx + (viewTween.tx - viewTween.fx) * e;
    view.y = viewTween.fy + (viewTween.ty - viewTween.fy) * e;
    view.zoom = viewTween.fz + (viewTween.tz - viewTween.fz) * e;
    if (t >= 1) viewTween = null;
  }
  function cancelViewTween() { viewTween = null; }

  // 短时力导向温习：旧节点固定、新节点收敛，随后重叠消除（fixed 节点不被动）
  function warmUpLayout(steps) {
    for (var i = 0; i < steps; i++) physicsStep();
    Object.keys(nodes).forEach(function (k) { nodes[k].vx = 0; nodes[k].vy = 0; });
    var KEYS = Object.keys(nodes);
    var MIN_D = 62;
    for (var it = 0; it < 60; it++) {
      var moved = false;
      for (var i = 0; i < KEYS.length; i++) {
        for (var j = i + 1; j < KEYS.length; j++) {
          var a = nodes[KEYS[i]], b = nodes[KEYS[j]];
          if (a.fixed && b.fixed) continue;
          var dx = b.x - a.x, dy = b.y - a.y;
          var d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          if (d < MIN_D) {
            var push = (MIN_D - d) / 2;
            var ux = dx / d, uy = dy / d;
            if (a.fixed) { b.x += ux * push * 2; b.y += uy * push * 2; }
            else if (b.fixed) { a.x -= ux * push * 2; a.y -= uy * push * 2; }
            else { a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; }
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    Object.keys(nodes).forEach(function (k) { nodes[k].fixed = false; });
  }

  // 单击聚焦：以该演员为中心重建并展开（幂等：同一人再次单击不重复重排）
  function focusActor(id) {
    if (focusId === id) { showFocusCard(id); return; }   // 已聚焦同一人：仅重新拉出信息卡，不重复重排
    if (scene) { scene = null; sceneHighlight = {}; hideSceneCard(); stripSceneFromHash(); }   // 点演员聚焦：退出场景，只保留个人信息
    var oldPos = {};
    Object.keys(nodes).forEach(function (k) { oldPos[k] = { x: nodes[k].x, y: nodes[k].y }; });
    focusId = id;
    buildGraph(focusId);
    Object.keys(oldPos).forEach(function (k) { if (nodes[k]) { nodes[k].x = oldPos[k].x; nodes[k].y = oldPos[k].y; } });
    var c = nodes[id];
    if (!c) { resetHome(); return; }
    var dx = -c.x, dy = -c.y;
    Object.keys(nodes).forEach(function (k) { nodes[k].x += dx; nodes[k].y += dy; });
    depthCenterId = id;
    Object.keys(nodes).forEach(function (k) { nodes[k].fixed = !(oldPos[k] !== undefined); });
    nodes[id].fixed = true;
    warmUpLayout(140);
    animateViewTo(0, 0, 0.92, 500);
    showFocusCard(id);
    updateStats();
  }

  // 单击聚焦剧目：作品成为焦点，右侧信息卡展示演员表（取代旧居中弹窗）
  function focusMusical(mid) {
    var mk = "mus:" + mid;
    if (focusId === mk) { showMusicalFocusCard(mid); return; }   // 幂等：已聚焦同一剧目
    var oldPos = {};
    Object.keys(nodes).forEach(function (k) { oldPos[k] = { x: nodes[k].x, y: nodes[k].y }; });
    if (scene) { scene = null; sceneHighlight = {}; hideSceneCard(); stripSceneFromHash(); }
    focusId = mk;
    var m = musicals[mid];
    if (!m) { resetHome(); return; }
    // 只保留一层关系：剧目节点 + 出演过该剧目的演员（不再展开全局网络/共演等推断关系）
    nodes = {}; edges = [];
    ensureMusicalNode(mid);
    var cast = (m.cast || []).slice(0, MAX_NODES - 1);
    cast.forEach(function (aid) { ensureActorNode(aid); });
    // 一层边：演员 ↔ 本剧目 + 参演演员之间的明确关系（不画共演等机器推断边）
    cast.forEach(function (aid) {
      edges.push({ a: aid, b: mk, type: "musical", color: MUS_COLOR, dashed: false, width: 0.45, alphaBase: 0.28, alpha: 0, count: 0 });
    });
    var seenRel = {};
    relations.forEach(function (r) {
      if (!visibleTypes[r.type]) return;
      if (!nodes[r.a] || !nodes[r.b]) return;
      if (r.a === mk || r.b === mk) return;
      var k = r.a < r.b ? r.a + "|" + r.b : r.b + "|" + r.a;
      if (seenRel[k]) return;
      seenRel[k] = true;
      edges.push({ a: r.a, b: r.b, type: r.type, color: TYPE_COLOR[r.type] || "#999", dashed: false, width: 0.7, alphaBase: 0.34, alpha: 0, count: 0, label: r.typeName + (r.detail ? " · " + r.detail : "") });
      nodes[r.a].deg++; nodes[r.b].deg++;
    });
    applyNodeRadii();
    Object.keys(oldPos).forEach(function (k) { if (nodes[k]) { nodes[k].x = oldPos[k].x; nodes[k].y = oldPos[k].y; } });
    var c = nodes[mk];
    if (!c) { resetHome(); return; }
    var dx = -c.x, dy = -c.y;
    Object.keys(nodes).forEach(function (k) { nodes[k].x += dx; nodes[k].y += dy; });
    depthCenterId = mk;
    Object.keys(nodes).forEach(function (k) { nodes[k].fixed = !(oldPos[k] !== undefined); });
    nodes[mk].fixed = true;
    warmUpLayout(140);
    animateViewTo(0, 0, 0.92, 500);
    showMusicalFocusCard(mid);
    updateStats();
  }

  // 单击聚焦团体：团体成为焦点，右侧信息卡展示成员（单层：团体 + 成员 + 成员间明确关系）
  function focusGroup(gid) {
    var gk = "grp:" + gid;
    if (focusId === gk) { showGroupFocusCard(gid); return; }   // 幂等：已聚焦同一团体
    var oldPos = {};
    Object.keys(nodes).forEach(function (k) { oldPos[k] = { x: nodes[k].x, y: nodes[k].y }; });
    if (scene) { scene = null; sceneHighlight = {}; hideSceneCard(); stripSceneFromHash(); }
    focusId = gk;
    var g = null;
    groups.forEach(function (x) { if (String(x.id) === String(gid)) g = x; });
    if (!g) { resetHome(); return; }
    nodes = {}; edges = [];
    ensureGroupNode(g);
    (g.members || []).slice(0, MAX_NODES - 1).forEach(function (aid) { ensureActorNode(aid); });
    // 一层边：成员 ↔ 团体 + 成员之间的明确关系（不画共演等推断边）
    (g.members || []).forEach(function (aid) {
      if (nodes[aid]) edges.push({ a: gk, b: aid, type: "group", color: "#8a7bb5", dashed: true, width: 0.6, alphaBase: 0.22, alpha: 0, count: 0 });
    });
    var seenRel = {};
    relations.forEach(function (r) {
      if (!visibleTypes[r.type]) return;
      if (!nodes[r.a] || !nodes[r.b]) return;
      var k = r.a < r.b ? r.a + "|" + r.b : r.b + "|" + r.a;
      if (seenRel[k]) return;
      seenRel[k] = true;
      edges.push({ a: r.a, b: r.b, type: r.type, color: TYPE_COLOR[r.type] || "#999", dashed: false, width: 0.7, alphaBase: 0.34, alpha: 0, count: 0, label: r.typeName + (r.detail ? " · " + r.detail : "") });
      nodes[r.a].deg++; nodes[r.b].deg++;
    });
    applyNodeRadii();
    Object.keys(oldPos).forEach(function (k) { if (nodes[k]) { nodes[k].x = oldPos[k].x; nodes[k].y = oldPos[k].y; } });
    var c = nodes[gk];
    if (!c) { resetHome(); return; }
    var dx = -c.x, dy = -c.y;
    Object.keys(nodes).forEach(function (k) { nodes[k].x += dx; nodes[k].y += dy; });
    depthCenterId = gk;
    Object.keys(nodes).forEach(function (k) { nodes[k].fixed = !(oldPos[k] !== undefined); });
    nodes[gk].fixed = true;
    warmUpLayout(140);
    animateViewTo(0, 0, 0.92, 500);
    showGroupFocusCard(gid);
    updateStats();
  }

  // 返回全局图谱（信息卡按钮 / Esc / 图例切换）
  function resetHome() {
    if (scene) { scene = null; sceneHighlight = {}; hideSceneCard(); stripSceneFromHash(); }
    focusId = null;
    backHistory = [];
    hideFocusCard();
    buildGraph();
    layoutAndCenter();
    playEntrance();
    updateStats();
    syncSceneFilter();
  }

  function restoreFocus(key) {
    if (key.indexOf("mus:") === 0) focusMusical(Number(key.slice(4)));
    else if (key.indexOf("grp:") === 0) focusGroup(Number(key.slice(4)));
    else focusActor(Number(key));
  }
  function backOne() {
    if (backHistory.length) {
      restoreFocus(backHistory.pop());
    } else {
      resetHome();
    }
  }
  function resetToDefault() {
    backHistory = [];
    resetHome();
  }

  // ============ 场景模式（首页章节卡片直达图谱的对应内容） ============
  function sceneFromHash() {
    var m = location.hash.match(/scene=([a-z_]+)/);
    return m ? m[1] : null;
  }
  function qFromHash() {
    var m = location.hash.match(/[?&]q=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function stripSceneFromHash() {
    if (!/[?&]scene=/.test(location.hash)) return;
    var base = location.hash.replace(/[?&]scene=[a-z_]+/, "").replace(/[?&]q=[^&]*/, "");
    history.replaceState(null, "", base || "#/graph");
  }
  function showSceneCard(name) {
    var info = {
      actors: "热门演员 · Top 20",
      musicals: "热门剧目 · Top 30",
      groups: "团体一览",
      moments: "精彩片段"
    }[name];
    var card = document.getElementById("scene-card");
    if (!card || !info) { hideSceneCard(); return; }
    document.getElementById("scene-name").textContent = info;
    document.getElementById("scene-desc").textContent =
      name === "actors" ? "按影响力（剧目数 / 合作人数 / 关系度）排名的前 20 位演员。"
      : name === "musicals" ? "按演出场次与巡演城市数排序的热门剧目 Top 30。"
      : name === "moments" ? "通过舞台高光片段了解演员。"
      : "共 " + groups.length + " 个团体（同班同学 / 室友 / 其他）。";
    var momBox = document.getElementById("scene-moments");
    if (momBox) {
      if (name === "moments") {
        var rows = moments.map(function (m) {
          return { name: actorLabel(m.actorId), title: m.title, url: m.url, source: m.source };
        });
        rows.sort(function (a, b) {
          return a.name < b.name ? -1 : a.name > b.name ? 1 : (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
        });
        momBox.innerHTML = "<div class='fc-mom-title'>推荐片段</div><ul class='scene-mom-list'>" +
          rows.map(function (r) {
            var url = safeUrl(r.url);
            var t = url
              ? "<a class='mom-title' href='" + escAttr(url) + "' target='_blank' rel='noopener noreferrer'>" + escHtml(r.title) + "</a>"
              : "<span class='mom-title'>" + escHtml(r.title) + "</span>";
            return "<li><span class='scene-mom-actor'>" + escHtml(r.name) + "</span>" + t +
              "<span class='mom-src'>" + escHtml(SOURCE_LABEL[r.source] || r.source || "") + "</span></li>";
          }).join("") + "</ul>";
        momBox.classList.remove("hidden");
      } else {
        momBox.classList.add("hidden");
        momBox.innerHTML = "";
      }
    }
    var addMom = document.getElementById("scene-add-moment");
    if (addMom) addMom.classList.toggle("hidden", name !== "moments");
    card.classList.remove("hidden");
    document.body.classList.add("side-open");     // 场景卡显示 -> 右侧面板滑出
  }
  function hideSceneCard() {
    var c = document.getElementById("scene-card");
    if (c) c.classList.add("hidden");
    document.body.classList.remove("side-open");
  }
  // 底部场景筛选条：按当前场景同步高亮；点击切换/退出
  function syncSceneFilter() {
    var bar = document.getElementById("scene-filter");
    if (!bar) return;
    bar.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", scene === b.getAttribute("data-scene"));
    });
  }
  var sceneFilter = document.getElementById("scene-filter");
  if (sceneFilter) {
    sceneFilter.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("button[data-scene]") : null;
      if (!btn) return;
      var s = btn.getAttribute("data-scene");
      if (scene === s) navTo("#/graph", true);          // 再点一次：退出筛选回全局
      else navTo("#/graph?scene=" + s, true);            // 进入对应筛选场景
    });
  }
  function focusSearch(q) {
    var el = document.getElementById("search");
    var box = document.querySelector(".search-box");
    var topBox = document.getElementById("top-search-box");
    if (topBox) openTopSearch();   // 展开顶部搜索框（平时收起）
    if (el) {
      el.focus();
      if (q) { el.value = q; el.dispatchEvent(new Event("input", { bubbles: true })); }
    }
    if (el) {
      el.classList.add("pulse");
      setTimeout(function () { el.classList.remove("pulse"); }, 1800);
    }
  }
  function enterScene(name) {
    if (name === "search") { scene = null; sceneHighlight = {}; focusSearch(qFromHash()); return; }
    scene = name;
    sceneHighlight = {};
    focusId = null;
    hoverId = null;
    hideFocusCard();
    hidePanel();
    if (name === "actors") {
      // 场景：热门演员 Top 20（按影响力 weight 排序），其余演员压暗
      buildGraph();
      var ranked = Object.keys(actors).map(function (id) { return { id: id, w: computeStats(id).weight }; })
        .sort(function (a, b) { return b.w - a.w; }).slice(0, 20);
      ranked.forEach(function (x) { ensureActorNode(x.id); sceneHighlight[x.id] = true; });
      rebuildEdges();
      applyNodeRadii();
    } else if (name === "musicals") {
      // 场景：热门剧目 Top 30（按演出场次 + 巡演城市数排序），只显示剧目名字，不画任何线
      nodes = {};
      edges = [];
      var mStats = D.musicalStats || {};
      var mRanked = Object.keys(musicals).map(function (mid) {
        var s = mStats[mid] || {};
        return { id: mid, shows: s.shows || 0, cities: s.cities || 0 };
      }).sort(function (a, b) { return (b.shows - a.shows) || (b.cities - a.cities); }).slice(0, 30);
      mRanked.forEach(function (x) { ensureMusicalNode(x.id); sceneHighlight["mus:" + x.id] = true; });
      applyNodeRadii();
    } else if (name === "groups") {
      // 场景：团体一览（新增团体节点，成员压暗，点击团体看成员）
      nodes = {};
      edges = [];
      groups.forEach(function (g) {
        var gk = "grp:" + g.id;
        nodes[gk] = {
          id: g.id, key: gk, type: "group",
          x: Math.random() * 1000 - 500, y: Math.random() * 1000 - 500,
          vx: 0, vy: 0, r: 4, core: 4, coreBase: 4, glow: 22, glowBase: 22,
          importance: 0.7, hitR: 18, alpha: 0, targetAlpha: 1,
          color: "#8a7bb5", label: g.name, fixed: false
        };
        sceneHighlight[gk] = true;
        (g.members || []).forEach(function (mid) {
          ensureActorNode(mid);
          edges.push({ a: gk, b: mid, type: "group", color: "#8a7bb5", dashed: true, width: 0.6, alphaBase: 0.22, alpha: 0, count: 0 });
        });
      });
      applyNodeRadii();
    } else if (name === "moments") {
      // 场景：精彩片段（点亮所有拥有 Stage Moments 的演员）
      buildGraph();
      Object.keys(momentsByActor).forEach(function (aid) {
        if (actors[aid]) {
          ensureActorNode(aid); sceneHighlight[aid] = true;
          // 每个演员只标注一个片段：取该演员第一条，歌名 = 标题「剧名-歌名」中的后半段
          var m0 = (momentsByActor[aid] || [])[0];
          var song = m0 && m0.title ? String(m0.title).split("-").pop().trim() : "";
          if (nodes[aid] && song) nodes[aid].label2 = song;
        }
      });
      rebuildEdges();
      applyNodeRadii();
    }
    layoutAndCenter();
    fitViewToHighlights();   // 场景进入后自动把被点亮节点适配进视口
    playEntrance();
    updateStats();
    showSceneCard(name);
    syncSceneFilter();
  }
  function handleSceneFromHash() {
    var s = sceneFromHash();
    if (s === "search") { enterScene("search"); return; }
    if (s && s !== "graph") {
      if (scene !== s) enterScene(s);
    } else {
      if (scene) resetHome();
    }
  }

  // 点击节点：演员->聚焦展开；剧目->打开作品面板
  function onNodeClick(key) {
    var n = nodes[key];
    if (!n) return;
    if (focusId && focusId !== key) backHistory.push(focusId);
    if (n.type === "musical") { goMusical(n.id); return; }
    if (n.type === "group") { goGroup(n.id); return; }
    focusActor(n.id);
  }

  // ---- hover 追光辅助 ----
  function hoverNeighbors() {
    var nb = {};
    if (!hoverId || !nodes[hoverId]) return nb;
    edges.forEach(function (e) {
      if (e.a === hoverId) nb[e.b] = true;
      if (e.b === hoverId) nb[e.a] = true;
    });
    return nb;
  }
  // 聚焦人物的直接邻居（含共演/明确关系/剧目）
  function focusNeighbors() {
    var nb = {};
    if (!focusId || !nodes[focusId]) return nb;
    edges.forEach(function (e) {
      if (e.a === focusId) nb[e.b] = true;
      if (e.b === focusId) nb[e.a] = true;
    });
    return nb;
  }
  // 当前 hover/聚焦时，与焦点存在明确关系（非共演）的邻居 -> 关系色
  var relColorCache = null;
  function depth01(k) {
    var c = nodes[depthCenterId];
    if (!c || maxDepth <= 0) return 0;
    var n = nodes[k];
    if (!n) return 0;
    var dx = n.x - c.x, dy = n.y - c.y;
    return Math.min(1, Math.sqrt(dx * dx + dy * dy) / maxDepth);
  }

  // ---- 渲染 ----
  function resizeHome() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(100, canvas.clientWidth) * dpr;
    canvas.height = Math.max(100, canvas.clientHeight) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeHome);
  if (typeof ResizeObserver !== "undefined") {
    var graphWrap = document.getElementById("graph-wrap");
    var ro = new ResizeObserver(function () {
      var w = Math.max(100, canvas.clientWidth), h = Math.max(100, canvas.clientHeight);
      var dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });
    ro.observe(graphWrap);
  }

  function draw() {
    if (homeView.classList.contains("hidden")) return;
    updateEntrance(performance.now());
    updateViewTween(performance.now());
    var pe = entranceT;   // 入场进度 0→1

    // 每帧重算景深基准
    maxDepth = 0;
    var dc = nodes[depthCenterId];
    if (dc) {
      Object.keys(nodes).forEach(function (k) {
        var n = nodes[k];
        var dx = n.x - dc.x, dy = n.y - dc.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxDepth) maxDepth = d;
      });
    }
    var hovering = !!(hoverId && nodes[hoverId]);
    var nb = hovering ? hoverNeighbors() : null;
    var nbFocus = focusId && nodes[focusId] ? focusNeighbors() : null;

    // 明确关系色：hover/聚焦时，与焦点存在关系标签（非共演）的演员用该关系色点亮
    relColorCache = null;
    var relPriCache = null;
    var relFrom = hovering ? hoverId : focusId;
    if (relFrom && nodes[relFrom]) {
      relColorCache = {};
      relPriCache = {};
      relations.forEach(function (r) {
        if (!TYPE_COLOR[r.type]) return;
        var o = r.a === relFrom ? r.b : (r.b === relFrom ? r.a : null);
        if (o && o !== relFrom) {
          var pri = REL_TYPE_PRIORITY[r.type] || 99;
          if (relPriCache[o] === undefined || pri < relPriCache[o]) {
            relPriCache[o] = pri;
            relColorCache[o] = TYPE_COLOR[r.type];
          }
        }
      });
    }

    // 光点目标状态（亮度 alpha / 光晕 glow / 核心 core）平滑过渡：hover 追光，聚焦点亮相关，平时按景深
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      var imp = n.importance || 0.5;
      var d01 = depth01(k);
      var ta, tg, tc;
      if (hovering) {
        if (k === hoverId) { ta = 1; tg = n.glowBase * 1.5; tc = n.coreBase * 1.6; }
        else if (nb[k]) { ta = 0.85; tg = n.glowBase * 1.18; tc = n.coreBase * 1.1; }
        else { ta = 0.06; tg = n.glowBase * 0.8; tc = n.coreBase * 0.8; }
        if (k === depthCenterId && ta < 0.4) ta = 0.4;   // 聚焦中心人物不完全熄灭
      } else if (focusId) {
        if (k === focusId) { ta = 1; tg = n.glowBase * 1.45; tc = n.coreBase * 1.5; }
        else if (nbFocus && nbFocus[k]) { ta = 0.85; tg = n.glowBase * 1.2; tc = n.coreBase * 1.1; }
        else { ta = 0.05; tg = n.glowBase * 0.7; tc = n.coreBase * 0.7; }
      } else if (scene) {
        if (sceneHighlight[k]) { ta = 1; tg = n.glowBase * 1.35; tc = n.coreBase * 1.35; }
        else { ta = 0.07; tg = n.glowBase * 0.7; tc = n.coreBase * 0.7; }
        if (k === depthCenterId && ta < 0.4) ta = 0.4;
      } else {
        ta = (0.2 + 0.55 * imp) * (1 - 0.8 * d01);       // 默认暗色光点，越靠外越暗
        tg = n.glowBase * (1 - 0.25 * d01);
        tc = n.coreBase;
      }
      // 首次提示：附近一颗星点轻微呼吸一次（暗示这些星点可探索）
      if (n._blinkT) {
        var bt = (performance.now() - n._blinkT) / 1400;
        if (bt < 1) {
          var b = Math.sin(bt * Math.PI);
          ta = Math.max(ta, 0.35 + 0.55 * b);
          tg = n.glowBase * (1 + 0.7 * b);
        } else {
          n._blinkT = 0;
        }
      }
      n.alpha += (ta - n.alpha) * LERP;
      if (n.alpha < 0.01) n.alpha = 0;
      n.glow += (tg - n.glow) * LERP;
      n.core += (tc - n.core) * LERP;
    });

    // 边目标透明度：默认全部隐藏；hover 只显示焦点关联线；聚焦模式显示中心网络
    // 舞台灯式淡入：帧率无关的指数平滑（时间常数 110ms，约 330ms 亮到 95%）+ 轻微错峰，
    // 目标随节点亮度变化也能平滑跟随，不会"瞬间出现一堆线"
    var EDGE_TC_MS = 110, EDGE_STAGGER_MS = 18;
    var _now = performance.now();
    edges.forEach(function (ed, idx) {
      var a = nodes[ed.a], b = nodes[ed.b];
      if (!a || !b) { ed.alpha = 0; return; }
      var ea = 0;
      if (hovering) {
        if (ed.a === hoverId || ed.b === hoverId) ea = Math.min(1, ed.alphaBase * 1.8);
      } else if (focusId) {
        var touchCenter = (ed.a === focusId || ed.b === focusId);
        var nearCenter = depth01(ed.a) < 0.5 && depth01(ed.b) < 0.5;
        if (touchCenter || nearCenter) ea = ed.alphaBase * Math.min(a.alpha, b.alpha) * (touchCenter ? 1 : 0.6);
      } else if (scene) {
        var aLit = !!sceneHighlight[ed.a], bLit = !!sceneHighlight[ed.b];
        if (aLit && bLit) ea = ed.alphaBase * 0.9;
        else if (aLit || bLit) ea = ed.alphaBase * 0.3;
      } else {
        // 纯全局视图：只显示演员-作品边（极淡青绿），让作品簇结构可读；关系/共演边保持隐藏
        if (ed.type === "musical" || ed.type === "group") ea = ed.alphaBase * 0.36 * (0.35 + 0.65 * Math.min(a.alpha, b.alpha));
      }
      if (ea <= 0.002) {                   // 隐藏：立即熄灭并复位
        ed._gate = undefined;
        ed._lastT = _now;
        ed.alpha = 0;
        return;
      }
      if (ed._gate === undefined) ed._gate = _now + (idx % 6) * EDGE_STAGGER_MS;  // 错峰起点
      if (_now < ed._gate) { ed._lastT = _now; ed.alpha = 0; return; }           // 未到该线的亮起时刻
      var dt = Math.min(50, Math.max(1, _now - (ed._lastT || _now)));
      ed._lastT = _now;
      ed.alpha += (ea - ed.alpha) * (1 - Math.exp(-dt / EDGE_TC_MS));
      if (ed.alpha < 0.002) ed.alpha = 0;
    });

    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.save();
    ctx.translate(canvas.clientWidth / 2 + view.x, canvas.clientHeight / 2 + view.y);
    ctx.scale(view.zoom, view.zoom);
    if (!hovering) drawVignette();
    edges.forEach(function (ed) {
      var a = nodes[ed.a], b = nodes[ed.b];
      if (!a || !b) return;
      if (ed.alpha <= 0.01) return;
      ctx.strokeStyle = ed.color;
      ctx.globalAlpha = ed.alpha * (0.25 + 0.75 * pe);
      ctx.lineWidth = (ed.width || 1) / view.zoom;
      ctx.setLineDash(ed.dashed ? [2, 4] : []);
      ctx.beginPath(); ctx.moveTo(a.x * pe, a.y * pe); ctx.lineTo(b.x * pe, b.y * pe); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      var x = n.x * pe, y = n.y * pe;
      if (n.alpha < 0.02) return;                       // 极暗光点跳过，保证性能
      var col = (relColorCache && relColorCache[k]) ? relColorCache[k] : n.color;   // 明确关系用关系色点亮
      drawLightPoint(ctx, x, y, n, col);                // 柔和光点：光晕 + 中心亮点，无边框
      // 姓名：放大到接近最大时全部显示；hover 时焦点与其一跳邻居显示；聚焦态显示中心与剧目节点
      var showLabel = view.zoom >= 2.4 || (k === hoverId) || (hovering && nb[k]) || (focusId && k === focusId) || (focusId && n.type === "musical") || (focusId && nbFocus && nbFocus[k]) || (scene && sceneHighlight[k] && (scene === "actors" || scene === "groups" || scene === "musicals" || scene === "moments" || view.zoom >= 1.6));
      if (showLabel && (view.zoom > 0.5 || scene === "moments")) {
        var fs = n.type === "musical" ? 11 : (n.type === "group" ? 13 : (k === focusId ? 14 : 12));
        ctx.font = fs + "px sans-serif";
        ctx.textAlign = "center";
        var label = n.type === "musical" && n.label.length > 10 ? n.label.slice(0, 10) + "…" : n.label;
        fillLabel(ctx, label, x, y + n.core + 16);
        if (scene === "moments" && sceneHighlight[k] && n.label2) {
          ctx.font = "10px sans-serif";
          ctx.fillStyle = "rgba(242,242,242,0.62)";
          ctx.fillText(n.label2, x, y + n.core + 30);
          ctx.fillStyle = "#f2f2f2";
        }
      }
    });
    ctx.restore();
    requestAnimationFrame(draw);
  }

  // 径向暗角渐变模拟景深（不启用真实 blur，性能优先）
  function drawVignette() {
    var c = nodes[depthCenterId];
    if (!c || maxDepth <= 0) return;
    var R = maxDepth * 1.05;
    var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
    g.addColorStop(0, "rgba(10,10,10,0)");
    g.addColorStop(0.72, "rgba(10,10,10,0.06)");
    g.addColorStop(1, "rgba(10,10,10,0.24)");
    ctx.fillStyle = g;
    ctx.fillRect(c.x - R, c.y - R, R * 2, R * 2);
  }

  // ---- 交互 ----
  function screenToWorld(px, py) {
    return { x: (px - canvas.clientWidth / 2 - view.x) / view.zoom, y: (py - canvas.clientHeight / 2 - view.y) / view.zoom };
  }
  function hitTest(px, py, minScreenRadius) {
    var p = screenToWorld(px, py);
    var hit = null, best = 1e9;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      var d = (n.x - p.x) * (n.x - p.x) + (n.y - p.y) * (n.y - p.y);
      // 手机上的可点击范围至少保持 28px，缩放时也不会变得难以点中。
      var hitR = Math.max(n.hitR || 18, (minScreenRadius || 0) / Math.max(view.zoom, 0.01));
      if (d < hitR * hitR && d < best) { best = d; hit = k; }
    });
    return hit;
  }

  // 点击与拖动区分：按住人物拖动=调整位置；原地单击=聚焦展开；双击=进入详情页
  var dragging = null, panning = false, lastX = 0, lastY = 0, startX = 0, startY = 0, dragMoved = false;
  canvas.addEventListener("mousedown", function (e) {
    cancelViewTween();
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var hit = hitTest(px, py);
    lastX = e.clientX; lastY = e.clientY;
    startX = e.clientX; startY = e.clientY;   // 记录按下点，按总位移判断是否拖动
    dragMoved = false;
    hideHoverCard();
    if (hit) { dragging = hit; nodes[hit].fixed = true; }
    else { panning = true; }
  });
  window.addEventListener("mousemove", function (e) {
    if (dragging || panning) {
      // 从按下点累计总位移：超过阈值才算「拖动」（慢速拖动也能正确识别）
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 4) dragMoved = true;
    }
    if (dragging) {
      var rect = canvas.getBoundingClientRect();
      var p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      nodes[dragging].x = p.x; nodes[dragging].y = p.y;
    } else if (panning) {
      view.x += e.clientX - lastX; view.y += e.clientY - lastY;
    } else {
      // 悬停追光：命中节点显示信息卡；焦点卡片区域不触发
      if (e.target && e.target.closest && e.target.closest("#focus-card")) { hideHoverCard(); return; }
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (px < 0 || py < 0 || px > canvas.clientWidth || py > canvas.clientHeight) { hideHoverCard(); return; }
      var h = hitTest(px, py);
      canvas.style.cursor = h ? "pointer" : "default";
      if (h && h !== hoverId) showHoverCard(h, e.clientX, e.clientY);
      else if (h && h === hoverId) moveHoverCard(e.clientX, e.clientY);
      else if (!h && hoverId) hideHoverCard();
      hoverId = h;
    }
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", function (e) {
    if (dragging) {
      var hit = dragging;
      if (nodes[hit]) nodes[hit].fixed = false;
      dragging = null;
      if (!dragMoved) onNodeClick(hit);
      return;
    }
    if (panning) {
      panning = false;
      if (dragMoved) return;   // 拖动图谱 = 平移，不算点击，不返回全局
      var rect = canvas.getBoundingClientRect();
      var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) onNodeClick(hit);
      else if (focusId || scene) backOne();   // 原地单击空白 -> 返回上一级
    }
  });
  canvas.addEventListener("mouseleave", function () { hideHoverCard(); });
  canvas.addEventListener("dblclick", function (e) {
    var rect = canvas.getBoundingClientRect();
    var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) { resetToDefault(); return; }   // 双击空白 -> 返回默认
    var n = nodes[hit];
    if (!n) return;
    if (n.type === "musical") goMusical(n.id);
    else goActor(n.id);               // 双击演员 -> 独立详情页
  });
  // 滚轮/触控板：双指滑动或普通滚轮 = 平移；Ctrl+滚轮 / 触控板捏合 = 缩放
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    cancelViewTween();
    if (e.ctrlKey) {
      // 捏合缩放（Windows Chrome/Edge 触控板捏合会带 ctrlKey；桌面也可 Ctrl+滚轮缩放）
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var before = screenToWorld(px, py);
      var factor = Math.pow(1.0015, -e.deltaY);
      view.zoom = Math.max(0.2, Math.min(4, view.zoom * factor));
      var after = screenToWorld(px, py);
      view.x += (after.x - before.x) * view.zoom;
      view.y += (after.y - before.y) * view.zoom;
    } else {
      // 平移：按网页滚动习惯（双指上滑 = 内容向下移动，与鼠标拖拽的"抓取移动"方向相反）
      var dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; }         // 行模式（部分 Windows 鼠标）
      else if (e.deltaMode === 2) { dx *= canvas.clientWidth; dy *= canvas.clientHeight; }
      view.x -= dx;
      view.y -= dy;
    }
  }, { passive: false });

  // Mac Safari：触控板捏合以 gesture 事件派发，映射为缩放（防止页面缩放）
  var safariPinch = 1;
  canvas.addEventListener("gesturestart", function (e) { e.preventDefault(); safariPinch = view.zoom; });
  canvas.addEventListener("gesturechange", function (e) {
    e.preventDefault();
    cancelViewTween();
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var before = screenToWorld(px, py);
    view.zoom = Math.max(0.2, Math.min(4, safariPinch * e.scale));
    var after = screenToWorld(px, py);
    view.x += (after.x - before.x) * view.zoom;
    view.y += (after.y - before.y) * view.zoom;
  });

  // ---- 悬停信息卡（DOM，跟随光标）----
  var hoverCard = document.getElementById("hover-card");
  function hideHoverCard() {
    hoverId = null;
    hoverCard.classList.add("hidden");
  }
  function showHoverCard(id, clientX, clientY) {
    var n = nodes[id];
    if (!n) return;
    hoverCard.innerHTML = "";
    var nameEl = document.createElement("div");
    nameEl.className = "hc-name";
    nameEl.textContent = n.label;
    hoverCard.appendChild(nameEl);
    if (n.type === "actor") {
      var st = computeStats(n.id);
      var statsEl = document.createElement("div");
      statsEl.className = "hc-stats";
      statsEl.textContent = "出演 " + st.musicals + " 部 · 合作 " + st.partners + " 人";
      hoverCard.appendChild(statsEl);
      var tags = [];
      relations.forEach(function (r) {
        if (r.a === n.id || r.b === n.id) {
          var tn = TYPE_LABEL[r.type] || r.typeName;
          if (tn && tags.indexOf(tn) < 0) tags.push(tn);
        }
      });
      if (tags.length) {
        var tdiv = document.createElement("div");
        tdiv.className = "hc-tags";
        tags.slice(0, 6).forEach(function (t) {
          var s = document.createElement("span");
          s.textContent = t;
          tdiv.appendChild(s);
        });
        hoverCard.appendChild(tdiv);
      }
    }
    hoverCard.classList.remove("hidden");
    moveHoverCard(clientX, clientY);
  }
  function moveHoverCard(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left + 16, y = clientY - rect.top + 16;
    var w = hoverCard.offsetWidth, h = hoverCard.offsetHeight;
    if (x + w > canvas.clientWidth - 8) x = clientX - rect.left - w - 10;
    if (y + h > canvas.clientHeight - 8) y = clientY - rect.top - h - 10;
    hoverCard.style.left = Math.max(4, x) + "px";
    hoverCard.style.top = Math.max(4, y) + "px";
  }

  // ---- 中心信息卡（DOM）：聚焦演员的作品数 / 合作人数 / 关系类型 ----
  var focusCard = document.getElementById("focus-card");
  var gtEmpty = document.getElementById("gt-empty");
  function hideFocusCard() {
    focusCard.classList.add("hidden");
    document.body.classList.remove("side-open");   // 无聚焦内容时右侧面板收起
    var d = document.getElementById("fc-detail"); if (d) d.classList.remove("hidden");
    if (gtEmpty) gtEmpty.classList.remove("hidden");
  }
  function ratingOnline() {
    var sb = window.MG_SUPABASE || {};
    return !!(sb.url && sb.anonKey && !ratingDemoMode() && !/(^|[?&])mode=static(?:&|$)/.test(location.search));
  }
  function ratingCanOpen() { return ratingOnline() || ratingDemoMode(); }
  function ratingAverage(item) {
    if (!item) return null;
    var values = [item.singing_avg, item.dancing_avg, item.acting_avg].filter(function (value) {
      return value != null && isFinite(Number(value));
    }).map(Number);
    return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : null;
  }
  function ownRatingSummary(rows) {
    var latest = rows.slice().sort(function (a, b) { return String(b.updated_at || "").localeCompare(String(a.updated_at || "")); })[0];
    function average(field) {
      var values = rows.map(function (row) { return row[field]; }).filter(function (value) {
        return value != null && isFinite(Number(value));
      }).map(Number);
      return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : null;
    }
    var overallValues = rows.map(myRatingAverage).filter(function (value) { return isFinite(value); });
    return {
      singing_score: average("singing_score"),
      dancing_score: average("dancing_score"),
      acting_score: average("acting_score"),
      overall_score: overallValues.length ? overallValues.reduce(function (sum, value) { return sum + value; }, 0) / overallValues.length : null,
      performance_count: rows.length,
      latest_rating: latest
    };
  }
  function ownRatingsByRole(rows, actorId) {
    var grouped = {}, summaries = {};
    (rows || []).filter(function (row) {
      return String(row.actor_id) === String(actorId) && row.musical_id != null && row.role_id != null;
    }).forEach(function (row) {
      var key = ratingRoleKey(actorId, row.musical_id, row.role_id);
      (grouped[key] = grouped[key] || []).push(row);
    });
    Object.keys(grouped).forEach(function (key) { summaries[key] = ownRatingSummary(grouped[key]); });
    return summaries;
  }
  function ratingScore10(avg) { return (avg * 2).toFixed(1); }
  function ratingStars(avg) {
    var rounded = Math.round(avg * 2) / 2;
    var full = Math.floor(rounded), half = rounded - full >= 0.5 ? 1 : 0;
    var html = "", i;
    for (i = 0; i < 5; i++) {
      html += "<i class='rating-star " + (i < full ? "is-full" : (i === full && half ? "is-half" : "is-empty")) + "'>★</i>";
    }
    return html;
  }
  function ratingSummaryHtml(item, compact) {
    if (!item) return "<p class='rating-empty'>暂无评分</p>";
    var avg = ratingAverage(item);
    if (!isFinite(avg)) return "<p class='rating-empty'>暂无评分</p>";
    var countLabel = Number(item.user_count) + (ratingDemoMode() ? " 人模拟评分" : " 人评分");
    var html = "<div class='rating-summary'><span class='rating-stars'>" + ratingStars(avg) + "</span><strong class='rating-score'>" + ratingScore10(avg) + "</strong><span class='rating-count'>" + countLabel + "</span></div>";
    html += "<div class='rating-dimension-list'>";
    [["唱", item.singing_avg], ["演", item.acting_avg], ["跳", item.dancing_avg]].forEach(function (row) {
      var value = Number(row[1]);
      html += "<div><b>" + row[0] + "</b><span class='rating-stars'>" + ratingStars(value) + "</span><strong>" + ratingScore10(value) + "</strong></div>";
    });
    return html + "</div>";
  }
  function ratingBriefHtml(item) {
    if (!item) return "<p class='rating-empty'>暂无评分</p>";
    var avg = ratingAverage(item);
    if (!isFinite(avg)) return "<p class='rating-empty'>暂无评分</p>";
    return "<div class='rating-summary'><span class='rating-stars'>" + ratingStars(avg) + "</span><strong class='rating-score'>" + ratingScore10(avg) + "</strong></div>";
  }
  function ratingDashboardHtml(item) {
    var dimensions = [["唱", "singing_avg"], ["演", "acting_avg"], ["跳", "dancing_avg"]];
    var rows = dimensions.map(function (dimension) {
      var value = item && Number(item[dimension[1]]);
      if (!isFinite(value)) return "<div class='rating-dashboard-dimension'><b>" + dimension[0] + "</b><span class='rating-empty'>暂无</span></div>";
      return "<div class='rating-dashboard-dimension'><b>" + dimension[0] + "</b><span class='rating-stars'>" + ratingStars(value) + "</span><strong>" + ratingScore10(value) + "</strong></div>";
    }).join("");
    var avg = ratingAverage(item);
    var countLabel = item ? Number(item.user_count) + (ratingDemoMode() ? " 人模拟评分" : " 人评分") : "";
    var overall = isFinite(avg)
      ? "<strong class='rating-dashboard-score'>" + ratingScore10(avg) + "</strong><span class='rating-stars'>" + ratingStars(avg) + "</span><span class='rating-dashboard-count'>" + countLabel + "</span>"
      : "<span class='rating-empty'>暂无评分</span>";
    return "<div class='rating-dashboard-dimensions'>" + rows + "</div><div class='rating-dashboard-overall'>" + overall + "</div>";
  }
  function ratingRolePreviewHtml(id) {
    var preview = (actorRoleOptions[id] || []).map(function (option) {
      var item = ratingsByRole[ratingRoleKey(id, option.musicalId, option.roleId)];
      var avg = ratingAverage(item);
      return item && isFinite(avg) ? { option: option, avg: avg, count: Number(item.user_count) || 0 } : null;
    }).filter(Boolean).sort(function (a, b) { return b.avg - a.avg || b.count - a.count; }).slice(0, 3);
    var list = preview.length
      ? "<ol class='rating-role-preview-list'>" + preview.map(function (entry, index) {
        return "<li><b>Top" + (index + 1) + "</b><span>《" + escHtml(entry.option.musicalName) + "》/ " + escHtml(entry.option.roleName) + "</span><strong>" + ratingScore10(entry.avg) + "</strong></li>";
      }).join("") + "</ol>"
      : "<p class='rating-empty'>暂无公开角色评分</p>";
    return "<h4>演员角色详细评分</h4>" + list + "<button id='rating-details-open' class='rating-role-preview-more' type='button'>展开更多</button>";
  }
  function renderFocusRating(id) {
    var box = document.getElementById("fc-rating");
    if (!box) return;
    box.classList.remove("hidden");
    box.innerHTML = "<div class='fc-rating-head'><div class='fc-mom-title'>观众评分</div><button id='fc-rate' type='button' title='给 TA 打分' aria-label='给 TA 打分'><svg viewBox='0 0 24 24' width='17' height='17' aria-hidden='true' focusable='false'><path d='M12 20h9' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg></button></div>" + ratingSummaryHtml(ratingsByActor[id], true);
    var button = document.getElementById("fc-rate");
    button.classList.toggle("hidden", !ratingCanOpen());
    button.addEventListener("click", function () { if (focusId && actors[focusId]) startRatingFlow(focusId); });
  }
  function renderActorRating(id) {
    var body = document.getElementById("ap-rating-body");
    var detail = document.getElementById("ap-rating-detail");
    var button = document.getElementById("ap-rate");
    var brief = document.getElementById("ap-rating-brief-body");
    if (!body || !detail || !button) return;
    body.innerHTML = ratingDashboardHtml(ratingsByActor[id]);
    if (brief) brief.innerHTML = ratingBriefHtml(ratingsByActor[id]);
    // 演示模式也要始终保留入口，即使该演员尚未达到公开评分门槛。
    if (ratingDemoMode()) button.classList.remove("hidden");
    else button.classList.toggle("hidden", !ratingCanOpen());
    detail.innerHTML = ratingRolePreviewHtml(id);
    var detailsOpen = document.getElementById("rating-details-open");
    if (detailsOpen) detailsOpen.addEventListener("click", function () { goActorRatings(id); });
  }
  function ratingRoleDetailHtml(id, option, ownRow) {
    var item = ratingsByRole[ratingRoleKey(id, option.musicalId, option.roleId)];
    var audience = "<section class='rating-detail-panel rating-detail-audience'><div class='rating-detail-panel-head'><span>观众评分</span></div>";
    if (!item) {
      audience += "<p class='rating-empty'>评分人数不足，暂不展示</p>";
    } else {
      var avg = ratingAverage(item);
      var rows = [["唱", item.singing_avg], ["演", item.acting_avg], ["跳", item.dancing_avg]].map(function (row) {
        var value = Number(row[1]);
        return "<span>" + row[0] + " " + ratingScore10(value) + "</span>";
      }).join("");
      audience += "<div class='rating-detail-overall'><span class='rating-stars'>" + ratingStars(avg) + "</span><strong>" + ratingScore10(avg) + "</strong><small>" + Number(item.user_count) + (ratingDemoMode() ? " 人模拟评分" : " 人评分") + "</small></div><div class='rating-detail-dimensions'>" + rows + "</div>";
    }
    audience += "</section>";
    var mine = "";
    if (ownRow) {
      var ownValues = [ownRow.singing_score, ownRow.acting_score, ownRow.dancing_score].filter(function (value) { return value != null && isFinite(Number(value)); }).map(Number);
      var ownAverage = ownRow.overall_score != null ? Number(ownRow.overall_score) : ownValues.reduce(function (total, value) { return total + value; }, 0) / ownValues.length;
      var ownRows = [["唱", ownRow.singing_score], ["演", ownRow.acting_score], ["跳", ownRow.dancing_score]].map(function (row) {
        return row[1] == null ? "" : "<span>" + row[0] + " " + ratingScore10(Number(row[1])) + "</span>";
      }).join("");
      var ownCount = Number(ownRow.performance_count) || 1;
      var ownLabel = ownCount > 1 ? "我的平均评分" : "我的评分";
      var ownNote = ownCount > 1 ? "<small>基于 " + ownCount + " 场评分</small>" : "";
      mine = "<section class='rating-detail-panel rating-detail-mine'><div class='rating-detail-panel-head'><span>" + ownLabel + "</span><button type='button' class='rating-detail-edit' data-rating-key='" + escHtml(ratingRoleKey(id, option.musicalId, option.roleId)) + "' title='编辑最近一场评分' aria-label='编辑最近一场评分'><svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' focusable='false'><path d='M12 20h9' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg></button></div><div class='rating-detail-overall'><span class='rating-stars'>" + ratingStars(ownAverage) + "</span><strong>" + ratingScore10(ownAverage) + "</strong>" + ownNote + "</div><div class='rating-detail-dimensions'>" + ownRows + "</div></section>";
    }
    return "<article class='rating-detail-role" + (ownRow ? " has-mine" : "") + "'><h4>" + escHtml(option.roleName) + "</h4>" + audience + mine + "</article>";
  }
  function openRatingDetails(id) {
    var modal = document.getElementById("rating-details-modal");
    var content = document.getElementById("rating-details-content");
    var byMusical = {};
    (actorRoleOptions[id] || []).forEach(function (option) { (byMusical[option.musicalId] = byMusical[option.musicalId] || []).push(option); });
    document.getElementById("rating-details-actor-name").textContent = actorName(id);
    modal.classList.remove("hidden");
    content.innerHTML = "<p class='rating-empty'>正在读取评分…</p>";
    var request = window.MG_AUTH && window.MG_AUTH.currentUser()
      ? (authDemoMode() ? Promise.resolve(authDemoRatings()) : ratingRpc("get_my_ratings", {}))
      : Promise.resolve([]);
    request.catch(function () { return []; }).then(function (ownRows) {
      var ownByRole = ownRatingsByRole(ownRows, id);
      // 本地登录预览固定放一条已关联的角色评分，方便直接检查“我的评分”和编辑入口。
      if (authDemoMode() && !Object.keys(ownByRole).length) {
        var previewOption = (actorRoleOptions[id] || [])[0];
        if (previewOption) {
          ownByRole[ratingRoleKey(id, previewOption.musicalId, previewOption.roleId)] = {
            actor_id: id,
            actor_name: actorName(id),
            musical_id: previewOption.musicalId,
            musical_name: previewOption.musicalName,
            role_id: previewOption.roleId,
            role_name: previewOption.roleName,
            singing_score: 4.8,
            acting_score: 4.9,
            dancing_score: 4.4
          };
        }
      }
      var html = Object.keys(byMusical).map(function (mid) {
        var options = byMusical[mid];
        return "<section class='rating-detail-work'><div class='rating-detail-work-head'><h3>" + escHtml(options[0].musicalName) + "</h3><span>" + options.length + " 个角色</span></div><div class='rating-detail-roles'>" + options.map(function (option) { return ratingRoleDetailHtml(id, option, ownByRole[ratingRoleKey(id, option.musicalId, option.roleId)]); }).join("") + "</div></section>";
      }).join("");
      content.innerHTML = html || "<p class='rating-empty'>暂无可展示的角色评分</p>";
      content.querySelectorAll(".rating-detail-edit").forEach(function (button) {
        button.addEventListener("click", function () {
          var row = ownByRole[button.dataset.ratingKey];
          if (!row) return;
          closeRatingDetailsModal();
          openMyRatingEditor(row.latest_rating || row);
        });
      });
    });
  }
  function actorRatingScoreCardHtml(kind, item, ownRow, id, option) {
    var isMine = kind === "mine";
    if (isMine && !ownRow) return "";
    var values = isMine
      ? [ownRow.singing_score, ownRow.acting_score, ownRow.dancing_score]
      : item ? [item.singing_avg, item.acting_avg, item.dancing_avg] : [];
    var valid = values.filter(function (value) { return value != null && isFinite(Number(value)); }).map(Number);
    if (!valid.length) return "";
    var average = isMine && ownRow.overall_score != null
      ? Number(ownRow.overall_score)
      : valid.reduce(function (sum, value) { return sum + value; }, 0) / valid.length;
    var metrics = [["唱", values[0]], ["演", values[1]], ["跳", values[2]]].filter(function (row) { return row[1] != null; }).map(function (row) {
      return "<span>" + row[0] + " " + ratingScore10(Number(row[1])) + "</span>";
    }).join("");
    var count = !isMine && item ? "<small>" + Number(item.user_count) + (ratingDemoMode() ? " 人模拟评分" : " 人评分") + "</small>" : "";
    var ownCount = isMine ? Number(ownRow.performance_count) || 1 : 0;
    var ownNote = ownCount > 1 ? "<small>基于 " + ownCount + " 场评分</small>" : "";
    var edit = isMine ? "<button type='button' class='actor-rating-edit' data-rating-key='" + escHtml(ratingRoleKey(id, option.musicalId, option.roleId)) + "' title='编辑最近一场评分' aria-label='编辑最近一场评分'><svg viewBox='0 0 24 24' width='17' height='17' aria-hidden='true' focusable='false'><path d='M12 20h9' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg></button>" : "";
    var label = isMine && ownCount > 1 ? "我的平均评分" : (isMine ? "我的评分" : "观众评分");
    return "<section class='actor-rating-score-card actor-rating-" + kind + "'><div class='actor-rating-card-head'><span>" + label + "</span>" + edit + "</div><div class='actor-rating-card-score'><span class='rating-stars'>" + ratingStars(average) + "</span><strong>" + ratingScore10(average) + "</strong>" + count + ownNote + "</div><div class='actor-rating-card-metrics'>" + metrics + "</div></section>";
  }
  function renderActorRatingsPage(id) {
    var content = document.getElementById("actor-ratings-content");
    var actor = actors[id];
    if (!actor || !content) { goActor(id); return; }
    document.getElementById("actor-ratings-crumb").textContent = actor.name;
    document.getElementById("actor-ratings-subtitle").textContent = actor.name + "的角色评分";
    content.innerHTML = "<p class='rating-empty'>正在读取评分…</p>";
    var request = window.MG_AUTH && window.MG_AUTH.currentUser() ? (authDemoMode() ? Promise.resolve(authDemoRatings()) : ratingRpc("get_my_ratings", {})) : Promise.resolve([]);
    request.catch(function () { return []; }).then(function (ownRows) {
      var ownByRole = ownRatingsByRole(ownRows, id);
      if (authDemoMode() && !Object.keys(ownByRole).length && (actorRoleOptions[id] || []).length) {
        var preview = actorRoleOptions[id][0];
        ownByRole[ratingRoleKey(id, preview.musicalId, preview.roleId)] = { actor_id: id, actor_name: actor.name, musical_id: preview.musicalId, musical_name: preview.musicalName, role_id: preview.roleId, role_name: preview.roleName, singing_score: 4.8, acting_score: 4.9, dancing_score: 4.4 };
      }
      var byMusical = {};
      (actorRoleOptions[id] || []).forEach(function (option) { (byMusical[option.musicalId] = byMusical[option.musicalId] || []).push(option); });
      var orderedOptions = Object.keys(byMusical).reduce(function (all, mid) { return all.concat(byMusical[mid]); }, []).sort(function (a, b) {
        var aItem = ratingsByRole[ratingRoleKey(id, a.musicalId, a.roleId)], bItem = ratingsByRole[ratingRoleKey(id, b.musicalId, b.roleId)];
        var aScore = aItem ? ratingAverage(aItem) : -1, bScore = bItem ? ratingAverage(bItem) : -1;
        return bScore - aScore;
      });
      content.innerHTML = "<div class='actor-role-card-grid'>" + orderedOptions.map(function (option) {
        var key = ratingRoleKey(id, option.musicalId, option.roleId), item = ratingsByRole[key], own = ownByRole[key];
        return "<article class='actor-ratings-role'><div class='actor-rating-role-title'><h3>《" + escHtml(option.musicalName) + "》</h3><span>" + escHtml(option.roleName) + "</span></div><div class='actor-rating-comparison'>" + actorRatingScoreCardHtml("audience", item, own, id, option) + actorRatingScoreCardHtml("mine", item, own, id, option) + (!item && !own ? "<p class='rating-empty'>暂无评分</p>" : "") + "</div></article>";
      }).join("") + "</div>";
      if (!Object.keys(byMusical).length) content.innerHTML = "<p class='rating-empty'>暂无可展示的角色评分</p>";
      content.querySelectorAll(".actor-rating-edit").forEach(function (button) { button.addEventListener("click", function () { var row = ownByRole[button.dataset.ratingKey]; if (row) openMyRatingEditor(row.latest_rating || row); }); });
    }).catch(function (error) { content.innerHTML = "<p class='rating-empty'>评分读取失败：" + escHtml(error && error.message ? error.message : "请稍后重试") + "</p>"; });
  }
  function refreshRatingViews() {
    rebuildRatingIndexes();
    if (focusId && actors[focusId]) renderFocusRating(focusId);
    if (currentRoute() === "actor" && currentActorId()) renderActorRating(currentActorId());
    if (currentRoute() === "actor-ratings" && currentActorId()) renderActorRatingsPage(currentActorId());
  }
  var myRatingsTab = "summary";
  function myRatingSubjectKey(row) {
    var actorId = s(row.actor_id);
    if (row.musical_id != null && row.role_id != null) return actorId + "|known|" + s(row.musical_id) + "|" + s(row.role_id);
    return actorId + "|manual|" + String(row.manual_musical_name || "").toLowerCase() + "|" + String(row.manual_role_name || "").toLowerCase();
  }
  function myRatingValues(row) {
    return [row.singing_score, row.acting_score, row.dancing_score].filter(function (value) {
      return value != null && isFinite(Number(value));
    }).map(Number);
  }
  function myRatingAverage(row) {
    var values = myRatingValues(row);
    return values.length ? values.reduce(function (total, value) { return total + value; }, 0) / values.length : 0;
  }
  function myRatingPerformanceLabel(row) {
    return row.performance_date ? String(row.performance_date) + (row.session_period ? " · " + (RATING_SESSION_LABELS[row.session_period] || row.session_period) : "") : "场次待补充";
  }
  function myRatingCard(row, options) {
    options = options || {};
    var actorId = s(row.actor_id), actor = row.actor_name || actorName(actorId);
    var musical = row.musical_name || row.manual_musical_name || "未知剧目";
    var role = row.role_name || row.manual_role_name || "角色待补充";
    var count = Number(row.performance_count) || 1;
    var meta = options.history ? "观演：" + myRatingPerformanceLabel(row) : "基于 " + count + " 场评分";
    var average = row.overall_score != null ? Number(row.overall_score) : myRatingAverage(row);
    var selectRecord = !!options.subjectKey;
    var multipleRecords = !!options.multipleRecords;
    var editAttribute = selectRecord
      ? " data-rating-subject-key='" + escHtml(options.subjectKey) + "'"
      : " data-rating-id='" + escHtml(String(row.id || "")) + "'";
    var editTitle = multipleRecords ? "选择要编辑的场次" : "编辑评分";
    var editLabel = multipleRecords
      ? "选择“" + actor + " · " + musical + "”要编辑的场次"
      : "编辑“" + actor + " · " + musical + "”的评分";
    return "<article class='my-rating-row" + (options.history ? " my-rating-history-card" : "") + "'>" +
      "<a class='my-rating-work' href='#/actor/" + encodeURIComponent(actorId) + "'>" + (options.history ? "<span class='my-rating-actor-inline'>" + escHtml(actor) + "</span>" : "") + escHtml(musical) + " <span class='my-rating-role'>· " + escHtml(role) + "</span><span class='my-rating-performance'>" + escHtml(meta) + "</span></a>" +
      "<div class='my-rating-overall'><span class='rating-stars'>" + ratingStars(average) + "</span><strong>" + ratingScore10(average) + "</strong></div>" +
      "<div class='my-rating-scores'>" + [["唱", row.singing_score], ["演", row.acting_score], ["跳", row.dancing_score]].map(function (pair) {
        return "<div class='my-rating-score'><span>" + pair[0] + "</span><strong>" + (pair[1] == null ? "—" : (Number(pair[1]) * 2).toFixed(1)) + "</strong></div>";
      }).join("") + "</div>" +
      "<button type='button' class='my-rating-edit'" + editAttribute + " title='" + escHtml(editTitle) + "' aria-label='" + escHtml(editLabel) + "'><svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' focusable='false'><path d='M12 20h9' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg></button>" +
      "</article>";
  }
  function bindMyRatingEditors(container, rows, subjectRows) {
    var byId = {};
    rows.forEach(function (row) { byId[String(row.id)] = row; });
    container.querySelectorAll(".my-rating-edit").forEach(function (button) {
      button.addEventListener("click", function () {
        var selectedRows = subjectRows && subjectRows[button.dataset.ratingSubjectKey];
        if (selectedRows) {
          if (selectedRows.length === 1) openMyRatingEditor(selectedRows[0]);
          else openMyRatingRecordPicker(selectedRows);
          return;
        }
        var row = byId[button.dataset.ratingId];
        if (row) openMyRatingEditor(row);
      });
    });
  }
  function renderMyRatingSummary(rows, list, summary) {
    var subjects = {}, ordered = [], subjectRows = {};
    rows.forEach(function (row) {
      var key = myRatingSubjectKey(row);
      if (!subjects[key]) { subjects[key] = { rows: [], latest: row }; ordered.push(subjects[key]); }
      subjects[key].rows.push(row);
      subjectRows[key] = subjects[key].rows;
      if (String(row.updated_at || "") > String(subjects[key].latest.updated_at || "")) subjects[key].latest = row;
    });
    var byActor = {}, actorsInOrder = [];
    ordered.forEach(function (subject) {
      var latest = subject.latest, actorId = s(latest.actor_id);
      if (!byActor[actorId]) {
        byActor[actorId] = { id: actorId, name: latest.actor_name || actorName(actorId), subjects: [] };
        actorsInOrder.push(byActor[actorId]);
      }
      var aggregate = ownRatingSummary(subject.rows);
      aggregate.id = latest.id;
      aggregate.actor_id = latest.actor_id;
      aggregate.actor_name = latest.actor_name;
      aggregate.musical_name = latest.musical_name;
      aggregate.manual_musical_name = latest.manual_musical_name;
      aggregate.role_name = latest.role_name;
      aggregate.manual_role_name = latest.manual_role_name;
      aggregate.performance_date = latest.performance_date;
      aggregate.session_period = latest.session_period;
      byActor[actorId].subjects.push({ key: myRatingSubjectKey(latest), row: aggregate, count: subject.rows.length });
    });
    actorsInOrder.sort(function (a, b) { return a.name.localeCompare(b.name, "zh-Hans-CN"); });
    summary.textContent = actorsInOrder.length + " 位演员 · " + ordered.length + " 个角色";
    summary.classList.remove("hidden");
    list.innerHTML = actorsInOrder.map(function (actor) {
      return "<li class='my-rating-actor'><div class='my-rating-actor-head'><a class='my-rating-actor-name' href='#/actor/" + encodeURIComponent(actor.id) + "'>" + escHtml(actor.name) + "</a><span class='my-rating-actor-count'>" + actor.subjects.length + " 个角色</span></div><div class='my-rating-works'>" + actor.subjects.map(function (subject) { return myRatingCard(subject.row, { subjectKey: subject.key, multipleRecords: subject.count > 1 }); }).join("") + "</div></li>";
    }).join("");
    bindMyRatingEditors(list, rows, subjectRows);
  }
  function renderMyRatingHistory(rows, timeline, summary) {
    var byDay = {}, days = [];
    rows.forEach(function (row) {
      var day = String(row.updated_at || row.performance_date || "").slice(0, 10) || "未标注日期";
      if (!byDay[day]) { byDay[day] = []; days.push(day); }
      byDay[day].push(row);
    });
    days.sort(function (a, b) { return b.localeCompare(a); });
    summary.textContent = rows.length + " 场评分 · 按评分日期排列";
    summary.classList.remove("hidden");
    timeline.innerHTML = days.map(function (day) {
      var label = day === "未标注日期" ? day : day.replace(/-/g, ".");
      var dayRows = byDay[day].slice().sort(function (a, b) {
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
      return "<li class='my-rating-day'><time class='my-rating-day-date' datetime='" + escHtml(day) + "'>" + escHtml(label) + "</time><span class='my-rating-timeline-rail' aria-hidden='true'><i></i></span><div class='my-rating-day-carousel'><button class='my-rating-history-control my-rating-history-prev' type='button' aria-label='查看前一条评分' title='查看前一条评分'>‹</button><div class='my-rating-day-records'>" + dayRows.map(function (row) { return myRatingCard(row, { history: true }); }).join("") + "</div><button class='my-rating-history-control my-rating-history-next' type='button' aria-label='查看后一条评分' title='查看后一条评分'>›</button></div></li>";
    }).join("");
    timeline.querySelectorAll(".my-rating-day-carousel").forEach(function (carousel) {
      var track = carousel.querySelector(".my-rating-day-records");
      var previous = carousel.querySelector(".my-rating-history-prev");
      var next = carousel.querySelector(".my-rating-history-next");
      function updateControls() {
        previous.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
        carousel.classList.toggle("is-scrollable", track.scrollWidth > track.clientWidth + 2);
      }
      previous.addEventListener("click", function () { track.scrollBy({ left: -Math.max(180, track.clientWidth * .82), behavior: "smooth" }); });
      next.addEventListener("click", function () { track.scrollBy({ left: Math.max(180, track.clientWidth * .82), behavior: "smooth" }); });
      track.addEventListener("scroll", updateControls, { passive: true });
      requestAnimationFrame(updateControls);
    });
    bindMyRatingEditors(timeline, rows);
  }
  function renderMyRatingsPage() {
    var empty = document.getElementById("my-ratings-empty");
    var list = document.getElementById("my-ratings-list");
    var summary = document.getElementById("my-ratings-summary");
    var timeline = document.getElementById("my-ratings-timeline");
    if (!empty || !list || !summary || !timeline) return;
    list.innerHTML = "";
    timeline.innerHTML = "";
    list.classList.toggle("hidden", myRatingsTab !== "summary");
    timeline.classList.toggle("hidden", myRatingsTab !== "history");
    document.querySelectorAll("[data-my-ratings-tab]").forEach(function (button) {
      var active = button.dataset.myRatingsTab === myRatingsTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    summary.classList.add("hidden");
    if (!window.MG_AUTH || !window.MG_AUTH.currentUser()) {
      empty.textContent = "登录后可以查看你的全部评分。";
      empty.classList.remove("hidden");
      if (window.MG_AUTH) window.MG_AUTH.open();
      return;
    }
    empty.textContent = "正在读取你的评分…";
    empty.classList.remove("hidden");
    var request = authDemoMode() ? Promise.resolve(authDemoRatings()) : ratingRpc("get_my_ratings", {});
    request.then(function (rows) {
      rows = rows || [];
      if (!rows.length) {
        empty.textContent = "你还没有提交过评分。";
        return;
      }
      empty.classList.add("hidden");
      if (myRatingsTab === "summary") renderMyRatingSummary(rows, list, summary);
      else renderMyRatingHistory(rows, timeline, summary);
    }).catch(function () {
      empty.textContent = "评分读取失败，请稍后再试。";
    });
  }
  function openMyRatingEditor(row) {
    if (!ratingCanOpen()) { showToast("评分功能需要连接线上数据"); return; }
    openRatingModal(row.actor_id, row);
  }
  function ratingRecordPickerDate(row) {
    var match = String(row.performance_date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var day = match ? Number(match[1]) + "年" + Number(match[2]) + "月" + Number(match[3]) + "日" : "场次待补充";
    var session = row.session_period ? RATING_SESSION_LABELS[row.session_period] || row.session_period : "";
    return day + (session ? " · " + session : "");
  }
  function openMyRatingRecordPicker(rows) {
    var modal = document.getElementById("rating-record-picker-modal");
    var subject = document.getElementById("rating-record-picker-subject");
    var list = document.getElementById("rating-record-picker-list");
    if (!modal || !subject || !list || !rows.length) return;
    var ordered = rows.slice().sort(function (a, b) {
      return String(b.performance_date || b.updated_at || "").localeCompare(String(a.performance_date || a.updated_at || "")) || String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
    var first = ordered[0];
    var actor = first.actor_name || actorName(s(first.actor_id));
    var musical = first.musical_name || first.manual_musical_name || "未知剧目";
    var role = first.role_name || first.manual_role_name || "角色待补充";
    subject.textContent = actor + " · " + musical + " · " + role;
    list.innerHTML = ordered.map(function (row) {
      var parts = [["唱", row.singing_score], ["演", row.acting_score], ["跳", row.dancing_score]].map(function (pair) {
        return pair[0] + " " + (pair[1] == null ? "—" : (Number(pair[1]) * 2).toFixed(1));
      }).join(" · ");
      return "<button type='button' class='rating-record-picker-item' data-rating-id='" + escHtml(String(row.id || "")) + "'><time>" + escHtml(ratingRecordPickerDate(row)) + "</time><span>" + escHtml(parts) + "</span><strong>" + ratingScore10(myRatingAverage(row)) + "</strong><i aria-hidden='true'>编辑</i></button>";
    }).join("");
    modal.classList.remove("hidden");
    list.querySelectorAll(".rating-record-picker-item").forEach(function (button) {
      button.addEventListener("click", function () {
        var row = ordered.filter(function (item) { return String(item.id) === button.dataset.ratingId; })[0];
        if (!row) return;
        closeRatingRecordPickerModal();
        openMyRatingEditor(row);
      });
    });
    setTimeout(function () { var firstButton = list.querySelector(".rating-record-picker-item"); if (firstButton) firstButton.focus(); }, 0);
  }
  document.querySelectorAll("[data-my-ratings-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      myRatingsTab = button.dataset.myRatingsTab;
      renderMyRatingsPage();
    });
  });
  if (window.MG_AUTH) {
    window.MG_AUTH.onChange(function () {
      if (currentRoute() === "my-ratings") renderMyRatingsPage();
    if (currentRoute() === "actor" && currentActorId()) loadMyRating();
    if (currentRoute() === "actor-ratings" && currentActorId()) renderActorRatingsPage(currentActorId());
    });
  }
  function showFocusCard(id) {
    var a = actors[id];
    var st = computeStats(id);
    document.getElementById("fc-name").textContent = a ? a.name : actorName(id);
    document.getElementById("fc-stats").textContent = "出演 " + st.musicals + " 部 · 合作 " + st.partners + " 人";
    var tagsBox = document.getElementById("fc-tags");
    tagsBox.innerHTML = "";
    var seen = {};
    relations.forEach(function (r) {
      if (r.a !== id && r.b !== id) return;
      var ty = r.type;
      var tn = TYPE_LABEL[ty] || r.typeName;
      if (!tn || seen[ty]) return;
      seen[ty] = true;
      var s = document.createElement("span");
      s.textContent = tn;
      s.style.setProperty("--tag-c", TYPE_COLOR[ty] || "#999");
      tagsBox.appendChild(s);
    });
    var fcMom = document.getElementById("fc-moments");
    if (fcMom) {
      var mlist = momentsByActor[id] || [];
      if (mlist.length) {
        var h = "<div class='fc-mom-title'>推荐片段</div><ul class='fc-mom-list'>";
        mlist.slice(0, 3).forEach(function (m) {
          var url = safeUrl(m.url);
          var titleHtml = url
            ? "<a class='mom-title' href='" + escAttr(url) + "' target='_blank' rel='noopener noreferrer'>" + escHtml(m.title) + "</a>"
            : "<span class='mom-title'>" + escHtml(m.title) + "</span>";
          h += "<li>" + titleHtml + "<span class='mom-src'>" + escHtml(SOURCE_LABEL[m.source] || m.source || "") + "</span></li>";
        });
        if (mlist.length > 3) h += "<li class='fc-mom-more'>… 共 " + mlist.length + " 条</li>";
        h += "</ul>";
        fcMom.innerHTML = h;
        fcMom.classList.remove("hidden");
      } else {
        fcMom.classList.add("hidden");
        fcMom.innerHTML = "";
      }
    }
    renderFocusRating(id);
    document.getElementById("fc-detail").textContent = "查看详情";
    document.getElementById("fc-detail").classList.remove("hidden");
    focusCard.classList.remove("hidden");
    document.body.classList.add("side-open");     // 聚焦演员 -> 右侧面板滑出
    if (gtEmpty) gtEmpty.classList.add("hidden");
  }
  // 剧目信息卡（右侧栏，取代旧居中弹窗）：名称 / 统计 / 演员表（按角色分组，点击演员跳转）
  function showMusicalFocusCard(mid) {
    var m = musicals[mid];
    if (!m) return;
    var ms = (D.musicalStats && D.musicalStats[mid]) || {};
    document.getElementById("fc-name").textContent = m.name;
    document.getElementById("fc-stats").textContent =
      "演出 " + (ms.shows || 0) + " 场 · 巡演 " + (ms.cities || 0) + " 城 · 演员表 " + (m.cast || []).length + " 人";
    var tagsBox = document.getElementById("fc-tags");
    tagsBox.innerHTML = "";
    var s = document.createElement("span");
    s.textContent = "作品";
    s.style.setProperty("--tag-c", MUS_COLOR);
    tagsBox.appendChild(s);
    var fcMom = document.getElementById("fc-moments");
    fcMom.classList.remove("hidden");
    fcMom.innerHTML = "<div class='fc-mom-title'>演员表</div>";
    var ul = document.createElement("ul");
    ul.className = "fc-cast";
    renderMusicalCast(ul, m);
    fcMom.appendChild(ul);
    document.getElementById("fc-rating").classList.add("hidden");
    var musicalRate = document.getElementById("fc-rate"); if (musicalRate) musicalRate.classList.add("hidden");
    document.getElementById("fc-detail").textContent = "查看详情";
    document.getElementById("fc-detail").classList.remove("hidden");
    focusCard.classList.remove("hidden");
    document.body.classList.add("side-open");     // 剧目信息 -> 右侧面板滑出
    if (gtEmpty) gtEmpty.classList.add("hidden");
  }
  // 团体信息卡（右侧栏）：名称 / 统计 / 成员列表（点击成员跳转）
  function showGroupFocusCard(gid) {
    var g = null;
    groups.forEach(function (x) { if (String(x.id) === String(gid)) g = x; });
    if (!g) return;
    document.getElementById("fc-name").textContent = g.name;
    document.getElementById("fc-stats").textContent = groupTypeLabel(g.type) + (g.parent ? " · 属于 " + g.parent : "") + " · 成员 " + (g.members || []).length + " 人";
    var tagsBox = document.getElementById("fc-tags");
    tagsBox.innerHTML = "";
    var s = document.createElement("span");
    s.textContent = "团体";
    s.style.setProperty("--tag-c", "#8a7bb5");
    tagsBox.appendChild(s);
    var fcMom = document.getElementById("fc-moments");
    fcMom.classList.remove("hidden");
    fcMom.innerHTML = "<div class='fc-mom-title'>成员</div>";
    var ul = document.createElement("ul");
    ul.className = "fc-cast";
    (g.members || []).forEach(function (aid) {
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.className = "c";
      span.textContent = actorLabel(aid);
      span.addEventListener("click", function () { goActor(aid); });
      li.appendChild(span);
      ul.appendChild(li);
    });
    fcMom.appendChild(ul);
    document.getElementById("fc-rating").classList.add("hidden");
    var groupRate = document.getElementById("fc-rate"); if (groupRate) groupRate.classList.add("hidden");
    document.getElementById("fc-detail").classList.add("hidden");   // 团体无独立详情页
    focusCard.classList.remove("hidden");
    document.body.classList.add("side-open");     // 团体信息 -> 右侧面板滑出
    if (gtEmpty) gtEmpty.classList.add("hidden");
  }
  document.getElementById("fc-detail").addEventListener("click", function () {
    if (!focusId) return;
    var focusKey = s(focusId);
    if (focusKey.indexOf("mus:") === 0) goMusicalDetail(focusKey.slice(4));
    else if (focusKey.indexOf("grp:") !== 0) goActor(focusKey);
  });
  document.getElementById("fc-close").addEventListener("click", function () {
    document.body.classList.remove("side-open");
  });
  var sceneClose = document.getElementById("scene-close");
  if (sceneClose) sceneClose.addEventListener("click", function () {
    document.body.classList.remove("side-open");
  });

  // 手机端的详情抽屉可从顶部把手调整高度，露出更多星图或详情内容。
  var graphTools = document.getElementById("graph-tools");
  var graphSheetHandle = document.getElementById("graph-sheet-handle");
  var graphSheetDrag = null;
  function isMobileGraphSheet() {
    return window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
  }
  if (graphTools && graphSheetHandle) {
    graphSheetHandle.addEventListener("pointerdown", function (e) {
      if (!isMobileGraphSheet() || !document.body.classList.contains("side-open")) return;
      e.preventDefault();
      graphSheetDrag = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startHeight: graphTools.getBoundingClientRect().height
      };
      graphSheetHandle.setPointerCapture(e.pointerId);
    });
    graphSheetHandle.addEventListener("pointermove", function (e) {
      if (!graphSheetDrag || e.pointerId !== graphSheetDrag.pointerId) return;
      var minHeight = 190;
      var maxHeight = Math.max(minHeight, window.innerHeight - 72);
      var height = graphSheetDrag.startHeight + (graphSheetDrag.startY - e.clientY);
      height = Math.max(minHeight, Math.min(maxHeight, height));
      graphTools.style.setProperty("--graph-sheet-height", Math.round(height) + "px");
    });
    function endGraphSheetDrag(e) {
      if (!graphSheetDrag || e.pointerId !== graphSheetDrag.pointerId) return;
      if (graphSheetHandle.hasPointerCapture(e.pointerId)) graphSheetHandle.releasePointerCapture(e.pointerId);
      graphSheetDrag = null;
    }
    graphSheetHandle.addEventListener("pointerup", endGraphSheetDrag);
    graphSheetHandle.addEventListener("pointercancel", endGraphSheetDrag);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var ratingRecordPickerModal = document.getElementById("rating-record-picker-modal");
      if (ratingRecordPickerModal && !ratingRecordPickerModal.classList.contains("hidden")) { ratingRecordPickerModal.classList.add("hidden"); return; }
      var ratingDetailsModal = document.getElementById("rating-details-modal");
      if (ratingDetailsModal && !ratingDetailsModal.classList.contains("hidden")) { ratingDetailsModal.classList.add("hidden"); return; }
      if (ratingModal && !ratingModal.classList.contains("hidden")) { closeRatingModal(); return; }
      if (!panel.classList.contains("hidden")) { hidePanel(); return; }
      var hg = document.getElementById("help-guide");
      if (hg && !hg.classList.contains("hidden")) { hg.classList.add("hidden"); return; }
      var topBox = document.getElementById("top-search-box");
      if (topBox && !topBox.classList.contains("hidden")) { closeTopSearch(); return; }
      if (!homeView.classList.contains("hidden") && (focusId || scene)) resetHome();
    }
  });

  // ---- 触摸支持（移动端）----
  var touches = null;
  var touchMoved = false;
  canvas.addEventListener("touchstart", function (e) {
    e.preventDefault();
    cancelViewTween();
    var rect = canvas.getBoundingClientRect();
    if (e.touches.length === 1) {
      var t = e.touches[0];
      var px = t.clientX - rect.left, py = t.clientY - rect.top;
      var hit = hitTest(px, py, 28);
      touchMoved = false;
      touches = hit
        ? { mode: "tap", id: t.identifier, nodeId: hit, startX: t.clientX, startY: t.clientY, startViewX: view.x, startViewY: view.y }
        : { mode: "pan", id: t.identifier, startX: t.clientX, startY: t.clientY, startViewX: view.x, startViewY: view.y };
    } else if (e.touches.length === 2) {
      var a = e.touches[0], b = e.touches[1];
      touchMoved = true;   // 双指手势：结束时不得误判为单击
      touches = {
        mode: "pinch", id: a.identifier,
        startDist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        startZoom: view.zoom,
        cx: (a.clientX + b.clientX) / 2 - rect.left,
        cy: (a.clientY + b.clientY) / 2 - rect.top
      };
    }
  }, { passive: false });
  canvas.addEventListener("touchmove", function (e) {
    e.preventDefault();
    if (!touches) return;
    var rect = canvas.getBoundingClientRect();
    if (touches.mode === "pinch" && e.touches.length >= 2) {
      var a = e.touches[0], b = e.touches[1];
      var dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      var newZoom = Math.max(0.2, Math.min(4, touches.startZoom * (dist / (touches.startDist || 1))));
      // 以两指中点为锚：缩放前后，中点下的世界坐标保持不变
      var midX = (a.clientX + b.clientX) / 2 - rect.left;
      var midY = (a.clientY + b.clientY) / 2 - rect.top;
      var wx = (midX - canvas.clientWidth / 2 - view.x) / view.zoom;
      var wy = (midY - canvas.clientHeight / 2 - view.y) / view.zoom;
      view.zoom = newZoom;
      view.x = midX - canvas.clientWidth / 2 - wx * newZoom;
      view.y = midY - canvas.clientHeight / 2 - wy * newZoom;
      touchMoved = true;
      return;
    }
    var t = e.touches[0];
    var moveX = t.clientX - touches.startX;
    var moveY = t.clientY - touches.startY;
    // 轻点节点优先于拖动：只有手指离开 10px 以上才开始平移图谱。
    if (touches.mode === "tap" && Math.hypot(moveX, moveY) > 10) touches.mode = "pan";
    if (touches.mode === "pan") {
      // 画面跟随手指同向移动
      view.x = touches.startViewX + moveX;
      view.y = touches.startViewY + moveY;
      if (Math.hypot(moveX, moveY) > 10) touchMoved = true;
    }
  }, { passive: false });
  canvas.addEventListener("touchend", function (e) {
    e.preventDefault();
    if (!touches) return;
    var tapNode = null;
    if (touches.mode === "tap") tapNode = touches.nodeId;
    touches = null;
    if (e.changedTouches && e.changedTouches.length === 1 && !touchMoved) {
      if (tapNode) { onNodeClick(tapNode); }
      else {
        var rect = canvas.getBoundingClientRect();
        var t = e.changedTouches[0];
        var hit = hitTest(t.clientX - rect.left, t.clientY - rect.top, 28);
        if (hit) onNodeClick(hit);
        else if (focusId || scene) backOne();   // 单击空白 -> 返回上一级
      }
    }
    touchMoved = false;
  }, { passive: false });
  canvas.addEventListener("touchcancel", function () { touches = null; touchMoved = false; }, { passive: true });


  function updateStats() {
    var el = document.getElementById("stats");
    if (el) el.textContent = "节点 " + Object.keys(nodes).length + " · 关系边 " + edges.length + " · 共演边 " + coWork.length;
  }

  // ---- 侧边面板（作品 / 团体；演员已改为独立详情页） ----
  var panel = document.getElementById("panel");
  function hidePanel() { panel.classList.add("hidden"); }
  document.getElementById("panel-close").addEventListener("click", hidePanel);
  panel.addEventListener("click", function (e) { if (e.target === panel) hidePanel(); });
  function showGroupPanel(gid) {
    var g = groups.filter(function (x) { return x.id === gid; })[0];
    if (!g) return;
    search.value = g.name;
    dropdown.classList.add("hidden");
    document.getElementById("p-name").textContent = g.name;
    document.getElementById("p-nickname").textContent = groupTypeLabel(g.type);
    document.getElementById("p-fields").innerHTML = "";
    document.getElementById("p-relations").innerHTML = "";
    document.getElementById("p-musicals").innerHTML = "";
    document.getElementById("p-cowork").innerHTML = "";
    document.getElementById("p-groups").innerHTML = "";
    document.getElementById("p-rel-title").classList.add("hidden");
    document.getElementById("p-mus-title").classList.add("hidden");
    document.getElementById("p-cw-title").classList.add("hidden");
    document.getElementById("p-gr-title").classList.add("hidden");
    document.getElementById("p-cast-title").classList.remove("hidden");
    document.getElementById("p-cast-title").textContent = "成员（" + (g.members || []).length + " 人）";
    var ul = document.getElementById("p-cast");
    ul.innerHTML = ""; ul.classList.remove("hidden");
    (g.members || []).forEach(function (aid) {
      var li = document.createElement("li");
      li.className = "c";
      li.textContent = actorLabel(aid);
      li.addEventListener("click", function () { goActor(aid); });
      ul.appendChild(li);
    });
    panel.classList.remove("hidden");
  }
  function showMusicalPanel(mid) {
    var m = musicals[mid];
    if (!m) return;
    search.value = m.name;
    dropdown.classList.add("hidden");
    document.getElementById("p-name").textContent = m.name;
    document.getElementById("p-nickname").textContent = "作品";
    document.getElementById("p-fields").innerHTML = "";
    document.getElementById("p-relations").innerHTML = "";
    document.getElementById("p-musicals").innerHTML = "";
    document.getElementById("p-cowork").innerHTML = "";
    document.getElementById("p-groups").innerHTML = "";
    document.getElementById("p-rel-title").classList.add("hidden");
    document.getElementById("p-mus-title").classList.add("hidden");
    document.getElementById("p-cw-title").classList.add("hidden");
    document.getElementById("p-gr-title").classList.add("hidden");
    document.getElementById("p-cast-title").classList.remove("hidden");
    document.getElementById("p-cast-title").textContent = "演员表（" + (m.cast || []).length + " 人）";
    var ul = document.getElementById("p-cast");
    ul.innerHTML = ""; ul.classList.remove("hidden");
    renderMusicalCast(ul, m);
    panel.classList.remove("hidden");
  }
  // 作品演员表：按角色分组（主演在前，组内按拼音排序；无角色信息者放最后）
  function renderMusicalCast(ul, m) {
    var castRoles = m.roles || {};
    var byRole = {};
    var noRole = [];
    (m.cast || []).slice(0, 200).forEach(function (aid) {
      var rs = castRoles[aid] || [];
      if (!rs.length) { noRole.push(aid); return; }
      rs.forEach(function (roleName) {
        (byRole[roleName] = byRole[roleName] || []).push(aid);
      });
    });
    function addRoleGroup(roleName, ids) {
      var li = document.createElement("li");
      li.className = "role-group";
      var rn = document.createElement("div");
      rn.className = "role-name";
      rn.textContent = roleName + "（" + ids.length + " 人）";
      li.appendChild(rn);
      ids.slice().sort(function (a, b) { return actorName(a).localeCompare(actorName(b), "zh"); })
        .forEach(function (aid) {
          var span = document.createElement("span");
          span.className = "c";
          span.textContent = actorLabel(aid);
          span.title = "查看 " + actorName(aid) + " 的关系页";
          span.addEventListener("click", function () { goActor(aid); });
          li.appendChild(span);
        });
      ul.appendChild(li);
    }
    // 主演在前：该角色轮演演员越多视为越重要；同名按拼音
    var roles = Object.keys(byRole).sort(function (x, y) {
      var d = byRole[y].length - byRole[x].length;
      return d || x.localeCompare(y, "zh");
    });
    roles.forEach(function (roleName) { addRoleGroup(roleName, byRole[roleName]); });
    if (noRole.length) addRoleGroup("其他演员", noRole);
  }

  function musicalRoleOption(actorId, musicalId, roleName) {
    return (actorRoleOptions[s(actorId)] || []).filter(function (option) {
      return s(option.musicalId) === s(musicalId) && option.roleName === roleName;
    })[0] || null;
  }
  function musicalRoleRating(actorId, musicalId, roleName) {
    var option = musicalRoleOption(actorId, musicalId, roleName);
    return option ? ratingsByRole[ratingRoleKey(actorId, musicalId, option.roleId)] : null;
  }
  function appendMusicalCastCard(container, actorId, musicalId, roleName) {
    var item = roleName ? musicalRoleRating(actorId, musicalId, roleName) : null;
    var hasRating = item && isFinite(ratingAverage(item));
    var card = document.createElement("article");
    card.className = "mp-cast-card" + (hasRating ? "" : " mp-cast-card-unrated");
    var nameBlock = document.createElement("div");
    nameBlock.className = "mp-cast-card-name";
    var name = document.createElement("button");
    name.type = "button"; name.className = "mp-cast-name"; name.textContent = actorLabel(actorId);
    name.title = "查看 " + actorName(actorId) + " 的关系页";
    name.addEventListener("click", function () { goActor(actorId); });
    nameBlock.appendChild(name);
    card.appendChild(nameBlock);
    var scoreBlock = document.createElement("div");
    scoreBlock.className = "mp-cast-card-score";
    if (hasRating) {
      var avg = ratingAverage(item);
      scoreBlock.innerHTML = "<span class='rating-stars'>" + ratingStars(avg) + "</span><strong class='rating-score'>" + ratingScore10(avg) + "</strong>";
    } else {
      scoreBlock.innerHTML = "<span class='mp-unrated'>暂无评分</span>";
    }
    card.appendChild(scoreBlock);
    var breakdown = document.createElement("div");
    breakdown.className = "mp-cast-card-breakdown";
    [["唱", "singing_avg"], ["演", "acting_avg"], ["跳", "dancing_avg"]].forEach(function (dimension) {
      var value = hasRating ? Number(item[dimension[1]]) : NaN;
      var cell = document.createElement("span");
      cell.innerHTML = "<b>" + dimension[0] + "</b><strong>" + (isFinite(value) ? ratingScore10(value) : "—") + "</strong>";
      breakdown.appendChild(cell);
    });
    if (hasRating) {
      var count = document.createElement("span");
      count.className = "mp-cast-card-count";
      count.textContent = Number(item.user_count) + (ratingDemoMode() ? " 人模拟评分" : " 人评分");
      breakdown.appendChild(count);
    }
    card.appendChild(breakdown);
    container.appendChild(card);
  }
  function renderMusicalPage(mid) {
    var m = musicals[mid];
    if (!m) { goHome(); return; }
    document.getElementById("mp-name").textContent = m.name;
    document.getElementById("mp-crumb").textContent = m.name;
    var intro = document.getElementById("mp-intro");
    var introSection = document.getElementById("mp-intro-section");
    var introText = String(m.info || "").split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean)[0] || "";
    intro.textContent = introText;
    intro.classList.remove("hidden");
    introSection.classList.toggle("hidden", !introText);
    var ms = (D.musicalStats && D.musicalStats[mid]) || {};
    var overview = document.getElementById("mp-overview");
    overview.innerHTML = "";
    var roleNames = {};
    Object.keys(m.roles || {}).forEach(function (aid) {
      (m.roles[aid] || []).forEach(function (roleName) { roleNames[roleName] = true; });
    });
    [["演出场次", ms.shows || 0], ["巡演城市", ms.cities || 0], ["卡司演员", (m.cast || []).length], ["角色", Object.keys(roleNames).length]].forEach(function (entry) {
      var item = document.createElement("span"); item.className = "ap-ov-item";
      var value = document.createElement("b"); value.textContent = entry[1];
      var label = document.createElement("em"); label.textContent = entry[0];
      item.appendChild(value); item.appendChild(label); overview.appendChild(item);
    });
    var groups = {}, noRole = [];
    (m.cast || []).forEach(function (aid) {
      var roles = (m.roles || {})[aid] || [];
      if (!roles.length) { noRole.push(aid); return; }
      roles.forEach(function (roleName) {
        var ids = groups[roleName] = groups[roleName] || [];
        if (ids.indexOf(aid) < 0) ids.push(aid);
      });
    });
    var ranking = document.getElementById("mp-cast-ranking");
    var roleTabs = document.getElementById("mp-role-tab-list");
    var roleTabsShell = document.getElementById("mp-role-tabs");
    var roleTabsPrev = document.getElementById("mp-role-tab-prev");
    var roleTabsNext = document.getElementById("mp-role-tab-next");
    var content = document.getElementById("mp-content");
    ranking.innerHTML = "";
    roleTabs.innerHTML = "";
    var panels = [];
    function updateRoleTabControls() {
      var scrollable = roleTabs.scrollWidth > roleTabs.clientWidth + 2;
      roleTabsShell.classList.toggle("is-scrollable", scrollable);
      roleTabsPrev.disabled = !scrollable || roleTabs.scrollLeft <= 2;
      roleTabsNext.disabled = !scrollable || roleTabs.scrollLeft + roleTabs.clientWidth >= roleTabs.scrollWidth - 2;
    }
    function shiftRoleTabs(direction) {
      roleTabs.scrollBy({ left: direction * Math.max(140, roleTabs.clientWidth * .72), behavior: "smooth" });
    }
    roleTabsPrev.onclick = function () { shiftRoleTabs(-1); };
    roleTabsNext.onclick = function () { shiftRoleTabs(1); };
    roleTabs.onscroll = updateRoleTabControls;
    if (roleTabs._resizeObserver) roleTabs._resizeObserver.disconnect();
    if (window.ResizeObserver) {
      roleTabs._resizeObserver = new ResizeObserver(updateRoleTabControls);
      roleTabs._resizeObserver.observe(roleTabs);
    }
    function setActiveRole(index) {
      roleTabs.querySelectorAll("button").forEach(function (button) {
        button.classList.toggle("is-active", Number(button.dataset.roleIndex) === index);
      });
      var activeTab = roleTabs.querySelector("button[data-role-index='" + index + "']");
      if (activeTab) {
        // Keep the selected tab visible without letting scrollIntoView move
        // the vertical reading column back to its top.
        var tabLeft = activeTab.offsetLeft - Math.max(0, (roleTabs.clientWidth - activeTab.offsetWidth) / 2);
        roleTabs.scrollTo({ left: Math.max(0, tabLeft), behavior: "smooth" });
      }
    }
    function roleScrollHost() {
      // 宽屏由右侧阅读列滚动；手机端则由整个剧目详情页滚动。
      // 两种布局不能共用固定的 content.scrollTo，否则手机点标签不会跳转。
      return content.scrollHeight > content.clientHeight + 2 ? content : document.getElementById("musical-view");
    }
    function scrollToRole(index) {
      var panel = panels[index];
      if (!panel) return;
      var scrollHost = roleScrollHost();
      var panelTop = panel.getBoundingClientRect().top - scrollHost.getBoundingClientRect().top + scrollHost.scrollTop;
      scrollHost.scrollTo({
        top: Math.max(0, panelTop - roleTabsShell.offsetHeight - 12),
        behavior: "smooth"
      });
      setActiveRole(index);
    }
    function addGroup(roleName, ids, index) {
      var group = document.createElement("section"); group.className = "mp-role-panel";
      group.id = "mp-role-" + mid + "-" + index;
      var head = document.createElement("div"); head.className = "mp-role-title";
      head.innerHTML = "<h3>" + escHtml(roleName) + "</h3><span>" + ids.length + " 位卡司</span>";
      group.appendChild(head);
      var carousel = document.createElement("div"); carousel.className = "mp-cast-carousel";
      var previous = document.createElement("button");
      previous.type = "button"; previous.className = "mp-carousel-control mp-carousel-prev";
      previous.setAttribute("aria-label", "查看前一批演员"); previous.title = "查看前一批演员"; previous.textContent = "‹";
      var track = document.createElement("div"); track.className = "mp-cast-card-track";
      var next = document.createElement("button");
      next.type = "button"; next.className = "mp-carousel-control mp-carousel-next";
      next.setAttribute("aria-label", "查看后一批演员"); next.title = "查看后一批演员"; next.textContent = "›";
      ids.slice().sort(function (a, b) {
        var aItem = roleName === "其他演员" ? null : musicalRoleRating(a, mid, roleName);
        var bItem = roleName === "其他演员" ? null : musicalRoleRating(b, mid, roleName);
        var aScore = aItem && isFinite(ratingAverage(aItem)) ? ratingAverage(aItem) : null;
        var bScore = bItem && isFinite(ratingAverage(bItem)) ? ratingAverage(bItem) : null;
        if (aScore != null && bScore != null && bScore !== aScore) return bScore - aScore;
        if (aScore != null && bScore == null) return -1;
        if (aScore == null && bScore != null) return 1;
        return actorName(a).localeCompare(actorName(b), "zh");
      }).forEach(function (aid) { appendMusicalCastCard(track, aid, mid, roleName === "其他演员" ? null : roleName); });
      function updateCarouselControls() {
        previous.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
        carousel.classList.toggle("is-scrollable", track.scrollWidth > track.clientWidth + 2);
      }
      previous.addEventListener("click", function () { track.scrollBy({ left: -Math.max(180, track.clientWidth * .82), behavior: "smooth" }); });
      next.addEventListener("click", function () { track.scrollBy({ left: Math.max(180, track.clientWidth * .82), behavior: "smooth" }); });
      track.addEventListener("scroll", updateCarouselControls, { passive: true });
      carousel.appendChild(previous); carousel.appendChild(track); carousel.appendChild(next);
      group.appendChild(carousel);
      ranking.appendChild(group);
      panels.push(group);
      var tab = document.createElement("button");
      tab.type = "button"; tab.textContent = roleName; tab.setAttribute("aria-controls", group.id); tab.dataset.roleIndex = index;
      tab.addEventListener("click", function () {
        scrollToRole(index);
      });
      roleTabs.appendChild(tab);
      requestAnimationFrame(updateCarouselControls);
      requestAnimationFrame(updateRoleTabControls);
    }
    var roleOrder = Object.keys(groups).sort(function (a, b) {
      var diff = groups[b].length - groups[a].length;
      return diff || a.localeCompare(b, "zh");
    });
    if (noRole.length) roleOrder.push("其他演员");
    roleOrder.forEach(function (roleName, index) { addGroup(roleName, roleName === "其他演员" ? noRole : groups[roleName], index); });
    if (panels.length) {
      setActiveRole(0);
      var scrollHost = roleScrollHost();
      scrollHost.onscroll = function () {
        var threshold = roleTabsShell.offsetHeight + 24;
        var activeIndex = 0;
        panels.forEach(function (panel, index) {
          if (panel.getBoundingClientRect().top - scrollHost.getBoundingClientRect().top <= threshold) activeIndex = index;
        });
        setActiveRole(activeIndex);
      };
    }
    requestAnimationFrame(updateRoleTabControls);
    if (!ranking.children.length) ranking.innerHTML = "<p class='rating-empty'>暂无卡司资料</p>";
  }

  // ============ 演员独立详情页 ============
  var apCanvas = document.getElementById("ap-graph"), apCtx = apCanvas.getContext("2d");
  var apNodes = {}, apEdges = [], apCenterId = null;
  var apAnimating = false, apAnimStart = 0, apRadius = 230;
  var AP_GRAPH_NODE_FONT_PX = 10, AP_GRAPH_REL_FONT_PX = 9;

  function apResize() {
    var wrap = document.getElementById("ap-graph-wrap");
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(120, wrap.clientWidth), h = Math.max(120, wrap.clientHeight);
    apCanvas.width = Math.round(w * dpr);
    apCanvas.height = Math.round(h * dpr);
    apCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    apRadius = Math.max(140, Math.min(w, h) / 2 - 80);
  }
  window.addEventListener("resize", function () { if (!actorView.classList.contains("hidden")) apResize(); });

  function buildActorGraph(id) {
    apNodes = {}; apEdges = [];
    apCenterId = id;
    apNodes[id] = { id: id, x: 0, y: 0, r: 5, core: 4.5, glow: 44, color: "#c9a961", label: actorName(id), fixed: true, alpha: 1 };

    // 直接相关的人：id -> {rel:[], cw:0, group:null}
    var nbr = {};
    function addRel(oid, r) {
      if (oid === id) return;                       // 防御：绝不连"自己"
      if (!nbr[oid]) nbr[oid] = { rel: [], cw: 0, group: null };
      nbr[oid].rel.push(r);
    }
    relations.forEach(function (r) {
      if (r.a === id) addRel(r.b, r);
      else if (r.b === id) addRel(r.a, r);
    });
    // 常共演（按场次取前 20）
    (coWorkByActor[id] || []).filter(function (e) { return e.a !== e.b; })
      .slice().sort(function (x, y) { return y.count - x.count; }).slice(0, 20)
      .forEach(function (e) {
        var o = e.a === id ? e.b : e.a;
        if (o === id) return;
        if (!nbr[o]) nbr[o] = { rel: [], cw: 0, group: null };
        nbr[o].cw = e.count;
      });
    // 团体成员
    groups.forEach(function (g) {
      var members = g.members || [];
      if (!members.length || members.indexOf(id) < 0) return;
      members.forEach(function (m) {
        if (m === id) return;
        if (!nbr[m]) nbr[m] = { rel: [], cw: 0, group: null };
        nbr[m].group = g.name;
      });
    });

    var order = Object.keys(nbr).sort(function (x, y) {
      return (nbr[y].rel.length - nbr[x].rel.length) || (nbr[y].cw - nbr[x].cw);
    });
    // 有机平铺：在板块矩形范围内随机散落；按亲密度决定距中心的远近（明确关系最近、共演多者次之、仅团体最远），并始终不越出边框
    var W2 = apCanvas.clientWidth / 2 - 36;    // 矩形半宽（预留边距与文字空间）
    var H2 = apCanvas.clientHeight / 2 - 36;   // 矩形半高
    var placed = [];
    order.forEach(function (oid, i) {
      var info = nbr[oid];
      var hasRel = info.rel.length > 0;
      // 明确关系：按优先级取关系色点亮；仅共演/团体：中性灰蓝
      var color = "#9aa2ad";
      if (hasRel) {
        var bestP = 99;
        info.rel.forEach(function (r_) {
          var pr = REL_TYPE_PRIORITY[r_.type] || 99;
          if (pr < bestP && TYPE_COLOR[r_.type]) { bestP = pr; color = TYPE_COLOR[r_.type]; }
        });
      }
      var closeness = (hasRel ? 2.2 : 0) + (info.cw > 0 ? Math.min(1.2, info.cw / 40) : 0) + (info.group ? 0.4 : 0);
      var f = 1 - 0.62 * Math.min(1, closeness / 2.6);      // 亲密度越高 f 越小 → 越靠中心
      var angle = (i / Math.max(1, order.length)) * Math.PI * 2 - Math.PI / 2 + (Math.random() - 0.5) * 1.3;
      var jr = 0.8 + Math.random() * 0.35;
      var tx = Math.cos(angle) * f * jr * W2;
      var ty = Math.sin(angle) * f * jr * H2;
      tx = Math.max(-W2, Math.min(W2, tx));                  // 边界钳制：绝不超出板块
      ty = Math.max(-H2, Math.min(H2, ty));
      apNodes[oid] = {
        id: oid, x: tx, y: ty, tx: tx, ty: ty,
        r: 3, core: 3, glow: hasRel ? 20 : 15,
        color: color, label: actorLabel(oid), fixed: false, alpha: 0.95
      };
      placed.push(oid);
      info.rel.forEach(function (r_) {
        apEdges.push({ a: id, b: oid, color: TYPE_COLOR[r_.type] || "#999", dashed: false, width: 0.9, alpha: 0.38, label: TYPE_LABEL[r_.type] || r_.typeName });
      });
      if (info.cw > 0) apEdges.push({ a: id, b: oid, color: TYPE_COLOR["co_work"], dashed: true, width: 0.45, alpha: 0.20, label: "" });
      if (info.group) apEdges.push({ a: id, b: oid, color: "#64748b", dashed: true, width: 0.45, alpha: 0.20, label: "" });
    });
    // 松弛：轻微斥力避免重叠 + 拉回各自目标位置；每轮都钳制在矩形边框内
    for (var it = 0; it < 70; it++) {
      var moved = false;
      for (var a = 0; a < placed.length; a++) {
        var na = apNodes[placed[a]];
        for (var b = a + 1; b < placed.length; b++) {
          var nb = apNodes[placed[b]];
          var ddx = nb.x - na.x, ddy = nb.y - na.y;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy) + 1e-6;
          if (dd < 42) {
            var push = (42 - dd) / 2;
            var ux = ddx / dd, uy = ddy / dd;
            na.x -= ux * push; na.y -= uy * push;
            nb.x += ux * push; nb.y += uy * push;
            moved = true;
          }
        }
      }
      placed.forEach(function (pid) {
        var nn = apNodes[pid];
        nn.x += (nn.tx - nn.x) * 0.1;
        nn.y += (nn.ty - nn.y) * 0.1;
        nn.x = Math.max(-W2, Math.min(W2, nn.x));
        nn.y = Math.max(-H2, Math.min(H2, nn.y));
      });
      if (!moved) break;
    }
    window.__apNodeCount = Object.keys(apNodes).length;

    apAnimating = true;
    apAnimStart = performance.now();
    apCtx.clearRect(0, 0, apCanvas.clientWidth, apCanvas.clientHeight);
    requestAnimationFrame(apDrawFrame);
  }

  function apDrawFrame(ts) {
    if (!apAnimating) return;
    var t = Math.min(1, (ts - apAnimStart) / 650);
    var e = 1 - Math.pow(1 - t, 3);                 // easeOutCubic 进入动效，随后静止
    apCtx.clearRect(0, 0, apCanvas.clientWidth, apCanvas.clientHeight);
    var cx = apCanvas.clientWidth / 2, cy = apCanvas.clientHeight / 2;
    apEdges.forEach(function (ed) {
      var ax = cx, ay = cy, bx = cx + apNodes[ed.b].x * e, by = cy + apNodes[ed.b].y * e;
      apCtx.strokeStyle = ed.color; apCtx.globalAlpha = ed.alpha != null ? ed.alpha : (ed.dashed ? 0.20 : 0.38);
      apCtx.lineWidth = ed.width;
      apCtx.setLineDash(ed.dashed ? [2, 4] : []);
      apCtx.beginPath(); apCtx.moveTo(ax, ay); apCtx.lineTo(bx, by); apCtx.stroke();
      apCtx.setLineDash([]);
      if (ed.label && t > 0.7) {
        apCtx.font = AP_GRAPH_REL_FONT_PX + "px sans-serif"; apCtx.textAlign = "center";
        fillLabel(apCtx, ed.label, (ax + bx) / 2, (ay + by) / 2 - 4);
      }
    });
    apCtx.globalAlpha = 1;
    Object.keys(apNodes).forEach(function (k) {
      var n = apNodes[k];
      var x = cx + n.x * e, y = cy + n.y * e;
      drawLightPoint(apCtx, x, y, n, n.color);          // 与首页一致的柔和光点（无边框）
      apCtx.font = AP_GRAPH_NODE_FONT_PX + "px sans-serif"; apCtx.textAlign = "center";
      fillLabel(apCtx, n.label, x, y + (n.core || 3) + 16);
    });
    if (t < 1) requestAnimationFrame(apDrawFrame); else apAnimating = false;
  }

  // 点击判定：节点圆 + 下方名字文字区都算可点击（提高命中率，点名字也能跳转）
  function apHitTest(clientX, clientY) {
    if (!apCenterId || !apNodes[apCenterId]) return null;
    var rect = apCanvas.getBoundingClientRect();
    var px = clientX - rect.left, py = clientY - rect.top;
    var best = null, bd = 1e9;
    Object.keys(apNodes).forEach(function (k) {
      var n = apNodes[k];
      var x = apCanvas.clientWidth / 2 + n.x, y = apCanvas.clientHeight / 2 + n.y;
      var d = (x - px) * (x - px) + (y - py) * (y - py);
      var R = n.r + 18;
      var inLabel = Math.abs(px - x) <= 60 && py >= y + n.r - 4 && py <= y + n.r + 26;
      if ((d < R * R || inLabel) && d < bd) { bd = d; best = k; }
    });
    return best;
  }
  apCanvas.addEventListener("mousemove", function (e) {
    apCanvas.style.cursor = apHitTest(e.clientX, e.clientY) ? "pointer" : "default";
  });
  apCanvas.addEventListener("click", function (e) {
    var best = apHitTest(e.clientX, e.clientY);
    if (best && best !== apCenterId) goActor(best);
  });

  // 演员页图例（静态颜色说明）
  (function buildApLegend() {
    var box = document.getElementById("ap-legend");
    if (!box) return;
    box.innerHTML = "";
    [
      ["伴侣", TYPE_COLOR.married], ["情侣", TYPE_COLOR.couple], ["前任", TYPE_COLOR.ex],
      ["CP", TYPE_COLOR.cp], ["同学", TYPE_COLOR.classmate],

      ["共演", TYPE_COLOR.co_work], ["团体", "#46c48a"]
    ].forEach(function (pair) {
      var span = document.createElement("span");
      span.className = "lg";
      span.style.setProperty("--c", pair[1]);
      span.textContent = pair[0];
      box.appendChild(span);
    });
  })();

  // ============ 查合作（演员页：查询当前演员与任意演员的共演情况） ============
  function escHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var coworkLoaded = false;
  var lastCowork = null;
  function loadCoworkData(cb) {
    if (window.MUSIC_GRAPH_COWORK) { cb(); return; }
    if (coworkLoaded) { cb(); return; }
    coworkLoaded = true;
    var s = document.createElement("script");
    s.src = "data_cowork.js";   // 全部共演对：按需加载，避免拖慢首屏
    s.onload = function () {
      var list = window.MUSIC_GRAPH_COWORK;
      if (list) { for (var i = 0; i < list.length; i++) { list[i].a = String(list[i].a); list[i].b = String(list[i].b); } }
      cb();
    };
    s.onerror = cb;
    document.head.appendChild(s);
  }
  function renderCoworkBox(target, pair, box) {
    if (!target) {
      box.innerHTML = "<div class='cw-none'>未找到演员「" + escHtml(document.getElementById("cw-q").value.trim()) + "」，可前往 Contribute 补充资料</div>";
      box.classList.remove("hidden");
      return;
    }
    if (!pair) {
      box.innerHTML = "<div class='cw-none'>未发现「" + escHtml(actorName(apCenterId)) + "」与「" + escHtml(actorName(target)) + "」的合作记录（或资料暂缺）</div>";
      box.classList.remove("hidden");
      return;
    }
    var common = [];
    Object.keys(musicals).forEach(function (mid) {
      var m = musicals[mid];
      var cast = m.cast || [];
      if (cast.indexOf(apCenterId) >= 0 && cast.indexOf(target) >= 0) {
        common.push({ name: m.name, r1: (m.roles || {})[apCenterId] || [], r2: (m.roles || {})[target] || [] });
      }
    });
    var h = "<div class='cw-head'>与 <b>" + escHtml(actorName(target)) + "</b> 的合作</div>";
    h += "<div class='cw-stats'>共演 <b>" + pair.c + "</b> 场 · 共同剧目 <b>" + (pair.m || common.length) + "</b> 部</div>";
    if (pair.f || pair.l) h += "<div class='cw-meta'>首次 " + escHtml(pair.f || "-") + " · 最近 " + escHtml(pair.l || "-") + "</div>";
    if (common.length) {
      h += "<ul class='cw-mus'>";
      common.slice(0, 20).forEach(function (cm) {
        h += "<li><span class='cw-mus-name'>" + escHtml(cm.name) + "</span>";
        if (cm.r1.length) h += " <span class='rel-detail'>" + escHtml(cm.r1.join("/")) + "</span>";
        if (cm.r1.length && cm.r2.length) h += " × ";
        if (cm.r2.length) h += "<span class='rel-detail'>" + escHtml(cm.r2.join("/")) + "</span>";
        h += "</li>";
      });
      if (common.length > 20) h += "<li class='rel-detail'>… 共 " + common.length + " 部</li>";
      h += "</ul>";
    }
    h += "<div class='cw-actions'><span class='cw-hint'>查看共演场次明细</span><button type='button' class='c-btn' id='cw-export'>导出表格</button></div>";
    box.innerHTML = h;
    box.classList.remove("hidden");
    lastCowork = { a: apCenterId, b: target, name: actorName(target), pair: pair, common: common };
    var ex = document.getElementById("cw-export");
    if (ex) ex.addEventListener("click", exportCoworkDetail);
  }
  function queryCoworkSupabase(name, box) {
    var target = null;
    Object.keys(actors).forEach(function (k) { if (target === null && actors[k].name === name) target = k; });
    if (!target) { renderCoworkBox(null, null, box); return; }
    var a = String(apCenterId), b = String(target);
    var where = "or=(and(actor_a.eq." + a + ",actor_b.eq." + b + "),and(actor_a.eq." + b + ",actor_b.eq." + a + "))";
    sbGet("/rest/v1/co_work_edges?select=actor_a,actor_b,co_show_count,co_musical_count,first_co_date,last_co_date&" + where + "&limit=5")
      .then(function (rows) {
        var row = rows && rows[0] ? rows[0] : null;
        var pair = row ? { a: a, b: b, c: row.co_show_count || 0, m: row.co_musical_count || 0, f: row.first_co_date || "", l: row.last_co_date || "" } : null;
        renderCoworkBox(target, pair, box);
      }).catch(function () { renderCoworkBox(target, null, box); });
  }
  function queryCowork() {
    var name = document.getElementById("cw-q").value.trim();
    var box = document.getElementById("cw-result");
    var coworkDropdown = document.getElementById("cw-dropdown");
    if (coworkDropdown) coworkDropdown.classList.add("hidden");
    if (!name || !apCenterId) return;
    box.classList.add("hidden");
    var sb = window.MG_SUPABASE;
    if (sb && sb.url && sb.anonKey) { queryCoworkSupabase(name, box); return; }
    loadCoworkData(function () {
      var target = null;
      Object.keys(actors).forEach(function (k) { if (target === null && actors[k].name === name) target = k; });
      var pair = null;
      (window.MUSIC_GRAPH_COWORK || []).forEach(function (e) {
        if (pair) return;
        if ((e.a === apCenterId && e.b === target) || (e.a === target && e.b === apCenterId)) pair = e;
      });
      renderCoworkBox(target, pair, box);
    });
  }
  function coworkDetailKey() {
    if (!lastCowork) return null;
    var a = String(lastCowork.a), b = String(lastCowork.b);
    return a < b ? a + "|" + b : b + "|" + a;
  }
  function sortShows(list) {
    return list.slice().sort(function (x, y) {
      return String(x.date || "").localeCompare(String(y.date || "")) || String(x.time || "").localeCompare(String(y.time || ""));
    });
  }
  function downloadCsv(name, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function sbAuth() {
    var sb = window.MG_SUPABASE;
    return sb && sb.url && sb.anonKey ? { apikey: sb.anonKey, Authorization: "Bearer " + sb.anonKey } : null;
  }
  function sbGet(path) {
    return fetch(window.MG_SUPABASE.url + path, { headers: sbAuth(), signal: AbortSignal.timeout(8000) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function sbPageAll(table, fields, where) {
    var out = [], limit = 1000;
    function next(off) {
      var q = "select=" + encodeURIComponent(fields) + "&limit=" + limit + "&offset=" + off + (where ? "&" + where : "");
      return sbGet("/rest/v1/" + table + "?" + q).then(function (rows) {
        rows = rows || []; out = out.concat(rows);
        if (rows.length === limit) return next(off + rows.length);
        return out;
      });
    }
    return next(0);
  }
  function exportCoworkDetail() {
    if (!lastCowork) return;
    var sb = window.MG_SUPABASE;
    if (sb && sb.url && sb.anonKey) {
      var a = String(lastCowork.a), b = String(lastCowork.b);
      Promise.all([
        sbPageAll("show_casts", "show_id,role", "artist_id=eq." + a),
        sbPageAll("show_casts", "show_id,role", "artist_id=eq." + b)
      ]).then(function (both) {
        var mapA = {}, mapB = {}, ids = [];
        both[0].forEach(function (r) { mapA[String(r.show_id)] = r.role || ""; });
        both[1].forEach(function (r) { mapB[String(r.show_id)] = r.role || ""; });
        Object.keys(mapA).forEach(function (sid) { if (mapB[sid] !== undefined && ids.indexOf(sid) < 0) ids.push(sid); });
        if (!ids.length) {
          downloadCsv("共演场次明细.csv", [["日期","时间","剧目","城市","剧场",actorName(lastCowork.a),actorName(lastCowork.b)],["共演场次",String(lastCowork.pair.c),"共同剧目数",String(lastCowork.pair.m || lastCowork.common.length),"首次",lastCowork.pair.f || "-","最近",lastCowork.pair.l || "-"]]);
          return;
        }
        var groups = [];
        for (var gi = 0; gi < ids.length; gi += 500) groups.push(ids.slice(gi, gi + 500));
        return Promise.all(groups.map(function (g) {
          return sbGet("/rest/v1/shows?select=id,date,time,musical,city,theatre&id=in.(" + g.join(",") + ")&limit=1000");
        })).then(function (chunks) {
          var shows = [];
          chunks.forEach(function (c) { shows = shows.concat(c || []); });
          shows.sort(function (x, y) {
            return String(x.date || "").localeCompare(String(y.date || "")) || String(x.time || "").localeCompare(String(y.time || ""));
          });
          var rows = [["日期","时间","剧目","城市","剧场",actorName(lastCowork.a),actorName(lastCowork.b)]];
          shows.forEach(function (s) {
            rows.push([s.date || "-", s.time || "-", s.musical || "-", s.city || "-", s.theatre || "-", mapA[String(s.id)] || "-", mapB[String(s.id)] || "-"]);
          });
          downloadCsv("共演场次明细.csv", rows);
        });
      }).catch(function () {
        downloadCsv("共演场次明细.csv", [["日期","时间","剧目","城市","剧场",actorName(lastCowork.a),actorName(lastCowork.b)],["共演场次",String(lastCowork.pair.c),"共同剧目数",String(lastCowork.pair.m || lastCowork.common.length),"首次",lastCowork.pair.f || "-","最近",lastCowork.pair.l || "-"]]);
      });
      return;
    }
    var map = window.MUSIC_GRAPH_COWORK_DETAIL;
    var key = coworkDetailKey();
    var list = (map && key && map[key]) ? map[key] : [];
    var rows = [["日期", "时间", "剧目", "城市", "剧场", actorName(lastCowork.a), actorName(lastCowork.b)]];
    if (list.length) {
      sortShows(list).forEach(function (r) {
        rows.push([r.date || "-", r.time || "-", r.musical || "-", r.city || "-", r.theatre || "-", r.ra || "-", r.rb || "-"]);
      });
    } else {
      rows.push(["共演场次", String(lastCowork.pair.c), "共同剧目数", String(lastCowork.pair.m || lastCowork.common.length), "首次", lastCowork.pair.f || "-", "最近", lastCowork.pair.l || "-"]);
    }
    downloadCsv("共演场次明细.csv", rows);
  }
  var cwQ = document.getElementById("cw-q");
  if (cwQ) {
    var cwDropdown = document.getElementById("cw-dropdown");
    function renderCoworkSuggestions() {
      var query = cwQ.value.trim();
      if (!cwDropdown || !query) { if (cwDropdown) cwDropdown.classList.add("hidden"); return; }
      var hits = Object.keys(actors).filter(function (id) {
        return String(id) !== String(apCenterId) && matches(actors[id], query);
      }).slice(0, 8);
      cwDropdown.innerHTML = "";
      hits.forEach(function (id) {
        var actor = actors[id];
        var item = document.createElement("div");
        item.className = "item";
        item.innerHTML = escHtml(actor.name) + (actor.nickname ? " <small>" + escHtml(actor.nickname) + "</small>" : "");
        item.addEventListener("mousedown", function (event) {
          event.preventDefault();
          cwQ.value = actor.name;
          queryCowork();
        });
        cwDropdown.appendChild(item);
      });
      cwDropdown.classList.toggle("hidden", !hits.length);
    }
    document.getElementById("cw-go").addEventListener("click", queryCowork);
    cwQ.addEventListener("input", renderCoworkSuggestions);
    cwQ.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var first = cwDropdown && cwDropdown.querySelector(".item");
      if (first) first.dispatchEvent(new MouseEvent("mousedown"));
      else queryCowork();
    });
  }

  // ---- 演员页内容 ----
  function renderRelations(id) {
    var ul = document.getElementById("ap-relations"); ul.innerHTML = "";
    var grouped = {};
    relations.forEach(function (r) {
      if (r.a !== id && r.b !== id) return;
      var other = r.a === id ? r.b : r.a;
      var key = other + "_" + r.type;
      if (!grouped[key]) grouped[key] = { other: other, type: r.type, typeName: r.typeName, details: [] };
      if (r.detail) grouped[key].details.push(r.detail);
    });
    Object.keys(grouped).forEach(function (key) {
      var g = grouped[key];
      var li = document.createElement("li");
      var tag = document.createElement("span");
      tag.className = "tag"; tag.style.setProperty("--tag-c", TYPE_COLOR[g.type] || "#999");
      tag.textContent = g.typeName;
      li.appendChild(tag);
      var txt = document.createElement("span");
      txt.className = "c";
      var uniq = g.details.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      txt.textContent = actorLabel(g.other) + (uniq.length ? "（" + uniq.join(" / ") + "）" : "");
      txt.title = "查看 " + actorName(g.other) + " 的关系页";
      txt.addEventListener("click", function () { goActor(g.other); });
      li.appendChild(txt);
      var myMusObj = actorMusicals[id] || {}, otherMusObj = actorMusicals[g.other] || {};
      var common = Object.keys(myMusObj).filter(function (m) { return otherMusObj.hasOwnProperty(m); });
      if (common.length) {
        var sub = document.createElement("div");
        sub.className = "rel-detail";
        sub.textContent = "共同作品：" + common.join("、");
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    if (!ul.children.length) {
      var li = document.createElement("li"); li.textContent = "暂无手动关系记录";
      ul.appendChild(li);
    }
  }
  var COWORK_LIST_LIMIT = 20;
  function renderCowork(id) {
    var ul = document.getElementById("ap-cowork"); ul.innerHTML = "";
    var sb = window.MG_SUPABASE;
    if (sb && sb.url && sb.anonKey) {
      sbGet("/rest/v1/co_work_edges?select=actor_a,actor_b,co_show_count&or=(actor_a.eq." + String(id) + ",actor_b.eq." + String(id) + ")&limit=1000").then(function (rows) {
        var list = (rows || []).map(function (r) { return { a: String(r.actor_a), b: String(r.actor_b), count: r.co_show_count || 0 }; })
          .filter(function (e) { return e.a !== e.b; })
          .sort(function (x, y) { return y.count - x.count; })
          .slice(0, COWORK_LIST_LIMIT);
        list.forEach(function (e) {
          var other = e.a === String(id) ? e.b : e.a;
          var li = document.createElement("li");
          var span = document.createElement("span"); span.className = "c"; span.textContent = actorLabel(other);
          span.title = "查看 " + actorName(other) + " 的关系页";
          span.addEventListener("click", function () { goActor(other); });
          li.appendChild(span);
          var cnt = document.createElement("span"); cnt.className = "rel-detail"; cnt.textContent = "共演 " + e.count + " 场";
          li.appendChild(cnt);
          ul.appendChild(li);
        });
        if (!list.length) { var li = document.createElement("li"); li.textContent = "暂无共演数据"; ul.appendChild(li); }
      }).catch(function () { var li = document.createElement("li"); li.textContent = "暂无共演数据"; ul.appendChild(li); });
      return;
    }
    var list = (coWorkByActor[id] || []).filter(function (e) { return e.a !== e.b; })
      .slice().sort(function (x, y) { return y.count - x.count; }).slice(0, COWORK_LIST_LIMIT);
    list.forEach(function (e) {
      var other = e.a === id ? e.b : e.a;
      if (other === id) return;                     // 防御：绝不显示"自己"
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.className = "c";
      span.textContent = actorLabel(other);
      span.title = "查看 " + actorName(other) + " 的关系页";
      span.addEventListener("click", function () { goActor(other); });
      li.appendChild(span);
      var cnt = document.createElement("span");
      cnt.className = "rel-detail";
      cnt.textContent = "共演 " + e.count + " 场";
      li.appendChild(cnt);
      ul.appendChild(li);
    });
    if (!list.length) {
      var li = document.createElement("li"); li.textContent = "暂无共演数据";
      ul.appendChild(li);
    }
  }
  function renderMusicals(id) {
    var ul = document.getElementById("ap-musicals"); ul.innerHTML = "";
    var myMusObj = actorMusicals[id] || {};
    var myMusList = Object.keys(myMusObj);
    if (myMusList.length) {
      myMusList.slice(0, 30).forEach(function (m) {
        var li = document.createElement("li");
        var rolesArr = myMusObj[m] || [];
        var span = document.createElement("span");
        span.className = "c";
        span.textContent = m;
        span.title = "查看剧目详情";
        span.addEventListener("click", function () {
          var mid = Object.keys(musicals).filter(function (k) { return musicals[k].name === m; })[0];
          if (mid) goMusicalDetail(mid);
        });
        li.appendChild(span);
        if (rolesArr.length) {
          var sub = document.createElement("span");
          sub.className = "rel-detail";
          sub.textContent = "（" + rolesArr.join(" / ") + "）";
          li.appendChild(sub);
        }
        ul.appendChild(li);
      });
      if (myMusList.length > 30) {
        var li = document.createElement("li");
        li.className = "rel-detail";
        li.textContent = "… 共 " + myMusList.length + " 部";
        ul.appendChild(li);
      }
    } else {
      var li = document.createElement("li"); li.textContent = "暂无参演记录";
      ul.appendChild(li);
    }
  }
  function renderGroups(id) {
    var ul = document.getElementById("ap-groups"); ul.innerHTML = "";
    var myGroups = groups.filter(function (g) { return (g.members || []).indexOf(id) >= 0; });
    myGroups.forEach(function (g) {
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.className = "c";
      span.textContent = g.name;
      span.title = "查看团体成员";
      span.addEventListener("click", function () { goGroup(g.id); });
      li.appendChild(span);
      if (g.type) {
        var sub = document.createElement("span");
        sub.className = "rel-detail";
        sub.textContent = groupTypeLabel(g.type);
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    if (!ul.children.length) {
      var li = document.createElement("li"); li.textContent = "暂无团体记录";
      ul.appendChild(li);
    }
  }

  function renderMoments(id) {
    var sec = document.getElementById("ap-moments-sec");
    if (!sec) return;
    var ul = document.getElementById("ap-moments");
    var list = momentsByActor[id] || [];
    if (!list.length) { sec.classList.add("hidden"); ul.innerHTML = ""; return; }
    sec.classList.remove("hidden");
    ul.innerHTML = "";
    list.forEach(function (m) {
      var li = document.createElement("li");
      li.className = "mom-item";
      var body = document.createElement("span");
      body.className = "mom-body";
      var url = safeUrl(m.url);
      var title = document.createElement(url ? "a" : "span");
      title.className = "mom-title";
      title.textContent = m.title;
      if (url) { title.href = url; title.target = "_blank"; title.rel = "noopener noreferrer"; title.title = "在新窗口打开"; }
      var src = document.createElement("span");
      src.className = "mom-src"; src.textContent = SOURCE_LABEL[m.source] || m.source || "";
      body.appendChild(title); body.appendChild(src);
      li.appendChild(body);
      ul.appendChild(li);
    });
  }

  function renderActorPage(id) {
    var a = actors[id];
    document.getElementById("ap-name").textContent = a ? a.name : "演员 " + id;
    document.getElementById("ap-nickname").textContent = (a && a.nickname) ? a.nickname : "";
    var crumb = document.getElementById("ap-crumb");
    if (crumb) crumb.textContent = a ? a.name : "演员 " + id;
    var st = computeStats(id);
    var relN = 0;
    relations.forEach(function (r) { if (r.a === id || r.b === id) relN++; });
    var grpN = groups.filter(function (g) { return (g.members || []).indexOf(id) >= 0; }).length;
    var ov = document.getElementById("ap-overview");
    if (ov) {
      ov.innerHTML = "";
      [["参演剧目", st.musicals], ["合作演员", st.partners], ["关系", relN], ["所属团体", grpN]].forEach(function (it) {
        var s = document.createElement("span");
        s.className = "ap-ov-item";
        var b = document.createElement("b"); b.textContent = it[1];
        var em = document.createElement("em"); em.textContent = it[0];
        s.appendChild(b); s.appendChild(em);
        ov.appendChild(s);
      });
    }
    var dl = document.getElementById("ap-fields"); dl.innerHTML = "";
    var fields = [
      ["学校", "school"], ["入学", "enrollment_year"], ["专业", "major"], ["职务", "role"],
      ["籍贯", "hometown"], ["身高", "height"], ["生日", "birth_date"], ["备注", "note"]
    ];
    fields.forEach(function (f) {
      if (a && a[f[1]]) {
        var dt = document.createElement("dt"); dt.textContent = f[0];
        var dd = document.createElement("dd"); dd.textContent = a[f[1]];
        dl.appendChild(dt); dl.appendChild(dd);
      }
    });
    if (!dl.children.length) {
      var dt = document.createElement("dt"); dt.textContent = "资料";
      var dd = document.createElement("dd"); dd.textContent = "暂无补充资料";
      dl.appendChild(dt); dl.appendChild(dd);
    }
    if (Object.keys(actorMusicals[id] || {}).length > 0 && (coWorkByActor[id] || []).length === 0) {
      var hintDt = document.createElement("dt"); hintDt.textContent = "提示";
      var hintDd = document.createElement("dd"); hintDd.className = "rel-detail"; hintDd.textContent = "人物具体排期数据暂无，无法解析对应人物关系。";
      dl.appendChild(hintDt); dl.appendChild(hintDd);
    }
    renderRelations(id);
    renderGroups(id);
    renderMoments(id);
    renderMusicals(id);
    renderActorRating(id);
    renderCowork(id);
    apResize();
    buildActorGraph(id);
    var cwQ2 = document.getElementById("cw-q");
    if (cwQ2) cwQ2.value = "";
    var cwDrop = document.getElementById("cw-dropdown");
    if (cwDrop) cwDrop.classList.add("hidden");
    var cwRes = document.getElementById("cw-result");
    if (cwRes) { cwRes.classList.add("hidden"); cwRes.innerHTML = ""; }
  }
  document.getElementById("ap-back").addEventListener("click", goHome);
  document.getElementById("mp-back").addEventListener("click", goHome);
  document.querySelectorAll(".ap-graph-link").forEach(function (apGraphLink) {
    apGraphLink.addEventListener("click", function (e) {
      e.preventDefault();
      goGraphFocus(apCenterId);
    });
  });

  // ---- 搜索 ----
  var search = document.getElementById("search"), dropdown = document.getElementById("dropdown");
  var actorSearchIndex = window.MUSIC_GRAPH_SEARCH_INDEX || {};
  function matches(actor, q) {
    q = q.toLowerCase();
    if ((actor.name || "").toLowerCase().indexOf(q) >= 0) return true;
    if ((actor.nickname || "").toLowerCase().indexOf(q) >= 0) return true;
    if ((actor.school || "").toLowerCase().indexOf(q) >= 0) return true;
    var latin = q.replace(/[^a-z0-9]/g, "");
    if (latin && /^[a-z0-9]+$/.test(latin)) {
      return (actorSearchIndex[String(actor.id)] || "").indexOf(latin) >= 0;
    }
    return false;
  }
  function doSearch(search, dropdown) {
    var q = search.value.trim();
    if (!q) { dropdown.classList.add("hidden"); return; }
    var hits = [];
    Object.keys(actors).forEach(function (k) {
      if (hits.length >= 20) return;
      if (matches(actors[k], q)) hits.push({ type: "actor", data: actors[k] });
    });
    Object.keys(musicals).forEach(function (k) {
      if (hits.length >= 30) return;
      var m = musicals[k];
      if ((m.name || "").toLowerCase().indexOf(q.toLowerCase()) >= 0) {
        hits.push({ type: "musical", data: m, id: k });
      }
    });
    groups.forEach(function (g) {
      if (hits.length >= 30) return;
      if ((g.name || "").toLowerCase().indexOf(q.toLowerCase()) >= 0) {
        hits.push({ type: "group", data: g, id: g.id });
      }
    });
    dropdown.innerHTML = "";
    hits.forEach(function (hit) {
      var div = document.createElement("div");
      div.className = "item";
      if (hit.type === "actor") {
        var a = hit.data;
        div.innerHTML = a.name + (a.nickname ? " <small>" + a.nickname + "</small>" : "") + (a.school ? " <small>" + a.school + "</small>" : "");
      } else if (hit.type === "musical") {
        div.innerHTML = hit.data.name + " <small>作品</small>";
      } else {
        div.innerHTML = hit.data.name + " <small>团体</small>";
      }
      div.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
        if (hit.type === "actor") { closeTopSearch(); goGraphFocus(hit.data.id); }
        else if (hit.type === "musical") goMusical(hit.id);
        else goGroup(hit.id);
      });
      dropdown.appendChild(div);
    });
    dropdown.classList.remove("hidden");
  }
  function bindSearch(search, dropdown) {
    search.addEventListener("input", function () { doSearch(search, dropdown); });
    search.addEventListener("keydown", function (e) { if (e.key === "Enter") { var first = dropdown.querySelector(".item"); if (first) first.dispatchEvent(new MouseEvent("mousedown")); } });
  }
  bindSearch(search, dropdown);

  // ---- 顶部搜索：图标 -> 点击展开输入框 ----
  var searchToggle = document.getElementById("search-toggle");
  var topSearchBox = document.getElementById("top-search-box");
  function openTopSearch() {
    topSearchBox.classList.remove("hidden");
    topSearchBox.classList.remove("open");
    void topSearchBox.offsetWidth;   // 强制回流，让展开过渡生效
    topSearchBox.classList.add("open");
    search.focus();
  }
  function closeTopSearch() {
    topSearchBox.classList.remove("open");
    search.value = "";
    dropdown.classList.add("hidden");
    clearTimeout(topSearchBox._t);
    topSearchBox._t = setTimeout(function () {
      if (!topSearchBox.classList.contains("open")) topSearchBox.classList.add("hidden");
    }, 480);   // 等收起动效结束再挂 display:none
  }
  if (searchToggle) {
    searchToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (topSearchBox.classList.contains("hidden")) openTopSearch();
      else closeTopSearch();
    });
  }

  var apSearchEl = document.getElementById("ap-search");
  if (apSearchEl) bindSearch(apSearchEl, document.getElementById("ap-dropdown"));
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-box") && !e.target.closest(".ap-search-wrap") && !e.target.closest(".cw-query")) {
      document.getElementById("dropdown").classList.add("hidden");
      var topBox = document.getElementById("top-search-box");
      if (topBox && !topBox.classList.contains("hidden")) closeTopSearch();
      var apDrop = document.getElementById("ap-dropdown");
      if (apDrop) apDrop.classList.add("hidden");
      var cwDrop = document.getElementById("cw-dropdown");
      if (cwDrop) cwDrop.classList.add("hidden");
    }
  });

  // ---- 首次进入提示 + 左下角「？」帮助入口 ----
  var firstHint = document.getElementById("first-hint");
  var helpFab = document.getElementById("help-fab");
  var helpGuide = document.getElementById("help-guide");
  function maybeShowFirstHint() {
    if (!firstHint) return;
    try {
      if (localStorage.getItem("mg_seen_first_hint")) return;
      localStorage.setItem("mg_seen_first_hint", "1");
    } catch (e) {}
    setTimeout(function () {
      if (homeView.classList.contains("hidden")) return;
      firstHint.classList.remove("hidden");
      requestAnimationFrame(function () { firstHint.classList.add("show"); });
      blinkNearbyStar();
      setTimeout(function () {
        firstHint.classList.remove("show");
        setTimeout(function () { firstHint.classList.add("hidden"); }, 650);
      }, 3600);
    }, 900);
  }
  function blinkNearbyStar() {
    var rect = canvas.getBoundingClientRect();
    var cx = rect.left + canvas.clientWidth / 2, cy = rect.bottom - 60;
    var best = null, bestD = 1e18;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (!n) return;
      var sx = rect.left + canvas.clientWidth / 2 + view.x + n.x * view.zoom;
      var sy = rect.top + canvas.clientHeight / 2 + view.y + n.y * view.zoom;
      var d = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy);
      if (d < bestD) { bestD = d; best = n; }
    });
    if (best) best._blinkT = performance.now();
  }
  if (helpFab && helpGuide) {
    var helpHideTimer = null;
    function showHelp() { clearTimeout(helpHideTimer); helpGuide.classList.remove("hidden"); }
    function hideHelp() { helpGuide.classList.add("hidden"); }
    function scheduleHideHelp() { clearTimeout(helpHideTimer); helpHideTimer = setTimeout(hideHelp, 160); }
    // 悬停即显示（鼠标移到指南卡片上不关闭；移开稍后自动收起）
    helpFab.addEventListener("mouseenter", showHelp);
    helpFab.addEventListener("mouseleave", scheduleHideHelp);
    helpGuide.addEventListener("mouseenter", showHelp);
    helpGuide.addEventListener("mouseleave", scheduleHideHelp);
    // 触屏无 hover：点击切换
    if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) {
      helpFab.addEventListener("click", function (e) {
        e.stopPropagation();
        if (helpGuide.classList.contains("hidden")) showHelp(); else hideHelp();
      });
    }
    document.addEventListener("click", function (e) {
      if (!helpGuide.classList.contains("hidden") &&
          !e.target.closest("#help-guide") && !e.target.closest("#help-fab")) {
        hideHelp();
      }
    });
  }

  // ---- 供自动化验证读取的调试接口（对日常使用无影响）----
  window.__entranceT = function () { return entranceT; };
  window.__homeZoom = function () { return view.zoom; };
  window.__homeView = function () { return { x: view.x, y: view.y, zoom: view.zoom }; };
  window.__homeResetView = function () { view.zoom = 0.92; view.x = 0; view.y = 0; viewTween = null; };
  window.__homeNodeIds = function () { return Object.keys(nodes); };
  window.__homeWorkNodeCount = function () {
    var n = 0;
    Object.keys(nodes).forEach(function (k) { if (nodes[k].type === "musical") n++; });
    return n;
  };
  window.__homeCoreCount = function () {
    var n = 0;
    Object.keys(nodes).forEach(function (k) { if (nodes[k].tier === "core") n++; });
    return n;
  };
  window.__homeTierCounts = function () {
    var c = { core: 0, star: 0, active: 0, normal: 0, work: 0 };
    Object.keys(nodes).forEach(function (k) {
      var t = nodes[k].tier || (nodes[k].type === "musical" ? "work" : "normal");
      c[t] = (c[t] || 0) + 1;
    });
    return c;
  };
  window.__homeNodeScreen = function (id) {
    var n = nodes[id]; if (!n) return null;
    var rect = canvas.getBoundingClientRect();
    return { x: rect.left + canvas.clientWidth / 2 + view.x + n.x * view.zoom,
             y: rect.top + canvas.clientHeight / 2 + view.y + n.y * view.zoom };
  };
  window.__homeHover = function () { return hoverId; };
  window.__homeFocusId = function () { return focusId; };
  window.__homeScene = function () { return scene; };
  window.__homeSceneHighlight = function () { return Object.keys(sceneHighlight); };
  window.__homeNodeType = function (id) { var n = nodes[id]; return n ? n.type : null; };
  window.__homeNodeAlpha = function (id) { var n = nodes[id]; return n ? n.alpha : null; };
  window.__homeNodeR = function (id) { var n = nodes[id]; return n ? n.r : null; };
  window.__homeEdges = function () {
    return edges.map(function (e) { return { a: e.a, b: e.b, type: e.type, count: e.count || 0, width: e.width || 0 }; });
  };
  window.__homeEdgeAlpha = function () {
    return edges.map(function (e) { return { a: e.a, b: e.b, alpha: e.alpha || 0 }; });
  };
  window.__homeLabelVisible = function (k) {
    if (!nodes[k]) return false;
    if (view.zoom >= 2.4) return true;
    if (k === hoverId) return true;
    if (hoverId && hoverNeighbors()[k]) return true;
    if (focusId && k === focusId) return true;
    if (focusId && nodes[k].type === "musical") return true;
    if (focusId && focusNeighbors()[k]) return true;
    return false;
  };
  window.__homeFocusNeighbors = function () { return focusId ? Object.keys(focusNeighbors()) : []; };
  window.__homeRelColorCache = function () { return relColorCache || {}; };
  window.__homeNodeColor = function (id) {
    var n = nodes[id]; if (!n) return null;
    return (relColorCache && relColorCache[id]) || n.color;
  };
  window.__homeFocusCardVisible = function () { return !focusCard.classList.contains("hidden"); };
  window.__homeHoverCardVisible = function () { return !hoverCard.classList.contains("hidden"); };
  window.__apNodes = function () { return apNodes; };
  window.__apCenterId = function () { return apCenterId; };
  window.__apNodeScreen = function (id) {
    var n = apNodes[id]; if (!n) return null;
    var rect = apCanvas.getBoundingClientRect();
    return { x: rect.left + apCanvas.clientWidth / 2 + n.x,
             y: rect.top + apCanvas.clientHeight / 2 + n.y };
  };

  // ============ Contribute 信息补充页 ============
  var MG_GITHUB_REPO = "";   // 填入 "user/repo"（如 "xxx/MusicGraph"）后，提交项可一键生成 GitHub Issue 直达链接
  var toastEl = document.getElementById("toast");
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.add("hidden"); }, 2600);
  }
  // ---- 匿名演员评分：仅走 Supabase RPC，不在静态快照保存原始评分 ----
  var ratingModal = document.getElementById("rating-modal");
  var ratingAuthModal = document.getElementById("rating-auth-modal");
  var ratingAuthEmailForm = document.getElementById("rating-auth-email-form");
  var ratingAuthTokenForm = document.getElementById("rating-auth-token-form");
  var ratingAuthEmail = document.getElementById("rating-auth-email");
  var ratingAuthToken = document.getElementById("rating-auth-token");
  var ratingAuthMessage = document.getElementById("rating-auth-message");
  var ratingAuthAgreementEmail = document.getElementById("rating-auth-agreement-email");
  var ratingAuthAgreementToken = document.getElementById("rating-auth-agreement-token");
  var ratingAuthCurrentEmail = "";
  var ratingDetailsModal = document.getElementById("rating-details-modal");
  var ratingRecordPickerModal = document.getElementById("rating-record-picker-modal");
  var ratingKnownSubject = document.getElementById("rating-known-subject");
  var ratingManualSubject = document.getElementById("rating-manual-subject");
  var ratingManualSubjectToggle = document.getElementById("rating-manual-subject-toggle");
  var ratingManualMusical = document.getElementById("rating-manual-musical");
  var ratingManualRole = document.getElementById("rating-manual-role");
  var ratingPerformanceStage = document.getElementById("rating-performance-stage");
  var ratingScoreStage = document.getElementById("rating-score-stage");
  var ratingMusical = document.getElementById("rating-musical");
  var ratingRole = document.getElementById("rating-role");
  var ratingDate = document.getElementById("rating-date");
  var ratingDateWrap = document.getElementById("rating-date-wrap");
  var ratingDateTrigger = document.getElementById("rating-date-trigger");
  var ratingCalendar = document.getElementById("rating-calendar");
  var ratingCalendarTitle = document.getElementById("rating-calendar-title");
  var ratingCalendarDays = document.getElementById("rating-calendar-days");
  var ratingCalendarYears = document.getElementById("rating-calendar-years");
  var ratingPerformanceResults = document.getElementById("rating-performance-results");
  var ratingPerformanceConfirm = document.getElementById("rating-performance-confirm");
  var ratingDimensions = document.getElementById("rating-dimensions");
  var ratingHint = document.getElementById("rating-hint");
  var ratingSubmit = document.getElementById("rating-submit");
  var ratingActorId = null;
  var ratingSubjectMode = "known";
  var ratingPerformance = null;
  function scrollRatingDialogTo(target, align) {
    if (!target || ratingModal.classList.contains("hidden")) return;
    var dialog = ratingModal.querySelector(".rating-dialog");
    if (!dialog) return;
    requestAnimationFrame(function () {
      var dialogRect = dialog.getBoundingClientRect();
      var targetRect = target.getBoundingClientRect();
      var top = dialog.scrollTop + targetRect.top - dialogRect.top - dialog.clientHeight * (align == null ? .28 : align);
      dialog.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  }
  var ratingPerformanceConfirmed = false;
  var pendingRatingActorId = null;
  var pendingRatingEdit = null;
  var ratingCurrentYear = new Date().getFullYear();
  var ratingCalendarView = { year: ratingCurrentYear, month: new Date().getMonth() };
  var RATING_MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  function clearRatingDate() {
    ratingDate.value = "";
    ratingDateTrigger.textContent = "选择日期";
    ratingDateTrigger.classList.remove("is-selected");
    closeRatingCalendar();
  }
  function setRatingDateEnabled(enabled) {
    ratingDateTrigger.disabled = !enabled;
    ratingPerformanceStage.classList.toggle("hidden", !enabled);
  }
  var mpGraphLink = document.getElementById("mp-graph-link");
  if (mpGraphLink) {
    mpGraphLink.addEventListener("click", function (e) {
      e.preventDefault();
      var mid = currentMusicalId();
      if (!mid) return;
      pendingGraphFocus = "mus:" + mid;
      if (location.hash !== "#/graph") { location.hash = "#/graph"; return; }
      showGraphView();
    });
  }
  function syncRatingDateControl(value) {
    var match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value || "");
    if (!match) return;
    ratingCalendarView.year = Number(match[1]); ratingCalendarView.month = Number(match[2]) - 1;
    ratingDateTrigger.textContent = Number(match[1]) + "年" + Number(match[2]) + "月" + Number(match[3]) + "日";
    ratingDateTrigger.classList.add("is-selected");
  }
  function closeRatingCalendar() {
    ratingCalendar.classList.add("hidden");
    ratingDateTrigger.setAttribute("aria-expanded", "false");
  }
  function renderRatingCalendar() {
    var year = ratingCalendarView.year, month = ratingCalendarView.month;
    ratingCalendarTitle.textContent = year + "年 " + RATING_MONTHS[month];
    document.getElementById("rating-calendar-prev").disabled = year === 1997 && month === 0;
    document.getElementById("rating-calendar-next").disabled = year === ratingCurrentYear && month === 11;
    var selected = ratingDate.value, today = new Date(), firstDay = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate();
    var html = "", i;
    for (i = 0; i < firstDay; i++) html += "<span class='is-empty'></span>";
    for (i = 1; i <= days; i++) {
      var value = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(i).padStart(2, "0");
      var classes = (value === selected ? " is-selected" : "") + (year === today.getFullYear() && month === today.getMonth() && i === today.getDate() ? " is-today" : "");
      html += "<button type='button' class='" + classes.trim() + "' data-date='" + value + "'>" + i + "</button>";
    }
    ratingCalendarDays.innerHTML = html;
    ratingCalendarDays.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        ratingDate.value = button.dataset.date;
        syncRatingDateControl(ratingDate.value);
        closeRatingCalendar();
        ratingDate.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }
  function renderRatingCalendarYears() {
    var html = "", year;
    for (year = ratingCurrentYear; year >= 1997; year--) html += "<button type='button' data-year='" + year + "' class='" + (year === ratingCalendarView.year ? "is-selected" : "") + "'>" + year + "</button>";
    ratingCalendarYears.innerHTML = html;
    ratingCalendarYears.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        ratingCalendarView.year = Number(button.dataset.year);
        ratingCalendarYears.classList.add("hidden"); ratingCalendarDays.classList.remove("hidden");
        renderRatingCalendar();
      });
    });
  }
  function ratingRpcHeaders(token) {
    var sb = window.MG_SUPABASE || {};
    var headers = { "Content-Type": "application/json", apikey: sb.anonKey };
    if (token) headers.Authorization = "Bearer " + token;
    else if (sb.anonKey) headers.Authorization = "Bearer " + sb.anonKey;
    return headers;
  }
  function ratingRpcWithToken(name, payload, token) {
    var sb = window.MG_SUPABASE || {};
    return fetch(sb.url + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: ratingRpcHeaders(token),
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(sb.timeoutMs || 8000)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("HTTP " + r.status)); });
      return r.json();
    });
  }
  function ratingRpc(name, payload) {
    if (window.MG_AUTH) {
      return window.MG_AUTH.getAccessToken().then(function (token) {
        return ratingRpcWithToken(name, payload, token);
      });
    }
    return ratingRpcWithToken(name, payload, null);
  }
  function ratingIdentityPayload() {
    return window.MG_AUTH && window.MG_AUTH.currentUser() ? {} : { p_anonymous_user_id: mgClientId() };
  }
  var anonymousRatingClaimUserId = "";
  var anonymousRatingClaimPromise = null;
  function claimAnonymousRatings() {
    var auth = window.MG_AUTH, user = auth && auth.currentUser && auth.currentUser();
    if (!user || !user.id || authDemoMode()) return Promise.resolve({ claimed_count: 0 });
    if (anonymousRatingClaimUserId === user.id && anonymousRatingClaimPromise) return anonymousRatingClaimPromise;
    anonymousRatingClaimUserId = user.id;
    anonymousRatingClaimPromise = ratingRpc("claim_anonymous_ratings", {
      p_anonymous_user_id: mgClientId()
    }).then(function (result) {
      var claimed = Number(result && result.claimed_count) || 0;
      if (claimed) {
        showToast("已将本浏览器的 " + claimed + " 条匿名评分保存到账号");
        refreshRatingViews();
        if (currentRoute() === "my-ratings") renderMyRatingsPage();
      }
      return result || { claimed_count: 0 };
    }).catch(function (error) {
      anonymousRatingClaimUserId = "";
      anonymousRatingClaimPromise = null;
      throw error;
    });
    return anonymousRatingClaimPromise;
  }
  function selectedRatingOption() {
    if (!ratingActorId) return null;
    if (ratingSubjectMode === "manual") {
      var musicalName = ratingManualMusical.value.trim(), roleName = ratingManualRole.value.trim();
      return musicalName && roleName ? { manual: true, musicalName: musicalName, roleName: roleName } : null;
    }
    if (!ratingMusical.value || !ratingRole.value) return null;
    var all = actorRoleOptions[ratingActorId] || [];
    return all.filter(function (o) { return o.musicalId === ratingMusical.value && o.roleId === ratingRole.value; })[0] || null;
  }
  function setRatingSubjectMode(mode) {
    ratingSubjectMode = mode;
    var isManual = mode === "manual";
    ratingKnownSubject.classList.toggle("hidden", isManual);
    ratingManualSubject.classList.toggle("hidden", !isManual);
    ratingManualSubjectToggle.classList.toggle("hidden", isManual);
    clearRatingDate();
    setRatingDateEnabled(isManual ? !!selectedRatingOption() : !!ratingRole.value);
    resetRatingPerformance();
    updateRatingSubmitState();
  }
  function resetRatingPerformance() {
    ratingPerformance = null;
    ratingPerformanceConfirmed = false;
    ratingPerformanceResults.innerHTML = "";
    ratingPerformanceResults.classList.add("hidden");
    ratingPerformanceConfirm.innerHTML = "";
    ratingPerformanceConfirm.classList.add("hidden");
    ratingDimensions.classList.add("hidden");
    ratingScoreStage.classList.add("hidden");
    resetRatingDimensions();
  }
  var RATING_SESSION_LABELS = { matinee: "午场", evening: "夕场", night: "晚场" };
  function ratingSessionPeriod(performance) {
    var explicit = String(performance.session_period || "");
    if (RATING_SESSION_LABELS[explicit]) return explicit;
    var raw = String(performance.time || "").toLowerCase();
    if (!raw) return "";
    if (/(晚|夜|night)/.test(raw)) return "night";
    if (/(夕|傍晚|黄昏)/.test(raw)) return "evening";
    var match = raw.match(/(\d{1,2})(?::\d{2})?/);
    if (!match) return "";
    var hour = Number(match[1]);
    if (/(下午|pm|p\.m\.)/.test(raw) && hour < 12) hour += 12;
    if (hour >= 12 && hour < 16) return "matinee";
    if (hour >= 18) return "night";
    return "evening";
  }
  function ratingPerformanceSessionLabel(performance) {
    return performance.sessionLabel || RATING_SESSION_LABELS[ratingSessionPeriod(performance)] || "演出时间待补充";
  }
  function ratingPerformanceLabel(performance) {
    return [ratingPerformanceSessionLabel(performance), performance.city, performance.theatre].filter(Boolean).join(" · ");
  }
  function demoRatingPerformances(option, date) {
    if (!date) return [];
    var demoData = window.MG_RATING_DEMO_PERFORMANCES || {};
    var performanceSets = demoData.performances || {};
    var realPerformances = performanceSets[[ratingActorId, option.musicalId, option.roleId].join("|")] ||
      performanceSets[[ratingActorId, option.musicalId, option.roleName].join("|")];
    if (realPerformances) return realPerformances.filter(function (performance) { return performance.date === date; });
    return [
      { id: "demo-" + option.musicalId + "-" + option.roleId + "-" + date + "-matinee", date: date, time: "14:30", city: "上海", theatre: "演艺大世界", role_confirmed: true, cast: [{ actor_id: ratingActorId, actor_name: actorName(ratingActorId), role_name: option.roleName }, { actor_id: "demo-2", actor_name: "李然", role_name: "角色待补充" }] },
      { id: "demo-" + option.musicalId + "-" + option.roleId + "-" + date + "-evening", date: date, time: "19:30", city: "上海", theatre: "演艺大世界", role_confirmed: false, cast: [{ actor_id: ratingActorId, actor_name: actorName(ratingActorId), role_name: "角色待补充" }, { actor_id: "demo-3", actor_name: "周晴", role_name: "角色待补充" }] }
    ];
  }
  function renderRatingPerformanceConfirmation() {
    if (!ratingPerformance) return;
    var cast = (ratingPerformance.cast || []).map(function (member) {
      return "<li>" + escHtml(member.actor_name) + " · " + escHtml(member.role_name || "角色待补充") + "</li>";
    }).join("");
    var notice = ratingPerformance.manualSubject ? "评分会立即计入演员整体评价；剧目与角色资料确认后才会显示在详细评分中。" : (ratingPerformance.role_confirmed ? "演员与角色已确认。" : "演员-角色场次信息将进入待核验；你的评分会正常生效。");
    ratingPerformanceConfirm.innerHTML = "<div class='rating-selected-performance'><span>已选演出</span><strong>" + escHtml([ratingPerformance.date, ratingPerformanceLabel(ratingPerformance)].filter(Boolean).join(" · ")) + "</strong><button type='button' class='rating-performance-change' id='rating-performance-change'>更换</button></div>" + (cast ? "<ul class='rating-performance-cast'>" + cast + "</ul>" : "") + "<p>" + notice + "</p>";
    ratingPerformanceConfirm.classList.remove("hidden");
    document.getElementById("rating-performance-change").addEventListener("click", loadRatingPerformances);
  }
  function ratingNoPerformanceMessage() {
    var year = Number((ratingDate.value || "").slice(0, 4));
    if (year && year < 2023) return "2023 年以前的历史排期覆盖有限，未查询到这一天的场次";
    return "暂未查询到 TA 在这一天的已录入场次";
  }
  function renderManualPerformanceChoice(message, option) {
    ratingPerformanceResults.innerHTML = "<div class='rating-manual-performance'><p>" + escHtml(message) + "</p><div><p class='rating-performance-title'>演出时间</p><div class='rating-session-picker'><button type='button' data-session='matinee'>午场</button><button type='button' data-session='evening'>夕场</button><button type='button' data-session='night'>晚场</button></div></div></div>";
    ratingPerformanceResults.classList.remove("hidden");
    ratingPerformanceResults.querySelectorAll("[data-session]").forEach(function (button) {
      button.addEventListener("click", function () {
        var session = button.dataset.session;
        ratingPerformance = {
          id: null, date: ratingDate.value, session_period: session, sessionLabel: RATING_SESSION_LABELS[session], city: "", theatre: "",
          role_confirmed: false, manualSubject: !!option.manual,
          cast: option.manual ? [] : [{ actor_id: ratingActorId, actor_name: actorName(ratingActorId), role_name: option.roleName }]
        };
        ratingPerformanceConfirmed = true;
        ratingPerformanceResults.classList.add("hidden");
        renderRatingPerformanceConfirmation();
        ratingScoreStage.classList.remove("hidden");
        ratingDimensions.classList.remove("hidden");
        scrollRatingDialogTo(ratingScoreStage, .2);
        var savedEdit = pendingRatingEdit;
        pendingRatingEdit = null;
        loadMyRating();
        prefillRatingEditScores(savedEdit);
      });
    });
    if (pendingRatingEdit && pendingRatingEdit.session_period) {
      var savedSession = ratingPerformanceResults.querySelector("[data-session='" + pendingRatingEdit.session_period + "']");
      if (savedSession) savedSession.click();
    }
  }
  function renderRatingPerformances(performances) {
    ratingPerformanceResults.innerHTML = "";
    if (!performances.length) {
      renderManualPerformanceChoice(ratingNoPerformanceMessage() + "。请选择演出时间后继续评分。", selectedRatingOption());
      updateRatingSubmitState();
      return;
    }
    ratingPerformanceResults.innerHTML = "<p class='rating-performance-title'>选择具体场次</p>";
    performances.forEach(function (performance) {
      var button = document.createElement("button");
      button.type = "button"; button.className = "rating-performance-choice";
      button.innerHTML = "<span>" + escHtml(ratingPerformanceSessionLabel(performance)) + "<br><small>" + escHtml([performance.city, performance.theatre].filter(Boolean).join(" · ") || "地点待补充") + "</small></span><small>" + (performance.role_confirmed ? "角色已确认" : "待补充角色") + "</small>";
      button.addEventListener("click", function () {
        ratingPerformance = Object.assign({}, performance, {
          session_period: ratingSessionPeriod(performance), sessionLabel: ratingPerformanceSessionLabel(performance)
        });
        ratingPerformanceConfirmed = false;
        ratingPerformanceResults.querySelectorAll("button").forEach(function (item) { item.classList.remove("is-selected"); });
        button.classList.add("is-selected");
        ratingPerformanceResults.classList.add("hidden");
        renderRatingPerformanceConfirmation();
        ratingPerformanceConfirmed = true;
        ratingScoreStage.classList.remove("hidden");
        ratingDimensions.classList.remove("hidden");
        scrollRatingDialogTo(ratingScoreStage, .2);
        var savedEdit = pendingRatingEdit;
        pendingRatingEdit = null;
        loadMyRating();
        prefillRatingEditScores(savedEdit);
      });
      ratingPerformanceResults.appendChild(button);
    });
    ratingPerformanceResults.classList.remove("hidden");
    if (pendingRatingEdit) {
      var saved = pendingRatingEdit;
      var match = Array.prototype.slice.call(ratingPerformanceResults.querySelectorAll("button")).filter(function (button) {
        var index = Array.prototype.indexOf.call(ratingPerformanceResults.querySelectorAll("button"), button);
        var performance = performances[index];
        return performance && (String(performance.id) === String(saved.performance_id) || ratingSessionPeriod(performance) === saved.session_period);
      })[0];
      if (match) match.click();
    }
  }
  function loadRatingPerformances() {
    var option = selectedRatingOption();
    resetRatingPerformance();
    if (!option || !ratingDate.value) { updateRatingSubmitState(); return; }
    if (option.manual) {
      renderManualPerformanceChoice("这条剧目与角色资料会进入待审核；评分将立即计入该演员的整体评价。", option);
      updateRatingSubmitState();
      return;
    }
    ratingHint.textContent = "正在查找该日场次...";
    var request = ratingPreviewMode() ? Promise.resolve(demoRatingPerformances(option, ratingDate.value)) : ratingRpc("get_rating_performances", {
      p_actor_id: Number(ratingActorId), p_musical_id: Number(option.musicalId), p_role_id: Number(option.roleId), p_date: ratingDate.value
    });
    request.then(function (performances) { renderRatingPerformances(Array.isArray(performances) ? performances : []); updateRatingSubmitState(); }).catch(function () {
      // 历史排期缺失或线上查询暂不可用时，仍允许用户用日期与演出时间完成评分。
      renderManualPerformanceChoice("暂未能读取当天排期。请选择演出时间后继续评分。", option);
      updateRatingSubmitState();
    });
  }
  function setDimensionScore(name, value) {
    var row = ratingDimensions.querySelector("[data-dimension='" + name + "']");
    if (!row) return;
    var picker = row.querySelector(".rating-star-picker"), label = row.querySelector(".rating-value"), clear = row.querySelector(".rating-clear");
    if (value == null) {
      row.classList.remove("is-scored"); row.dataset.score = ""; label.textContent = "未评分"; clear.textContent = "未评分";
      picker.style.setProperty("--rating-fill", "0%");
    } else {
      var n = Number(value); row.classList.add("is-scored"); row.dataset.score = String(n); label.textContent = (n * 2).toFixed(1); clear.textContent = "清空";
      picker.style.setProperty("--rating-fill", (n / 5 * 100) + "%");
    }
  }
  function previewDimensionScore(row, value) {
    var picker = row.querySelector(".rating-star-picker");
    picker.style.setProperty("--rating-fill", value == null ? (row.dataset.score ? Number(row.dataset.score) / 5 * 100 : 0) + "%" : (value / 5 * 100) + "%");
  }
  function initRatingStarPickers() {
    ratingDimensions.querySelectorAll(".rating-dimension").forEach(function (row) {
      var picker = row.querySelector(".rating-star-picker");
      var hits = "";
      var stars = "";
      for (var star = 0; star < 5; star++) stars += "<i aria-hidden='true'>★</i>";
      for (var i = 1; i <= 10; i++) hits += "<button type='button' class='rating-star-hit' data-score='" + (i / 2).toFixed(1) + "' aria-label='" + (i / 2).toFixed(1) + " 星'></button>";
      picker.innerHTML = "<span class='rating-star-base' aria-hidden='true'>" + stars + "</span><span class='rating-star-fill' aria-hidden='true'>" + stars + "</span><span class='rating-star-hits'>" + hits + "</span>";
      picker.querySelectorAll(".rating-star-hit").forEach(function (hit) {
        var score = Number(hit.dataset.score);
        hit.addEventListener("mouseenter", function () { previewDimensionScore(row, score); });
        hit.addEventListener("focus", function () { previewDimensionScore(row, score); });
        hit.addEventListener("click", function () { setDimensionScore(row.dataset.dimension, score); updateRatingSubmitState(); });
      });
      picker.addEventListener("mouseleave", function () { previewDimensionScore(row, null); });
    });
  }
  function currentRatingScores() {
    var out = {};
    ratingDimensions.querySelectorAll(".rating-dimension").forEach(function (row) {
      out[row.dataset.dimension] = row.dataset.score === "" || row.dataset.score === undefined ? null : Number(row.dataset.score);
    });
    return out;
  }
  function updateRatingSubmitState() {
    var ready = !!selectedRatingOption() && !!ratingPerformance && ratingPerformanceConfirmed;
    var scores = currentRatingScores();
    var count = [scores.singing, scores.dancing, scores.acting].filter(function (v) { return v != null; }).length;
    ratingSubmit.disabled = ratingPreviewMode() || !ready || count < 2;
    if (ratingPreviewMode()) ratingHint.textContent = "演示模式可查看编辑流程，但不会保存或提交。";
    else if (!selectedRatingOption()) ratingHint.textContent = ratingSubjectMode === "manual" ? "请填写剧目名称与角色名称。" : "请选择剧目与角色。";
    else if (!ratingDate.value) ratingHint.textContent = "请选择观看日期。";
    else if (!ratingPerformance) ratingHint.textContent = "请选择演出时间。";
    else if (!ratingPerformanceConfirmed) ratingHint.textContent = "请选择演出时间后开始评分。";
    else if (count < 2) ratingHint.textContent = "请至少完成两个维度的评分。";
    else ratingHint.textContent = "";
    ratingHint.classList.remove("is-error");
  }
  function resetRatingDimensions() {
    ["singing", "dancing", "acting"].forEach(function (name) { setDimensionScore(name, null); });
  }
  function loadMyRating() {
    var option = selectedRatingOption();
    if (!option || !ratingPerformance || !ratingPerformanceConfirmed) { ratingDimensions.classList.add("hidden"); resetRatingDimensions(); updateRatingSubmitState(); return; }
    ratingDimensions.classList.remove("hidden"); resetRatingDimensions(); updateRatingSubmitState();
    if (ratingPreviewMode()) return;
    if (option.manual) {
      ratingRpc("get_my_manual_rating", Object.assign(ratingIdentityPayload(), {
        p_actor_id: Number(ratingActorId),
        p_musical_name: option.musicalName, p_role_name: option.roleName,
        p_performance_date: ratingPerformance.date, p_session_period: ratingPerformance.session_period
      })).then(function (saved) {
        if (!saved || typeof saved !== "object") return;
        setDimensionScore("singing", saved.singing_score); setDimensionScore("dancing", saved.dancing_score); setDimensionScore("acting", saved.acting_score);
        updateRatingSubmitState();
      }).catch(function () {});
      return;
    }
    if (ratingPerformance.id == null) return;
    ratingRpc("get_my_rating", Object.assign(ratingIdentityPayload(), {
      p_performance_id: Number(ratingPerformance.id), p_actor_id: Number(ratingActorId), p_musical_id: Number(option.musicalId), p_role_id: Number(option.roleId)
    })).then(function (saved) {
      if (!saved || typeof saved !== "object") return;
      setDimensionScore("singing", saved.singing_score);
      setDimensionScore("dancing", saved.dancing_score);
      setDimensionScore("acting", saved.acting_score);
      updateRatingSubmitState();
    }).catch(function () {
      // 读取失败不阻断新评分；提交时服务端仍会完整校验。
    });
  }
  function openRatingModal(actorId, editRow) {
    if (!ratingCanOpen()) { showToast("评分功能需要连接线上数据"); return; }
    pendingRatingEdit = editRow || null;
    ratingActorId = s(actorId);
    document.getElementById("rating-actor-name").textContent = actorName(ratingActorId);
    ratingMusical.innerHTML = "<option value=''>请选择剧目</option>";
    var seen = {};
    (actorRoleOptions[ratingActorId] || []).forEach(function (option) {
      if (seen[option.musicalId]) return;
      seen[option.musicalId] = true;
      var el = document.createElement("option"); el.value = option.musicalId; el.textContent = option.musicalName; ratingMusical.appendChild(el);
    });
    ratingSubjectMode = "known";
    ratingKnownSubject.classList.remove("hidden"); ratingManualSubject.classList.add("hidden"); ratingManualSubjectToggle.classList.remove("hidden");
    ratingManualMusical.value = ""; ratingManualRole.value = "";
    ratingRole.innerHTML = "<option value=''>请先选择剧目</option>";
    ratingRole.disabled = true;
    clearRatingDate(); setRatingDateEnabled(false);
    refreshRatingSelect(ratingMusical); refreshRatingSelect(ratingRole);
    resetRatingPerformance(); updateRatingSubmitState();
    ratingModal.classList.remove("hidden");
    if (ratingPreviewMode()) ratingSubmit.textContent = "演示模式不可提交";
    else ratingSubmit.textContent = "提交评分";
    if (editRow) {
      if (editRow.manual_musical_name || editRow.manual_role_name) {
        setRatingSubjectMode("manual");
        ratingManualMusical.value = editRow.manual_musical_name || "";
        ratingManualRole.value = editRow.manual_role_name || "";
        ratingManualRole.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        ratingMusical.value = s(editRow.musical_id || "");
        ratingMusical.dispatchEvent(new Event("change", { bubbles: true }));
        ratingRole.value = s(editRow.role_id || "");
        ratingRole.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (editRow.performance_date) {
        ratingDate.value = editRow.performance_date;
        ratingDate.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
  function prefillRatingEditScores(row) {
    if (!row) return;
    setDimensionScore("singing", row.singing_score);
    setDimensionScore("dancing", row.dancing_score);
    setDimensionScore("acting", row.acting_score);
    updateRatingSubmitState();
  }
  function openRatingAuthModal(actorId) {
    if (!ratingCanOpen()) { showToast("评分功能需要连接线上数据"); return; }
    pendingRatingActorId = s(actorId);
    ratingAuthEmailForm.classList.remove("hidden");
    ratingAuthTokenForm.classList.add("hidden");
    ratingAuthMessage.textContent = "";
    ratingAuthMessage.className = "auth-message";
    ratingAuthToken.value = "";
    if (ratingAuthAgreementEmail) ratingAuthAgreementEmail.checked = false;
    if (ratingAuthAgreementToken) ratingAuthAgreementToken.checked = false;
    ratingAuthModal.classList.remove("hidden");
    setTimeout(function () { ratingAuthEmail.focus(); }, 0);
  }
  function closeRatingAuthModal() {
    ratingAuthModal.classList.add("hidden");
  }
  function setRatingAuthMessage(msg, tone) {
    ratingAuthMessage.textContent = msg || "";
    ratingAuthMessage.className = "auth-message" + (tone ? " " + tone : "");
  }
  function ratingAgreementChecked(checkbox) { return !!(checkbox && checkbox.checked); }
  function continueRatingAfterAuth() {
    if (!pendingRatingActorId) return;
    var actorId = pendingRatingActorId;
    claimAnonymousRatings().catch(function () {
      // 认领失败不阻断刚完成的登录和当前评分流程；下次登录会自动重试。
    }).then(function () {
      closeRatingAuthModal();
      openRatingModal(actorId);
    });
  }
  function startRatingFlow(actorId) {
    if (!ratingCanOpen()) { showToast("评分功能需要连接线上数据"); return; }
    if (window.MG_AUTH && window.MG_AUTH.currentUser()) {
      openRatingModal(actorId);
      return;
    }
    openRatingAuthModal(actorId);
  }
  function closeRatingModal() { ratingModal.classList.add("hidden"); ratingActorId = null; pendingRatingEdit = null; }
  function closeRatingDetailsModal() { ratingDetailsModal.classList.add("hidden"); }
  function closeRatingRecordPickerModal() { ratingRecordPickerModal.classList.add("hidden"); }
  ratingMusical.addEventListener("change", function () {
    ratingRole.innerHTML = "<option value=''>请选择角色</option>";
    var musicalRoles = (actorRoleOptions[ratingActorId] || []).filter(function (option) {
      return option.musicalId === ratingMusical.value;
    });
    musicalRoles.forEach(function (option) {
      var el = document.createElement("option"); el.value = option.roleId; el.textContent = option.roleName; ratingRole.appendChild(el);
    });
    ratingRole.disabled = !ratingMusical.value;
    refreshRatingSelect(ratingRole);
    clearRatingDate(); setRatingDateEnabled(false);
    resetRatingPerformance(); updateRatingSubmitState();
    if (musicalRoles.length === 1) {
      ratingRole.value = musicalRoles[0].roleId;
      refreshRatingSelect(ratingRole);
      ratingRole.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  ratingRole.addEventListener("change", function () {
    setRatingDateEnabled(!!ratingRole.value);
    resetRatingPerformance(); updateRatingSubmitState();
    if (ratingRole.value) scrollRatingDialogTo(ratingDateWrap, .3);
  });
  ratingManualSubjectToggle.addEventListener("click", function () { setRatingSubjectMode("manual"); });
  document.getElementById("rating-use-known-subject").addEventListener("click", function () { setRatingSubjectMode("known"); });
  [ratingManualMusical, ratingManualRole].forEach(function (input) {
    input.addEventListener("input", function () {
      var isReady = !!selectedRatingOption();
      clearRatingDate(); setRatingDateEnabled(isReady);
      resetRatingPerformance(); updateRatingSubmitState();
    });
  });
  ratingDateTrigger.addEventListener("click", function () {
    if (ratingDateTrigger.disabled) return;
    var isHidden = ratingCalendar.classList.contains("hidden");
    if (!isHidden) { closeRatingCalendar(); return; }
    if (ratingDate.value) syncRatingDateControl(ratingDate.value);
    ratingCalendarYears.classList.add("hidden"); ratingCalendarDays.classList.remove("hidden");
    renderRatingCalendar();
    ratingCalendar.classList.remove("hidden"); ratingDateTrigger.setAttribute("aria-expanded", "true");
    scrollRatingDialogTo(ratingDateWrap, .25);
  });
  document.getElementById("rating-calendar-prev").addEventListener("click", function () {
    if (ratingCalendarView.month === 0) { ratingCalendarView.year--; ratingCalendarView.month = 11; } else ratingCalendarView.month--;
    renderRatingCalendar();
  });
  document.getElementById("rating-calendar-next").addEventListener("click", function () {
    if (ratingCalendarView.month === 11) { ratingCalendarView.year++; ratingCalendarView.month = 0; } else ratingCalendarView.month++;
    renderRatingCalendar();
  });
  ratingCalendarTitle.addEventListener("click", function () {
    var showYears = ratingCalendarYears.classList.contains("hidden");
    ratingCalendarYears.classList.toggle("hidden", !showYears); ratingCalendarDays.classList.toggle("hidden", showYears);
    if (showYears) renderRatingCalendarYears();
  });
  ratingDate.addEventListener("change", function () {
    syncRatingDateControl(ratingDate.value);
    loadRatingPerformances();
  });
  document.addEventListener("click", function (event) {
    var control = ratingDateTrigger.parentNode;
    if (!ratingCalendar.classList.contains("hidden") && !control.contains(event.target)) closeRatingCalendar();
  });
  initRatingStarPickers();
  ratingDimensions.querySelectorAll(".rating-dimension").forEach(function (row) {
    var name = row.dataset.dimension;
    row.querySelector(".rating-clear").addEventListener("click", function () { setDimensionScore(name, null); updateRatingSubmitState(); });
  });
  ratingSubmit.addEventListener("click", function () {
    var option = selectedRatingOption(), scores = currentRatingScores();
    if (!option || !ratingPerformance || !ratingPerformanceConfirmed) return;
    ratingSubmit.disabled = true;
    ratingHint.textContent = "正在保存评分...";
    var request = option.manual ? ratingRpc("upsert_manual_actor_rating", Object.assign(ratingIdentityPayload(), {
      p_actor_id: Number(ratingActorId), p_musical_name: option.musicalName, p_role_name: option.roleName,
      p_performance_date: ratingPerformance.date, p_session_period: ratingPerformance.session_period,
      p_singing_score: scores.singing, p_dancing_score: scores.dancing, p_acting_score: scores.acting
    })) : ratingRpc("upsert_actor_rating", Object.assign(ratingIdentityPayload(), {
      p_performance_id: ratingPerformance.id == null ? null : Number(ratingPerformance.id), p_actor_id: Number(ratingActorId), p_musical_id: Number(option.musicalId), p_role_id: Number(option.roleId),
      p_performance_date: ratingPerformance.id == null ? ratingPerformance.date : null, p_session_period: ratingPerformance.id == null ? ratingPerformance.session_period : null,
      p_singing_score: scores.singing, p_dancing_score: scores.dancing, p_acting_score: scores.acting
    }));
    request.then(function (saved) {
      closeRatingModal();
      showToast(option.manual ? "评分已保存；会立即计入演员整体评价" : (saved && saved.cast_mapping_status === "pending" ? "评分已保存；场次角色信息已进入待核验" : "评分已保存；达到 10 人后将公开展示"));
      return ratingRpc("get_rating_summary", {}).then(function (summary) {
        D.ratings = summary || { actors: [], roles: [] };
        refreshRatingViews();
      }).catch(function () {
        // 写入已成功；聚合刷新失败时，下一次页面数据加载会补齐。
      });
    }).catch(function (err) {
      ratingHint.textContent = "提交失败，请稍后再试。"; ratingHint.classList.add("is-error");
      updateRatingSubmitState();
      if (window.__MG_DEBUG) window.__MG_DEBUG.ratingError = err && err.message ? err.message : String(err);
    });
  });
  document.getElementById("ap-rate").addEventListener("click", function () { if (apCenterId) startRatingFlow(apCenterId); });
  document.getElementById("rating-auth-close").addEventListener("click", closeRatingAuthModal);
  ratingAuthModal.addEventListener("click", function (e) { if (e.target === ratingAuthModal) closeRatingAuthModal(); });
  ratingAuthEmailForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!window.MG_AUTH || !window.MG_AUTH.sendOtp) {
      setRatingAuthMessage("登录服务还没有配置完成，可以先匿名提交。", "error");
      return;
    }
    ratingAuthCurrentEmail = ratingAuthEmail.value.trim();
    if (!ratingAuthCurrentEmail) return;
    if (!ratingAgreementChecked(ratingAuthAgreementEmail)) {
      setRatingAuthMessage("请先阅读并同意《用户协议》和《隐私政策》", "error");
      return;
    }
    var sendButton = e.currentTarget.querySelector("button[type='submit']");
    sendButton.disabled = true;
    sendButton.textContent = "正在发送...";
    setRatingAuthMessage("");
    window.MG_AUTH.sendOtp(ratingAuthCurrentEmail).then(function () {
      document.getElementById("rating-auth-email-sent").textContent = "验证码已发送至 " + ratingAuthCurrentEmail;
      ratingAuthEmailForm.classList.add("hidden");
      ratingAuthTokenForm.classList.remove("hidden");
      ratingAuthToken.value = "";
      setRatingAuthMessage("");
      setTimeout(function () { ratingAuthToken.focus(); }, 0);
    }).catch(function (err) {
      sendButton.disabled = false;
      sendButton.textContent = "发送验证码";
      setRatingAuthMessage(err.message || "发送失败", "error");
    });
  });
  ratingAuthTokenForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!window.MG_AUTH || !window.MG_AUTH.verifyOtp) return;
    var token = ratingAuthToken.value.trim();
    if (!ratingAuthCurrentEmail || !token) return;
    if (!ratingAgreementChecked(ratingAuthAgreementToken)) {
      setRatingAuthMessage("请先阅读并同意《用户协议》和《隐私政策》", "error");
      return;
    }
    setRatingAuthMessage("正在登录...");
    window.MG_AUTH.verifyOtp(ratingAuthCurrentEmail, token).then(continueRatingAfterAuth).catch(function (err) {
      setRatingAuthMessage(err.message || "验证码错误或已过期", "error");
    });
  });
  document.getElementById("rating-auth-resend").addEventListener("click", function (e) {
    if (!window.MG_AUTH || !window.MG_AUTH.sendOtp || !ratingAuthCurrentEmail) return;
    var remaining = 60;
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = remaining + " 秒后可重发";
    var timer = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        e.currentTarget.disabled = false;
        e.currentTarget.textContent = "重新发送验证码";
        return;
      }
      e.currentTarget.textContent = remaining + " 秒后可重发";
    }, 1000);
    setRatingAuthMessage("正在重新发送...");
    window.MG_AUTH.sendOtp(ratingAuthCurrentEmail).then(function () {
      setRatingAuthMessage("验证码已重新发送");
    }).catch(function (err) {
      setRatingAuthMessage(err.message || "发送失败", "error");
    });
  });
  document.getElementById("rating-auth-change-email").addEventListener("click", function () {
    ratingAuthTokenForm.classList.add("hidden");
    ratingAuthEmailForm.classList.remove("hidden");
    var sendButton = ratingAuthEmailForm.querySelector("button[type='submit']");
    if (sendButton) { sendButton.disabled = false; sendButton.textContent = "发送验证码"; }
    setRatingAuthMessage("");
    setTimeout(function () { ratingAuthEmail.focus(); }, 0);
  });
  if (ratingAuthAgreementEmail && ratingAuthAgreementToken) {
    ratingAuthAgreementEmail.addEventListener("change", function () { ratingAuthAgreementToken.checked = ratingAuthAgreementEmail.checked; });
    ratingAuthAgreementToken.addEventListener("change", function () { ratingAuthAgreementEmail.checked = ratingAuthAgreementToken.checked; });
  }
  document.getElementById("rating-auth-anonymous").addEventListener("click", function () {
    var actorId = pendingRatingActorId;
    closeRatingAuthModal();
    if (actorId) openRatingModal(actorId);
  });
  document.getElementById("legal-back").addEventListener("click", function () {
    location.hash = legalReturnHash || "#/home";
  });
  if (window.MG_AUTH) {
    window.MG_AUTH.onChange(function () {
      if (window.MG_AUTH.currentUser()) claimAnonymousRatings().catch(function () {});
      if (!pendingRatingActorId || !window.MG_AUTH.currentUser() || ratingAuthModal.classList.contains("hidden")) return;
      continueRatingAfterAuth();
    });
  }
  document.getElementById("rating-close").addEventListener("click", closeRatingModal);
  document.getElementById("actor-ratings-back").addEventListener("click", function () { location.hash = "#/actor/" + encodeURIComponent(String(currentActorId())); });
  ratingModal.addEventListener("click", function (e) { if (e.target === ratingModal) closeRatingModal(); });
  document.getElementById("rating-details-close").addEventListener("click", closeRatingDetailsModal);
  ratingDetailsModal.addEventListener("click", function (e) { if (e.target === ratingDetailsModal) closeRatingDetailsModal(); });
  document.getElementById("rating-record-picker-close").addEventListener("click", closeRatingRecordPickerModal);
  ratingRecordPickerModal.addEventListener("click", function (e) { if (e.target === ratingRecordPickerModal) closeRatingRecordPickerModal(); });
  var MODE_LABELS = { supplement: "补充信息", fix: "勘误", feedback: "意见反馈" };
  var CAT_LABELS = { actor: "演员", musical: "剧目", relation: "关系", moment: "精彩片段", feedback: "意见反馈" };
  var FIELD_LABELS = {
    name: "名称", nickname: "昵称/别名", birth: "生日", school: "毕业院校", grade: "入学年份/年级",
    major: "专业", hometown: "籍贯", height: "身高(cm)", note: "备注", groupName: "所属团体",
    field: "要修正的字段", wrong: "当前内容", correct: "正确内容",
    date: "演出日期", city: "城市", theatre: "剧院", cast: "参演演员与角色",
    castActor: "演员姓名", castRole: "角色名", wrongCastRole: "当前角色", correctCastRole: "正确角色",
    actorA: "人物 A", actorB: "人物 B", relType: "关系类型", detail: "关系详情/备注",
    actorName: "演员姓名", title: "标题", url: "链接", platform: "平台", desc: "描述", message: "反馈内容", contact: "联系方式"
  };

  function activeGroupId() {
    return "c-" + document.getElementById("c-mode").value + "-" + document.getElementById("c-category").value;
  }
  function syncContributeGroups() {
    var category = document.getElementById("c-category").value;
    var modeLabel = document.getElementById("c-mode").closest("label");
    if (modeLabel) modeLabel.classList.toggle("hidden", category === "moment");
    var refWrap = document.getElementById("c-ref-wrap");
    if (refWrap) refWrap.classList.toggle("hidden", category === "moment");
    var active = category === "moment" ? "c-moment" : activeGroupId();
    document.querySelectorAll(".c-group").forEach(function (g) {
      g.classList.toggle("hidden", g.id !== active);
    });
    var batch = document.getElementById("c-batch-musical");
    if (batch) batch.classList.toggle("hidden", !(category === "musical" && document.getElementById("c-mode").value === "supplement"));
  }
  document.getElementById("c-mode").addEventListener("change", syncContributeGroups);
  document.getElementById("c-category").addEventListener("change", syncContributeGroups);
  // 作品表单：卡司行「＋ 添加一位演员」
  function addCastRow(targetId) {
    var box = document.getElementById(targetId);
    if (!box) return;
    var row = document.createElement("div");
    row.className = "cast-row";
    row.innerHTML = '<label>演员姓名<input type="text" name="castActor" placeholder="必填" autocomplete="off"></label>' +
                    '<label>角色名<input type="text" name="castRole" placeholder="可选" autocomplete="off"></label>';
    box.appendChild(row);
  }
  document.querySelectorAll(".cast-add").forEach(function (btn) {
    btn.addEventListener("click", function () { addCastRow(btn.getAttribute("data-target")); });
  });
  // 表单原生下拉统一为自定义下拉（黑底、悬停红字），保持全站 UI 一致
  function enhanceSelect(sel) {
    if (!sel || sel.dataset.enhanced) return;
    sel.dataset.enhanced = "1";
    var wrap = document.createElement("div");
    wrap.className = "c-select" + (sel.closest(".rating-modal") ? " rating-select" : "");
    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "c-select-trigger";
    trigger.innerHTML = '<span class="c-select-value"></span><span class="c-select-arrow">▾</span>';
    var menu = document.createElement("ul");
    menu.className = "c-select-menu";
    function sync() {
      var v = sel.value;
      var opt = sel.querySelector('option[value="' + v + '"]');
      trigger.querySelector(".c-select-value").textContent = opt ? opt.textContent : "";
      trigger.disabled = !!sel.disabled;
      wrap.classList.toggle("is-disabled", !!sel.disabled);
      menu.querySelectorAll("li").forEach(function (li) {
        li.setAttribute("aria-selected", String(li.getAttribute("data-value")) === String(v));
      });
    }
    function open() {
      if (sel.closest(".rating-modal")) scrollRatingDialogTo(wrap, .24);
      wrap.classList.add("open");
      document.addEventListener("mousedown", closeOutside, true);
    }
    function close() {
      wrap.classList.remove("open");
      document.removeEventListener("mousedown", closeOutside, true);
    }
    function closeOutside(e) {
      if (e && wrap.contains(e.target)) return;   // 组件内部点击不关闭
      close();
    }
    // 每次选项变化后重建下拉项（用于“关系类型”这类动态选项）
    function buildMenu() {
      menu.innerHTML = "";
      Array.prototype.forEach.call(sel.options, function (o) {
        var li = document.createElement("li");
        li.textContent = o.textContent;
        li.setAttribute("data-value", o.value);
        li.setAttribute("role", "option");
        li.addEventListener("click", function () {
          sel.value = o.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          sync();
          close();
          if (sel.closest(".rating-modal")) scrollRatingDialogTo(wrap, .24);
        });
        menu.appendChild(li);
      });
      sync();
    }
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      if (sel.disabled) return;
      if (wrap.classList.contains("open")) close(); else open();
    });
    sel.parentNode.insertBefore(wrap, sel.nextSibling);
    sel.classList.add("hidden");
    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    sel._rebuildMenu = buildMenu;
    buildMenu();
  }
  function refreshRatingSelect(sel) {
    if (sel && sel._rebuildMenu) sel._rebuildMenu();
  }
  document.querySelectorAll("#contribute-form select").forEach(function (sel) {
    if (sel.id === "c-mode" || sel.id === "c-category" || sel.dataset.raw) return;
    enhanceSelect(sel);
  });
  document.querySelectorAll("#rating-modal select").forEach(function (sel) { enhanceSelect(sel); });
  var REL_GROUPS = {
    co_work: [{ code: "co_work", label: "合作演出" }],
    love: [{ code: "married", label: "伴侣" }, { code: "couple", label: "情侣" }, { code: "ex", label: "前任" }],
    group: [{ code: "classmate", label: "同学" }, { code: "roommate", label: "室友" }],
    fan: [{ code: "cp", label: "CP" }]
  };
  function fillRelTypes(catKey) {
    var sel = document.querySelector('#c-supplement-relation select[name="relType"]');
    if (!sel) return;
    var list = REL_GROUPS[catKey] || REL_GROUPS.co_work;
    sel.innerHTML = "";
    list.forEach(function (it) {
      var o = document.createElement("option");
      o.value = it.code; o.textContent = it.label;
      sel.appendChild(o);
    });
    if (sel._rebuildMenu) sel._rebuildMenu();
  }
  var relCat = document.querySelector('#c-supplement-relation select[name="relCat"]');
  if (relCat) {
    fillRelTypes(relCat.value);
    relCat.addEventListener("change", function () { fillRelTypes(relCat.value); });
  }
  function syncFixRelationCp() {
    var sel = document.querySelector('#c-fix-relation select[name="curType"]');
    if (!sel) return;
    var isCp = sel.value === "cp";
    var generic = document.querySelector('#c-fix-relation .fix-correct-generic');
    var cpBox = document.querySelector('#c-fix-relation .fix-correct-cp');
    if (generic) generic.classList.toggle("hidden", isCp);
    if (cpBox) cpBox.classList.toggle("hidden", !isCp);
  }
  var fixCurType = document.querySelector('#c-fix-relation select[name="curType"]');
  if (fixCurType) {
    syncFixRelationCp();
    fixCurType.addEventListener("change", syncFixRelationCp);
  }

  // ---- 联系与反馈：卡片式流程（一级入口 → 内容类型 → 表单 / 意见反馈）----
  var MODE_TITLE = { supplement: "补充信息", fix: "内容勘误" };
  var CAT_TITLE = { actor: "演员", musical: "作品", relation: "人物关系", moment: "精彩片段" };
  var fbRoot = document.getElementById("fb-step-root");
  var fbType = document.getElementById("fb-step-type");
  var fbForm = document.getElementById("fb-step-form");
  var fbFeedback = document.getElementById("fb-step-feedback");
  var fbMode = document.getElementById("c-mode");
  var fbCat = document.getElementById("c-category");
  var fbPageHead = document.querySelector("#view-contribute .page-head");
  var fbView = document.getElementById("view-contribute");
  function fbShow(step) {
    [fbRoot, fbType, fbForm, fbFeedback].forEach(function (s) { if (s) s.classList.toggle("hidden", s !== step); });
    if (fbPageHead) fbPageHead.classList.toggle("hidden", step !== fbRoot);   // 大标题+副标题只在一级页显示
    if (fbView) fbView.classList.toggle("fb-deep", step !== fbRoot);          // 二级/三级贴顶（收起顶部留白）
  }
  // 类型卡描述按模式区分：补充页只说补充、勘误页只说修正，互不混用
  var FB_DESC = {
    actor:    { supplement: "补充演员相关信息。", fix: "修正演员相关信息。" },
    musical:  { supplement: "补充音乐剧作品相关信息。", fix: "修正音乐剧作品相关信息。" },
    relation: { supplement: "补充演员之间的关系。", fix: "修正演员之间的关系。" },
    moment:   { supplement: "补充 Stage Moments。", fix: "修正 Stage Moments。" }
  };
  function fbGoType(mode) {
    fbMode.value = mode;
    var t = MODE_TITLE[mode] || mode;
    document.getElementById("fb-crumb-type").textContent = "联系与反馈 / " + t;
    document.getElementById("fb-ask-type").textContent = mode === "fix" ? "你想修改哪一类内容？" : "你想补充什么？";
    document.querySelectorAll("#fb-type-cards .fb-card").forEach(function (card) {
      var d = FB_DESC[card.getAttribute("data-category")];
      var desc = card.querySelector(".fb-card-desc");
      if (d && desc) desc.textContent = d[mode] || d.supplement;
    });
    fbShow(fbType);
  }
  function fbGoForm(category) {
    fbCat.value = category;
    fbCat.dispatchEvent(new Event("change", { bubbles: true }));   // 触发 syncContributeGroups 显示对应表单
    document.getElementById("fb-crumb-form").textContent =
      "联系与反馈 / " + (MODE_TITLE[fbMode.value] || fbMode.value) + " / " + (CAT_TITLE[category] || category);
    fbShow(fbForm);
  }
  // ---- 表单草稿：刷新后静默恢复已填内容 ----
  var DRAFT_KEY = "mg_contribute_draft_v1";
  function draftHasContent(d) {
    if (!d || !d.values) return false;
    for (var k in d.values) { if (d.values[k]) return true; }
    return !!(d.ref || d.email || d.schedBulk || (d.feedback && (d.feedback.message || d.feedback.contact)) || (d.castRows && d.castRows.length));
  }
  function activeFormGroup() {
    var cat = fbCat.value;
    return document.getElementById(cat === "moment" ? "c-moment" : activeGroupId());
  }
  function collectDraft() {
    var d = { mode: fbMode.value, category: fbCat.value, step: "form", values: {}, castRows: [], ref: "", email: "", schedBulk: "", feedback: {} };
    if (fbFeedback && !fbFeedback.classList.contains("hidden")) d.step = "feedback";
    var group = activeFormGroup();
    if (group) {
      group.querySelectorAll("input, textarea, select").forEach(function (el) {
        if (!el.name || el.name === "castActor" || el.name === "castRole") return;
        d.values[el.name] = el.value;
      });
    }
    document.querySelectorAll("#c-supplement-musical .cast-row").forEach(function (row) {
      var a = row.querySelector("[name=castActor]");
      var r = row.querySelector("[name=castRole]");
      d.castRows.push({ actor: a ? a.value : "", role: r ? r.value : "" });
    });
    var ref = document.getElementById("c-ref");
    var email = document.getElementById("c-email");
    var bulk = document.getElementById("sched-bulk");
    d.ref = ref ? ref.value : "";
    d.email = email ? email.value : "";
    d.schedBulk = bulk ? bulk.value : "";
    if (fbFeedbackForm) {
      var m = fbFeedbackForm.querySelector("[name=message]");
      var cc = fbFeedbackForm.querySelector("[name=contact]");
      d.feedback.message = m ? m.value : "";
      d.feedback.contact = cc ? cc.value : "";
    }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function restoreDraft() {
    var raw;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return; }
    if (!raw) return;
    var d;
    try { d = JSON.parse(raw) || {}; } catch (e) { return; }
    if (!draftHasContent(d)) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} return; }
    fbMode.value = d.mode === "fix" ? "fix" : "supplement";
    fbCat.value = d.category;
    fbCat.dispatchEvent(new Event("change", { bubbles: true }));
    if (d.category === "relation" && d.values && d.values.relCat) fillRelTypes(d.values.relCat);
    if (d.category === "relation" && d.values && d.values.curType) syncFixRelationCp();
    var group = activeFormGroup();
    if (group && d.values) {
      Object.keys(d.values).forEach(function (k) {
        var el = group.querySelector('[name="' + k + '"]');
        if (el) el.value = d.values[k];
      });
      group.querySelectorAll("select").forEach(function (sel) { if (sel._rebuildMenu) sel._rebuildMenu(); });
    }
    if (Array.isArray(d.castRows) && d.castRows.length) {
      var box = document.getElementById("cast-rows-supplement");
      if (box) {
        box.innerHTML = "";
        d.castRows.forEach(function (r) {
          var row = document.createElement("div");
          row.className = "cast-row";
          row.innerHTML = '<label>演员姓名<input type="text" name="castActor" placeholder="必填" autocomplete="off"></label>' +
                          '<label>角色名<input type="text" name="castRole" placeholder="可选" autocomplete="off"></label>';
          box.appendChild(row);
          row.querySelector("[name=castActor]").value = r.actor || "";
          row.querySelector("[name=castRole]").value = r.role || "";
        });
      }
    }
    var ref = document.getElementById("c-ref");
    var email = document.getElementById("c-email");
    var bulk = document.getElementById("sched-bulk");
    if (ref && d.ref !== undefined) ref.value = d.ref;
    if (email && d.email !== undefined) email.value = d.email;
    if (bulk && d.schedBulk !== undefined) bulk.value = d.schedBulk;
    if (fbFeedbackForm && d.feedback) {
      var m = fbFeedbackForm.querySelector("[name=message]");
      var cc = fbFeedbackForm.querySelector("[name=contact]");
      if (m && d.feedback.message !== undefined) m.value = d.feedback.message;
      if (cc && d.feedback.contact !== undefined) cc.value = d.feedback.contact;
    }
    var crumb = document.getElementById("fb-crumb-form");
    if (crumb && d.step !== "feedback") crumb.textContent = "联系与反馈 / " + (MODE_TITLE[fbMode.value] || fbMode.value) + " / " + (CAT_TITLE[d.category] || d.category);
    fbShow(d.step === "feedback" ? fbFeedback : fbForm);
  }
  if (fbRoot) {
    document.getElementById("fb-add").addEventListener("click", function () { fbGoType("supplement"); });
    document.getElementById("fb-fix").addEventListener("click", function () { fbGoType("fix"); });
    document.getElementById("fb-feedback").addEventListener("click", function () {
      prefillFeedbackContact();
      fbShow(fbFeedback);
    });
    document.getElementById("fb-back-type").addEventListener("click", function () { fbShow(fbRoot); });
    document.getElementById("fb-back-form").addEventListener("click", function () { fbShow(fbType); });
    document.getElementById("fb-back-feedback").addEventListener("click", function () { fbShow(fbRoot); });
    document.querySelectorAll("#fb-type-cards .fb-card").forEach(function (card) {
      card.addEventListener("click", function () { fbGoForm(card.getAttribute("data-category")); });
    });
  }

  function collectContribution() {
    var mode = document.getElementById("c-mode").value;
    var category = document.getElementById("c-category").value;
    var group = document.getElementById(category === "moment" ? "c-moment" : activeGroupId());
    var fields = {};
    group.querySelectorAll("input, textarea, select").forEach(function (el) {
      if (el.name && el.name !== "castActor" && el.name !== "castRole") fields[el.name] = el.value.trim();
    });
    if (category === "musical") {
      // 卡司行：逐行收集为「演员：角色」列表（保持与旧 textarea 相同的提交格式）
      var castLines = [];
      group.querySelectorAll(".cast-row").forEach(function (row) {
        var a = row.querySelector("[name=castActor]");
        var r = row.querySelector("[name=castRole]");
        var av = a ? a.value.trim() : "";
        var rv = r ? r.value.trim() : "";
        if (av) castLines.push(rv ? av + "：" + rv : av);
      });
      if (castLines.length) fields.cast = castLines.join("\n");
      if (mode === "fix") {
        var ca = group.querySelector("[name=castActor]");
        if (ca && ca.value.trim()) fields.castActor = ca.value.trim();
      }
    }
    var item = {
      id: Date.now(),
      mode: mode,
      category: category,
      fields: fields,
      ref: category === "moment" ? "" : document.getElementById("c-ref").value.trim(),
      email: document.getElementById("c-email").value.trim(),
      ts: new Date().toISOString()
    };
    if (category === "moment") {
      if (!fields.actorName || !fields.title || !fields.url) { showToast("请填写演员姓名、标题与链接"); return null; }
    } else if (!(fields.name || fields.actorA)) { showToast("请填写名称"); return null; }
    if (category === "relation" && (!fields.actorA || !fields.actorB)) { showToast("请填写关系双方姓名"); return null; }
    if (mode === "fix") {
      var castFixOk = category === "musical" && fields.castActor && fields.correctCastRole;
      var relFixOk;
      if (category === "relation") relFixOk = fields.curType === "cp" ? !!fields.correctCpName : !!fields.correct;
      else relFixOk = castFixOk || !!fields.correct;
      if (!relFixOk) { showToast("请填写正确的 CP 名或关系说明"); return null; }
    }
    return item;
  }
  // ???????? submissions ?????????????????
  function buildSubmissionPayload(item) {
    var f = item.fields || {};
    var p = { source_url: item.ref, status: "pending" };
    if (item.category === "actor") {
      p.submission_type = "actor_update";
      p.actor_a = f.name;
      var d = {};
      if (f.nickname) d.nickname = f.nickname;
      if (f.birth) d.birth_date = f.birth;
      if (f.school) d.school = f.school;
      if (f.grade) d.enrollment_year = f.grade;
      if (f.major) d.major = f.major;
      if (f.hometown) d.hometown = f.hometown;
      if (f.height) d.height = f.height;
      if (f.note) d.note = f.note;
      if (item.mode === "fix") {
        var map = { name: "name", nickname: "nickname", birth: "birth_date", school: "school",
                    grade: "enrollment_year", major: "major", hometown: "hometown",
                    height: "height", note: "note" };
        var ff = map[f.field];
        if (ff) d.fix = { field: ff, wrong: f.wrong, correct: f.correct };
      }
      if (Object.keys(d).length) p.details = JSON.stringify(d);
    } else if (item.category === "musical") {
      p.submission_type = "musical_update";
      p.musical_name = f.name;
      var d = {};
      if (f.date) d.premiere_date = f.date;
      if (f.note) d.info = f.note;
      if (f.cast) {
        d.cast = String(f.cast).split(/[\n\r]+/).map(function (line) {
          var parts = line.split(/[?:：？]/);
          return { actor: (parts[0] || "").trim(), role: (parts[1] || "").trim() };
        }).filter(function (x) { return x.actor; });
      }
      if (f.city) d.city = f.city;
      if (f.theatre) d.theatre = f.theatre;
      if (item.mode === "fix") {
        if (f.castActor && f.correctCastRole) {
          d.fix = { field: "cast", actor: f.castActor, wrong: f.wrongCastRole || "", correct: f.correctCastRole };
        } else {
          var fixMap = { name: "name", date: "year", city: "city", theatre: "theatre" };
          var ff = fixMap[f.field];
          if (f.correct && ff) d.fix = { field: ff, wrong: f.wrong || "", correct: f.correct };
        }
      }
      if (Object.keys(d).length) p.details = JSON.stringify(d);
    } else if (item.category === "relation") {
      p.submission_type = "relation_update";
      p.actor_a = f.actorA;
      p.actor_b = f.actorB;
      p.relation_type = f.curType || f.relType || "co_work";
      var desc = f.detail || "";
      if (item.mode === "fix") {
        var newVal = p.relation_type === "cp" ? f.correctCpName : f.correct;
        if (f.wrong) desc = (desc ? desc + "；" : "") + "原内容：" + f.wrong;
        if (newVal) desc = (desc ? desc + "；" : "") + "改为：" + newVal;
        if (newVal) p.details = JSON.stringify({ fix: { field: "detail", correct: newVal } });
      }
      if (desc) p.description = desc;
    } else if (item.category === "moment") {
      p.submission_type = "moment_submission";
      p.actor_a = f.actorName;
      p.title = f.title;
      p.url = f.url;
      p.platform = f.platform || "bilibili";
          if (f.desc) p.description = f.desc;
    } else if (item.category === "feedback") {
      p.submission_type = "feedback";
      p.description = f.message || "";
      p.actor_a = f.contact || "";
      p.source_url = f.contact || "feedback";
    } else if (item.category === "schedule") {
      p.submission_type = "schedule_submission";
      p.details = ((item.fields && item.fields.rows) || []).map(function (row) {
        return {
          date: row.date || "",
          time: row.time || "",
          city: row.city || "",
          theatre: row.theatre || "",
          musical: row.musical || "",
          cast: (row.cast || []).map(function (c) {
            return { actor: c.a || c.actor || "", role: c.r || c.role || "" };
          })
        };
      });
    }
    if (p.details !== undefined && typeof p.details !== "string") {
      try { p.details = JSON.stringify(p.details); } catch (e) { delete p.details; }
    }
    return p;
  }
    function mgClientId() {
    try {
      var v = localStorage.getItem("mg_client_id");
      if (!v) {
        v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        localStorage.setItem("mg_client_id", v);
      }
      return v;
    } catch (e) { return "c" + Date.now() + Math.random().toString(36).slice(2, 10); }
  }
  function submitToBackend(item) {
    var sb = window.MG_SUPABASE;
    var payload = buildSubmissionPayload(item);
    if (sb && sb.url && sb.anonKey) {
      if (payload.details && typeof payload.details === "string") {
        try { payload.details = JSON.parse(payload.details); } catch (e) { delete payload.details; }
      }
      delete payload.status;
      payload.client_id = mgClientId();
      return fetch(sb.url + "/rest/v1/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: sb.anonKey, Authorization: "Bearer " + sb.anonKey, Prefer: "return=minimal" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(sb.timeoutMs || 8000)
      }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r; });
    }
    var url = window.MG_PB_CONFIG && window.MG_PB_CONFIG.url;
    if (!url) return Promise.reject(new Error("no backend"));
    return fetch(url + "/api/collections/submissions/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000)
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  var DEMO_SUBMISSIONS_KEY = "mg_demo_submissions";
  function saveDemoSubmission(item) {
    try {
      var list = [];
      var raw = localStorage.getItem(DEMO_SUBMISSIONS_KEY);
      if (raw) list = JSON.parse(raw) || [];
      list.push(item);
      localStorage.setItem(DEMO_SUBMISSIONS_KEY, JSON.stringify(list));
    } catch (e) { /* 演示模式尽力保存，失败不阻塞提示 */ }
  }
  function persistSubmission(item, form, okMsg) {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    submitToBackend(item).then(function () {
      form.reset();
      showToast(okMsg || "提交成功，已进入待审核，感谢你的补充");
    }).catch(function (err) {
      console.error("后端不可用，已按演示模式保存", err);
      saveDemoSubmission(item);
      form.reset();
      showToast(okMsg ? okMsg + "（演示版已保存）" : "提交成功，感谢你的补充（演示版已保存）");
    });
  }
  document.getElementById("contribute-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var item = collectContribution();
    if (!item) return;
    persistSubmission(item, e.target);
  });
  var fbFeedbackForm = document.getElementById("fb-feedback-form");
  function prefillFeedbackContact() {
    if (!fbFeedbackForm || !window.MG_AUTH || !window.MG_AUTH.currentUser) return;
    var contact = fbFeedbackForm.querySelector("[name=contact]");
    var user = window.MG_AUTH.currentUser();
    if (contact && !contact.value.trim() && user && user.email) contact.value = user.email;
  }
  if (fbFeedbackForm) {
    fbFeedbackForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = fbFeedbackForm.querySelector("[name=message]").value.trim();
      var contact = fbFeedbackForm.querySelector("[name=contact]").value.trim();
      if (!msg || !contact) return;
      var item = { id: Date.now(), mode: "feedback", category: "feedback", fields: { message: msg, contact: contact }, ref: "", email: contact, ts: new Date().toISOString() };
      persistSubmission(item, fbFeedbackForm, "反馈已提交，感谢你的建议");
    });
  }

  var draftTimer = null;
  function queueDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(collectDraft, 400);
  }
  document.getElementById("contribute-form").addEventListener("input", queueDraftSave);
  document.getElementById("contribute-form").addEventListener("change", queueDraftSave);
  if (fbFeedbackForm) {
    fbFeedbackForm.addEventListener("input", queueDraftSave);
    fbFeedbackForm.addEventListener("change", queueDraftSave);
  }
  restoreDraft();
  prefillFeedbackContact();
  if (window.MG_AUTH && window.MG_AUTH.onChange) window.MG_AUTH.onChange(prefillFeedbackContact);
  // ---- 演出排期批量补充（作品表单内） ----
  var SCHED_COLS = [
    { name: "date", keys: ["日期", "date"] },
    { name: "time", keys: ["时间", "time"] },
    { name: "city", keys: ["城市", "city"] },
    { name: "theatre", keys: ["剧场", "剧院", "theatre", "theater"] },
    { name: "musical", keys: ["剧目", "剧名", "musical"] },
    { name: "cast", keys: ["演员与角色", "卡司", "演员", "cast"] }
  ];
  function schedDelim(line) {
    if (line.indexOf("\t") >= 0) return "\t";
    if (line.indexOf("|") >= 0) return "|";
    if (line.indexOf(",") >= 0) return ",";
    return null;
  }
  function csvSplit(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; } }
        else { cur += ch; }
      } else if (ch === '"') { q = true; }
      else if (ch === ",") { out.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur.trim());
    return out;
  }
  function schedCells(line, d) {
    if (d === ",") return csvSplit(line);
    if (d) return line.split(d).map(function (s) { return s.trim(); });
    return line.trim().split(/\s+/);
  }
  function schedMap(head) {
    var m = {};
    head.forEach(function (c, i) {
      var col = null;
      var ck = String(c).trim().toLowerCase();
      SCHED_COLS.forEach(function (def) {
        if (col) return;
        for (var k = 0; k < def.keys.length && !col; k++) {
          if (ck.indexOf(String(def.keys[k]).toLowerCase()) >= 0) { col = def.name; }
        }
      });
      if (col && m[col] == null) m[col] = i;
    });
    return m;
  }
  function schedDate(s) {
    var m = String(s || "").trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    return m ? m[1] + "/" + (+m[2]) + "/" + (+m[3]) : "";
  }
  function schedCast(s) {
    var out = [];
    String(s == null ? "" : s).split(/[；;]/).forEach(function (seg) {
      seg = seg.trim(); if (!seg) return;
      var p = seg.split(/[：:]/);
      if (p[0].trim()) out.push({ a: p[0].trim(), r: (p[1] || "").trim() });
    });
    return out;
  }
  function parseScheduleText(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var rows = [];
    if (!lines.length) return rows;
    var first = lines[0];
    var delim = schedDelim(first);
    var map = schedMap(schedCells(first, delim));
    var dataStart = 0;
    if (map.date == null && map.cast == null) {
      map = { date: 0, time: 1, city: 2, theatre: 3, musical: 4, cast: 5 };
    } else {
      dataStart = 1;
    }
    for (var i = dataStart; i < lines.length; i++) {
      var cells = schedCells(lines[i], delim);
      var get = function (k) { return (map[k] != null && cells[map[k]] != null) ? cells[map[k]] : ""; };
      var cast = schedCast(get("cast"));
      var errs = [];
      if (!schedDate(get("date"))) errs.push("缺日期");
      if (!get("musical")) errs.push("缺剧目");
      if (!cast.length) errs.push("缺演员");
      rows.push({
        n: i + 1, ok: errs.length === 0, msg: errs.join("；"),
        date: schedDate(get("date")), time: get("time"), city: get("city"),
        theatre: get("theatre"), musical: get("musical"), cast: cast, castCnt: cast.length
      });
    }
    return rows;
  }
  var schedParsed = [];
  function renderSchedPreview() {
    var box = document.getElementById("sched-preview");
    if (!box) return;
    if (!schedParsed.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    var ok = schedParsed.filter(function (r) { return r.ok; }).length;
    var html = "<div class='sched-foot'>通过 <b>" + ok + "</b> / " + schedParsed.length + " 条</div>";
    schedParsed.forEach(function (r, i) {
      html += "<div class='sched-row " + (r.ok ? "ok" : "err") + "'>" +
        "<span class='sched-num'>" + (i + 1) + "</span>" +
        "<span class='sched-info'>" + escHtml((r.date || "?") + " · " + (r.musical || "?") + " · " + r.castCnt + " 位演员") + "</span>" +
        "<span class='sched-status'>" + (r.ok ? "可提交" : escHtml(r.msg)) + "</span></div>";
    });
    if (ok) html += "<div class='sched-foot'><button type='button' class='c-submit' id='sched-submit'>提交 " + ok + " 条</button><button type='button' class='c-btn' id='sched-clear'>清空</button></div>";
    box.innerHTML = html;
    box.classList.remove("hidden");
    var sBtn = document.getElementById("sched-submit");
    if (sBtn) sBtn.addEventListener("click", submitScheduleBatch);
    var cBtn = document.getElementById("sched-clear");
    if (cBtn) cBtn.addEventListener("click", function () { schedParsed = []; renderSchedPreview(); });
  }
  function submitScheduleBatch() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    var rows = schedParsed.filter(function (r) { return r.ok; }).map(function (r) {
      return {
        date: r.date, time: r.time, city: r.city, theatre: r.theatre, musical: r.musical,
        cast: r.cast.map(function (c) { return { a: c.a, r: c.r }; })
      };
    });
    if (!rows.length) return;
    var item = {
      id: Date.now() + Math.random(), mode: "supplement", category: "schedule", count: rows.length,
      fields: { rows: rows },
      ref: document.getElementById("c-ref").value.trim() || "",
      email: document.getElementById("c-email").value.trim() || "",
      ts: new Date().toISOString()
    };
    submitToBackend(item).then(function () {
      showToast("批量排期提交成功，共 " + item.count + " 条");
    }).catch(function () {
      saveDemoSubmission(item);
      showToast("批量排期提交成功（演示版已保存），共 " + item.count + " 条");
    });
    schedParsed = [];
    renderSchedPreview();
  }

  var schedTpl = document.getElementById("sched-template");
  if (schedTpl) schedTpl.addEventListener("click", function () {
    var csv = "日期,时间,城市,剧场,剧目,演员与角色\n" +
      "2026-05-01,19:30,上海,文化广场,我，堂吉诃德,刘阳：堂吉诃德；党韫葳：阿尔东莎\n" +
      "2026-05-02,14:00,上海,文化广场,我，堂吉诃德,刘阳：堂吉诃德；党韫葳：阿尔东莎\n";
    var blob = new Blob(["\uFEFF" + csv], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "演出排期补充模板.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  var schedFile = document.getElementById("sched-file");
  if (schedFile) schedFile.addEventListener("change", function () {
    var f = schedFile.files && schedFile.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var ta = document.getElementById("sched-bulk");
      if (ta) ta.value = rd.result;
      schedParsed = parseScheduleText(rd.result);
      renderSchedPreview();
    };
    rd.readAsText(f, "utf-8");
  });
  var schedParse = document.getElementById("sched-parse");
  if (schedParse) schedParse.addEventListener("click", function () {
    var ta = document.getElementById("sched-bulk");
    schedParsed = parseScheduleText(ta ? ta.value : "");
    renderSchedPreview();
  });
  // ---- 首页右上角数据标签（跟随导出数据自动更新） ----
  var heroStats = document.querySelector(".hero-stats");
  if (heroStats && D.musicalStats) {
    var showsN = 0;
    Object.keys(D.musicalStats).forEach(function (k) { showsN += D.musicalStats[k].shows; });
    heroStats.textContent = Object.keys(actors).length + " 演员 · " + showsN + " 场演出";
  }

  // 排序说明仅在点击其自身时保留；点击页面其他位置即收起。
  document.addEventListener("click", function (event) {
    document.querySelectorAll(".mp-sort-info[open]").forEach(function (info) {
      if (!info.contains(event.target)) info.removeAttribute("open");
    });
  });

  // ---- 启动 ----
  buildGraph();
  resizeHome();
  layoutAndCenter();
  playEntrance();
  requestAnimationFrame(draw);
  updateStats();
  // 初始路由：Home / Graph / Contribute / #/actor/ID 均可直达
  document.querySelectorAll('a[href^="#/"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      if (a.classList.contains("ap-graph-link") || a.id === "mp-graph-link") return;   // 该链接已有自己的“返回图谱并定位”逻辑
      e.preventDefault();
      var href = a.getAttribute("href");
      navTo(href, !/^#\/(actor|musical)\//.test(href));
    });
  });
  applyRoute();
  window.MG_UPGRADE = function (newD) {
    if (!newD || !newD.actors) return;
    window.MUSIC_GRAPH = newD;
    D = newD;
    actors = newD.actors; relations = newD.relations || []; coWork = newD.coWork || [];
    actorMusicals = newD.actorMusicals || {}; musicals = newD.musicals || {}; groups = newD.groups || [];
    actorRoleOptions = newD.actorRoleOptions || {}; D.ratings = newD.ratings || { actors: [], roles: [] };
    moments = newD.moments || [];
    relations.forEach(function (r) { r.a = s(r.a); r.b = s(r.b); });
    coWork.forEach(function (e) { e.a = s(e.a); e.b = s(e.b); });
    Object.keys(musicals).forEach(function (mid) {
      var m = musicals[mid];
      if (m.cast) m.cast = m.cast.map(s);
      if (m.roles) { var nr = {}; Object.keys(m.roles).forEach(function (aid) { nr[s(aid)] = m.roles[aid]; }); m.roles = nr; }
    });
    groups.forEach(function (g) { if (g.members) g.members = g.members.map(s); if (g.id !== undefined) g.id = s(g.id); });
    momentsByActor = {};
    moments.forEach(function (m) { var aid = s(m.actorId); (momentsByActor[aid] = momentsByActor[aid] || []).push(m); });
    var nm2 = {};
    Object.keys(actorMusicals).forEach(function (aid) { nm2[s(aid)] = actorMusicals[aid]; });
    actorMusicals = nm2;
    Object.keys(actors).forEach(function (k) { if (actors[k].id !== undefined) actors[k].id = s(actors[k].id); });
    Object.keys(musicals).forEach(function (k) { if (musicals[k].id !== undefined) musicals[k].id = s(musicals[k].id); });
    var roleOptionsNormalized = {};
    Object.keys(actorRoleOptions).forEach(function (aid) {
      roleOptionsNormalized[s(aid)] = (actorRoleOptions[aid] || []).map(function (option) {
        option.musicalId = s(option.musicalId); option.roleId = s(option.roleId); return option;
      });
    });
    actorRoleOptions = roleOptionsNormalized;
    applyRatingDemoData();
    rebuildRatingIndexes();
    coWorkByActor = {};
    coWork.forEach(function (e) { if (e.a === e.b) return; (coWorkByActor[e.a] = coWorkByActor[e.a] || []).push(e); (coWorkByActor[e.b] = coWorkByActor[e.b] || []).push(e); });
    nameCount = {};
    Object.keys(actors).forEach(function (k) { nameCount[actors[k].name] = (nameCount[actors[k].name] || 0) + 1; });
    // 数据升级完成后保留用户当前所在页，不能把首页、反馈或协议页强制带回图谱。
    applyRoute();
    updateStats();
  };
})();
