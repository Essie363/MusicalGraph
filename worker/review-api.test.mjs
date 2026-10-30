import test from "node:test";
import assert from "node:assert/strict";
import { handleReviewApi, __test } from "./review-api.mjs";

test("decision validation only permits review fields", () => {
  assert.match(
    __test.validateDecision({ decision: "approve", revision: "v1", changes: { status: "approved" } }),
    /不允许修改字段/,
  );
  assert.equal(
    __test.validateDecision({ decision: "approve", revision: "v1", changes: { actor_a: "甲" } }),
    null,
  );
  assert.equal(
    __test.validateDecision({ decision: "approve", revision: "v1", changes: { relation_types: ["classmate", "friend"] } }),
    null,
  );
});

test("review summaries redact feedback contact details", () => {
  const safe = __test.safeReview({
    id: 7,
    submission_type: "feedback",
    actor_a: "someone@example.com",
    source_url: "someone@example.com",
    description: "请联系 13800000000",
    details: { contact: "wx123456", note: "搜索有问题" },
    agent_processed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    conversation_review_state: "unreviewed",
    agent_analysis: { summary: "搜索反馈" },
  });
  assert.equal(safe.submission.actor_a, null);
  assert.equal(JSON.stringify(safe).includes("13800000000"), false);
  assert.equal(JSON.stringify(safe).includes("someone@example.com"), false);
});

test("review API rejects requests without the review token", async () => {
  const response = await handleReviewApi(
    new Request("https://example.com/api/admin/feedback-reviews"),
    { FEEDBACK_REVIEW_TOKEN: "correct" },
  );
  assert.equal(response.status, 401);
});

test("issues endpoint returns sanitized failed submissions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: 9,
    submission_type: "feedback",
    actor_a: "private@example.com",
    description: "联系 13800000000",
    agent_status: "failed",
    agent_error: "model output invalid",
  }]), { status: 200 });
  try {
    const response = await handleReviewApi(
      new Request("https://example.com/api/admin/feedback-reviews/issues", {
        headers: { Authorization: "Bearer correct" },
      }),
      { FEEDBACK_REVIEW_TOKEN: "correct", SUPABASE_URL: "https://db.example.com",
        SUPABASE_SERVICE_KEY: "secret" },
    );
    const body = await response.json();
    assert.equal(body.count, 1);
    assert.equal(body.issues[0].submission.actor_a, null);
    assert.equal(JSON.stringify(body).includes("13800000000"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("group curation requires unique members and known relation codes", () => {
  assert.match(__test.validateGroup({
    name: "B532", type: "dorm", members: ["甲", "甲"], relations: ["roommate"],
  }), /重复/);
  assert.match(__test.validateGroup({
    name: "B532", type: "dorm", members: ["甲", "乙"], relations: ["friend"],
  }), /只支持/);
  assert.equal(__test.validateGroup({
    name: "B532", type: "dorm", members: ["甲", "乙"], relations: ["classmate", "roommate"],
  }), null);
});

test("relation correction is narrowly limited to changing an existing CP name", () => {
  assert.equal(__test.validateRelationCorrection({
    actor_a: "冒海飞", actor_b: "于晓璘", relation_type: "cp",
    old_detail: "冒村", new_detail: "冒树",
  }), null);
  assert.match(__test.validateRelationCorrection({
    actor_a: "冒海飞", actor_b: "于晓璘", relation_type: "couple",
    old_detail: "冒村", new_detail: "冒树",
  }), /只支持修正 CP 名/);
  assert.match(__test.validateRelationCorrection({
    actor_a: "冒海飞", actor_b: "冒海飞", relation_type: "cp",
    old_detail: "冒村", new_detail: "冒树",
  }), /不能是同一人/);
});

test("shared musical curation requires exactly two actors and unique musicals", () => {
  assert.equal(__test.validateSharedMusicals({
    actors: ["张泽", "叶麒圣"], musicals: ["摇滚浮士德", "阿波罗尼亚"],
  }), null);
  assert.match(__test.validateSharedMusicals({
    actors: ["张泽"], musicals: ["摇滚浮士德"],
  }), /两位演员/);
  assert.match(__test.validateSharedMusicals({
    actors: ["张泽", "叶麒圣"], musicals: ["摇滚浮士德", "摇滚浮士德"],
  }), /重复/);
});

test("relation actor reassignment requires three distinct people and a CP relation", () => {
  assert.equal(__test.validateRelationReassignment({
    old_actor: "钟嘉诚", other_actor: "郭嘉轩", new_actor: "钟舜傲",
    relation_type: "cp", detail: "钟花",
  }), null);
  assert.match(__test.validateRelationReassignment({
    old_actor: "钟嘉诚", other_actor: "郭嘉轩", new_actor: "钟嘉诚",
    relation_type: "cp", detail: "钟花",
  }), /三个不同的人/);
  assert.match(__test.validateRelationReassignment({
    old_actor: "钟嘉诚", other_actor: "郭嘉轩", new_actor: "钟舜傲",
    relation_type: "couple", detail: "钟花",
  }), /只支持修正 CP/);
});
