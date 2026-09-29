import test from "node:test";
import assert from "node:assert/strict";
import { buildStructuredFormat, resolveProvider } from "../provider.mjs";

test("defaults to DeepSeek and its official Responses API base URL", () => {
  const provider = resolveProvider({});
  assert.equal(provider.provider, "deepseek");
  assert.equal(provider.model, "deepseek-flash");
  assert.equal(provider.baseURL, "https://api.deepseek.com");
  assert.equal(provider.keyName, "DEEPSEEK_API_KEY");
});

test("keeps OpenAI as an optional provider", () => {
  const provider = resolveProvider({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" });
  assert.equal(provider.provider, "openai");
  assert.equal(provider.model, "gpt-6-luna");
  assert.equal(provider.apiKey, "test-key");
});

test("uses provider-compatible JSON schema options", () => {
  const schema = { type: "object" };
  assert.equal("strict" in buildStructuredFormat(resolveProvider({}), schema), false);
  assert.equal(buildStructuredFormat(resolveProvider({ AI_PROVIDER: "openai" }), schema).strict, true);
});

test("rejects unsupported providers", () => {
  assert.throws(() => resolveProvider({ AI_PROVIDER: "unknown" }), /deepseek/);
});
