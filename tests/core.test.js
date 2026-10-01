const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const core = require("../core.js");

function loadData() {
  const source = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.ZHIMEI_DATA;
}

const data = loadData();
const index = core.buildIndex(data);

test("S00018 detects the shade record conflict without claiming real-world mis-shipment", () => {
  const result = core.analyzeSession("S00018", index);
  assert.ok(result.conflicts.some((item) => item.title.includes("换货目标")));
  assert.ok(result.conflicts.some((item) => item.detail.includes("不能认定已经再次错发")));
  assert.equal(result.riskLevel, "高");
  assert.ok(result.request.includes("消费者反馈"));
  assert.ok(result.request.includes("更换为 #05枫叶红"));
  assert.ok(!result.request.includes("枫叶红不适合"));
  assert.notEqual(result.request, result.messages.filter((item) => item["角色"] === "买家").at(-1)["message_text"]);
});

test("S00072 detects consumer payment feedback versus ticket status", () => {
  const result = core.analyzeSession("S00072", index);
  assert.ok(result.conflicts.some((item) => item.title.includes("到账反馈")));
  assert.ok(result.doNotCommit.some((item) => item.includes("到账")));
});

test("S00012 identifies the unanswered coupon question", () => {
  const result = core.analyzeSession("S00012", index);
  assert.ok(result.unanswered.some((item) => item.includes("优惠券")));
  assert.ok(result.actions.some((item) => item.includes("优惠券")));
});

test("all source sessions can be analysed without throwing", () => {
  for (const sessionId of index.sessions.keys()) {
    const result = core.analyzeSession(sessionId, index);
    assert.equal(result.sessionId, sessionId);
    assert.ok(result.messages.length > 0);
    assert.ok(result.actions.length > 0);
    assert.equal(result.emotion.allLabels.length, 28);
    assert.ok(result.emotion.confidence >= 0 && result.emotion.confidence <= 100);
    assert.ok(result.emotion.vad.valence >= 1 && result.emotion.vad.valence <= 5);
    assert.ok(result.emotion.vad.arousal >= 1 && result.emotion.vad.arousal <= 5);
    assert.ok(result.emotion.vad.dominance >= 1 && result.emotion.vad.dominance <= 5);
    assert.equal(result.emotion.trajectory.length, result.messages.filter((item) => item["角色"] === "买家").length);
    assert.ok(result.risk.score >= 0 && result.risk.score <= 100);
  }
});

test("the 28 fine-grained labels map to exactly one operational group", () => {
  const counts = new Map(core.GO_EMOTIONS.map((item) => [item.key, 0]));
  core.EMOTION_GROUPS.forEach((group) => group.labels.forEach((label) => counts.set(label, (counts.get(label) || 0) + 1)));
  assert.deepEqual([...counts.values()], Array(28).fill(1));
});
