import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePayload } from "../validation.mjs";
import { analysisSchema, GO_EMOTION_KEYS, STRATEGY_GROUP_KEYS } from "../schema.mjs";

test("sanitizes the browser payload and preserves customer roles", () => {
  const result = sanitizePayload({
    sessionId: "S00018",
    scene: { major: "补发换货", minor: "错发色号" },
    messages: [{ seq: 1, role: "customer", time: "2026-05-05", text: "换货" }],
    tickets: [],
  });
  assert.equal(result.sessionId, "S00018");
  assert.equal(result.messages[0].role, "customer");
});
test("rejects missing conversations and oversized inputs", () => {
  assert.throws(() => sanitizePayload({ sessionId: "S1", messages: [] }));
  assert.throws(() => sanitizePayload({ sessionId: "S1", messages: Array.from({ length: 81 }, () => ({ text: "x" })) }));
});

test("structured schema contains the full emotion taxonomy and strategy groups", () => {
  assert.equal(GO_EMOTION_KEYS.length, 28);
  assert.equal(new Set(GO_EMOTION_KEYS).size, 28);
  assert.equal(STRATEGY_GROUP_KEYS.length, 9);
  assert.equal(analysisSchema.additionalProperties, false);
});
