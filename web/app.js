/* MusicGraph 前端 MVP：零依赖 Canvas 力导向关系图 */
(function () {
  "use strict";
  var D = window.MUSIC_GRAPH;
  if (!D) { document.body.innerHTML = "<p style='padding:40px'>数据文件缺失：请先运行 python export_graph.py</p>"; return; }

  var TYPE_COLOR = {
    couple: "#e0546f", classmate: "#2f9e6e", friend: "#3f7fd6",
    teacher_student: "#8b5fd6", same_company: "#d68a2f", co_work: "#9aa3b2"
  };

  // ---- 图数据构建 ----
  var actors = D.actors, relations = D.relations, coWork = D.coWork, actorMusicals = D.actorMusicals || {}, musicals = D.musicals || {}, groups = D.groups || [];
  var coWorkByActor = {};
  coWork.forEach(function (e) {
    (coWorkByActor[e.a] = coWorkByActor[e.a] || []).push(e);
    (coWorkByActor[e.b] = coWorkByActor[e.b] || []).push(e);
  });
  function actorName(id) { var a = actors[id]; return a ? a.name : "?" + id; }

  // 初始节点：参与关系的人
  var baseIds = new Set();
  relations.forEach(function (r) { baseIds.add(r.a); baseIds.add(r.b); });

  var nodes = {};   // id -> {id,x,y,vx,vy,r,color,label,deg}
  var edges = [];   // {a,b,type,color,dashed,width,label}

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

  var visibleTypes = {};   // 类型 -> 是否显示（默认全开）
  ["couple", "classmate", "friend", "teacher_student", "same_company", "co_work"]
    .forEach(function (ty) { visibleTypes[ty] = true; });

  function buildGraph() {
    nodes = {}; edges = [];
    // 参与任意可见类型关系的节点
    var active = {};
    relations.forEach(function (r) {
      if (visibleTypes[r.type]) { active[r.a] = true; active[r.b] = true; }
    });
    Object.keys(active).forEach(function (id) { ensureNode(id); });
    relations.forEach(function (r) {
      if (!visibleTypes[r.type]) return;
      if (!nodes[r.a] || !nodes[r.b]) return;
      edges.push({ a: r.a, b: r.b, type: r.type, color: TYPE_COLOR[r.type] || "#999", dashed: false, width: 2, label: r.typeName + (r.detail ? " · " + r.detail : "") });
      nodes[r.a].deg++; nodes[r.b].deg++;
    });
    // 节点半径按关系数
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      var rels = relations.filter(function (r) { return (r.a === id || r.b === id) && visibleTypes[r.type]; });
      n.r = 10 + Math.min(8, rels.length);
    });
  }

  // ---- 力导向模拟 ----
  var simRunning = false;
  function tick() {
    var ks = 0.02, kc = 6000, damp = 0.85, list = Object.keys(nodes).map(function (k) { return nodes[k]; });
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.fixed) continue;
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var d2 = dx * dx + dy * dy + 1e-6;
        var d = Math.sqrt(d2);
        var f = kc / d2;
        var fx = dx / d * f, fy = dy / d * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
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
      n.vx *= damp; n.vy *= damp;
      n.x += n.vx; n.y += n.vy;
    });
    requestAnimationFrame(tick);
  }
  function startSim() { if (!simRunning) { simRunning = true; requestAnimationFrame(tick); } }

  // ---- 渲染 ----
  var canvas = document.getElementById("graph"), ctx = canvas.getContext("2d");
  var view = { x: 0, y: 0, zoom: 1 };
  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  function draw() {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.save();
    ctx.translate(canvas.clientWidth / 2 + view.x, canvas.clientHeight / 2 + view.y);
    ctx.scale(view.zoom, view.zoom);
    // edges
    edges.forEach(function (e) {
      var a = nodes[e.a], b = nodes[e.b];
      if (!a || !b) return;
      ctx.strokeStyle = e.color; ctx.globalAlpha = e.dashed ? 0.5 : 0.65;
      ctx.lineWidth = (e.width || 1) / view.zoom;
      ctx.setLineDash(e.dashed ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (e.dashed && view.zoom > 0.7) {
        ctx.fillStyle = "#888"; ctx.font = "10px sans-serif";
        ctx.fillText(e.label || "", (a.x + b.x) / 2, (a.y + b.y) / 2 - 4);
      }
    });
    // nodes
    var selId = selected;
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.color; ctx.fill();
      ctx.strokeStyle = (k === selId) ? "#222" : "#fff"; ctx.lineWidth = (k === selId ? 3 : 1.5);
      ctx.stroke();
      if (view.zoom > 0.5) {
        ctx.fillStyle = "#333"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(n.label, n.x, n.y + n.r + 14);
      }
    });
    ctx.restore();
    requestAnimationFrame(draw);
  }

  // ---- 交互 ----
  var selected = null;
  var expandCowork = document.getElementById("expand-cowork").checked = false;
  document.getElementById("expand-cowork").addEventListener("change", function (e) {
    expandCowork = e.target.checked;
    if (selected) selectNode(selected, true);
  });

  // 图例点击筛选关系类型
  document.querySelectorAll(".lg[data-type]").forEach(function (el) {
    el.addEventListener("click", function () {
      var ty = el.getAttribute("data-type");
      visibleTypes[ty] = !visibleTypes[ty];
      el.classList.toggle("off", !visibleTypes[ty]);
      var wasSelected = selected;
      buildGraph();
      // 重建后重新定位原选中节点
      if (wasSelected && nodes[wasSelected]) {
        var n = nodes[wasSelected];
        view.x = -n.x * view.zoom; view.y = -n.y * view.zoom;
        selectNode(wasSelected, true);
      } else {
        selected = null; hidePanel();
      }
      document.getElementById("stats").textContent =
        "节点 " + Object.keys(nodes).length + " · 关系边 " + edges.length + " · 共演边 " + coWork.length;
    });
  });

  function selectNode(id, fromExpand) {
    if (id && nodes[id]) {
      selected = id;
      // 展开共演
      if (expandCowork && fromExpand !== false) {
        (coWorkByActor[id] || []).slice(0, 12).forEach(function (e) {
          var other = e.a === id ? e.b : e.a;
          if (!nodes[other]) {
            var n = ensureNode(other, { color: "#b7bcc8" });
            n.r = 7;
            edges.push({ a: id, b: other, type: "co_work", color: "#9aa3b2", dashed: true, width: 1, label: "共演" + e.count + "场" });
          }
        });
      }
      showPanel(id);
    } else {
      selected = null;
      hidePanel();
    }
  }

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

  var dragging = null, panning = false, lastX = 0, lastY = 0;
  canvas.addEventListener("mousedown", function (e) {
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var hit = hitTest(px, py);
    lastX = e.clientX; lastY = e.clientY;
    if (hit) { dragging = hit; nodes[hit].fixed = true; }
    else { panning = true; }
  });
  window.addEventListener("mousemove", function (e) {
    if (dragging) {
      var rect = canvas.getBoundingClientRect();
      var p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      nodes[dragging].x = p.x; nodes[dragging].y = p.y;
    } else if (panning) {
      view.x += e.clientX - lastX; view.y += e.clientY - lastY;
    }
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", function (e) {
    if (dragging) {
      if (nodes[dragging]) nodes[dragging].fixed = false;
      dragging = null;
      return;
    }
    if (panning) {
      panning = false;
      // 判断是否点击（无位移）
      var rect = canvas.getBoundingClientRect();
      var hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      selectNode(hit);
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
  var touches = null;          // {mode:'pan'|'drag'|'pinch', id, nodeId, startX, startY, startDist, startZoom}
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
      if (touches.startDist > 0) {
        var before = screenToWorld(touches.cx, touches.cy);
        view.zoom = Math.max(0.2, Math.min(4, touches.startZoom * dist / touches.startDist));
        var after = screenToWorld(touches.cx, touches.cy);
        view.x += (after.x - before.x) * view.zoom;
        view.y += (after.y - before.y) * view.zoom;
      }
    } else {
      var t = null;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touches.id) { t = e.touches[i]; break; }
      }
      if (!t) return;
      var px = t.clientX - rect.left, py = t.clientY - rect.top;
      if (touches.mode === "drag") {
        var p = screenToWorld(px, py);
        nodes[touches.nodeId].x = p.x;
        nodes[touches.nodeId].y = p.y;
        nodes[touches.nodeId].fixed = true;
      } else if (touches.mode === "pan") {
        view.x += px - touches.startX;
        view.y += py - touches.startY;
      }
      if (Math.abs(px - touches.startX) > 6 || Math.abs(py - touches.startY) > 6) touchMoved = true;
      touches.startX = px; touches.startY = py;
    }
  }, { passive: false });

  canvas.addEventListener("touchend", function (e) {
    e.preventDefault();
    if (!touches) return;
    if (touches.mode === "drag" && nodes[touches.nodeId]) nodes[touches.nodeId].fixed = false;
    var wasDrag = touches.mode === "drag";
    touches = null;
    // 轻点（未移动）视为点击
    if (e.changedTouches && e.changedTouches.length === 1 && !touchMoved && !wasDrag) {
      var rect = canvas.getBoundingClientRect();
      var t = e.changedTouches[0];
      var hit = hitTest(t.clientX - rect.left, t.clientY - rect.top);
      selectNode(hit);
    }
    touchMoved = false;
  }, { passive: false });
  canvas.addEventListener("touchcancel", function () { touches = null; touchMoved = false; }, { passive: true });

  // ---- 档案面板 ----
  var panel = document.getElementById("panel");
  function hidePanel() { panel.classList.add("hidden"); }
  function showPanel(id) {
    document.getElementById("p-cast-title").classList.add("hidden");
    document.getElementById("p-cast").classList.add("hidden");
    document.getElementById("p-rel-title").classList.remove("hidden");
    document.getElementById("p-mus-title").classList.remove("hidden");
    document.getElementById("p-cw-title").classList.remove("hidden");
    // 所属团体
    var ug = document.getElementById("p-groups"), ugTitle = document.getElementById("p-gr-title");
    ug.innerHTML = ""; ug.classList.add("hidden"); ugTitle.classList.add("hidden");
    var myGroups = groups.filter(function (g) { return (g.members || []).indexOf(id) >= 0; });
    if (myGroups.length) {
      ugTitle.classList.remove("hidden"); ug.classList.remove("hidden");
      myGroups.forEach(function (g) {
        var li = document.createElement("li");
        li.textContent = g.name;
        li.style.cursor = "pointer"; li.style.color = "#3f7fd6";
        li.addEventListener("click", function () { showGroupPanel(g.id); });
        ug.appendChild(li);
      });
    }
    var a = actors[id];
    panel.classList.remove("hidden");
    document.getElementById("p-name").textContent = a ? a.name : actorName(id);
    document.getElementById("p-nickname").textContent = a && a.nickname ? a.nickname : "";
    var dl = document.getElementById("p-fields"); dl.innerHTML = "";
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
    // 关系（同一对 + 同类型合并，多个 CP 名用顿号连接）
    var ul = document.getElementById("p-relations"); ul.innerHTML = "";
    var grouped = {};  // key: other_type -> {other, type, typeName, details: []}
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
      var uniq = g.details.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      txt.innerHTML = actorName(g.other) + (uniq.length ? " <span class='rel-detail'>(" + uniq.join(" / ") + ")</span>" : "");
      li.appendChild(txt);
      // 共同作品
      var myMus = actorMusicals[id] || [], otherMus = actorMusicals[g.other] || [];
      var common = myMus.filter(function (m) { return otherMus.indexOf(m) >= 0; });
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
    // 参演剧目
    var um = document.getElementById("p-musicals"); um.innerHTML = "";
    var myMusList = actorMusicals[id] || [];
    if (myMusList.length) {
      myMusList.slice(0, 12).forEach(function (m) {
        var li = document.createElement("li");
        li.textContent = m;
        um.appendChild(li);
      });
      if (myMusList.length > 12) {
        var li = document.createElement("li");
        li.className = "rel-detail";
        li.textContent = "… 共 " + myMusList.length + " 部";
        um.appendChild(li);
      }
    } else {
      var li = document.createElement("li"); li.textContent = "暂无参演记录";
      um.appendChild(li);
    }
    // 共演
    var uc = document.getElementById("p-cowork"); uc.innerHTML = "";
    var list = (coWorkByActor[id] || []).slice(0, 10);
    list.forEach(function (e) {
      var other = e.a === id ? e.b : e.a;
      var li = document.createElement("li");
      li.textContent = actorName(other) + "（共演 " + e.count + " 场）";
      uc.appendChild(li);
    });
    if (!list.length) {
      var li = document.createElement("li"); li.textContent = "暂无共演数据";
      uc.appendChild(li);
    }
  }
  document.getElementById("panel-close").addEventListener("click", function () { selected = null; hidePanel(); });

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
        if (hit.type === "actor") focusActor(hit.data.id);
        else if (hit.type === "musical") showMusicalPanel(hit.id);
        else showGroupPanel(hit.id);
      });
      dropdown.appendChild(div);
    });
    dropdown.classList.remove("hidden");
  }
  function showGroupPanel(gid) {
    var g = groups.filter(function (x) { return x.id === gid; })[0];
    if (!g) return;
    selected = null;
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
      var a = actors[aid];
      var li = document.createElement("li");
      li.textContent = a ? a.name : "?" + aid;
      li.style.cursor = "pointer"; li.style.color = "#3f7fd6";
      li.addEventListener("click", function () { focusActor(aid); });
      ul.appendChild(li);
    });
    panel.classList.remove("hidden");
  }
  function showMusicalPanel(mid) {
    var m = musicals[mid];
    if (!m) return;
    selected = null;
    search.value = m.name;
    dropdown.classList.add("hidden");
    document.getElementById("p-name").textContent = "🎭 " + m.name;
    document.getElementById("p-nickname").textContent = "作品";
    document.getElementById("p-fields").innerHTML = "";
    document.getElementById("p-relations").innerHTML = "";
    document.getElementById("p-musicals").innerHTML = "";
    document.getElementById("p-cowork").innerHTML = "";
    document.getElementById("p-rel-title").classList.add("hidden");
    document.getElementById("p-mus-title").classList.add("hidden");
    document.getElementById("p-cw-title").classList.add("hidden");
    document.getElementById("p-cast-title").classList.remove("hidden");
    document.getElementById("p-cast-title").textContent = "演员表（" + (m.cast || []).length + " 人）";
    var ul = document.getElementById("p-cast");
    ul.innerHTML = "";
    ul.classList.remove("hidden");
    (m.cast || []).slice(0, 100).forEach(function (aid) {
      var li = document.createElement("li");
      var a = actors[aid];
      li.textContent = (a ? a.name : "?" + aid) + (a && a.nickname ? "（" + a.nickname + "）" : "");
      li.style.cursor = "pointer";
      li.style.color = "#3f7fd6";
      li.addEventListener("click", function () { focusActor(aid); });
      ul.appendChild(li);
    });
    panel.classList.remove("hidden");
  }
  function focusActor(id) {
    search.value = actorName(id);
    dropdown.classList.add("hidden");
    if (!nodes[id]) {
      var rels = relations.filter(function (r) { return r.a === id || r.b === id; });
      if (!rels.length) { selected = null; showPanel(id); return; }  // 无关系但搜到：仅显示档案
    }
    selectNode(id);
    var n = nodes[id];
    if (n) { view.x = -n.x * view.zoom; view.y = -n.y * view.zoom; view.zoom = Math.max(view.zoom, 1.2); }
  }
  search.addEventListener("input", doSearch);
  search.addEventListener("keydown", function (e) { if (e.key === "Enter") { var first = dropdown.querySelector(".item"); if (first) first.dispatchEvent(new MouseEvent("mousedown")); } });
  document.addEventListener("click", function (e) { if (!e.target.closest(".search-box")) dropdown.classList.add("hidden"); });

  // ---- 热门演员标签 + 初始聚焦 ----
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
      span.addEventListener("click", function () { focusActor(d.id); });
      chips.appendChild(span);
    });
  }

  // ---- 启动 ----
  buildGraph();
  resize();
  startSim();
  requestAnimationFrame(draw);
  buildHotChips();
  document.getElementById("stats").textContent = "节点 " + Object.keys(nodes).length + " · 关系边 " + edges.length + " · 共演边 " + coWork.length;
  // 初始聚焦：度数最高的节点（2.5 秒后视图稳定再聚焦）
  setTimeout(function () {
    var degs = [];
    Object.keys(nodes).forEach(function (id) { degs.push({ id: id, deg: degreeOf(id) }); });
    degs.sort(function (x, y) { return y.deg - x.deg; });
    if (degs.length) {
      var top = degs[0].id;
      var n = nodes[top];
      if (n) { view.x = -n.x * view.zoom; view.y = -n.y * view.zoom; }
      selectNode(top);
    }
  }, 2500);
})();
