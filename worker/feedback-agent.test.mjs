import test from "node:test";
import assert from "node:assert/strict";
import { applySafetyPolicy, fallbackReview, sanitizeSubmission, __test } from "./feedback-agent.mjs";

function baseReview(overrides = {}) {
  return {
    summary: "补充演员资料",
    inferred_intent: "补充学校",
    proposed_submission_type: "actor_update",
    proposed_changes: [],
    recommendation: "approve",
    confidence: 0.9,
    missing_information: [],
    risk_flags: [],
    reasoning: "字段清楚",
    ...overrides,
  };
}

test("feedback contact details are never sent to the model", () => {
  const safe = sanitizeSubmission({
    id: 1,
    submission_type: "feedback",
    actor_a: "someone@example.com",
    source_url: "someone@example.com",
    description: "搜索框不好用，可以联系 13800000000 或 tester@example.com",
    client_id: "private-client-id",
    details: { contact: "13800000000", note: "保留这句" },
  });

  assert.equal(safe.actor_a, null);
  assert.equal(safe.source_url, undefined);
  assert.equal(safe.client_id, undefined);
  assert.deepEqual(safe.details, { note: "保留这句" });
  assert.equal(safe.description.includes("13800000000"), false);
  assert.equal(safe.description.includes("tester@example.com"), false);
});

test("wrapped Bilibili text is reduced to the actual source URL", () => {
  const safe = sanitizeSubmission({
    id: 2,
    submission_type: "moment_submission",
    actor_a: "徐均朔",
    title: "现场",
    url: "【视频标题】 https://b23.tv/abc123",
  });
  assert.equal(safe.url, "https://b23.tv/abc123");
});

test("feedback contact stored in actor_a is not treated as an actor", () => {
  const result = applySafetyPolicy(
    baseReview({ proposed_submission_type: "feedback", recommendation: "manual_review" }),
    { submission_type: "feedback", actor_a: "someone@example.com", source_url: "someone@example.com" },
    { actor_a: [] },
  );

  assert.equal(result.risk_flags.includes("unmatched_actor_a"), false);
});

test("a note can be proposed for a different structured field", () => {
  const review = baseReview({
    recommendation: "approve_after_edit",
    proposed_changes: [
      {
        source_path: "details.note",
        target_field: "school",
        value: "上海戏剧学院",
        confidence: 0.95,
        reason: "原文表达毕业院校",
      },
    ],
  });
  const result = applySafetyPolicy(
    review,
    { submission_type: "actor_update", actor_a: "测试演员", source_url: "https://example.com" },
    { actor_a: [{ id: 10, name: "测试演员" }] },
  );

  assert.equal(result.recommendation, "approve_after_edit");
  assert.equal(result.proposed_changes[0].target_field, "school");
});

test("same-name actors always require manual review", () => {
  const result = applySafetyPolicy(
    baseReview(),
    { submission_type: "actor_update", actor_a: "王婷", source_url: "https://example.com" },
    { actor_a: [{ id: 1, name: "王婷" }, { id: 2, name: "王婷" }] },
  );

  assert.equal(result.recommendation, "manual_review");
  assert.ok(result.risk_flags.includes("ambiguous_actor_a"));
});

test("sensitive relationships always require manual review", () => {
  const result = applySafetyPolicy(
    baseReview(),
    {
      submission_type: "relation_update",
      actor_a: "甲",
      actor_b: "乙",
      relation_type: "couple",
      source_url: "https://example.com",
    },
    { actor_a: [{ id: 1 }], actor_b: [{ id: 2 }] },
  );

  assert.equal(result.recommendation, "manual_review");
  assert.ok(result.risk_flags.includes("sensitive_relationship"));
});

test("fan CP is not treated as a real romantic relationship", () => {
  const result = applySafetyPolicy(
    baseReview({ proposed_submission_type: "relation_update" }),
    {
      submission_type: "relation_update",
      actor_a: "甲",
      actor_b: "乙",
      relation_type: "cp",
      source_url: "https://example.com",
    },
    { actor_a: [{ id: 1 }], actor_b: [{ id: 2 }] },
  );
  assert.equal(result.risk_flags.includes("sensitive_relationship"), false);
  assert.equal(result.recommendation, "approve");
});

test("multiple relationship types are preserved for model review", () => {
  const safe = sanitizeSubmission({
    id: 3,
    submission_type: "relation_update",
    actor_a: "甲",
    actor_b: "乙",
    relation_type: "classmate",
    relation_types: ["classmate", "friend", "cp", "cp"],
    details: { relation_details: { cp: "甲乙" } },
  });

  assert.deepEqual(safe.relation_types, ["classmate", "friend", "cp"]);
  assert.deepEqual(safe.details, { relation_details: { cp: "甲乙" } });
});

test("a sensitive type in a multi-relationship submission requires manual review", () => {
  const result = applySafetyPolicy(
    baseReview({ proposed_submission_type: "relation_update" }),
    {
      submission_type: "relation_update",
      actor_a: "甲",
      actor_b: "乙",
      relation_type: "classmate",
      relation_types: ["classmate", "couple"],
      source_url: "https://example.com",
    },
    { actor_a: [{ id: 1 }], actor_b: [{ id: 2 }] },
  );

  assert.equal(result.recommendation, "manual_review");
  assert.ok(result.risk_flags.includes("sensitive_relationship"));
});

test("missing source prevents automatic approval", () => {
  const result = applySafetyPolicy(
    baseReview(),
    { submission_type: "actor_update", actor_a: "甲", source_url: "feedback" },
    { actor_a: [{ id: 1 }] },
  );

  assert.equal(result.recommendation, "needs_information");
  assert.ok(result.risk_flags.includes("missing_source"));
});

test("a moment video URL counts as its source", () => {
  const result = applySafetyPolicy(
    baseReview({ proposed_submission_type: "moment_submission" }),
    {
      submission_type: "moment_submission",
      actor_a: "甲",
      url: "【现场】 https://b23.tv/abc123",
    },
    { actor_a: [{ id: 1 }] },
  );
  assert.equal(result.risk_flags.includes("missing_source"), false);
  assert.equal(result.recommendation, "approve");
});

test("database context cannot be proposed as new user input", () => {
  const result = applySafetyPolicy(
    baseReview({
      proposed_changes: [{
        source_path: "database_context.actor_a.school",
        target_field: "school",
        value: "中央戏剧学院",
        confidence: 0.9,
        reason: "数据库已有",
      }],
    }),
    { submission_type: "actor_update", actor_a: "甲", source_url: "https://example.com" },
    { actor_a: [{ id: 1, school: "中央戏剧学院" }] },
  );
  assert.equal(result.proposed_changes.length, 0);
  assert.equal(result.recommendation, "manual_review");
  assert.ok(result.risk_flags.includes("database_context_is_not_user_input"));
});

test("same-name musicals always require manual review", () => {
  const result = applySafetyPolicy(
    baseReview({ proposed_submission_type: "musical_update" }),
    { submission_type: "musical_update", musical_name: "同名剧目", source_url: "https://example.com" },
    { musicals: [{ id: 1 }, { id: 2 }] },
  );

  assert.equal(result.recommendation, "manual_review");
  assert.ok(result.risk_flags.includes("ambiguous_musical"));
});

test("Workers AI JSON responses are accepted as objects", () => {
  assert.deepEqual(__test.parseAiResponse({ response: { summary: "ok" } }), { summary: "ok" });
});

test("incomplete Workers AI output is rejected", () => {
  assert.throws(
    () => __test.validateReview({ summary: "只有摘要" }),
    /missing inferred_intent/,
  );
});

test("near-duplicate schedules always require manual review", () => {
  const submission = {
    submission_type: "schedule_submission",
    details: [{ date: "2020-01-01", time: "19:30", city: "上海", musical: "A", theatre: "剧院二" }],
  };
  const result = applySafetyPolicy(baseReview(), submission, {
    actor_a: [], actor_b: [], musicals: [],
    schedule_matches: [{ match_type: "near" }],
  });
  assert.equal(result.recommendation, "manual_review");
  assert.ok(result.risk_flags.includes("possible_duplicate_schedule"));
});

test("exact schedules are marked for cast merging", () => {
  const submission = { submission_type: "schedule_submission", details: [] };
  const result = applySafetyPolicy(baseReview(), submission, {
    actor_a: [], actor_b: [], musicals: [],
    schedule_matches: [{ match_type: "exact" }],
  });
  assert.ok(result.risk_flags.includes("existing_schedule_merge"));
});

test("malformed model output becomes a manual fallback review", () => {
  const review = fallbackReview(
    { submission_type: "actor_update" },
    new Error("Unterminated string in JSON"),
  );
  assert.equal(review.proposed_submission_type, "actor_update");
  assert.equal(review.recommendation, "manual_review");
  assert.ok(review.risk_flags.includes("model_output_invalid"));
});
