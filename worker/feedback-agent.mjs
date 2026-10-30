const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const AGENT_VERSION = "feedback-agent-v4-relation-corrections";
const DEFAULT_BATCH_LIMIT = 20;

const RECOMMENDATIONS = [
  "approve",
  "approve_after_edit",
  "needs_information",
  "manual_review",
  "reject",
];

const SUBMISSION_TYPES = [
  "actor_update",
  "musical_update",
  "relation_update",
  "moment_submission",
  "schedule_submission",
  "feedback",
];

const SENSITIVE_RELATIONS = new Set(["couple", "married", "ex"]);

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 180 },
    inferred_intent: { type: "string", maxLength: 140 },
    proposed_submission_type: { type: "string", enum: SUBMISSION_TYPES },
    proposed_changes: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          source_path: { type: "string" },
          target_field: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["source_path", "target_field", "value", "confidence", "reason"],
      },
    },
    recommendation: { type: "string", enum: RECOMMENDATIONS },
    confidence: { type: "number" },
    missing_information: { type: "array", maxItems: 8, items: { type: "string" } },
    risk_flags: { type: "array", maxItems: 8, items: { type: "string" } },
    reasoning: { type: "string", maxLength: 360 },
  },
  required: [
    "summary",
    "inferred_intent",
    "proposed_submission_type",
    "proposed_changes",
    "recommendation",
    "confidence",
    "missing_information",
    "risk_flags",
    "reasoning",
  ],
};

const PROJECT_CONTEXT = `
项目：MusicGraph，中国音乐剧演员关系图谱。用户共同补充演员档案、剧目、具体演出排期、精彩片段、团体和人物关系，管理员审核后入库。

领域词典：
- cp = 粉丝给两位演员组成的组合及组合名，不代表现实情侣，不属于敏感恋爱关系。
- couple = 现实情侣，married = 伴侣/婚姻，ex = 前任；这三类才属于敏感关系。
- co_work = 两位演员出现在同一场具体演出的卡司中。只说共同参演过某剧目或列出剧目名称，不能直接增加共演场次。
- classmate = 同学，roommate = 室友，friend = 好友，family = 亲人，teacher_student = 师生，same_company = 同公司。
- 新提交最多同时选择三种关系。
- 同一对人物可以同时有多种关系。新提交优先读取 relation_types 数组；relation_type 是为兼容旧提交保留的第一个关系类型。
- “上音”通常指上海音乐学院，“中戏”通常指中央戏剧学院；“上音15级”在同学关系提交中通常是关系说明，不能擅自只写入其中一人的档案。
- “尤瑞”“祥瑞”“文祥”等两人名字组合通常是 CP 名，不是某一位演员的昵称。
- 团体可表示班级、宿舍、届次或其他行业组合，成员关系与团体成员信息可以同时存在。

数据边界：
- submission 是用户这次真正提交的内容；database_context 只是用于查重和核对的已有数据库资料。
- 绝不能把只存在于 database_context 的学校、昵称等旧资料当成用户本次提交的新信息。
- details.fix 表示勘误：field 是要修正的字段，correct 是正确值。
- 关系勘误中，details.fix.previous_relation_types 是修改前网站显示的关系，relation_types 是用户认为正确的修改后关系；两者不能混淆。
- details.fix.current_cp_name 是修改前的 CP 名，details.relation_details.cp 是正确的 CP 名。
- 联系方式只用于管理员联系用户，不属于演员或剧目数据，也不会发送给你。
- 排期按日期、时间、城市、剧目、剧院识别同一场；完全相同应合并卡司，近似冲突应人工判断。
`;

const TYPE_GUIDANCE = {
  actor_update: "演员资料提交：actor_a 是目标演员；details 中的 nickname、birth_date、major、school、hometown、enrollment_year、height、note 才是候选更新字段。",
  musical_update: "剧目提交：musical_name 是目标剧目。新增剧目不要求填写演员关系；details 可包含 info、premiere_date、cast 或 fix。只有剧名和官方主页时，可理解为新增空剧目或补充来源，不要索要无关的 actor_b/relation_type。",
  relation_update: "人物关系提交：actor_a、actor_b、relation_types（修改后的正确关系，可多选）和 description/details.relation_details 是核心；勘误时 details.fix.previous_relation_types 表示修改前关系。旧提交可能只有 relation_type。每一种关系应独立入库。CP 名应写入 relation_details.cp 或关系 detail，不得写成演员 nickname。",
  moment_submission: "精彩片段提交：actor_a、title、url、platform 已足以表达意图；不要求 actor_b、relation_type 或 musical_name。视频 URL 本身就是来源。",
  schedule_submission: "排期提交：details 数组中的 date/time/city/musical/theatre/cast 是核心。只有同一场具体演出的共同卡司才影响共演边。",
  feedback: "产品意见反馈：description 是用户想对管理员说的话，不要求任何演员、剧目或关系字段；建议记录问题，不要虚构数据更新。",
};

const SYSTEM_PROMPT = `你是音乐剧演员资料网站的反馈审核助理。
你的工作是基于项目背景理解用户真实意图，把口语化内容或填错位置的信息整理成结构化建议。

${PROJECT_CONTEXT}

规则：
1. 只提取用户明确表达的信息，不得猜测或补写事实。
2. 原文写在备注里但实际属于学校、专业、生日等字段时，提出移动字段的建议。
3. source_path 必须指向 submission 中真实存在的位置，例如 details.note 或 description；禁止指向 database_context。
4. 数据库候选不唯一、资料互相冲突、缺少必要来源时，必须建议 manual_review 或 needs_information。
5. 情侣、伴侣、前任等敏感关系必须建议 manual_review。
6. recommendation=approve 仅用于格式正确、目标唯一、来源充分且没有冲突的低风险内容。
7. 排期完全重复时说明应合并缺失卡司；日期、时间、城市、剧目相同但剧院不同，视为疑似冲突。
8. 只有同一场具体演出的共同卡司才构成共演；仅补充剧目演员或好友等关系不能增加共演次数。
9. 不得要求与当前 submission_type 无关的字段。
10. 用简洁中文输出，不复述整份数据库上下文。
11. relation_types 中的多种关系可以同时成立，不得擅自只保留第一项；应逐项理解 relation_details 中对应的说明。
12. 关系勘误必须清楚区分 previous_relation_types（修改前）与 relation_types（修改后），并概括哪些关系被删除、保留或新增。

典型判断：
- relation_types=["classmate","friend","cp"]，relation_details.cp=“尤瑞”：表示同一对人物同时是同学、朋友和 CP，“尤瑞”只属于 CP 关系详情。
- 旧提交 relation_type=cp，description=“尤瑞”：这是两人的粉丝 CP 名，不是演员昵称，也不是现实情侣。
- relation_update，description=“上音15级”：优先理解为同学关系依据，不要擅自改某一人的 school。
- moment_submission 已有演员、标题、Bilibili 链接：按精彩片段审核，不要求关系类型。
- musical_update 只有剧名和官方微博：不要错误要求演员或人物关系；说明目前只能建立空剧目或等待更多剧目资料。
- actor_update 只有演员姓名、details 为空：这是空提交；不得从 database_context 复制旧资料冒充新增内容。`;

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function extractHttpUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/https?:\/\/[^\s】》)]+/i);
  return match ? match[0] : null;
}

function redactText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已隐藏邮箱]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[已隐藏手机号]")
    .replace(/((?:微信|wechat|vx|qq)\s*[:：]?\s*)[A-Za-z0-9_-]{5,}/gi, "$1[已隐藏账号]");
}

function safeSourceUrl(value) {
  if (!isHttpUrl(value)) return null;
  try {
    const url = new URL(value.trim());
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function scrubObject(value) {
  if (Array.isArray(value)) return value.map(scrubObject);
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/client|contact|email|phone|wechat|qq/i.test(key)) continue;
    result[key] = scrubObject(child);
  }
  return result;
}

export function sanitizeSubmission(submission) {
  const relationTypes = Array.isArray(submission.relation_types)
    ? Array.from(new Set(submission.relation_types.filter((value) => typeof value === "string" && value)))
    : [];
  const safe = {
    id: submission.id,
    submission_type: submission.submission_type,
    actor_a: submission.actor_a || null,
    actor_b: submission.actor_b || null,
    musical_name: submission.musical_name || null,
    relation_type: submission.relation_type || null,
    relation_types: relationTypes.length ? relationTypes : null,
    title: submission.title || null,
    url: extractHttpUrl(submission.url) || submission.url || null,
    platform: submission.platform || null,
    description: redactText(submission.description) || null,
    details: scrubObject(submission.details),
  };

  if (submission.submission_type === "feedback") {
    // 旧表单把联系方式暂存在 actor_a/source_url；不发送给模型。
    safe.actor_a = null;
  } else if (safeSourceUrl(submission.source_url)) {
    safe.source_url = safeSourceUrl(submission.source_url);
  }

  return safe;
}

function exactCandidates(context, side) {
  return Array.isArray(context?.[side]) ? context[side] : [];
}

export function applySafetyPolicy(review, submission, context) {
  const result = {
    ...review,
    risk_flags: Array.from(new Set(review.risk_flags || [])),
    missing_information: Array.from(new Set(review.missing_information || [])),
  };

  const forceManual = (flag) => {
    if (!result.risk_flags.includes(flag)) result.risk_flags.push(flag);
    result.recommendation = "manual_review";
  };

  const invalidContextChanges = result.proposed_changes.filter((change) =>
    /^database_context(?:\.|$)/.test(change.source_path));
  if (invalidContextChanges.length) {
    result.proposed_changes = result.proposed_changes.filter((change) =>
      !/^database_context(?:\.|$)/.test(change.source_path));
    forceManual("database_context_is_not_user_input");
  }

  const submittedRelationTypes = Array.isArray(submission.relation_types) && submission.relation_types.length
    ? submission.relation_types
    : [submission.relation_type].filter(Boolean);
  if (submittedRelationTypes.some((code) => SENSITIVE_RELATIONS.has(code))) {
    forceManual("sensitive_relationship");
  }

  if (submission.submission_type !== "feedback") {
    for (const side of ["actor_a", "actor_b"]) {
      if (!submission[side]) continue;
      const candidates = exactCandidates(context, side);
      if (candidates.length > 1) forceManual(`ambiguous_${side}`);
      if (candidates.length === 0) forceManual(`unmatched_${side}`);
    }
  }

  if (submission.musical_name) {
    const musicals = exactCandidates(context, "musicals");
    if (musicals.length > 1) forceManual("ambiguous_musical");
    if (musicals.length === 0) forceManual("unmatched_musical");
  }

  if (submission.submission_type === "schedule_submission") {
    const scheduleMatches = Array.isArray(context?.schedule_matches)
      ? context.schedule_matches
      : [];
    if (scheduleMatches.some((match) => match.match_type === "near")) {
      forceManual("possible_duplicate_schedule");
    }
    if (
      scheduleMatches.some((match) => match.match_type === "exact") &&
      !result.risk_flags.includes("existing_schedule_merge")
    ) {
      result.risk_flags.push("existing_schedule_merge");
    }
  }

  const needsSource = !["feedback", "schedule_submission"].includes(submission.submission_type);
  const hasSource = isHttpUrl(submission.source_url)
    || (submission.submission_type === "moment_submission" && Boolean(extractHttpUrl(submission.url)));
  if (needsSource && !hasSource) {
    if (!result.risk_flags.includes("missing_source")) result.risk_flags.push("missing_source");
    if (!result.missing_information.includes("可靠来源链接")) {
      result.missing_information.push("可靠来源链接");
    }
    if (result.recommendation === "approve") result.recommendation = "needs_information";
  }

  if (!RECOMMENDATIONS.includes(result.recommendation)) {
    result.recommendation = "manual_review";
    result.risk_flags.push("invalid_model_recommendation");
  }

  const confidence = Number(result.confidence);
  result.confidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0;
  return result;
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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(env, options.prefer),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new Error(`Supabase ${response.status}: ${message}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function findArtists(env, name) {
  if (!name) return [];
  const query = new URLSearchParams({
    select: "id,name,nickname,birth_date,major,school,hometown,enrollment_year,height,note",
    name: `eq.${name}`,
    limit: "10",
  });
  return (await supabaseRequest(env, `artists?${query}`)) || [];
}

async function findMusicals(env, name) {
  if (!name) return [];
  const query = new URLSearchParams({
    select: "id,name,info,premiere_date",
    name: `eq.${name}`,
    limit: "10",
  });
  return (await supabaseRequest(env, `musicals?${query}`)) || [];
}

async function findRelations(env, actorA, actorB) {
  if (!actorA || !actorB) return [];
  const query = new URLSearchParams({
    select: "id,actor_a,actor_b,type_id,detail,source_url,status,relation_types(code)",
    or: `(and(actor_a.eq.${actorA},actor_b.eq.${actorB}),and(actor_a.eq.${actorB},actor_b.eq.${actorA}))`,
    limit: "20",
  });
  return (await supabaseRequest(env, `relations?${query}`)) || [];
}

function submittedSchedules(submission) {
  return Array.isArray(submission.details)
    ? submission.details.filter((item) => item && typeof item === "object" && item.date)
    : [];
}

async function findScheduleMatches(env, submission) {
  const matches = [];
  for (const item of submittedSchedules(submission).slice(0, 20)) {
    const query = new URLSearchParams({
      select: "id,date,time,city,musical,theatre",
      date: `eq.${item.date || ""}`,
      time: `eq.${item.time || ""}`,
      city: `eq.${item.city || ""}`,
      musical: `eq.${item.musical || ""}`,
      limit: "20",
    });
    const existing = (await supabaseRequest(env, `shows?${query}`)) || [];
    for (const show of existing) {
      matches.push({
        submitted: {
          date: item.date || "",
          time: item.time || "",
          city: item.city || "",
          musical: item.musical || "",
          theatre: item.theatre || "",
        },
        existing: show,
        match_type: (show.theatre || "") === (item.theatre || "") ? "exact" : "near",
      });
    }
  }
  return matches;
}

async function loadContext(env, submission) {
  if (submission.submission_type === "feedback") {
    return { actor_a: [], actor_b: [], musicals: [], existing_relations: [], schedule_matches: [] };
  }
  const [actorA, actorB, musicals, scheduleMatches] = await Promise.all([
    findArtists(env, submission.actor_a),
    findArtists(env, submission.actor_b),
    findMusicals(env, submission.musical_name),
    submission.submission_type === "schedule_submission"
      ? findScheduleMatches(env, submission)
      : Promise.resolve([]),
  ]);
  const existingRelations =
    actorA.length === 1 && actorB.length === 1
      ? await findRelations(env, actorA[0].id, actorB[0].id)
      : [];
  return {
    actor_a: actorA,
    actor_b: actorB,
    musicals,
    existing_relations: existingRelations,
    schedule_matches: scheduleMatches,
  };
}

function parseAiResponse(response) {
  const value = response?.response ?? response;
  if (value && typeof value === "object") return value;
  if (typeof value === "string") return JSON.parse(value);
  throw new Error("Workers AI returned an empty response");
}

function validateReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new Error("Workers AI review is not an object");
  }
  for (const field of ["summary", "inferred_intent", "reasoning"]) {
    if (typeof review[field] !== "string" || !review[field].trim()) {
      throw new Error(`Workers AI review is missing ${field}`);
    }
  }
  if (!SUBMISSION_TYPES.includes(review.proposed_submission_type)) {
    throw new Error("Workers AI review has an invalid submission type");
  }
  for (const field of ["proposed_changes", "missing_information", "risk_flags"]) {
    if (!Array.isArray(review[field])) {
      throw new Error(`Workers AI review has an invalid ${field}`);
    }
  }
  for (const change of review.proposed_changes) {
    if (
      !change ||
      typeof change.source_path !== "string" ||
      typeof change.target_field !== "string" ||
      typeof change.value !== "string" ||
      typeof change.reason !== "string" ||
      !Number.isFinite(Number(change.confidence))
    ) {
      throw new Error("Workers AI review has an invalid proposed change");
    }
  }
  return review;
}

export function fallbackReview(submission, error) {
  const label = submission.submission_type || "unknown";
  return {
    summary: `模型未能生成合法结构化结果，请人工审核这条 ${label} 提交`,
    inferred_intent: "根据原始提交内容进行人工判断",
    proposed_submission_type: SUBMISSION_TYPES.includes(label) ? label : "feedback",
    proposed_changes: [],
    recommendation: "manual_review",
    confidence: 0,
    missing_information: [],
    risk_flags: ["model_output_invalid"],
    reasoning: `保底审核单：${String(error?.message || error).slice(0, 300)}`,
  };
}

async function analyzeSubmission(env, submission, context) {
  const safeSubmission = sanitizeSubmission(submission);
  const response = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          project_context_version: AGENT_VERSION,
          submission_type_guidance: TYPE_GUIDANCE[submission.submission_type] || "先判断真实提交类型",
          submission: safeSubmission,
          database_context: context,
        }),
      },
    ],
    response_format: { type: "json_schema", json_schema: REVIEW_SCHEMA },
    temperature: 0,
    max_tokens: 1200,
  });

  const review = validateReview(parseAiResponse(response));
  return applySafetyPolicy(review, submission, context);
}

async function claimSubmission(env, id) {
  const query = new URLSearchParams({
    id: `eq.${id}`,
    status: "eq.pending",
    agent_status: "eq.unprocessed",
  });
  const rows = await supabaseRequest(env, `submissions?${query}`, {
    method: "PATCH",
    body: JSON.stringify({
      agent_status: "processing",
      agent_processed_at: new Date().toISOString(),
      agent_error: null,
      conversation_review_state: "unreviewed",
      conversation_reviewed_at: null,
    }),
    prefer: "return=representation",
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function saveReview(env, id, analysis) {
  const query = new URLSearchParams({ id: `eq.${id}`, agent_status: "eq.processing" });
  await supabaseRequest(env, `submissions?${query}`, {
    method: "PATCH",
    body: JSON.stringify({
      agent_status: "ready",
      agent_analysis: {
        ...analysis,
        agent_version: AGENT_VERSION,
        model: MODEL,
        processed_at: new Date().toISOString(),
      },
      agent_processed_at: new Date().toISOString(),
      agent_error: null,
    }),
    prefer: "return=minimal",
  });
}

async function saveFailure(env, id, error) {
  const query = new URLSearchParams({ id: `eq.${id}`, agent_status: "eq.processing" });
  await supabaseRequest(env, `submissions?${query}`, {
    method: "PATCH",
    body: JSON.stringify({
      agent_status: "failed",
      agent_error: String(error?.message || error).slice(0, 500),
      agent_processed_at: new Date().toISOString(),
    }),
    prefer: "return=minimal",
  });
}

async function recoverStaleClaims(env) {
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const query = new URLSearchParams({
    status: "eq.pending",
    agent_status: "eq.processing",
    agent_processed_at: `lt.${staleBefore}`,
  });
  await supabaseRequest(env, `submissions?${query}`, {
    method: "PATCH",
    body: JSON.stringify({
      agent_status: "unprocessed",
      agent_error: "Recovered after an interrupted Agent run",
    }),
    prefer: "return=minimal",
  });
}

async function requeueOutdatedReviews(env) {
  const query = new URLSearchParams({
    status: "eq.pending",
    agent_status: "eq.ready",
    conversation_review_state: "eq.unreviewed",
    "agent_analysis->>agent_version": `neq.${AGENT_VERSION}`,
  });
  const rows = await supabaseRequest(env, `submissions?${query}`, {
    method: "PATCH",
    body: JSON.stringify({
      agent_status: "unprocessed",
      agent_error: null,
    }),
    prefer: "return=representation",
  });
  return Array.isArray(rows) ? rows.length : 0;
}

export async function processPendingSubmissions(env) {
  await recoverStaleClaims(env);
  const requeued = await requeueOutdatedReviews(env);
  const batchLimit = Math.max(1, Math.min(50, Number(env.AGENT_BATCH_LIMIT) || DEFAULT_BATCH_LIMIT));
  const query = new URLSearchParams({
    select: "id,submission_type,actor_a,actor_b,musical_name,relation_type,relation_types,title,url,platform,description,details,source_url,created_at,agent_status",
    status: "eq.pending",
    agent_status: "eq.unprocessed",
    order: "created_at.asc",
    limit: String(batchLimit),
  });
  const pending = (await supabaseRequest(env, `submissions?${query}`)) || [];
  const result = { found: pending.length, requeued, ready: 0, failed: 0, skipped: 0 };

  for (const item of pending) {
    const claimed = await claimSubmission(env, item.id);
    if (!claimed) {
      result.skipped += 1;
      continue;
    }
    let context;
    try {
      context = await loadContext(env, claimed);
    } catch (error) {
      await saveFailure(env, claimed.id, error);
      result.failed += 1;
      continue;
    }
    try {
      const analysis = await analyzeSubmission(env, claimed, context);
      await saveReview(env, claimed.id, analysis);
      result.ready += 1;
    } catch (error) {
      await saveReview(env, claimed.id, fallbackReview(claimed, error));
      result.ready += 1;
    }
  }

  return result;
}

export const __test = {
  parseAiResponse,
  validateReview,
  REVIEW_SCHEMA,
  PROJECT_CONTEXT,
  TYPE_GUIDANCE,
};
