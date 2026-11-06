import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReview, verdictFrom } from "./review.mjs";

test("verdictFrom reads a pass and a doubt", () => {
  assert.deepEqual(verdictFrom('{"verdict":"pass","reasons":["It is on their main domain."]}'), {
    readable: true,
    verdict: "pass",
    reasons: ["It is on their main domain."],
  });
  assert.equal(verdictFrom('Here you go: {"verdict":"doubt","reasons":["No docs."]}').verdict, "doubt");
});

test("verdictFrom says when it decided nothing", () => {
  const cutOff = '{"verdict":"pass","reasons":["The answer stopped he';
  for (const answer of [cutOff, "", "No opinion.", '{"verdict":"maybe","reasons":[]}', '{"verdict":"pass"}']) {
    const result = verdictFrom(answer);
    assert.equal(result.readable, false);
    assert.equal(result.verdict, "doubt");
  }
});

test("verdictFrom keeps a doubt however badly it was written", () => {
  for (const answer of [
    '{"verdict":"doubt"}',
    '{"verdict":"doubt","reasons":"Not their domain."}',
    '{"verdict":"doubt","reasons":["The domain looks wro',
  ]) {
    const result = verdictFrom(answer);
    assert.equal(result.readable, true);
    assert.equal(result.verdict, "doubt");
    assert.ok(result.reasons.length > 0);
  }
});

const applied = { date: "2026-11-06", server: "https://x.test/mcp", model: "m" };
const unreadable = { readable: false, verdict: "doubt", reasons: ["No."] };

test("applyReview gives an unreadable answer three nights, then counts it as a doubt", () => {
  const proof = {};
  applyReview(proof, unreadable, applied);
  applyReview(proof, unreadable, applied);
  assert.equal(proof.review, undefined);
  assert.equal(proof.unreadableReviews, 2);
  applyReview(proof, unreadable, applied);
  assert.equal(proof.review.verdict, "doubt");
  assert.equal(proof.review.server, applied.server);
  assert.equal(proof.unreadableReviews, undefined);
});

test("applyReview forgets the failed tries once it can read one", () => {
  const proof = { unreadableReviews: 2 };
  applyReview(proof, { readable: true, verdict: "pass", reasons: ["Fine."] }, applied);
  assert.equal(proof.review.verdict, "pass");
  assert.equal(proof.unreadableReviews, undefined);
});

test("verdictFrom keeps three reasons at most", () => {
  const answer = JSON.stringify({ verdict: "doubt", reasons: ["a", "b", "c", "d"] });
  assert.equal(verdictFrom(answer).reasons.length, 3);
});
