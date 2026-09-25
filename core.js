(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZhimeiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const safe = (value) => String(value == null ? "" : value);
  const includesAny = (text, terms) => terms.some((term) => safe(text).includes(term));
  const compact = (items) => [...new Set(items.filter(Boolean))];

  function buildIndex(data) {
    const sessions = new Map();
    for (const message of data.messages || []) {
      const id = safe(message["会话ID"]);
      if (!sessions.has(id)) sessions.set(id, []);
      sessions.get(id).push(message);
    }
    for (const messages of sessions.values()) {
      messages.sort((a, b) => Number(a["消息序号"]) - Number(b["消息序号"]));
    }

    const orders = new Map((data.orders || []).map((order) => [safe(order["会话ID"]), order]));
    const tickets = new Map();
    for (const [type, rows] of Object.entries(data.tickets || {})) {
      for (const ticket of rows) {
        const id = safe(ticket["会话ID"]);
        if (!tickets.has(id)) tickets.set(id, []);
        tickets.get(id).push({ ...ticket, _ticket_type: type });
      }
    }
    return { sessions, orders, tickets };
  }

  function extractShades(text) {
    return compact((safe(text).match(/#\d{2}[^\s，。；、~）)]+/g) || []).map((v) => v.replace(/[，。！!？?]+$/, "")));
  }

  function currentRequest(messages) {
    const buyer = messages.filter((m) => m["角色"] === "买家");
    if (!buyer.length) return "当前诉求待确认";
    const explicit = [...buyer].reverse().find((m) => includesAny(m["message_text"], ["要", "能", "吗", "怎么", "为什么", "没收到", "换", "退", "查", "处理"]));
    return safe((explicit || buyer[buyer.length - 1])["message_text"]) || "当前诉求待确认";
  }

  function extractConcerns(messages) {
    const text = messages.filter((m) => m["角色"] === "买家").map((m) => m["message_text"]).join(" ");
    const concerns = [];
    if (includesAny(text, ["急", "尽快", "马上", "拖", "等着"])) concerns.push("处理时效和等待时间");
    if (includesAny(text, ["钱", "退款", "到账", "补偿", "运费", "价保"])) concerns.push("金额与资金状态");
    if (includesAny(text, ["发错", "不一样", "正品", "骗人", "走点心"])) concerns.push("记录准确性与服务可信度");
    if (includesAny(text, ["过敏", "发红", "红肿", "瘙痒", "刺痒", "医院", "不良反应"])) concerns.push("产品使用安全与专门流程");
    if (includesAny(text, ["优惠券", "赠品", "权益"])) concerns.push("活动权益是否适用");
    return concerns.length ? concerns : ["希望获得明确、可执行的处理答复"];
  }

  function extractPreferences(messages) {
    const preferences = [];
    for (const message of messages.filter((m) => m["角色"] === "买家")) {
      const text = safe(message["message_text"]);
      if (includesAny(text, ["我就要", "只要", "不要", "不接受", "选", "换"])) preferences.push(text);
    }
    return compact(preferences).slice(0, 4);
  }

  function scoreEmotion(messages) {
    const buyer = messages.filter((m) => m["角色"] === "买家");
    const scoreOne = (text) => {
      let score = 0;
      if (includesAny(text, ["开啥玩笑", "走点心", "骗人", "投诉", "一直", "还没", "别再拖", "没法用"])) score += 2;
      if (includesAny(text, ["急", "尽快", "怎么回事", "为什么", "...", "啊"])) score += 1;
      if (includesAny(text, ["谢谢", "麻烦了", "行", "好的"])) score -= 1;
      return Math.max(0, Math.min(5, score));
    };
    const series = buyer.map((m) => scoreOne(safe(m["message_text"])));
    const score = series.length ? Math.max(...series) : 0;
    const label = score >= 4 ? "明确投诉或升级风险" : score >= 2 ? "明显不满" : score >= 1 ? "轻度焦虑" : "平稳咨询";
    const trend = series.length > 1 && series[series.length - 1] < series[0] ? "缓和" : series.length > 1 && series[series.length - 1] > series[0] ? "升高" : "稳定";
    return { score, label, trend, confidence: score ? "中" : "低" };
  }

  function findUnanswered(messages) {
    const unanswered = [];
    const keywordSets = [
      ["优惠券", "券"], ["尾款", "尾款"], ["到账", "到账"], ["物流", "物流"], ["什么时候", "时间"], ["能用", "使用"],
    ];
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message["角色"] !== "买家") continue;
      const text = safe(message["message_text"]);
      const matched = keywordSets.find((set) => text.includes(set[0]));
      if (!matched) continue;
      const laterAgentText = messages.slice(i + 1).filter((m) => m["角色"] === "客服").map((m) => safe(m["message_text"])).join(" ");
      if (!laterAgentText.includes(matched[1])) unanswered.push(text);
    }
    return compact(unanswered);
  }

  function findCommitments(messages) {
    return messages
      .filter((m) => m["角色"] === "客服" && includesAny(m["message_text"], ["今天", "小时", "工作日", "马上", "会", "预计", "安排", "为您发出"]))
      .map((m) => ({
        text: safe(m["message_text"]),
        seq: m["消息序号"],
        time: m["发送时间"],
        status: "待核验履约证据",
      }));
  }

  function detectConflicts(messages, order, tickets) {
    const conflicts = [];
    const buyerText = messages.filter((m) => m["角色"] === "买家").map((m) => m["message_text"]).join(" ");
    const agentText = messages.filter((m) => m["角色"] === "客服").map((m) => m["message_text"]).join(" ");
    const preferredShadeMessage = [...messages].reverse().find((m) => m["角色"] === "买家" && includesAny(m["message_text"], ["我就要", "只要", "换成", "换回"]));
    const buyerShades = extractShades(preferredShadeMessage ? preferredShadeMessage["message_text"] : buyerText);
    const orderShades = extractShades(order && order["商品名称"]);
    for (const ticket of tickets) {
      const ticketShades = extractShades(ticket["发出商品名称"]);
      const requested = buyerShades[buyerShades.length - 1] || orderShades[0];
      if (requested && ticketShades.length && !ticketShades.some((shade) => shade.startsWith(requested.slice(0, 3)))) {
        conflicts.push({
          level: "high",
          title: "换货目标与工单发出商品记录不一致",
          detail: `消费者或订单指向 ${requested}，工单记录为 ${ticketShades.join("、")}。需要核验实际出库，当前不能认定已经再次错发。`,
          sources: ["聊天记录", "订单", ticket._ticket_type],
        });
      }
      if (includesAny(buyerText, ["收到到账通知", "钱收到了", "已经到账"]) && safe(ticket["转账状态"]) && ticket["转账状态"] !== "转账成功") {
        conflicts.push({
          level: "high",
          title: "消费者到账反馈与打款工单状态不一致",
          detail: `消费者表示已到账，但工单转账状态为“${ticket["转账状态"]}”。应核对支付流水，不能直接再次发起打款。`,
          sources: ["聊天记录", ticket._ticket_type],
        });
      }
      if (includesAny(agentText, ["工单已创建", "已登记提交"]) && ticket["创建时间"]) {
        const lastMessageTime = safe(messages[messages.length - 1] && messages[messages.length - 1]["发送时间"]);
        if (lastMessageTime && safe(ticket["创建时间"]) > lastMessageTime) {
          conflicts.push({
            level: "medium",
            title: "聊天表述与工单创建时间存在差异",
            detail: `聊天中已表述完成创建，但工单表记录的创建时间为 ${ticket["创建时间"]}。该差异适合离线复盘，回放时不得提前使用工单。`,
            sources: ["聊天记录", ticket._ticket_type],
          });
        }
      }
    }
    return conflicts;
  }

  function buildActions(sceneMajor, sceneMinor, conflicts, unanswered) {
    const actions = [];
    if (conflicts.length) actions.push("先核验跨源记录差异，确认实际执行状态");
    if (unanswered.length) actions.push(`直接回应尚未回答的问题：${unanswered[0]}`);
    if (includesAny(sceneMinor, ["错发色号", "换货"])) actions.push("核对换货目标、工单商品字段与实际出库记录");
    if (includesAny(sceneMajor + sceneMinor, ["退款", "打款"])) actions.push("核对工单、支付流水和消费者到账反馈，避免重复支付");
    if (includesAny(sceneMajor + sceneMinor, ["不良反应", "过敏", "刺痒", "闷痘"])) actions.push("转入企业产品安全专门流程，由指定人员复核");
    if (includesAny(sceneMajor + sceneMinor, ["物流"])) actions.push("核对最新物流节点并明确下一次反馈时间");
    if (!actions.length) actions.push("确认当前诉求及已有材料，再查询适用规则与业务状态");
    actions.push("向消费者说明当前已确认事实、待核验事项和下一次反馈安排");
    return compact(actions).slice(0, 3);
  }

  function buildDoNotCommit(sceneMajor, conflicts) {
    const items = ["未经核验的到账、出库、库存或到货时间"];
    if (conflicts.length) items.push("在记录冲突解决前承诺具体处理结果");
    if (includesAny(sceneMajor, ["不良反应"])) items.push("医疗诊断、治疗建议或产品因果结论");
    return items;
  }

  function buildDraft(analysis) {
    const firstAction = analysis.actions[0];
    const request = analysis.request.length > 68 ? analysis.request.slice(0, 68) + "…" : analysis.request;
    return `您好，我已经看到您反馈的“${request}”。目前我会为您${firstAction}。在核验完成前，我不会把尚未确认的状态当作处理结果。核对后会向您说明已确认信息、下一步安排和反馈时间。给您带来不便，十分抱歉。`;
  }

  function analyzeSession(sessionId, index) {
    const messages = index.sessions.get(sessionId) || [];
    const order = index.orders.get(sessionId) || null;
    const tickets = index.tickets.get(sessionId) || [];
    const first = messages[0] || {};
    const sceneMajor = safe(first["scene_major"]) || "其他服务";
    const sceneMinor = safe(first["scene_minor"]) || "待分类";
    const request = currentRequest(messages);
    const concerns = extractConcerns(messages);
    const preferences = extractPreferences(messages);
    const emotion = scoreEmotion(messages);
    const unanswered = findUnanswered(messages);
    const commitments = findCommitments(messages);
    const conflicts = detectConflicts(messages, order, tickets);
    const actions = buildActions(sceneMajor, sceneMinor, conflicts, unanswered);
    const doNotCommit = buildDoNotCommit(sceneMajor, conflicts);
    const analysis = {
      sessionId, messages, order, tickets, sceneMajor, sceneMinor, request,
      concerns, preferences, emotion, unanswered, commitments, conflicts,
      actions, doNotCommit,
      riskLevel: includesAny(sceneMajor + sceneMinor, ["不良反应", "过敏", "就医"]) || conflicts.some((c) => c.level === "high") ? "高" : unanswered.length || commitments.length ? "中" : "低",
      evidence: compact([
        ...messages.filter((m) => m["角色"] === "买家").slice(-3).map((m) => `聊天记录 第${m["消息序号"]}条`),
        order ? `订单 ${order["订单号"]}` : "",
        ...tickets.map((t) => `${t._ticket_type} ${t["工单号"]}`),
      ]),
    };
    analysis.draft = buildDraft(analysis);
    return analysis;
  }

  function sessionSummary(sessionId, messages, index) {
    const first = messages[0] || {};
    const last = messages[messages.length - 1] || {};
    const analysis = analyzeSession(sessionId, index);
    return {
      id: sessionId,
      buyer: safe(first["买家昵称"]) || "匿名消费者",
      sceneMajor: safe(first["scene_major"]),
      sceneMinor: safe(first["scene_minor"]),
      lastText: safe(last["message_text"]),
      lastTime: safe(last["发送时间"]),
      riskLevel: analysis.riskLevel,
      ticketCount: analysis.tickets.length,
      analysis,
    };
  }

  return { buildIndex, analyzeSession, sessionSummary, extractShades };
});
