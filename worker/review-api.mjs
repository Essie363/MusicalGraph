import { fallbackReview, processPendingSubmissions, sanitizeSubmission } from "./feedback-agent.mjs";

const EDITABLE_FIELDS = new Set([
  "submission_type",
  "actor_a",
  "actor_b",
  "musical_name",
  "relation_type",
  "relation_types",
  "title",
  "url",
  "platform",
  "description",
  "details",
  "source_url",
]);
const DECISIONS = new Set(["approve", "reject", "defer"]);
const GROUP_TYPES = new Set(["dorm", "class", "group", "cohort", "other"]);
const GROUP_RELATIONS = new Map([
  ["classmate", "同学"],
  ["roommate", "室友"],
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const [left, right] = await Promise.all([digest(received), digest(expected)]);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return tokenMatches(token, env.FEEDBACK_REVIEW_TOKEN);
}

function supabaseHeaders(env, prefer) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function supabaseRequest(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: { ...supabaseHeaders(env, options.prefer), ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function safeReview(row) {
  return {
    id: row.id,
    revision: row.agent_processed_at,
    created_at: row.created_at,
    conversation_review_state: row.conversation_review_state,
    submission: sanitizeSubmission(row),
    analysis: row.agent_analysis,
  };
}

function validateDecision(body) {
  if (!body || !DECISIONS.has(body.decision)) return "decision 必须是 approve、reject 或 defer";
  if (typeof body.revision !== "string" || !body.revision) return "缺少审核版本 revision";
  if (body.note != null && typeof body.note !== "string") return "note 必须是文字";
  if (body.changes != null && (!body.changes || typeof body.changes !== "object" || Array.isArray(body.changes))) {
    return "changes 必须是对象";
  }
  for (const field of Object.keys(body.changes || {})) {
    if (!EDITABLE_FIELDS.has(field)) return `不允许修改字段 ${field}`;
  }
  if (body.decision !== "approve" && Object.keys(body.changes || {}).length) {
    return "只有批准时可以同时修正字段";
  }
  return null;
}

function validateGroup(body) {
  if (!body || typeof body.name !== "string" || !body.name.trim()) return "缺少团体名称";
  if (!GROUP_TYPES.has(body.type)) return "不支持的团体类型";
  if (!Array.isArray(body.members) || body.members.length < 2 || body.members.length > 20) {
    return "团体成员数量必须为 2 到 20 人";
  }
  if (new Set(body.members).size !== body.members.length || body.members.some((name) => typeof name !== "string" || !name.trim())) {
    return "成员姓名不能为空或重复";
  }
  if (!Array.isArray(body.relations) || body.relations.some((code) => !GROUP_RELATIONS.has(code))) {
    return "团体关系只支持 classmate 和 roommate";
  }
  return null;
}

function validateRelationCorrection(body) {
  if (!body || typeof body.actor_a !== "string" || !body.actor_a.trim()
      || typeof body.actor_b !== "string" || !body.actor_b.trim()) {
    return "缺少关系双方姓名";
  }
  if (body.actor_a.trim() === body.actor_b.trim()) return "关系双方不能是同一人";
  if (body.relation_type !== "cp") return "当前只支持修正 CP 名";
  if (typeof body.old_detail !== "string" || !body.old_detail.trim()) return "缺少原 CP 名";
  if (typeof body.new_detail !== "string" || !body.new_detail.trim()) return "缺少新 CP 名";
  if (body.old_detail.trim() === body.new_detail.trim()) return "新旧 CP 名不能相同";
  return null;
}

function validateSharedMusicals(body) {
  if (!body || !Array.isArray(body.actors) || body.actors.length !== 2) {
    return "共同作品补录必须包含两位演员";
  }
  if (new Set(body.actors).size !== 2
      || body.actors.some((name) => typeof name !== "string" || !name.trim())) {
    return "演员姓名不能为空或重复";
  }
  if (!Array.isArray(body.musicals) || body.musicals.length < 1 || body.musicals.length > 30) {
    return "共同作品数量必须为 1 到 30 部";
  }
  if (new Set(body.musicals).size !== body.musicals.length
      || body.musicals.some((name) => typeof name !== "string" || !name.trim())) {
    return "剧目名称不能为空或重复";
  }
  return null;
}

function validateRelationReassignment(body) {
  for (const field of ["old_actor", "other_actor", "new_actor", "detail"]) {
    if (typeof body?.[field] !== "string" || !body[field].trim()) return `缺少字段 ${field}`;
  }
  if (new Set([body.old_actor.trim(), body.other_actor.trim(), body.new_actor.trim()]).size !== 3) {
    return "旧演员、关系另一方和新演员必须是三个不同的人";
  }
  if (body.relation_type !== "cp") return "当前只支持修正 CP 关系演员";
  return null;
}

async function reassignRelationActor(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求内容必须是 JSON" }, 400);
  }
  const validationError = validateRelationReassignment(body);
  if (validationError) return json({ error: validationError }, 400);

  const names = [body.old_actor, body.other_actor, body.new_actor].map((name) => name.trim());
  const artists = [];
  for (const name of names) {
    const query = new URLSearchParams({ select: "id,name", name: `eq.${name}`, limit: "3" });
    const matches = (await supabaseRequest(env, `artists?${query}`)) || [];
    if (matches.length !== 1) {
      return json({ error: `演员“${name}”匹配到 ${matches.length} 条，已停止写入` }, 409);
    }
    artists.push(matches[0]);
  }

  const typeQuery = new URLSearchParams({
    select: "id,code", code: `eq.${body.relation_type}`, limit: "2",
  });
  const relationTypes = (await supabaseRequest(env, `relation_types?${typeQuery}`)) || [];
  if (relationTypes.length !== 1) return json({ error: "CP 关系类型不唯一" }, 409);
  const typeId = relationTypes[0].id;
  const oldIds = [artists[0].id, artists[1].id];
  const newIds = [artists[1].id, artists[2].id];
  const relationQuery = new URLSearchParams({
    select: "id,type_id,actor_a,actor_b,detail,status",
    type_id: `eq.${typeId}`,
    actor_a: `in.(${oldIds.join(",")})`,
    actor_b: `in.(${oldIds.join(",")})`,
    detail: `eq.${body.detail.trim()}`,
    status: "eq.approved",
  });
  const sourceRelations = ((await supabaseRequest(env, `relations?${relationQuery}`)) || [])
    .filter((item) => item.actor_a !== item.actor_b);
  if (sourceRelations.length !== 1) {
    return json({ error: `原 CP 关系匹配到 ${sourceRelations.length} 条，已停止写入` }, 409);
  }

  const duplicateQuery = new URLSearchParams({
    select: "id",
    type_id: `eq.${typeId}`,
    actor_a: `in.(${newIds.join(",")})`,
    actor_b: `in.(${newIds.join(",")})`,
    detail: `eq.${body.detail.trim()}`,
    status: "eq.approved",
  });
  const duplicates = ((await supabaseRequest(env, `relations?${duplicateQuery}`)) || [])
    .filter((item) => item.actor_a !== item.actor_b);
  if (duplicates.length) return json({ error: "新演员组合已存在同名 CP，已停止写入" }, 409);

  const actorA = Math.min(...newIds);
  const actorB = Math.max(...newIds);
  const patchQuery = new URLSearchParams({
    id: `eq.${sourceRelations[0].id}`,
    actor_a: `eq.${sourceRelations[0].actor_a}`,
    actor_b: `eq.${sourceRelations[0].actor_b}`,
    detail: `eq.${body.detail.trim()}`,
  });
  const updated = await supabaseRequest(env, `relations?${patchQuery}`, {
    method: "PATCH",
    body: JSON.stringify({ actor_a: actorA, actor_b: actorB }),
    prefer: "return=representation",
  });
  if (!Array.isArray(updated) || updated.length !== 1) {
    return json({ error: "关系内容已变化，请重新检查" }, 409);
  }
  return json({
    id: updated[0].id,
    old_actor: names[0],
    other_actor: names[1],
    new_actor: names[2],
    relation_type: body.relation_type,
    detail: updated[0].detail,
  });
}

async function curateSharedMusicals(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求内容必须是 JSON" }, 400);
  }
  const validationError = validateSharedMusicals(body);
  if (validationError) return json({ error: validationError }, 400);

  const actorNames = body.actors.map((name) => name.trim());
  const musicalNames = body.musicals.map((name) => name.trim());
  const artists = [];
  const musicalByName = new Map();
  const missingMusicalNames = [];
  for (const name of actorNames) {
    const query = new URLSearchParams({ select: "id,name", name: `eq.${name}`, limit: "3" });
    const matches = (await supabaseRequest(env, `artists?${query}`)) || [];
    if (matches.length !== 1) {
      return json({ error: `演员“${name}”匹配到 ${matches.length} 条，已停止写入` }, 409);
    }
    artists.push(matches[0]);
  }
  for (const name of musicalNames) {
    const query = new URLSearchParams({ select: "id,name", name: `eq.${name}`, limit: "3" });
    const matches = (await supabaseRequest(env, `musicals?${query}`)) || [];
    if (matches.length > 1) return json({ error: `剧目“${name}”存在重名，已停止写入` }, 409);
    if (matches.length === 1) musicalByName.set(name, matches[0]);
    else missingMusicalNames.push(name);
  }
  if (missingMusicalNames.length) {
    const created = await supabaseRequest(env, "musicals", {
      method: "POST",
      body: JSON.stringify(missingMusicalNames.map((name) => ({ name }))),
      prefer: "return=representation",
    });
    for (const musical of created || []) musicalByName.set(musical.name, musical);
  }
  const musicals = musicalNames.map((name) => musicalByName.get(name));
  if (musicals.some((musical) => !musical)) {
    return json({ error: "缺失剧目创建不完整，已停止关系写入" }, 409);
  }

  const artistIds = artists.map((artist) => artist.id);
  const musicalIds = musicals.map((musical) => musical.id);
  const query = new URLSearchParams({
    select: "artist_id,musical_id",
    artist_id: `in.(${artistIds.join(",")})`,
    musical_id: `in.(${musicalIds.join(",")})`,
  });
  const existing = (await supabaseRequest(env, `actor_roles?${query}`)) || [];
  const existingKeys = new Set(existing.map((item) => `${item.artist_id}:${item.musical_id}`));
  const additions = [];
  for (const artist of artists) {
    for (const musical of musicals) {
      const key = `${artist.id}:${musical.id}`;
      if (!existingKeys.has(key)) {
        additions.push({ artist_id: artist.id, musical_id: musical.id, role_id: null });
        existingKeys.add(key);
      }
    }
  }
  if (additions.length) {
    await supabaseRequest(env, "actor_roles", {
      method: "POST",
      body: JSON.stringify(additions),
      prefer: "return=minimal",
    });
  }
  return json({
    actors: artists,
    musicals,
    created_musicals: missingMusicalNames,
    added_actor_roles: additions.length,
  });
}

async function correctRelation(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求内容必须是 JSON" }, 400);
  }
  const validationError = validateRelationCorrection(body);
  if (validationError) return json({ error: validationError }, 400);

  const actorNames = [body.actor_a.trim(), body.actor_b.trim()];
  const artists = [];
  for (const name of actorNames) {
    const query = new URLSearchParams({ select: "id,name", name: `eq.${name}`, limit: "3" });
    const matches = (await supabaseRequest(env, `artists?${query}`)) || [];
    if (matches.length !== 1) {
      return json({ error: `演员“${name}”匹配到 ${matches.length} 条，已停止写入` }, 409);
    }
    artists.push(matches[0]);
  }

  const typeQuery = new URLSearchParams({
    select: "id,code", code: `eq.${body.relation_type}`, limit: "2",
  });
  const relationTypes = (await supabaseRequest(env, `relation_types?${typeQuery}`)) || [];
  if (relationTypes.length !== 1) return json({ error: "CP 关系类型不唯一" }, 409);

  const ids = artists.map((artist) => artist.id);
  const relationQuery = new URLSearchParams({
    select: "id,type_id,actor_a,actor_b,detail,status",
    type_id: `eq.${relationTypes[0].id}`,
    actor_a: `in.(${ids.join(",")})`,
    actor_b: `in.(${ids.join(",")})`,
    status: "eq.approved",
  });
  const relations = ((await supabaseRequest(env, `relations?${relationQuery}`)) || []).filter((item) =>
    item.actor_a !== item.actor_b && item.detail === body.old_detail.trim());
  if (relations.length !== 1) {
    return json({ error: `原 CP 关系匹配到 ${relations.length} 条，已停止写入` }, 409);
  }

  const patchQuery = new URLSearchParams({
    id: `eq.${relations[0].id}`,
    detail: `eq.${body.old_detail.trim()}`,
  });
  const updated = await supabaseRequest(env, `relations?${patchQuery}`, {
    method: "PATCH",
    body: JSON.stringify({ detail: body.new_detail.trim() }),
    prefer: "return=representation",
  });
  if (!Array.isArray(updated) || updated.length !== 1) {
    return json({ error: "关系内容已变化，请重新检查" }, 409);
  }
  return json({
    id: updated[0].id,
    actor_a: actorNames[0],
    actor_b: actorNames[1],
    relation_type: body.relation_type,
    old_detail: body.old_detail.trim(),
    new_detail: updated[0].detail,
  });
}

async function curateGroup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求内容必须是 JSON" }, 400);
  }
  const validationError = validateGroup(body);
  if (validationError) return json({ error: validationError }, 400);

  const names = body.members.map((name) => name.trim());
  const artists = [];
  for (const name of names) {
    const query = new URLSearchParams({ select: "id,name", name: `eq.${name}`, limit: "3" });
    const matches = (await supabaseRequest(env, `artists?${query}`)) || [];
    if (matches.length !== 1) {
      return json({ error: `演员“${name}”匹配到 ${matches.length} 条，已停止写入` }, 409);
    }
    artists.push(matches[0]);
  }

  const groupQuery = new URLSearchParams({ select: "id,name,type", name: `eq.${body.name.trim()}`, limit: "2" });
  let groups = (await supabaseRequest(env, `groups?${groupQuery}`)) || [];
  if (groups.length > 1) return json({ error: "存在重复团体名称，已停止写入" }, 409);
  if (groups.length === 1 && groups[0].type !== body.type) {
    return json({ error: `现有团体类型为 ${groups[0].type}，与提交的 ${body.type} 冲突` }, 409);
  }
  if (!groups.length) {
    groups = await supabaseRequest(env, "groups", {
      method: "POST", body: JSON.stringify({ name: body.name.trim(), type: body.type }),
      prefer: "return=representation",
    });
  }
  const group = groups[0];

  const memberQuery = new URLSearchParams({ select: "artist_id", group_id: `eq.${group.id}` });
  const currentMembers = (await supabaseRequest(env, `group_members?${memberQuery}`)) || [];
  const memberIds = new Set(currentMembers.map((item) => item.artist_id));
  const missingMembers = artists.filter((artist) => !memberIds.has(artist.id));
  if (missingMembers.length) {
    await supabaseRequest(env, "group_members", {
      method: "POST",
      body: JSON.stringify(missingMembers.map((artist) => ({ group_id: group.id, artist_id: artist.id }))),
      prefer: "return=minimal",
    });
  }

  const relationTypes = new Map();
  for (const code of body.relations) {
    const query = new URLSearchParams({ select: "id,code", code: `eq.${code}`, limit: "2" });
    let matches = (await supabaseRequest(env, `relation_types?${query}`)) || [];
    if (!matches.length) {
      matches = await supabaseRequest(env, "relation_types", {
        method: "POST",
        body: JSON.stringify({ code, name: GROUP_RELATIONS.get(code), is_builtin: false,
                              description: `${body.name.trim()}成员关系` }),
        prefer: "return=representation",
      });
    }
    if (matches.length !== 1) return json({ error: `关系类型 ${code} 不唯一` }, 409);
    relationTypes.set(code, matches[0].id);
  }

  const ids = artists.map((artist) => artist.id);
  const inList = `in.(${ids.join(",")})`;
  const relationQuery = new URLSearchParams({
    select: "id,type_id,actor_a,actor_b", actor_a: inList, actor_b: inList,
  });
  const existingRelations = (await supabaseRequest(env, `relations?${relationQuery}`)) || [];
  const existingKeys = new Set(existingRelations.map((item) =>
    `${item.type_id}:${Math.min(item.actor_a, item.actor_b)}:${Math.max(item.actor_a, item.actor_b)}`));
  const additions = [];
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      for (const code of body.relations) {
        const typeId = relationTypes.get(code);
        const actorA = Math.min(ids[left], ids[right]);
        const actorB = Math.max(ids[left], ids[right]);
        const key = `${typeId}:${actorA}:${actorB}`;
        if (!existingKeys.has(key)) {
          additions.push({ type_id: typeId, actor_a: actorA, actor_b: actorB,
                           detail: body.name.trim(), source_type: "user", status: "approved" });
          existingKeys.add(key);
        }
      }
    }
  }
  if (additions.length) {
    await supabaseRequest(env, "relations", {
      method: "POST", body: JSON.stringify(additions), prefer: "return=minimal",
    });
  }
  return json({ group, members: artists, added_members: missingMembers.length,
                added_relations: additions.length });
}

async function listReviews(request, env) {
  const url = new URL(request.url);
  const includeDeferred = url.searchParams.get("include_deferred") === "true";
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 20));
  const query = new URLSearchParams({
    select: "id,submission_type,actor_a,actor_b,musical_name,relation_type,relation_types,title,url,platform,description,details,source_url,created_at,agent_analysis,agent_processed_at,conversation_review_state",
    status: "eq.pending",
    agent_status: "eq.ready",
    order: "created_at.asc",
    limit: String(limit),
  });
  if (!includeDeferred) query.set("conversation_review_state", "eq.unreviewed");
  const rows = (await supabaseRequest(env, `submissions?${query}`)) || [];
  return json({ count: rows.length, reviews: rows.map(safeReview) });
}

async function listIssues(env) {
  const query = new URLSearchParams({
    select: "id,submission_type,actor_a,actor_b,musical_name,relation_type,relation_types,title,url,platform,description,details,source_url,created_at,agent_status,agent_error,agent_processed_at",
    status: "eq.pending",
    agent_status: "in.(failed,processing,unprocessed)",
    order: "created_at.asc",
    limit: "50",
  });
  const rows = (await supabaseRequest(env, `submissions?${query}`)) || [];
  return json({
    count: rows.length,
    issues: rows.map((row) => ({
      id: row.id,
      agent_status: row.agent_status,
      agent_error: row.agent_error,
      agent_processed_at: row.agent_processed_at,
      created_at: row.created_at,
      submission: sanitizeSubmission(row),
    })),
  });
}

async function retryFailed(env) {
  const query = new URLSearchParams({ status: "eq.pending", agent_status: "eq.failed" });
  const reset = await supabaseRequest(env, `submissions?${query}`, {
    method: "PATCH",
    body: JSON.stringify({ agent_status: "unprocessed", agent_error: null }),
    prefer: "return=representation",
  });
  const processing = await processPendingSubmissions(env);
  return json({ reset: Array.isArray(reset) ? reset.map((row) => row.id) : [], processing });
}

async function recoverStuckReview(env, id) {
  const query = new URLSearchParams({
    select: "id,submission_type,agent_processed_at",
    id: `eq.${id}`,
    status: "eq.pending",
    agent_status: "eq.processing",
    limit: "1",
  });
  const rows = (await supabaseRequest(env, `submissions?${query}`)) || [];
  if (rows.length !== 1) return json({ error: "没有找到处于 processing 的待审反馈" }, 409);
  const processedAt = new Date(rows[0].agent_processed_at).getTime();
  if (!Number.isFinite(processedAt) || Date.now() - processedAt < 5 * 60 * 1000) {
    return json({ error: "任务尚未停滞满 5 分钟，暂不回收" }, 409);
  }
  const now = new Date().toISOString();
  const patchQuery = new URLSearchParams({
    id: `eq.${id}`, status: "eq.pending", agent_status: "eq.processing",
    agent_processed_at: `eq.${rows[0].agent_processed_at}`,
  });
  const recovered = await supabaseRequest(env, `submissions?${patchQuery}`, {
    method: "PATCH",
    body: JSON.stringify({
      agent_status: "ready",
      agent_analysis: {
        ...fallbackReview(rows[0], new Error("Recovered from a stale processing lock")),
        agent_version: "feedback-agent-v1",
        processed_at: now,
      },
      agent_processed_at: now,
      agent_error: null,
      conversation_review_state: "unreviewed",
      conversation_reviewed_at: null,
    }),
    prefer: "return=representation",
  });
  if (!Array.isArray(recovered) || recovered.length !== 1) {
    return json({ error: "反馈状态已变化，请重新检查" }, 409);
  }
  return json({ id: recovered[0].id, agent_status: recovered[0].agent_status });
}

async function decideReview(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求内容必须是 JSON" }, 400);
  }
  const validationError = validateDecision(body);
  if (validationError) return json({ error: validationError }, 400);

  const patch = {
    review_note: (body.note || `通过 Codex 对话执行 ${body.decision}`).slice(0, 1000),
    conversation_reviewed_at: new Date().toISOString(),
  };
  if (body.decision === "approve") {
    Object.assign(patch, body.changes || {}, { status: "approved" });
  } else if (body.decision === "reject") {
    patch.status = "rejected";
  } else {
    patch.conversation_review_state = "deferred";
  }

  const query = new URLSearchParams({
    id: `eq.${id}`,
    status: "eq.pending",
    agent_status: "eq.ready",
    agent_processed_at: `eq.${body.revision}`,
  });
  const rows = await supabaseRequest(env, `submissions?${query}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    prefer: "return=representation",
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    return json({ error: "反馈状态或版本已变化，请重新读取后再审核" }, 409);
  }
  const row = rows[0];
  return json({ id: row.id, status: row.status, applied: row.applied,
                review_note: row.review_note, decision: body.decision });
}

export async function handleReviewApi(request, env) {
  if (!(await authorized(request, env))) return json({ error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/admin/feedback-reviews") {
    return listReviews(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/feedback-reviews/issues") {
    return listIssues(env);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/feedback-reviews/run") {
    const processing = await processPendingSubmissions(env);
    return json({ processing });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/feedback-reviews/retry-failed") {
    return retryFailed(env);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/feedback-reviews/curate-group") {
    return curateGroup(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/feedback-reviews/correct-relation") {
    return correctRelation(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/feedback-reviews/curate-shared-musicals") {
    return curateSharedMusicals(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/feedback-reviews/reassign-relation-actor") {
    return reassignRelationActor(request, env);
  }
  const recoverMatch = url.pathname.match(/^\/api\/admin\/feedback-reviews\/(\d+)\/recover$/);
  if (request.method === "POST" && recoverMatch) return recoverStuckReview(env, recoverMatch[1]);
  const match = url.pathname.match(/^\/api\/admin\/feedback-reviews\/(\d+)\/decision$/);
  if (request.method === "POST" && match) return decideReview(request, env, match[1]);
  return json({ error: "Not found" }, 404);
}

export const __test = {
  validateDecision, validateGroup, validateRelationCorrection, validateRelationReassignment,
  validateSharedMusicals, safeReview,
};
