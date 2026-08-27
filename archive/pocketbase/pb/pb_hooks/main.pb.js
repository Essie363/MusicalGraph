// CAST LIGHT — PocketBase 审核转换钩子
// 职责（范围受限）：
//   1. 用户创建 submissions 时强制 status=pending / applied=false（防止伪造已审核状态）
//   2. 管理员把 submission 状态改为 approved 且 applied=false 时，做纯机械的数据转换写入正式 collection；
//      不做审核判断、不做模糊匹配（判断由管理员在后台人工完成）
// 注意：
//   - 请求级钩子必须调用 event.next() 才会继续默认处理（校验+入库+响应），否则请求会被截断。
//   - v0.39 的 JSVM 中，钩子回调看不到文件顶层声明的函数，因此辅助函数需定义在回调内部。

// ---------- 钩子 1：创建提交时强制 pending（防止伪造已审核状态） ----------
onRecordCreateRequest((event) => {
  if (!event.collection || event.collection.name !== "submissions") return event.next();
  const rec = event.record;
  rec.set("status", "pending");
  rec.set("applied", false);
  rec.set("reviewed_at", null);
  return event.next();
}, "submissions");

// ---------- 钩子 2：管理员置 approved 后自动写入正式 collection（纯转换，不判断内容真伪） ----------
onRecordUpdateRequest((event) => {
  if (!event.collection || event.collection.name !== "submissions") return event.next();
  const rec = event.record;
  const status = rec.getString("status");
  const applied = rec.getBool("applied");
  if (status !== "approved" || applied) return event.next();

  const app = event.app;
  const notes = [];

  // ---- 工具（定义在回调内，保证可见） ----
  function findByName(collectionName, name) {
    return app.findRecordsByFilter(collectionName, "name = {:name}", "", 10, 0, { name: name });
  }
  function createRecord(collectionName, data) {
    const col = app.findCollectionByNameOrId(collectionName);
    const r = new Record(col);
    for (const k in data) r.set(k, data[k]);
    app.save(r);
    return r;
  }
  function resolveActor(name) {
    const list = findByName("actors", name);
    if (!list.length) {
      const r = createRecord("actors", { name: name });
      notes.push("新建演员「" + name + "」");
      return r;
    }
    if (list.length > 1) notes.push("演员「" + name + "」存在同名，已取第一条，请人工核对");
    return list[0];
  }
  function resolveMusical(name) {
    const list = findByName("musicals", name);
    if (!list.length) {
      const r = createRecord("musicals", { name: name });
      notes.push("新建剧目「" + name + "」");
      return r;
    }
    return list[0];
  }

  const ACTOR_FIELDS = ["nickname", "birth_date", "major", "school", "hometown", "enrollment_year", "height", "note", "role", "is_actor"];
  const MUSICAL_FIELDS = ["year", "description"];
  const RELATION_TYPES = ["co_work", "classmate", "friend", "couple", "teacher_student", "same_company", "cp", "married", "ex"];

  function parseDetails() {
    const raw = rec.getString("details");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function applyActorUpdate() {
    const name = rec.getString("actor_a");
    if (!name) throw new Error("缺少演员姓名");
    const actor = resolveActor(name);
    const d = parseDetails();
    if (d && typeof d === "object") {
      if (d.fix && d.fix.field && d.fix.correct) {
        const f = String(d.fix.field);
        if (ACTOR_FIELDS.indexOf(f) >= 0) { actor.set(f, String(d.fix.correct)); notes.push("修正 " + f); }
      }
      for (const f of ACTOR_FIELDS) {
        if (d[f] !== undefined && d[f] !== null && String(d[f]) !== "") actor.set(f, String(d[f]));
      }
    }
    app.save(actor);
    notes.unshift("演员「" + name + "」已更新");
  }
  function applyMusicalUpdate() {
    const name = rec.getString("musical_name");
    if (!name) throw new Error("缺少剧目名称");
    const musical = resolveMusical(name);
    const d = parseDetails();
    if (d && typeof d === "object") {
      if (d.fix && d.fix.field && d.fix.correct) {
        const f = String(d.fix.field);
        if (MUSICAL_FIELDS.indexOf(f) >= 0) { musical.set(f, String(d.fix.correct)); notes.push("修正 " + f); }
      }
      for (const f of MUSICAL_FIELDS) {
        if (d[f] !== undefined && d[f] !== null && String(d[f]) !== "") musical.set(f, String(d[f]));
      }
      if (Array.isArray(d.cast)) {
        for (const item of d.cast) {
          if (!item || !item.actor) continue;
          const actor = resolveActor(String(item.actor));
          const role = item.role ? String(item.role) : "";
          const dup = app.findRecordsByFilter("actor_roles", "actor = {:a} && musical = {:m} && role = {:r}", "", 1, 0, { a: actor.id, m: musical.id, r: role });
          if (!dup.length) createRecord("actor_roles", { actor: actor.id, musical: musical.id, role: role });
        }
      }
    }
    app.save(musical);
    notes.unshift("剧目「" + name + "」已更新");
  }
  function applyRelationUpdate() {
    const a = rec.getString("actor_a");
    const b = rec.getString("actor_b");
    const type = rec.getString("relation_type");
    if (!a || !b) throw new Error("缺少关系双方");
    if (a === b) throw new Error("关系双方不能是同一人");
    if (RELATION_TYPES.indexOf(type) < 0) throw new Error("未知关系类型: " + type);
    const actorA = resolveActor(a);
    const actorB = resolveActor(b);
    const dup = app.findRecordsByFilter(
      "relations",
      "((actor_a = {:a} && actor_b = {:b}) || (actor_a = {:b} && actor_b = {:a})) && relation_type = {:t}",
      "", 1, 0, { a: actorA.id, b: actorB.id, t: type }
    );
    if (dup.length) { notes.push("该关系已存在，跳过写入"); return; }
    createRecord("relations", {
      actor_a: actorA.id, actor_b: actorB.id, relation_type: type,
      description: rec.getString("description"), source: rec.getString("source_url"),
    });
    notes.unshift("关系「" + a + " ↔ " + b + "」已写入");
  }
  function applyMomentSubmission() {
    const a = rec.getString("actor_a");
    const title = rec.getString("title");
    const url = rec.getString("url");
    if (!a) throw new Error("缺少演员姓名");
    if (!title || !url) throw new Error("缺少标题或链接");
    const actor = resolveActor(a);
    const platform = rec.getString("platform") || "bilibili";
    const dup = app.findRecordsByFilter("moments", "actor = {:a} && url = {:u}", "", 1, 0, { a: actor.id, u: url });
    if (dup.length) { notes.push("该精彩片段已存在，跳过写入"); return; }
    createRecord("moments", {
      actor: actor.id, title: title, url: url, platform: platform,
      description: rec.getString("description"),
    });
    notes.unshift("精彩片段「" + title + "」已写入");
  }

  // ---- 转换执行 ----
  try {
    const t = rec.getString("submission_type");
    if (t === "actor_update") applyActorUpdate();
    else if (t === "musical_update") applyMusicalUpdate();
    else if (t === "relation_update") applyRelationUpdate();
    else if (t === "moment_submission") applyMomentSubmission();
    else throw new Error("未知提交类型: " + t);

    rec.set("applied", true);
    rec.set("reviewed_at", new Date().toISOString());
    rec.set("review_note", notes.length ? notes.join("；") : "已写入正式库");
  } catch (err) {
    rec.set("applied", true);
    rec.set("status", "rejected");
    rec.set("reviewed_at", new Date().toISOString());
    rec.set("review_note", "自动写入失败，已改回 rejected: " + (err && err.message ? err.message : String(err)));
  }
  return event.next();
}, "submissions");
