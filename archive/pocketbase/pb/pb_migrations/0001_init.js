// CAST LIGHT — PocketBase 初始建表迁移（v0.39：Collection.fields 直接传字段数组）
// 集合命名沿用现有 SQLite 语义：actors / musicals(剧目) / actor_roles / relations / moments / submissions
// legacy_id：来自 music_graph.db 的原始整数 id，用于幂等导入（actors 表存在 52 组重名，故 name 不做唯一约束）
// 访问规则：正式数据公开读、仅管理员写；submissions 公开创建、仅管理员可读/改

migrate((app) => {
  // ---------- 1. actors 演员 ----------
  const actors = new Collection({
    type: "base",
    name: "actors",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "legacy_id", type: "number" },
      { name: "nickname", type: "text" },
      { name: "birth_date", type: "text" },
      { name: "major", type: "text" },
      { name: "school", type: "text" },
      { name: "hometown", type: "text" },
      { name: "enrollment_year", type: "text" },
      { name: "height", type: "text" },
      { name: "note", type: "text" },
      { name: "role", type: "text" },
      { name: "is_actor", type: "bool" },
    ],
    indexes: [
      "CREATE INDEX idx_actors_legacy ON actors (legacy_id)",
      "CREATE INDEX idx_actors_name ON actors (name)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(actors);

  // ---------- 2. musicals 剧目 ----------
  const musicals = new Collection({
    type: "base",
    name: "musicals",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "legacy_id", type: "number" },
      { name: "year", type: "text" },
      { name: "description", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_musicals_legacy ON musicals (legacy_id)",
      "CREATE INDEX idx_musicals_name ON musicals (name)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(musicals);

  // ---------- 3. actor_roles 演员-剧目-角色 ----------
  const actorRoles = new Collection({
    type: "base",
    name: "actor_roles",
    fields: [
      { name: "actor", type: "relation", collectionId: actors.id, maxSelect: 1, cascadeDelete: true },
      { name: "musical", type: "relation", collectionId: musicals.id, maxSelect: 1, cascadeDelete: true },
      { name: "role", type: "text" },
      { name: "year", type: "text" },
    ],
    indexes: ["CREATE INDEX idx_ar_actor_musical ON actor_roles (actor, musical)"],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(actorRoles);

  // ---------- 4. relations 演员关系 ----------
  const relations = new Collection({
    type: "base",
    name: "relations",
    fields: [
      { name: "actor_a", type: "relation", collectionId: actors.id, maxSelect: 1, cascadeDelete: true },
      { name: "actor_b", type: "relation", collectionId: actors.id, maxSelect: 1, cascadeDelete: true },
      { name: "relation_type", type: "select", values: ["co_work", "classmate", "friend", "couple", "teacher_student", "same_company", "cp", "married", "ex"], maxSelect: 1, required: true },
      { name: "description", type: "text" },
      { name: "source", type: "text" },
      { name: "legacy_id", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_relations_legacy ON relations (legacy_id)",
      "CREATE INDEX idx_relations_pair ON relations (actor_a, actor_b)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(relations);

  // ---------- 5. moments 精彩片段 ----------
  const moments = new Collection({
    type: "base",
    name: "moments",
    fields: [
      { name: "actor", type: "relation", collectionId: actors.id, maxSelect: 1, cascadeDelete: true },
      { name: "title", type: "text", required: true },
      { name: "url", type: "text", required: true },
      { name: "platform", type: "select", values: ["bilibili", "netease", "youtube", "xiaohongshu"], maxSelect: 1 },
      { name: "description", type: "text" },
      { name: "legacy_id", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_moments_legacy ON moments (legacy_id)",
      "CREATE INDEX idx_moments_actor ON moments (actor)",
    ],
    listRule: "",
    viewRule: "",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(moments);

  // ---------- 6. submissions 用户提交（结构化字段，按类型分列） ----------
  const submissions = new Collection({
    type: "base",
    name: "submissions",
    fields: [
      { name: "submission_type", type: "select", values: ["actor_update", "musical_update", "relation_update", "moment_submission"], maxSelect: 1, required: true },
      { name: "actor_a", type: "text" },
      { name: "actor_b", type: "text" },
      { name: "musical_name", type: "text" },
      { name: "relation_type", type: "select", values: ["co_work", "classmate", "teacher_student", "same_company"], maxSelect: 1 },
      { name: "title", type: "text" },
      { name: "url", type: "text" },
      { name: "platform", type: "select", values: ["bilibili", "netease", "youtube"], maxSelect: 1 },
      { name: "description", type: "text" },
      { name: "details", type: "text" },
      { name: "source_url", type: "text", required: true },
      { name: "status", type: "select", values: ["pending", "approved", "rejected"], maxSelect: 1, required: true },
      { name: "reviewed_at", type: "date" },
      { name: "review_note", type: "text" },
      { name: "applied", type: "bool" },
    ],
    indexes: ["CREATE INDEX idx_submissions_status ON submissions (status)"],
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "",
    updateRule: null,
    deleteRule: null,
  });
  app.save(submissions);
}, (app) => {
  // 回滚（按依赖倒序删除）
  const names = ["submissions", "moments", "relations", "actor_roles", "musicals", "actors"];
  for (const n of names) {
    const c = app.findCollectionByNameOrId(n);
    if (c) app.delete(c);
  }
});
