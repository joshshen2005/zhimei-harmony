const test = require("node:test");
const assert = require("node:assert/strict");
const experience = require("../experience-core.js");

function summary(id, minor, request, risk = "中") {
  return {
    id, sceneMajor: "售后退货", sceneMinor: minor, riskLevel: risk, lastTime: "2026-05-01 10:00:00",
    analysis: {
      sessionId: id, sceneMajor: "售后退货", sceneMinor: minor, riskLevel: risk, request,
      preferences: ["处理方式：换货"], concerns: ["处理进度"], actions: ["核验订单后创建换货工单"],
      doNotCommit: ["未经核验的发货时间"], draft: "我先为您核验换货状态。", messages: [
        { 角色: "买家", message_text: request }, { 角色: "买家", message_text: "好的，谢谢" },
      ],
    },
  };
}

test("knowledge library structures historical sessions as published cases", () => {
  const library = experience.buildLibrary([summary("S1", "错发色号", "收到错误色号，希望换货")], []);
  assert.equal(library.length, 1);
  assert.equal(library[0].status, "已发布");
  assert.ok(library[0].actions.length);
  assert.ok(library[0].boundary.length);
  assert.ok(library[0].evidence.length);
});

test("retrieval ranks the same fine-grained scene above a broad-scene match", () => {
  const summaries = [
    summary("S1", "错发色号", "收到错误色号，希望换成正确色号", "高"),
    summary("S2", "七天无理由退货", "商品未拆封，希望退货", "高"),
  ];
  const current = { ...summaries[0].analysis, sessionId: "CURRENT" };
  const ranked = experience.retrieve(current, experience.buildLibrary(summaries, []));
  assert.equal(ranked[0].sourceSessionId, "S1");
  assert.ok(ranked[0].matchReasons.includes("同一细分场景"));
});

test("unreviewed candidates do not enter formal recommendations", () => {
  const current = summary("CURRENT", "错发色号", "色号错了要换货").analysis;
  const candidate = experience.createCandidate(current, "CURRENT");
  const library = experience.buildLibrary([], [candidate]);
  assert.equal(experience.retrieve(current, library).length, 0);
  candidate.status = "已审核";
  assert.equal(experience.retrieve(current, experience.buildLibrary([], [candidate])).length, 0, "current session itself is excluded");
});
