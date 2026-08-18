/* MusicGraph 数据层（web/data_loader.js）
   加载顺序：data.js → data_loader.js →（数据就绪后注入）app.js
   数据源：优先 PocketBase API（在线、含审核通过的新内容），失败回退静态快照 data.js。
   用法：?pb=<url> 指定后端地址；?mode=static 强制离线快照；localStorage mg_pb_url 可保存地址。
   线上静态 demo：默认只读打包快照；仅本机（localhost/file）自动探测本地 PocketBase。
*/
(function () {
  "use strict";
  var CONFIG = { url: "", timeoutMs: 2500 };

  function defaultBackendUrl() {
    var proto = location.protocol;
    var host = (location.hostname || "").toLowerCase();
    if (proto === "file:") return "http://127.0.0.1:8090";
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
      return "http://127.0.0.1:8090";
    }
    return "";
  }

  // 配置覆盖：URL 参数 > localStorage > 默认（默认仅本机启用后端探测）
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("mode") === "static") {
      CONFIG.url = "";
    } else if (q.get("pb")) {
      CONFIG.url = q.get("pb").replace(/\/+$/, "");
    } else {
      var saved = localStorage.getItem("mg_pb_url");
      if (saved) {
        CONFIG.url = saved.replace(/\/+$/, "");
      } else {
        CONFIG.url = defaultBackendUrl();
      }
    }
  } catch (e) { /* 忽略 */ }

  window.MG_PB_CONFIG = CONFIG;
  window.MG_DATA_MODE = "static";

  function fetchJson(url) {
    return fetch(url, { signal: AbortSignal.timeout(CONFIG.timeoutMs) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  // 分页拉取某个 collection 的全部记录（?fields= 精简字段）
  function pageAll(collection, fields) {
    var out = [];
    function next(page) {
      return fetchJson(CONFIG.url + "/api/collections/" + collection +
        "/records?page=" + page + "&perPage=500&fields=" + encodeURIComponent(fields))
        .then(function (d) {
          out = out.concat(d.items || []);
          if (page < d.totalPages) return next(page + 1);
          return out;
        });
    }
    return next(1);
  }

  var staticD = null;   // static snapshot (window.MUSIC_GRAPH) for fallback fields

  var TYPE_NAMES = {
    co_work: "\u5171\u6f14", classmate: "\u540c\u5b66", friend: "\u597d\u53cb",
    couple: "\u60c5\u4fa3", teacher_student: "\u5e08\u751f", same_company: "\u540c\u516c\u53f8",
    cp: "CP", married: "\u4f34\u4fa3", ex: "\u524d\u4efb", roommate: "\u5ba4\u53cb"
  };
  var ACTOR_PROFILE_FIELDS = ["nickname", "birth_date", "major", "school", "hometown", "enrollment_year", "height", "note", "role"];

  // 用 PocketBase 数据组装与 window.MUSIC_GRAPH 相同结构（id 统一用 legacy_id 保持与静态数据一致）
  function buildFromApi(actorsRaw, musicalsRaw, rolesRaw, relationsRaw, momentsRaw, staticD) {
    var actorMap = {}, actors = {}, i, r, id, a, k;
    for (i = 0; i < actorsRaw.length; i++) {
      r = actorsRaw[i];
      id = r.legacy_id ? String(r.legacy_id) : r.id;
      actorMap[r.id] = id;
      a = { id: id, name: r.name };
      for (k = 0; k < ACTOR_PROFILE_FIELDS.length; k++) {
        var f = ACTOR_PROFILE_FIELDS[k];
        if (r[f]) a[f] = String(r[f]);
      }
      actors[id] = a;
    }

    var musicalMap = {}, musicals = {};
    for (i = 0; i < musicalsRaw.length; i++) {
      r = musicalsRaw[i];
      id = r.legacy_id ? String(r.legacy_id) : r.id;
      musicalMap[r.id] = id;
      musicals[id] = { id: id, name: r.name, cast: [], roles: {} };
    }

    var actorMusicals = {}, actorMusicalIds = {}, aid, mid, m, role;
    for (i = 0; i < rolesRaw.length; i++) {
      r = rolesRaw[i];
      aid = actorMap[r.actor]; mid = musicalMap[r.musical];
      if (!aid || !mid) continue;
      m = musicals[mid];
      if (!m) continue;
      if (m.cast.indexOf(aid) < 0) m.cast.push(aid);
      role = r.role || "";
      if (role) {
        if (!m.roles[aid]) m.roles[aid] = [];
        if (m.roles[aid].indexOf(role) < 0) m.roles[aid].push(role);
      }
      if (!actorMusicals[aid]) actorMusicals[aid] = {};
      if (!actorMusicals[aid][m.name]) actorMusicals[aid][m.name] = [];
      if (role && actorMusicals[aid][m.name].indexOf(role) < 0) actorMusicals[aid][m.name].push(role);
      if (!actorMusicalIds[aid]) actorMusicalIds[aid] = [];
      if (actorMusicalIds[aid].indexOf(mid) < 0) actorMusicalIds[aid].push(mid);
    }

    var relations = [];
    for (i = 0; i < relationsRaw.length; i++) {
      r = relationsRaw[i];
      var ra = actorMap[r.actor_a], rb = actorMap[r.actor_b];
      if (!ra || !rb) continue;
      relations.push({
        type: r.relation_type,
        typeName: TYPE_NAMES[r.relation_type] || r.relation_type,
        a: ra, b: rb, detail: r.description || ""
      });
    }

    var moments = [];
    for (i = 0; i < momentsRaw.length; i++) {
      r = momentsRaw[i];
      var ma = actorMap[r.actor];
      if (!ma) continue;
      moments.push({
        id: r.legacy_id ? String(r.legacy_id) : r.id,
        actorId: ma, title: r.title, url: r.url, source: r.platform || ""
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        actors: Object.keys(actors).length,
        relations: relations.length,
        coWork: (staticD.coWork || []).length,
        moments: moments.length
      },
      actors: actors,
      relations: relations,
      coWork: staticD.coWork || [],
      actorMusicals: actorMusicals,
      musicals: musicals,
      actorMusicalIds: actorMusicalIds,
      actorCounts: staticD.actorCounts || {},
      musicalStats: staticD.musicalStats || {},
      groups: staticD.groups || [],
      moments: moments
    };
  }

  function loadData() {
    if (!CONFIG.url) return Promise.resolve(null);
    if (!window.MUSIC_GRAPH) return Promise.resolve(null);
    staticD = window.MUSIC_GRAPH;
    // quick health probe: fall back to static if backend is unreachable
    // (probe timeout == data timeout; some environments are slow to first-connect)
    return fetchJson(CONFIG.url + "/api/health").then(function () {
      return fetchCollections();
    }, function () {
      return null;
    });
  }
  function fetchCollections() {
    return Promise.all([
      pageAll("actors", "id,legacy_id,name," + ACTOR_PROFILE_FIELDS.join(",")),
      pageAll("musicals", "id,legacy_id,name"),
      pageAll("actor_roles", "id,actor,musical,role"),
      pageAll("relations", "id,actor_a,actor_b,relation_type,description"),
      pageAll("moments", "id,legacy_id,actor,title,url,platform")
    ]).then(function (all) {
      return buildFromApi(all[0], all[1], all[2], all[3], all[4], staticD);
    });
  }

  var promise = null;
  window.__MG_DEBUG = {};
  window.MG_loadSiteData = function () {
    if (promise) return promise;
    promise = loadData().then(function (data) {
      window.__MG_DEBUG.loaded = !!data;
      if (data) {
        window.MUSIC_GRAPH = data;
        window.MG_DATA_MODE = "api";
        try {
          var t = document.getElementById("toast");
          if (t) {
            t.textContent = "\u6570\u636e\u6e90\uff1aPocketBase \u5728\u7ebf";
            t.classList.remove("hidden");
            setTimeout(function () { t.classList.add("hidden"); }, 2200);
          }
        } catch (e) { /* 忽略 */ }
      }
      return window.MG_DATA_MODE;
    }).catch(function (err) {
      window.__MG_DEBUG.error = err && err.message ? err.message : String(err);
      return "static";
    });
    return promise;
  };

  // 数据就绪后注入 app.js（app.js 仍按同步方式读取 window.MUSIC_GRAPH）
  window.MG_loadSiteData().then(function () {
    var s = document.createElement("script");
    s.src = "app.js";
    document.head.appendChild(s);
  });
})();
