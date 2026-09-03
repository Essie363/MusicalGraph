/* MusicGraph Supabase 数据层
   在 supabase_config.js 配置 url + anonKey 后，从 Supabase REST API 拉取数据，
   组装成与静态快照一致的 window.MUSIC_GRAPH 结构（供 app.js 使用）。
   未配置或请求失败时返回 null，由 data_loader.js 回退静态快照（?mode=static 也走静态）。 */
(function () {
  "use strict";

  var SB = window.MG_SUPABASE || {};
  var PROFILE_FIELDS = ["nickname", "birth_date", "major", "school", "hometown", "enrollment_year", "height", "note"];
  var TYPE_NAMES = {
    co_work: "共演", classmate: "同学", friend: "好友",
    couple: "情侣", teacher_student: "师生", same_company: "同公司",
    cp: "CP", married: "伴侣", ex: "前任", roommate: "室友"
  };

  function active() {
    return !!(SB && SB.url && SB.anonKey);
  }
  function headers() {
    return {
      "apikey": SB.anonKey,
      "Authorization": "Bearer " + SB.anonKey
    };
  }
  function fetchJson(path) {
    return fetch(SB.url + path, {
      headers: headers(),
      signal: AbortSignal.timeout(SB.timeoutMs || 8000)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function pageAll(table, fields) {
    var limit = 1000;
    var q = "select=" + encodeURIComponent(fields) + "&limit=" + limit;
    return fetch(SB.url + "/rest/v1/" + table + "?" + q, {
      headers: Object.assign(headers(), { Prefer: "count=exact", Range: "0-" + (limit - 1) }),
      signal: AbortSignal.timeout(SB.timeoutMs || 8000)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      var cr = r.headers.get("Content-Range") || "*/0";
      var total = parseInt(cr.split("/")[1], 10);
      if (isNaN(total)) total = 0;
      return r.json().then(function (firstPage) {
        var jobs = [firstPage || []];
        for (var off = limit; off < total; off += limit) {
          jobs.push(fetchJson("/rest/v1/" + table + "?select=" + encodeURIComponent(fields) + "&limit=" + limit + "&offset=" + off));
        }
        return Promise.all(jobs).then(function (pages) {
          var out = [];
          pages.forEach(function (p) { out = out.concat(p || []); });
          return out;
        });
      });
    });
  }

  var MIN_COWORK = 5, TOP_COWORK = 12;
  function buildStartupCowork(all) {
    var by = {}, out = [], seen = {}, i, e;
    for (i = 0; i < all.length; i++) {
      e = all[i];
      if (e.count < MIN_COWORK) continue;
      (by[e.a] = by[e.a] || []).push([e.b, e.count]);
      (by[e.b] = by[e.b] || []).push([e.a, e.count]);
    }
    Object.keys(by).forEach(function (a) {
      by[a].sort(function (x, y) { return y[1] - x[1]; });
      for (i = 0; i < Math.min(TOP_COWORK, by[a].length); i++) {
        var b = by[a][i][0], c = by[a][i][1];
        var key = a < b ? a + "|" + b : b + "|" + a;
        if (seen[key]) continue;
        seen[key] = true;
        out.push({ a: a, b: b, count: c, c: c });
      }
    });
    return out;
  }

  function build(actorsRaw, musicalsRaw, rolesRaw, actorRolesRaw, relationsRaw, typesRaw, momentsRaw, staticD, ratingSummary) {
    var actorMap = {}, actors = {}, i, r, id, a, k;
    for (i = 0; i < actorsRaw.length; i++) {
      r = actorsRaw[i];
      id = String(r.id);
      actorMap[id] = id;
      a = { id: id, name: r.name };
      for (k = 0; k < PROFILE_FIELDS.length; k++) {
        var f = PROFILE_FIELDS[k];
        if (r[f]) a[f] = String(r[f]);
      }
      actors[id] = a;
    }

    var musicalMap = {}, musicals = {};
    for (i = 0; i < musicalsRaw.length; i++) {
      r = musicalsRaw[i];
      id = String(r.id);
      musicalMap[id] = id;
      musicals[id] = { id: id, name: r.name, cast: [], roles: {} };
    }

    var roleMap = {};
    for (i = 0; i < rolesRaw.length; i++) {
      r = rolesRaw[i];
      roleMap[String(r.id)] = r.name || "";
    }

    var actorMusicals = {}, actorMusicalIds = {}, actorRoleOptions = {}, aid, mid, m, role;
    for (i = 0; i < actorRolesRaw.length; i++) {
      r = actorRolesRaw[i];
      aid = actorMap[String(r.artist_id)];
      mid = musicalMap[String(r.musical_id)];
      if (!aid || !mid) continue;
      m = musicals[mid];
      if (!m) continue;
      if (m.cast.indexOf(aid) < 0) m.cast.push(aid);
      role = r.role_id != null ? (roleMap[String(r.role_id)] || "") : "";
      if (role) {
        if (!m.roles[aid]) m.roles[aid] = [];
        if (m.roles[aid].indexOf(role) < 0) m.roles[aid].push(role);
      }
      if (!actorMusicals[aid]) actorMusicals[aid] = {};
      if (!actorMusicals[aid][m.name]) actorMusicals[aid][m.name] = [];
      if (role && actorMusicals[aid][m.name].indexOf(role) < 0) actorMusicals[aid][m.name].push(role);
      if (!actorMusicalIds[aid]) actorMusicalIds[aid] = [];
      if (actorMusicalIds[aid].indexOf(mid) < 0) actorMusicalIds[aid].push(mid);
      if (r.role_id != null && role) {
        if (!actorRoleOptions[aid]) actorRoleOptions[aid] = [];
        var optionKey = mid + "|" + String(r.role_id);
        var exists = actorRoleOptions[aid].some(function (x) { return x.key === optionKey; });
        if (!exists) actorRoleOptions[aid].push({
          key: optionKey,
          musicalId: mid,
          musicalName: m.name,
          roleId: String(r.role_id),
          roleName: role
        });
      }
    }

    var typeMap = {};
    for (i = 0; i < typesRaw.length; i++) {
      typeMap[String(typesRaw[i].id)] = typesRaw[i].code;
    }
    var relations = [];
    for (i = 0; i < relationsRaw.length; i++) {
      r = relationsRaw[i];
      var ra = actorMap[String(r.actor_a)], rb = actorMap[String(r.actor_b)];
      if (!ra || !rb) continue;
      var code = typeMap[String(r.type_id)] || "co_work";
      relations.push({
        type: code,
        typeName: TYPE_NAMES[code] || code,
        a: ra, b: rb, detail: r.detail || ""
      });
    }

    var moments = [];
    for (i = 0; i < momentsRaw.length; i++) {
      r = momentsRaw[i];
      var ma = actorMap[String(r.actor_id)];
      if (!ma) continue;
      moments.push({
        id: String(r.id),
        actorId: ma, title: r.title, url: r.url, source: r.source || ""
      });
    }

    var coWork = (staticD && staticD.coWork) || [];
    try { window.MUSIC_GRAPH_COWORK = null; } catch (e) {}
    return {
      counts: {
        actors: Object.keys(actors).length,
        relations: relations.length,
        coWork: coWork.length,
        moments: moments.length
      },
      actors: actors,
      relations: relations,
      coWork: coWork,
      actorMusicals: actorMusicals,
      musicals: musicals,
      actorMusicalIds: actorMusicalIds,
      actorCounts: staticD.actorCounts || {},
      musicalStats: staticD.musicalStats || {},
      groups: staticD.groups || [],
      moments: moments,
      actorRoleOptions: actorRoleOptions,
      ratings: ratingSummary || { actors: [], roles: [] }
    };
  }

  function loadRPC() {
    return fetch(SB.url + "/rest/v1/rpc/get_music_graph", {
      method: "POST",
      headers: Object.assign(headers(), { "Content-Type": "application/json" }),
      body: "{}",
      signal: AbortSignal.timeout(SB.timeoutMs || 8000)
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function loadRatingSummary() {
    return fetch(SB.url + "/rest/v1/rpc/get_rating_summary", {
      method: "POST",
      headers: Object.assign(headers(), { "Content-Type": "application/json" }),
      body: "{}",
      signal: AbortSignal.timeout(SB.timeoutMs || 8000)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).catch(function () {
      // 评分 SQL 尚未部署时，基础图谱仍应正常加载。
      return { actors: [], roles: [] };
    });
  }
  window.MG_supabaseLoadData = function (staticD) {
    if (!active() || !staticD) return Promise.resolve(null);
    return Promise.all([loadRPC(), loadRatingSummary()]).then(function (loaded) {
      var p = loaded[0], ratingSummary = p.rating_summary || loaded[1];
      return build(p.artists || [], p.musicals || [], p.roles || [], p.actor_roles || [],
                   p.relations || [], p.relation_types || [], p.moments || [], staticD, ratingSummary);
    }).catch(function (err) {
      if (window.__MG_DEBUG) window.__MG_DEBUG.rpcError = err && err.message ? err.message : String(err);
      return Promise.all([
        pageAll("artists", "id,name," + PROFILE_FIELDS.join(",")),
        pageAll("musicals", "id,name"),
        pageAll("roles", "id,musical_id,name"),
        pageAll("actor_roles", "artist_id,musical_id,role_id"),
        pageAll("relations", "id,actor_a,actor_b,type_id,detail"),
        pageAll("relation_types", "id,code"),
        pageAll("moments", "id,actor_id,title,url,source"),
        loadRatingSummary()
      ]).then(function (all) {
        return build(all[0], all[1], all[2], all[3], all[4], all[5], all[6], staticD, all[7]);
      }).catch(function (err2) {
        if (window.__MG_DEBUG) window.__MG_DEBUG.supabaseError = err2 && err2.message ? err2.message : String(err2);
        return null;
      });
    });
  }
})();
