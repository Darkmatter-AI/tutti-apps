import assert from "node:assert/strict";
import { test } from "node:test";
import { verdictFrom } from "./review.mjs";

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

test("verdictFrom keeps three reasons at most", () => {
  const answer = JSON.stringify({ verdict: "doubt", reasons: ["a", "b", "c", "d"] });
  assert.equal(verdictFrom(answer).reasons.length, 3);
});
