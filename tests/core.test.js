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
  }
});
