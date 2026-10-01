(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZhimeiExperience = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const safe = (value) => String(value == null ? "" : value).trim();
  const unique = (items) => [...new Set((items || []).filter(Boolean))];
  const splitText = (value) => Array.isArray(value) ? value.filter(Boolean) : safe(value).split(/[；;\n]/).map((item) => item.trim()).filter(Boolean);

  function tokens(value) {
    const text = safe(value).toLowerCase().replace(/\s+/g, "");
    const result = new Set((text.match(/[a-z0-9#]+/g) || []));
    const chinese = (text.match(/[\u3400-\u9fff]+/g) || []).join("");
    for (let i = 0; i < chinese.length; i += 1) {
      result.add(chinese[i]);
      if (i < chinese.length - 1) result.add(chinese.slice(i, i + 2));
    }
    return result;
  }

  function overlapScore(left, right) {
    const a = tokens(left);
    const b = tokens(right);
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    a.forEach((token) => { if (b.has(token)) intersection += 1; });
    return intersection / Math.max(a.size, b.size);
  }

  function latestBuyerMessage(messages) {
    return [...(messages || [])].reverse().find((message) => message["角色"] === "买家") || {};
  }

  function outcomeFrom(messages) {
    const latest = safe(latestBuyerMessage(messages)["message_text"]);
    if (/到账|收到|解决|可以了|太好了|谢谢|感谢|操作挺方便|换！|换!/.test(latest)) {
      return { label: "客户已反馈进展", signal: latest, confidence: "中" };
    }
    if (/投诉|骗人|不接受|没解决|还没|等着瞧|掉链子/.test(latest)) {
      return { label: "仍需继续处理", signal: latest, confidence: "中" };
    }
    return { label: "结果待核验", signal: latest || "未记录客户结果反馈", confidence: "低" };
  }

  function evidenceFrom(messages) {
    const buyer = (messages || []).filter((message) => message["角色"] === "买家");
    const first = buyer[0];
    const latest = buyer[buyer.length - 1];
    return unique([first && first["message_text"], latest && latest["message_text"]]).map((text, index) => ({
      label: index === 0 ? "问题原话" : "结果反馈",
      text: safe(text),
    }));
  }

  function caseFromSummary(summary) {
    const a = summary.analysis || {};
    const outcome = outcomeFrom(a.messages);
    return {
      id: `KB-${summary.id}`,
      sourceSessionId: summary.id,
      sourceType: "历史会话",
      title: `${summary.sceneMinor || summary.sceneMajor || "客服事项"}处理经验`,
      status: "已发布",
      sceneMajor: summary.sceneMajor || a.sceneMajor || "其他服务",
      sceneMinor: summary.sceneMinor || a.sceneMinor || "未分类",
      riskLevel: a.riskLevel || summary.riskLevel || "低",
      request: safe(a.request || summary.lastText),
      conditions: unique([...(a.preferences || []), a.order && a.order["订单状态"] ? `订单状态：${a.order["订单状态"]}` : ""]),
      actions: unique(a.actions || []),
      boundary: unique(a.doNotCommit || []),
      replyTemplate: safe(a.draft),
      outcome: outcome.label,
      outcomeEvidence: outcome.signal,
      outcomeConfidence: outcome.confidence,
      evidence: evidenceFrom(a.messages),
      tags: unique([summary.sceneMajor, summary.sceneMinor, a.riskLevel, ...(a.preferences || []).slice(0, 2)]),
      ruleVersion: "演示规则 2026.05",
      validUntil: "2027-05-31",
      reviewedBy: "赛事演示数据校验",
      qualityScore: Math.min(96, 58 + Math.min((a.actions || []).length, 4) * 6 + Math.min((a.doNotCommit || []).length, 3) * 5 + (outcome.confidence === "中" ? 8 : 0)),
      createdAt: summary.lastTime || "",
      usageCount: 0,
      mock: true,
    };
  }

  function caseFromCustom(item) {
    const status = item.status === "已审核" || item.status === "已发布" ? "已发布" : item.status === "停止推荐" || item.status === "已失效" ? "已失效" : "待审核";
    return {
      id: item.id,
      sourceSessionId: item.sessionId || item.sourceSessionId || "",
      sourceType: "人工沉淀",
      title: item.title || "候选处理经验",
      status,
      sceneMajor: item.sceneMajor || "人工沉淀",
      sceneMinor: item.sceneMinor || "待分类",
      riskLevel: item.riskLevel || "中",
      request: item.request || "待补充核心诉求",
      conditions: splitText(item.conditions),
      actions: splitText(item.actions || item.lesson),
      boundary: splitText(item.boundary),
      replyTemplate: item.replyTemplate || "",
      outcome: item.outcome || "结果待核验",
      outcomeEvidence: item.outcomeEvidence || "等待人工补充结果证据",
      outcomeConfidence: item.outcomeConfidence || "低",
      evidence: item.evidence || [],
      tags: item.tags || [],
      ruleVersion: item.ruleVersion || "待确认",
      validUntil: item.validUntil || "待确认",
      reviewedBy: item.reviewedBy || (status === "已发布" ? "人工审核" : "待审核"),
      qualityScore: Number(item.qualityScore) || (status === "已发布" ? 76 : 52),
      createdAt: item.createdAt || "",
      usageCount: Number(item.usageCount) || 0,
      mock: true,
    };
  }

  function buildLibrary(summaries, customCases) {
    const custom = (customCases || []).map(caseFromCustom);
    const customIds = new Set(custom.map((item) => item.id));
    const history = (summaries || []).map(caseFromSummary).filter((item) => !customIds.has(item.id));
    return [...custom, ...history];
  }

  function retrieve(current, library, options) {
    const opts = options || {};
    const limit = Number(opts.limit) || 5;
    const currentText = [current.request, ...(current.preferences || []), ...(current.concerns || [])].join(" ");
    return (library || [])
      .filter((item) => item.status === "已发布")
      .filter((item) => item.sourceSessionId !== current.sessionId)
      .map((item) => {
        let score = 0;
        const reasons = [];
        if (item.sceneMinor && item.sceneMinor === current.sceneMinor) { score += 38; reasons.push("同一细分场景"); }
        else if (item.sceneMajor && item.sceneMajor === current.sceneMajor) { score += 20; reasons.push("同一业务大类"); }
        if (item.riskLevel === current.riskLevel) { score += 7; reasons.push("风险等级相近"); }
        const similarity = overlapScore(currentText, [item.request, ...item.conditions, ...item.tags].join(" "));
        if (similarity >= 0.5) reasons.push("诉求与事实高度相似");
        else if (similarity >= 0.25) reasons.push("诉求关键词相似");
        score += Math.round(similarity * 32);
        score += Math.round(Math.min(item.qualityScore, 100) * 0.08);
        if (item.outcome !== "结果待核验") { score += 5; reasons.push("留有客户结果反馈"); }
        return { ...item, matchScore: Math.min(98, score), matchReasons: unique(reasons).slice(0, 3) };
      })
      .filter((item) => item.matchScore >= (opts.minimumScore == null ? 18 : Number(opts.minimumScore)))
      .sort((left, right) => right.matchScore - left.matchScore || right.qualityScore - left.qualityScore)
      .slice(0, limit);
  }

  function search(library, query, status) {
    const term = safe(query).toLowerCase();
    return (library || []).filter((item) => {
      if (status && status !== "全部" && item.status !== status) return false;
      if (!term) return true;
      return [item.id, item.title, item.sceneMajor, item.sceneMinor, item.request, item.outcome, ...(item.tags || [])].join(" ").toLowerCase().includes(term);
    });
  }

  function createCandidate(analysis, sessionId) {
    return {
      id: `CASE-${Date.now()}`,
      sessionId,
      sourceSessionId: sessionId,
      title: `${analysis.sceneMinor || "服务事项"}处理候选案例`,
      status: "待审核",
      sceneMajor: analysis.sceneMajor,
      sceneMinor: analysis.sceneMinor,
      riskLevel: analysis.riskLevel,
      request: analysis.request,
      conditions: unique([...(analysis.preferences || []), ...(analysis.concerns || [])]),
      actions: unique(analysis.actions || []),
      lesson: unique(analysis.actions || []).join("；"),
      boundary: unique(analysis.doNotCommit || []),
      replyTemplate: analysis.draft,
      outcome: "结果待核验",
      outcomeEvidence: "等待客服补充最终处理结果",
      evidence: evidenceFrom(analysis.messages),
      tags: unique([analysis.sceneMajor, analysis.sceneMinor, analysis.riskLevel]),
      ruleVersion: "待审核确认",
      validUntil: "待审核确认",
      qualityScore: 58,
      createdAt: new Date().toISOString(),
    };
  }

  function stats(library) {
    const rows = library || [];
    return {
      total: rows.length,
      published: rows.filter((item) => item.status === "已发布").length,
      pending: rows.filter((item) => item.status === "待审核").length,
      expired: rows.filter((item) => item.status === "已失效").length,
    };
  }

  return { buildLibrary, retrieve, search, createCandidate, stats, overlapScore };
});
