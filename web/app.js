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
    teacher_student: "#8678a3", same_company: "#64748b", co_work: "#c9a227",
    married: "#8c2f45", ex: "#8f8790"
  };
  // 点亮颜色优先级（数字越小越优先）：伴侣 > 情侣 > 前任 > CP > 同学 > 好友 > 师生 > 同公司
  var REL_TYPE_PRIORITY = {
    married: 1, couple: 2, ex: 3, cp: 4, classmate: 5,
    friend: 6, teacher_student: 7, same_company: 8
  };
  var TYPE_LABEL = {
    couple: "情侣", cp: "CP", classmate: "同学", friend: "好友",
    teacher_student: "师生", same_company: "同公司", co_work: "共演",
    married: "伴侣", ex: "前任"
  };

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
  var nam2 = {};
  Object.keys(actorMusicals).forEach(function (aid) { nam2[s(aid)] = actorMusicals[aid]; });
  actorMusicals = nam2;
  Object.keys(actors).forEach(function (k) { if (actors[k].id !== undefined) actors[k].id = s(actors[k].id); });
  Object.keys(musicals).forEach(function (k) { if (musicals[k].id !== undefined) musicals[k].id = s(musicals[k].id); });

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
  // 画布文字：深色描边 + 暖白填充，照片背景上保持可读
  function fillLabel(c, text, x, y) {
    c.save();
    c.strokeStyle = "rgba(10,10,10,.92)";
    c.lineWidth = 3;
    c.lineJoin = "round";
    c.strokeText(text, x, y);
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
    var m = location.hash.match(/^#\/actor\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  // 路由：home / graph / contribute / actor
  function currentRoute() {
    var h = location.hash || "";
    if (/^#\/actor\//.test(h)) return "actor";
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
    if (currentActorId() === str) { showActorView(str); return; }
    location.hash = "#/actor/" + encodeURIComponent(str);
  }
  function goHome() {   // 返回关系图谱
    if (location.hash !== "#/graph") location.hash = "#/graph";
    showGraphView();
  }
  function goGroup(gid) { goHome(); showGroupPanel(gid); }
  function goMusical(mid) { goHome(); showMusicalPanel(mid); }
  window.addEventListener("hashchange", applyRoute);

  var viewHome = document.getElementById("view-home");
  var viewGraph = document.getElementById("view-graph");
  var viewContribute = document.getElementById("view-contribute");
  var homeView = document.getElementById("home-view");
  var actorView = document.getElementById("actor-view");

  function showHomeView() {
    viewHome.classList.remove("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.add("hidden");
    homeView.classList.add("hidden");
    actorView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("home");
  }
  var pendingGraphFocus = null;   // 详情页「在图谱中查看」→ 返回图谱并聚焦该演员
  function goGraphFocus(id) {
    pendingGraphFocus = id;
    if (location.hash !== "#/graph") location.hash = "#/graph";
    showGraphView();
  }
  function showGraphView() {
    viewHome.classList.add("hidden");
    viewGraph.classList.remove("hidden");
    viewContribute.classList.add("hidden");
    homeView.classList.remove("hidden");
    actorView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("graph");
    resizeHome();
    requestAnimationFrame(draw);
    if (pendingGraphFocus) {
      var f = pendingGraphFocus;
      pendingGraphFocus = null;
      focusActor(f);
    }
  }
  function showContributeView() {
    viewHome.classList.add("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.remove("hidden");
    homeView.classList.add("hidden");
    actorView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    setNavActive("contribute");
    renderReviewList();
  }
  function showActorView(id) {
    viewHome.classList.add("hidden");
    viewGraph.classList.add("hidden");
    viewContribute.classList.add("hidden");
    homeView.classList.add("hidden");
    actorView.classList.remove("hidden");
    document.body.classList.add("actor-mode");
    setNavActive("graph");
    hidePanel();
    renderActorPage(id);
  }
  function applyRoute() {
    document.body.classList.remove("tools-open");   // 切页时收起移动端工具抽屉
    var route = currentRoute();
    if (route === "actor") showActorView(currentActorId());
    else if (route === "graph") showGraphView();
    else if (route === "contribute") showContributeView();
    else showHomeView();
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

  var focusId = null;                   // 当前聚焦演员 id（null=全局视图）
  var hoverId = null;                   // 当前悬停节点 key
  var depthCenterId = null;             // 景深中心节点 key
  var maxDepth = 0;                     // 距景深中心的最大距离（每帧重算）
  var viewTween = null;                 // 视图动画：聚焦时把目标演员送到画面中心

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
          width: 0.5 + t * 2, alphaBase: 0.2 + t * 0.5, alpha: 0, count: e.count
        });
      });
    }
    relations.forEach(function (r) {
      if (!visibleTypes[r.type]) return;
      if (!nodes[r.a] || !nodes[r.b]) return;
      edges.push({
        a: r.a, b: r.b, type: r.type, color: TYPE_COLOR[r.type] || "#999", dashed: false,
        width: 1.4, alphaBase: 0.55, alpha: 0, count: 0,
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
          if (nodes[mk]) edges.push({ a: k, b: mk, type: "musical", color: MUS_COLOR, dashed: false, width: 0.8, alphaBase: 0.5, alpha: 0, count: 0 });
        });
      });
    }
  }

  // 影响力由光效表达：核心亮点与光晕半径随 importance 递增（不再用大尺寸区分）
  function applyNodeRadii() {
    var ws = [];
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (n.type === "musical") {
        n.coreBase = 3; n.glowBase = 20; n.importance = 0.6; n.hitR = 16;
        n.core = 3; n.glow = 20;
        return;
      }
      n.w = computeStats(n.id).weight;
      ws.push(n.w);
    });
    if (!ws.length) return;
    var minW = Math.min.apply(null, ws), maxW = Math.max.apply(null, ws);
    var span = (maxW - minW) || 1;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      if (n.type === "musical") return;
      var imp = (n.w - minW) / span;
      n.importance = imp;
      n.coreBase = 2 + imp * 3;          // 核心亮点 2–5px
      n.glowBase = 12 + imp * 26;        // 光晕半径 12–38px（重要人物光更大更亮）
      n.hitR = 15 + imp * 7;             // 命中区域 15–22px，保证小光点易点
      n.core = n.coreBase;
      n.glow = n.glowBase;
    });
  }

  // 构建图谱：base 为参与可见类型关系的演员；focusId 存在时以其为中心展开
  function buildGraph(focusId) {
    nodes = {}; edges = [];
    var active = {};
    relations.forEach(function (r) {
      if (visibleTypes[r.type]) { active[r.a] = true; active[r.b] = true; }
    });
    Object.keys(active).forEach(function (id) { ensureActorNode(id); });
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

  // 同步快速收敛得到稳定的"网络形状"，做归一化 + 重叠消除；最高关联人物落在中心（景深中心）
  function layoutAndCenter() {
    for (var i = 0; i < 320; i++) physicsStep();
    Object.keys(nodes).forEach(function (k) { var n = nodes[k]; n.vx = 0; n.vy = 0; });
    var deg = {};
    edges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
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
    if (focusId === id) return;
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

  // 返回全局图谱（信息卡按钮 / Esc / 图例切换）
  function resetHome() {
    focusId = null;
    hideFocusCard();
    buildGraph();
    layoutAndCenter();
    playEntrance();
    updateStats();
  }

  // 点击节点：演员->聚焦展开；剧目->打开作品面板
  function onNodeClick(key) {
    var n = nodes[key];
    if (!n) return;
    if (n.type === "musical") { goMusical(n.id); return; }
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
      } else {
        ta = (0.25 + 0.45 * imp) * (1 - 0.8 * d01);       // 默认暗色光点，越靠外越暗
        tg = n.glowBase * (1 - 0.25 * d01);
        tc = n.coreBase;
      }
      n.alpha += (ta - n.alpha) * LERP;
      if (n.alpha < 0.01) n.alpha = 0;
      n.glow += (tg - n.glow) * LERP;
      n.core += (tc - n.core) * LERP;
    });

    // 边目标透明度：默认全部隐藏；hover 只显示焦点关联线；聚焦模式显示中心网络
    edges.forEach(function (ed) {
      var a = nodes[ed.a], b = nodes[ed.b];
      if (!a || !b) { ed.alpha = 0; return; }
      var ea = 0;
      if (hovering) {
        if (ed.a === hoverId || ed.b === hoverId) ea = Math.min(1, ed.alphaBase * 1.8);
      } else if (focusId) {
        var touchCenter = (ed.a === focusId || ed.b === focusId);
        var nearCenter = depth01(ed.a) < 0.5 && depth01(ed.b) < 0.5;
        if (touchCenter || nearCenter) ea = ed.alphaBase * Math.min(a.alpha, b.alpha) * (touchCenter ? 1 : 0.6);
      }
      ed.alpha += (ea - ed.alpha) * LERP;
      if (ed.alpha < 0.01) ed.alpha = 0;
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
      ctx.setLineDash(ed.dashed ? [6, 5] : []);
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
      var showLabel = view.zoom >= 2.4 || (k === hoverId) || (hovering && nb[k]) || (focusId && k === focusId) || (focusId && n.type === "musical") || (focusId && nbFocus && nbFocus[k]);
      if (showLabel && view.zoom > 0.5) {
        var fs = n.type === "musical" ? 11 : (k === focusId ? 14 : 12);
        ctx.font = fs + "px sans-serif";
        ctx.textAlign = "center";
        var label = n.type === "musical" && n.label.length > 10 ? n.label.slice(0, 10) + "…" : n.label;
        fillLabel(ctx, label, x, y + n.core + 16);
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
  function hitTest(px, py) {
    var p = screenToWorld(px, py);
    var hit = null, best = 1e9;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      var d = (n.x - p.x) * (n.x - p.x) + (n.y - p.y) * (n.y - p.y);
      var hitR = n.hitR || 18;
      if (d < hitR * hitR && d < best) { best = d; hit = k; }
    });
    return hit;
  }

  // 点击与拖动区分：按住人物拖动=调整位置；原地单击=聚焦展开；双击=进入详情页
  var dragging = null, panning = false, lastX = 0, lastY = 0, dragMoved = false;
  canvas.addEventListener("mousedown", function (e) {
    cancelViewTween();
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var hit = hitTest(px, py);
    lastX = e.clientX; lastY = e.clientY;
    dragMoved = false;
    hideHoverCard();
    if (hit) { dragging = hit; nodes[hit].fixed = true; }
    else { panning = true; }
  });
  window.addEventListener("mousemove", function (e) {
    if (dragging) {
      if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 4) dragMoved = true;
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
      var rect = canvas.getBoundingClientRect();
      var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) onNodeClick(hit);
    }
  });
  canvas.addEventListener("mouseleave", function () { hideHoverCard(); });
  canvas.addEventListener("dblclick", function (e) {
    var rect = canvas.getBoundingClientRect();
    var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
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
      var hint = document.createElement("div");
      hint.className = "hc-hint";
      hint.textContent = "单击聚焦展开 · 双击进详情";
      hoverCard.appendChild(hint);
    } else {
      var mhint = document.createElement("div");
      mhint.className = "hc-hint";
      mhint.textContent = "单击查看演员表";
      hoverCard.appendChild(mhint);
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
    if (gtEmpty) gtEmpty.classList.remove("hidden");
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
    focusCard.classList.remove("hidden");
    if (gtEmpty) gtEmpty.classList.add("hidden");
  }
  document.getElementById("fc-detail").addEventListener("click", function () { if (focusId) goActor(focusId); });
  document.getElementById("fc-global").addEventListener("click", resetHome);
  document.getElementById("fc-close").addEventListener("click", resetHome);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!panel.classList.contains("hidden")) { hidePanel(); return; }
      if (!homeView.classList.contains("hidden") && focusId) resetHome();
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
      var hit = hitTest(px, py);
      touchMoved = false;
      touches = hit
        ? { mode: "drag", id: t.identifier, nodeId: hit, startX: px, startY: py }
        : { mode: "pan", id: t.identifier, startX: px, startY: py };
    } else if (e.touches.length === 2) {
      var a = e.touches[0], b = e.touches[1];
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
      var scale = dist / (touches.startDist || 1);
      view.zoom = Math.max(0.2, Math.min(4, touches.startZoom * scale));
      var cx = (a.clientX + b.clientX) / 2 - rect.left, cy = (a.clientY + b.clientY) / 2 - rect.top;
      view.x += (touches.cx - cx) * (view.zoom / (touches.startZoom || 1));
      view.y += (touches.cy - cy) * (view.zoom / (touches.startZoom || 1));
      return;
    }
    if (touches.mode === "drag" && nodes[touches.nodeId]) {
      var p = screenToWorld(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
      nodes[touches.nodeId].x = p.x; nodes[touches.nodeId].y = p.y;
      touchMoved = true;
    } else if (touches.mode === "pan") {
      view.x += e.touches[0].clientX - touches.startX; view.y += e.touches[0].clientY - touches.startY;
      touches.startX = e.touches[0].clientX; touches.startY = e.touches[0].clientY;
      touchMoved = true;
    }
  }, { passive: false });
  canvas.addEventListener("touchend", function (e) {
    e.preventDefault();
    if (!touches) return;
    var tapNode = null;
    if (touches.mode === "drag" && nodes[touches.nodeId]) {
      nodes[touches.nodeId].fixed = false;
      tapNode = touches.nodeId;
    }
    touches = null;
    if (e.changedTouches && e.changedTouches.length === 1 && !touchMoved) {
      if (tapNode) { onNodeClick(tapNode); }
      else {
        var rect = canvas.getBoundingClientRect();
        var t = e.changedTouches[0];
        var hit = hitTest(t.clientX - rect.left, t.clientY - rect.top);
        if (hit) onNodeClick(hit);
      }
    }
    touchMoved = false;
  }, { passive: false });
  canvas.addEventListener("touchcancel", function () { touches = null; touchMoved = false; }, { passive: true });


  // ---- 图例点击筛选关系类型 ----
  document.querySelectorAll(".lg[data-type]").forEach(function (el) {
    el.addEventListener("click", function () {
      var ty = el.getAttribute("data-type");
      visibleTypes[ty] = !visibleTypes[ty];
      el.classList.toggle("off", !visibleTypes[ty]);
      resetHome();
    });
  });
  function setAllLegendTypes(on) {
    document.querySelectorAll(".lg[data-type]").forEach(function (el) {
      var ty = el.getAttribute("data-type");
      visibleTypes[ty] = on;
      el.classList.toggle("off", !on);
    });
    resetHome();
  }
  document.getElementById("legend-all").addEventListener("click", function () { setAllLegendTypes(true); });
  document.getElementById("legend-none").addEventListener("click", function () { setAllLegendTypes(false); });
  function updateStats() {
    document.getElementById("stats").textContent =
      "节点 " + Object.keys(nodes).length + " · 关系边 " + edges.length + " · 共演边 " + coWork.length;
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
    document.getElementById("p-nickname").textContent = "团体" + (g.type ? "（" + g.type + "）" : "");
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

  // ============ 演员独立详情页 ============
  var apCanvas = document.getElementById("ap-graph"), apCtx = apCanvas.getContext("2d");
  var apNodes = {}, apEdges = [], apCenterId = null;
  var apAnimating = false, apAnimStart = 0, apRadius = 230;

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
        apEdges.push({ a: id, b: oid, color: TYPE_COLOR[r_.type] || "#999", dashed: false, width: 1.6, label: TYPE_LABEL[r_.type] || r_.typeName });
      });
      if (info.cw > 0) apEdges.push({ a: id, b: oid, color: TYPE_COLOR["co_work"], dashed: true, width: 0.8, label: "" });
      if (info.group) apEdges.push({ a: id, b: oid, color: "#64748b", dashed: true, width: 0.8, label: "" });
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
      apCtx.strokeStyle = ed.color; apCtx.globalAlpha = ed.dashed ? 0.35 : 0.55;
      apCtx.lineWidth = ed.width;
      apCtx.setLineDash(ed.dashed ? [6, 5] : []);
      apCtx.beginPath(); apCtx.moveTo(ax, ay); apCtx.lineTo(bx, by); apCtx.stroke();
      apCtx.setLineDash([]);
      if (ed.label && t > 0.7) {
        apCtx.font = "11px sans-serif"; apCtx.textAlign = "center";
        fillLabel(apCtx, ed.label, (ax + bx) / 2, (ay + by) / 2 - 4);
      }
    });
    apCtx.globalAlpha = 1;
    Object.keys(apNodes).forEach(function (k) {
      var n = apNodes[k];
      var x = cx + n.x * e, y = cy + n.y * e;
      drawLightPoint(apCtx, x, y, n, n.color);          // 与首页一致的柔和光点（无边框）
      apCtx.font = "12px sans-serif"; apCtx.textAlign = "center";
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
  function queryCowork() {
    var name = document.getElementById("cw-q").value.trim();
    var box = document.getElementById("cw-result");
    if (!name || !apCenterId) return;
    box.classList.add("hidden");
    loadCoworkData(function () {
      var target = null;
      Object.keys(actors).forEach(function (k) { if (target === null && actors[k].name === name) target = k; });
      if (!target) {
        box.innerHTML = "<div class='cw-none'>未找到演员「" + escHtml(name) + "」，可前往 Contribute 补充资料</div>";
        box.classList.remove("hidden");
        return;
      }
      var pair = null;
      (window.MUSIC_GRAPH_COWORK || []).forEach(function (e) {
        if (pair) return;
        if ((e.a === apCenterId && e.b === target) || (e.a === target && e.b === apCenterId)) pair = e;
      });
      if (!pair) {
        box.innerHTML = "<div class='cw-none'>未发现「" + escHtml(actorName(apCenterId)) + "」与「" + escHtml(actorName(target)) + "」的合作记录（或资料暂缺）</div>";
        box.classList.remove("hidden");
        return;
      }
      // 共同剧目：由作品演员表计算（含角色）
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
      box.innerHTML = h;
      box.classList.remove("hidden");
    });
  }
  var cwQ = document.getElementById("cw-q");
  if (cwQ) {
    document.getElementById("cw-go").addEventListener("click", queryCowork);
    cwQ.addEventListener("keydown", function (e) { if (e.key === "Enter") queryCowork(); });
    var cwList = document.getElementById("cw-list");
    Object.keys(actors).forEach(function (k) {
      var o = document.createElement("option");
      o.value = actors[k].name;
      cwList.appendChild(o);
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
        sub.textContent = "共同作品：" + common.slice(0, 3).join("、") + (common.length > 3 ? " 等" + common.length + "部" : "");
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    if (!ul.children.length) {
      var li = document.createElement("li"); li.textContent = "暂无手动关系记录";
      ul.appendChild(li);
    }
  }
  function renderCowork(id) {
    var ul = document.getElementById("ap-cowork"); ul.innerHTML = "";
    var list = (coWorkByActor[id] || []).filter(function (e) { return e.a !== e.b; })
      .slice().sort(function (x, y) { return y.count - x.count; }).slice(0, 30);
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
        span.title = "查看作品演员表";
        span.addEventListener("click", function () {
          var mid = Object.keys(musicals).filter(function (k) { return musicals[k].name === m; })[0];
          if (mid) goMusical(mid);
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
        sub.textContent = g.type;
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    if (!ul.children.length) {
      var li = document.createElement("li"); li.textContent = "暂无团体记录";
      ul.appendChild(li);
    }
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
    var ident = document.getElementById("ap-identity");
    if (ident) ident.textContent = "演员 · 参与 " + st.musicals + " 部音乐剧 · 关联 " + st.partners + " 位人物";
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
    renderRelations(id);
    renderGroups(id);
    renderMusicals(id);
    renderCowork(id);
    apResize();
    buildActorGraph(id);
    var cwQ2 = document.getElementById("cw-q");
    if (cwQ2) cwQ2.value = "";
    var cwRes = document.getElementById("cw-result");
    if (cwRes) { cwRes.classList.add("hidden"); cwRes.innerHTML = ""; }
  }
  document.getElementById("ap-back").addEventListener("click", goHome);
  var apGraphLink = document.getElementById("ap-graph-link");
  if (apGraphLink) {
    apGraphLink.addEventListener("click", function (e) {
      e.preventDefault();
      goGraphFocus(apCenterId);
    });
  }

  // ---- 搜索 ----
  var search = document.getElementById("search"), dropdown = document.getElementById("dropdown");
  function matches(actor, q) {
    q = q.toLowerCase();
    if ((actor.name || "").toLowerCase().indexOf(q) >= 0) return true;
    if ((actor.nickname || "").toLowerCase().indexOf(q) >= 0) return true;
    if ((actor.school || "").toLowerCase().indexOf(q) >= 0) return true;
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
        if (hit.type === "actor") goActor(hit.data.id);
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
  var apSearchEl = document.getElementById("ap-search");
  if (apSearchEl) bindSearch(apSearchEl, document.getElementById("ap-dropdown"));
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-box") && !e.target.closest(".ap-search-wrap")) {
      document.getElementById("dropdown").classList.add("hidden");
      var apDrop = document.getElementById("ap-dropdown");
      if (apDrop) apDrop.classList.add("hidden");
    }
  });

  // ---- 供自动化验证读取的调试接口（对日常使用无影响）----
  window.__entranceT = function () { return entranceT; };
  window.__homeZoom = function () { return view.zoom; };
  window.__homeView = function () { return { x: view.x, y: view.y, zoom: view.zoom }; };
  window.__homeResetView = function () { view.zoom = 0.92; view.x = 0; view.y = 0; viewTween = null; };
  window.__homeNodeIds = function () { return Object.keys(nodes); };
  window.__homeNodeScreen = function (id) {
    var n = nodes[id]; if (!n) return null;
    var rect = canvas.getBoundingClientRect();
    return { x: rect.left + canvas.clientWidth / 2 + view.x + n.x * view.zoom,
             y: rect.top + canvas.clientHeight / 2 + view.y + n.y * view.zoom };
  };
  window.__homeHover = function () { return hoverId; };
  window.__homeFocusId = function () { return focusId; };
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
  var MODE_LABELS = { supplement: "补充信息", fix: "勘误" };
  var CAT_LABELS = { actor: "演员", musical: "剧目", relation: "关系" };
  var FIELD_LABELS = {
    name: "名称", nickname: "昵称/别名", birth: "生日", school: "毕业院校", grade: "入学年份/年级",
    major: "专业", hometown: "籍贯", height: "身高(cm)", note: "备注", groupName: "所属团体",
    field: "要修正的字段", wrong: "当前内容", correct: "正确内容",
    date: "演出日期", city: "城市", theatre: "剧院", cast: "参演演员与角色",
    actorA: "人物 A", actorB: "人物 B", relType: "关系类型", detail: "关系详情/备注"
  };

  function activeGroupId() {
    return "c-" + document.getElementById("c-mode").value + "-" + document.getElementById("c-category").value;
  }
  function syncContributeGroups() {
    var active = activeGroupId();
    document.querySelectorAll(".c-group").forEach(function (g) {
      g.classList.toggle("hidden", g.id !== active);
    });
  }
  document.getElementById("c-mode").addEventListener("change", syncContributeGroups);
  document.getElementById("c-category").addEventListener("change", syncContributeGroups);

  function getContributions() {
    try { return JSON.parse(localStorage.getItem("mg_contributions") || "[]"); } catch (e) { return []; }
  }
  function collectContribution() {
    var mode = document.getElementById("c-mode").value;
    var category = document.getElementById("c-category").value;
    var group = document.getElementById(activeGroupId());
    var fields = {};
    group.querySelectorAll("input, textarea, select").forEach(function (el) {
      if (el.name) fields[el.name] = el.value.trim();
    });
    var item = {
      id: Date.now(),
      mode: mode,
      category: category,
      fields: fields,
      ref: document.getElementById("c-ref").value.trim(),
      email: document.getElementById("c-email").value.trim(),
      ts: new Date().toISOString()
    };
    if (!(fields.name || fields.actorA)) { showToast("请填写名称"); return null; }
    if (category === "relation" && (!fields.actorA || !fields.actorB)) { showToast("请填写关系双方姓名"); return null; }
    if (mode === "fix" && !fields.correct) { showToast("请填写正确内容"); return null; }
    return item;
  }
  function issueTextFor(item) {
    var lines = [];
    lines.push("### 信息类别");
    lines.push((MODE_LABELS[item.mode] || item.mode) + " · " + (CAT_LABELS[item.category] || item.category));
    var f = item.fields || {};
    Object.keys(FIELD_LABELS).forEach(function (k) {
      if (f[k]) { lines.push(""); lines.push("### " + FIELD_LABELS[k]); lines.push(f[k]); }
    });
    lines.push(""); lines.push("### 来源链接");
    lines.push(item.ref || "（无）");
    lines.push(""); lines.push("### 提交时间");
    lines.push(new Date(item.ts).toLocaleString());
    return lines.join("\n");
  }
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); showToast(okMsg || "已复制"); } catch (e) { showToast("复制失败，请手动复制"); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg || "已复制"); }, fallback);
    } else { fallback(); }
  }
  function renderReviewList() {
    var ul = document.getElementById("c-review-list");
    if (!ul) return;
    ul.innerHTML = "";
    getContributions().forEach(function (item) {
      var li = document.createElement("li");
      li.className = "cr-item";
      var head = document.createElement("div");
      head.className = "cr-head";
      head.textContent = "[" + (MODE_LABELS[item.mode] || item.mode) + " · " + (CAT_LABELS[item.category] || item.category) + "] " + (item.fields.name || item.fields.actorA || "");
      li.appendChild(head);
      var info = document.createElement("div");
      info.className = "cr-info";
      info.textContent = item.fields.correct || item.fields.detail || item.fields.note || item.fields.cast || "";
      li.appendChild(info);
      var meta = document.createElement("div");
      meta.className = "cr-meta";
      meta.textContent = new Date(item.ts).toLocaleString();
      li.appendChild(meta);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cr-copy";
      btn.textContent = "复制为 Issue 文本";
      btn.addEventListener("click", function () { copyText(issueTextFor(item), "Issue 文本已复制"); });
      li.appendChild(btn);
      if (MG_GITHUB_REPO) {
        var gbtn = document.createElement("button");
        gbtn.type = "button";
        gbtn.className = "cr-copy";
        gbtn.textContent = "在 GitHub 提交";
        gbtn.addEventListener("click", function () {
          var title = "[贡献] " + (item.fields.name || item.fields.actorA) + " " + (CAT_LABELS[item.category] || "");
          var url = "https://github.com/" + MG_GITHUB_REPO + "/issues/new?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(issueTextFor(item));
          window.open(url, "_blank");
        });
        li.appendChild(gbtn);
      }
      ul.appendChild(li);
    });
  }
  document.getElementById("contribute-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var item = collectContribution();
    if (!item) return;
    var list = getContributions();
    list.push(item);
    try { localStorage.setItem("mg_contributions", JSON.stringify(list)); } catch (err) { showToast("保存失败（存储空间不足）"); return; }
    e.target.reset();
    showToast("提交成功，已进入待审核列表");
    renderReviewList();
  });
  document.getElementById("c-export").addEventListener("click", function () {
    var list = getContributions();
    if (!list.length) { showToast("暂无待审核内容"); return; }
    var blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "mg_contributions.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast("已导出 JSON 文件");
  });
  document.getElementById("c-copy-all").addEventListener("click", function () {
    var list = getContributions();
    if (!list.length) { showToast("暂无待审核内容"); return; }
    copyText(list.map(issueTextFor).join("\n\n---\n\n"), "已复制全部 Issue 文本");
  });
  document.getElementById("c-clear").addEventListener("click", function () {
    localStorage.removeItem("mg_contributions");
    renderReviewList();
    showToast("已清空待审核列表");
  });
  var toolsToggle = document.getElementById("tools-toggle");
  if (toolsToggle) {
    toolsToggle.addEventListener("click", function () {
      document.body.classList.toggle("tools-open");
    });
  }
  document.getElementById("contact-link").addEventListener("click", function (e) {
    e.preventDefault();
    showToast("联系方式将在后续开放，可先通过 Contribute 页提交反馈");
  });

  // ---- 启动 ----
  buildGraph();
  resizeHome();
  layoutAndCenter();
  playEntrance();
  requestAnimationFrame(draw);
  updateStats();
  // 初始路由：Home / Graph / Contribute / #/actor/ID 均可直达
  applyRoute();
})();
