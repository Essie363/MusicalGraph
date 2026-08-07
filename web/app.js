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
    couple: "#e0546f", cp: "#e0546f", classmate: "#2f9e6e", friend: "#3f7fd6",
    teacher_student: "#8b5fd6", same_company: "#d68a2f", co_work: "#9aa3b2"
  };
  var TYPE_LABEL = {
    couple: "情侣", cp: "CP", classmate: "同学", friend: "好友",
    teacher_student: "师生", same_company: "同公司", co_work: "共演"
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

  // ============ hash 路由 ============
  function currentActorId() {
    var m = location.hash.match(/^#\/actor\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function goActor(id) {
    var str = String(id);
    if (currentActorId() === str) { showActorView(str); return; }
    location.hash = "#/actor/" + encodeURIComponent(str);
  }
  function goHome() {
    if (location.hash && location.hash !== "#" && location.hash !== "#/") location.hash = "#/";
    showHomeView();
  }
  function goGroup(gid) { goHome(); showGroupPanel(gid); }
  function goMusical(mid) { goHome(); showMusicalPanel(mid); }
  window.addEventListener("hashchange", function () {
    var id = currentActorId();
    if (id) showActorView(id); else showHomeView();
  });

  var homeView = document.getElementById("home-view");
  var actorView = document.getElementById("actor-view");

  function showHomeView() {
    if (!homeView.classList.contains("hidden")) return;
    homeView.classList.remove("hidden");
    actorView.classList.add("hidden");
    document.body.classList.remove("actor-mode");
    resizeHome();
    requestAnimationFrame(draw);
  }
  function showActorView(id) {
    homeView.classList.add("hidden");
    actorView.classList.remove("hidden");
    document.body.classList.add("actor-mode");
    hidePanel();
    renderActorPage(id);
  }

  // ============ 首页：全局图谱 ============
  var canvas = document.getElementById("graph"), ctx = canvas.getContext("2d");
  var view = { x: 0, y: 0, zoom: 1 };
  var nodes = {}, edges = [];
  var visibleTypes = {};
  ["couple", "cp", "classmate", "friend", "teacher_student", "same_company", "co_work"]
    .forEach(function (ty) { visibleTypes[ty] = true; });

  function ensureNode(id, extra) {
    if (nodes[id]) return nodes[id];
    var a = actors[id] || { name: actorName(id) };
    nodes[id] = {
      id: id, x: Math.random() * 1000 - 500, y: Math.random() * 1000 - 500,
      vx: 0, vy: 0, r: 10, color: extra && extra.color || "#5b8def",
      label: a.name, deg: 0, fixed: false
    };
    return nodes[id];
  }

  function buildGraph() {
    nodes = {}; edges = [];
    // 参与任意可见类型关系的节点
    var active = {};
    relations.forEach(function (r) {
      if (visibleTypes[r.type]) { active[r.a] = true; active[r.b] = true; }
    });
    Object.keys(active).forEach(function (id) { ensureNode(id); });

    // 底层：共演边（若"共演"图例开启）——只画两端都在当前图谱里的边；首页不显示场次数字
    if (visibleTypes["co_work"]) {
      coWork.forEach(function (e) {
        if (!nodes[e.a] || !nodes[e.b]) return;
        edges.push({ a: e.a, b: e.b, type: "co_work", color: TYPE_COLOR["co_work"], dashed: true, width: 1, label: "" });
      });
    }

    // 上层：明确关系边
    relations.forEach(function (r) {
      if (!visibleTypes[r.type]) return;
      if (!nodes[r.a] || !nodes[r.b]) return;
      edges.push({ a: r.a, b: r.b, type: r.type, color: TYPE_COLOR[r.type] || "#999", dashed: false, width: 2, label: r.typeName + (r.detail ? " · " + r.detail : "") });
      nodes[r.a].deg++; nodes[r.b].deg++;
    });

    // 节点半径按关系数
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      var rels = relations.filter(function (r) { return (r.a === id || r.b === id); });
      n.r = 7 + Math.min(10, rels.length);
    });
  }

  // ---- 布局与入场动效：先瞬间算好稳定布局，再用 0.8 秒平滑展开，之后完全静止 ----
  var entranceT = 1, entranceStart = 0;   // entranceT: 0→1 入场进度

  function physicsStep() {
    var list = Object.keys(nodes).map(function (k) { return nodes[k]; });
    var ks = 0.02, kr = 1200, kd = 0.85, dt = 0.3;
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
      var f = (d - 90) * ks;
      var fx = dx / d * f, fy = dy / d * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    });
    list.forEach(function (n) {
      if (n.fixed) return;
      n.vx *= kd; n.vy *= kd;
      n.x += n.vx * dt; n.y += n.vy * dt;
    });
  }

  // 同步快速收敛（几十毫秒）得到稳定的"网络形状"，并把"连接最多的人"放到画布中心
  function layoutAndCenter() {
    for (var i = 0; i < 300; i++) physicsStep();
    Object.keys(nodes).forEach(function (k) { var n = nodes[k]; n.vx = 0; n.vy = 0; });
    var deg = {};
    edges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    var best = null, bestDeg = -1;
    Object.keys(deg).forEach(function (id) { if (deg[id] > bestDeg) { bestDeg = deg[id]; best = id; } });
    if (best && nodes[best]) {
      var cx = nodes[best].x, cy = nodes[best].y;
      Object.keys(nodes).forEach(function (k) { nodes[k].x -= cx; nodes[k].y -= cy; });
    }
    // 软边界：让图谱整体落在屏幕范围内（宽 650 / 高 370 的椭圆）
    var RX = 650, RY = 370;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      var r = Math.sqrt(Math.pow(n.x / RX, 2) + Math.pow(n.y / RY, 2));
      if (r > 1) { n.x /= r; n.y /= r; }
    });
    view.x = 0; view.y = 0;
    if (view.zoom < 1) view.zoom = 1;
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

  // ---- 渲染 ----
  function resizeHome() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(100, canvas.clientWidth) * dpr;
    canvas.height = Math.max(100, canvas.clientHeight) * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeHome);
  // 面板开关会改变布局，导致画布宽高变化——用 ResizeObserver 自动同步，避免残影
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
    var pe = entranceT;   // 入场进度 0→1
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.save();
    ctx.translate(canvas.clientWidth / 2 + view.x, canvas.clientHeight / 2 + view.y);
    ctx.scale(view.zoom, view.zoom);
    edges.forEach(function (ed) {
      var a = nodes[ed.a], b = nodes[ed.b];
      if (!a || !b) return;
      ctx.strokeStyle = ed.color; ctx.globalAlpha = (ed.dashed ? 0.45 : 0.65) * (0.25 + 0.75 * pe);
      ctx.lineWidth = (ed.width || 1) / view.zoom;
      ctx.setLineDash(ed.dashed ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(a.x * pe, a.y * pe); ctx.lineTo(b.x * pe, b.y * pe); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      var x = n.x * pe, y = n.y * pe;
      ctx.beginPath(); ctx.arc(x, y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.color; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
      ctx.stroke();
      if (view.zoom > 0.5) {
        ctx.fillStyle = "#333"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(n.label, x, y + n.r + 14);
      }
    });
    ctx.restore();
    requestAnimationFrame(draw);
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
      if (d < (n.r + 6) * (n.r + 6) && d < best) { best = d; hit = k; }
    });
    return hit;
  }

  // 点击与拖动区分：按住人物拖动=调整位置；原地点击=进入该演员详情页
  var dragging = null, panning = false, lastX = 0, lastY = 0, dragMoved = false;
  canvas.addEventListener("mousedown", function (e) {
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var hit = hitTest(px, py);
    lastX = e.clientX; lastY = e.clientY;
    dragMoved = false;
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
      // 悬停提示：指到人物时显示手型，提示可点击
      var rect = canvas.getBoundingClientRect();
      var h = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = h ? "pointer" : "default";
    }
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", function (e) {
    if (dragging) {
      var hit = dragging;
      if (nodes[hit]) nodes[hit].fixed = false;
      dragging = null;
      if (!dragMoved) goActor(hit);   // 单击人物 -> 进入该演员的关系详情页
      return;
    }
    if (panning) {
      panning = false;
      var rect = canvas.getBoundingClientRect();
      var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) goActor(hit);
    }
  });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var before = screenToWorld(px, py);
    view.zoom *= (e.deltaY < 0 ? 1.1 : 0.9);
    view.zoom = Math.max(0.2, Math.min(4, view.zoom));
    var after = screenToWorld(px, py);
    view.x += (after.x - before.x) * view.zoom;
    view.y += (after.y - before.y) * view.zoom;
  }, { passive: false });

  // ---- 触摸支持（移动端）----
  var touches = null;
  var touchMoved = false;
  canvas.addEventListener("touchstart", function (e) {
    e.preventDefault();
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
    if (touches.mode === "drag" && nodes[touches.nodeId]) nodes[touches.nodeId].fixed = false;
    var wasDrag = touches.mode === "drag";
    touches = null;
    if (e.changedTouches && e.changedTouches.length === 1 && !touchMoved && !wasDrag) {
      var rect = canvas.getBoundingClientRect();
      var t = e.changedTouches[0];
      var hit = hitTest(t.clientX - rect.left, t.clientY - rect.top);
      if (hit) goActor(hit);
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
      buildGraph();
      layoutAndCenter();
      playEntrance();
      updateStats();
    });
  });
  function updateStats() {
    document.getElementById("stats").textContent =
      "节点 " + Object.keys(nodes).length + " · 关系边 " + edges.length + " · 共演边 " + coWork.length;
  }

  // ---- 侧边面板（作品 / 团体；演员已改为独立详情页） ----
  var panel = document.getElementById("panel");
  function hidePanel() { panel.classList.add("hidden"); }
  document.getElementById("panel-close").addEventListener("click", hidePanel);
  function showGroupPanel(gid) {
    var g = groups.filter(function (x) { return x.id === gid; })[0];
    if (!g) return;
    search.value = g.name;
    dropdown.classList.add("hidden");
    document.getElementById("p-name").textContent = "👥 " + g.name;
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
      li.textContent = actorLabel(aid);
      li.style.cursor = "pointer"; li.style.color = "#3f7fd6";
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
    document.getElementById("p-name").textContent = "🎭 " + m.name;
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
    var castRoles = m.roles || {};
    (m.cast || []).slice(0, 100).forEach(function (aid) {
      var li = document.createElement("li");
      li.textContent = actorLabel(aid);
      var rs = castRoles[aid] || [];
      if (rs.length) {
        var span = document.createElement("span");
        span.className = "rel-detail";
        span.textContent = "（" + rs.join(" / ") + "）";
        li.appendChild(span);
      }
      li.style.cursor = "pointer"; li.style.color = "#3f7fd6";
      li.addEventListener("click", function () { goActor(aid); });
      ul.appendChild(li);
    });
    panel.classList.remove("hidden");
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
    apNodes[id] = { id: id, x: 0, y: 0, r: 16, color: "#e8604c", label: actorName(id), fixed: true };

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
    order.forEach(function (oid, i) {
      var info = nbr[oid];
      var hasRel = info.rel.length > 0;
      var color = hasRel ? "#5b8def" : (info.group ? "#3aa57a" : "#aab3c5");
      var r = hasRel ? 12 : (info.group ? 10 : 8);
      var angle = (i / Math.max(1, order.length)) * Math.PI * 2 - Math.PI / 2;
      apNodes[oid] = {
        id: oid, x: Math.cos(angle) * apRadius, y: Math.sin(angle) * apRadius,
        r: r, color: color, label: actorLabel(oid), fixed: false
      };
      info.rel.forEach(function (r_) {
        apEdges.push({ a: id, b: oid, color: TYPE_COLOR[r_.type] || "#999", dashed: false, width: 2, label: TYPE_LABEL[r_.type] || r_.typeName });
      });
      if (info.cw > 0) apEdges.push({ a: id, b: oid, color: TYPE_COLOR["co_work"], dashed: true, width: 1, label: "" });
      if (info.group) apEdges.push({ a: id, b: oid, color: "#2f9e6e", dashed: true, width: 1, label: "" });
    });
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
      apCtx.strokeStyle = ed.color; apCtx.globalAlpha = ed.dashed ? 0.55 : 0.7;
      apCtx.lineWidth = ed.width;
      apCtx.setLineDash(ed.dashed ? [6, 5] : []);
      apCtx.beginPath(); apCtx.moveTo(ax, ay); apCtx.lineTo(bx, by); apCtx.stroke();
      apCtx.setLineDash([]);
      if (ed.label && t > 0.7) {
        apCtx.fillStyle = "#777"; apCtx.font = "11px sans-serif"; apCtx.textAlign = "center";
        apCtx.fillText(ed.label, (ax + bx) / 2, (ay + by) / 2 - 4);
      }
    });
    apCtx.globalAlpha = 1;
    Object.keys(apNodes).forEach(function (k) {
      var n = apNodes[k];
      var x = cx + n.x * e, y = cy + n.y * e;
      apCtx.beginPath(); apCtx.arc(x, y, n.r, 0, Math.PI * 2);
      apCtx.fillStyle = n.color; apCtx.fill();
      apCtx.strokeStyle = (k === apCenterId) ? "#222" : "#fff"; apCtx.lineWidth = 2;
      apCtx.stroke();
      apCtx.fillStyle = "#333"; apCtx.font = "12px sans-serif"; apCtx.textAlign = "center";
      apCtx.fillText(n.label, x, y + n.r + 14);
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
    box.innerHTML = "";
    [
      ["情侣(待补充)", TYPE_COLOR.couple], ["CP", TYPE_COLOR.cp], ["同学", TYPE_COLOR.classmate],
      ["好友", TYPE_COLOR.friend], ["师生", TYPE_COLOR.teacher_student], ["同公司", TYPE_COLOR.same_company],
      ["共演", TYPE_COLOR.co_work], ["团体", "#2f9e6e"]
    ].forEach(function (pair) {
      var span = document.createElement("span");
      span.className = "lg";
      span.style.background = pair[1];
      span.textContent = pair[0];
      box.appendChild(span);
    });
  })();

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
      tag.className = "tag"; tag.style.background = TYPE_COLOR[g.type] || "#999";
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
    var dl = document.getElementById("ap-fields"); dl.innerHTML = "";
    var fields = [
      ["学校", "school"], ["入学", "enrollment_year"], ["专业", "major"],
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
    renderCowork(id);
    renderMusicals(id);
    renderGroups(id);
    apResize();
    buildActorGraph(id);
  }
  document.getElementById("ap-back").addEventListener("click", goHome);

  // ---- 搜索 ----
  var search = document.getElementById("search"), dropdown = document.getElementById("dropdown");
  function matches(actor, q) {
    q = q.toLowerCase();
    if ((actor.name || "").toLowerCase().indexOf(q) >= 0) return true;
    if ((actor.nickname || "").toLowerCase().indexOf(q) >= 0) return true;
    if ((actor.school || "").toLowerCase().indexOf(q) >= 0) return true;
    return false;
  }
  function doSearch() {
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
        div.innerHTML = "🎭 " + hit.data.name + " <small>作品</small>";
      } else {
        div.innerHTML = "👥 " + hit.data.name + " <small>团体</small>";
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
  search.addEventListener("input", doSearch);
  search.addEventListener("keydown", function (e) { if (e.key === "Enter") { var first = dropdown.querySelector(".item"); if (first) first.dispatchEvent(new MouseEvent("mousedown")); } });
  document.addEventListener("click", function (e) { if (!e.target.closest(".search-box")) dropdown.classList.add("hidden"); });

  // ---- 热门演员标签 ----
  function degreeOf(id) {
    return relations.reduce(function (n, r) { return n + ((r.a === id || r.b === id) ? 1 : 0); }, 0);
  }
  function buildHotChips() {
    var degs = [];
    Object.keys(nodes).forEach(function (id) { degs.push({ id: id, deg: degreeOf(id) }); });
    degs.sort(function (x, y) { return y.deg - x.deg; });
    var chips = document.getElementById("hot-chips");
    chips.innerHTML = "";
    degs.slice(0, 8).forEach(function (d) {
      var span = document.createElement("span");
      span.className = "chip";
      span.textContent = actorName(d.id);
      span.addEventListener("click", function () { goActor(d.id); });
      chips.appendChild(span);
    });
  }

  // ---- 供自动化验证读取的调试接口（对日常使用无影响）----
  window.__entranceT = function () { return entranceT; };
  window.__homeNodeIds = function () { return Object.keys(nodes); };
  window.__homeNodeScreen = function (id) {
    var n = nodes[id]; if (!n) return null;
    var rect = canvas.getBoundingClientRect();
    return { x: rect.left + canvas.clientWidth / 2 + view.x + n.x * view.zoom,
             y: rect.top + canvas.clientHeight / 2 + view.y + n.y * view.zoom };
  };
  window.__apNodes = function () { return apNodes; };
  window.__apCenterId = function () { return apCenterId; };
  window.__apNodeScreen = function (id) {
    var n = apNodes[id]; if (!n) return null;
    var rect = apCanvas.getBoundingClientRect();
    return { x: rect.left + apCanvas.clientWidth / 2 + n.x,
             y: rect.top + apCanvas.clientHeight / 2 + n.y };
  };

  // ---- 启动 ----
  buildGraph();
  resizeHome();
  layoutAndCenter();
  playEntrance();
  requestAnimationFrame(draw);
  buildHotChips();
  updateStats();
  // 初始路由：允许直接通过 #/actor/ID 打开详情页
  var initId = currentActorId();
  if (initId) showActorView(initId); else showHomeView();
})();
