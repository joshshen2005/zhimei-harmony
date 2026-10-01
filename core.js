(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZhimeiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const safe = (value) => String(value == null ? "" : value);
  const includesAny = (text, terms) => terms.some((term) => safe(text).includes(term));
  const compact = (items) => [...new Set(items.filter(Boolean))];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const GO_EMOTIONS = [
    ["admiration", "钦佩"], ["amusement", "觉得有趣"], ["anger", "愤怒"], ["annoyance", "烦躁/不耐烦"],
    ["approval", "认可"], ["caring", "关心"], ["confusion", "困惑"], ["curiosity", "好奇"],
    ["desire", "希望得到"], ["disappointment", "失望"], ["disapproval", "不赞同"], ["disgust", "厌恶"],
    ["embarrassment", "尴尬"], ["excitement", "兴奋"], ["fear", "恐惧"], ["gratitude", "感激"],
    ["grief", "悲痛"], ["joy", "喜悦"], ["love", "喜爱"], ["nervousness", "紧张/不安"],
    ["optimism", "乐观/期待"], ["pride", "自豪"], ["realization", "意识到"], ["relief", "释然"],
    ["remorse", "懊悔"], ["sadness", "悲伤"], ["surprise", "惊讶"], ["neutral", "中性"],
  ].map(([key, zh]) => ({ key, zh }));

  const EMOTION_GROUPS = [
    { key: "positive", en: "Positive / Happy", zh: "积极愉悦", labels: ["joy", "amusement", "excitement", "pride"], strategy: ["保持友好", "感谢认可"] },
    { key: "appreciation", en: "Appreciation / Affection", zh: "认可与亲近", labels: ["admiration", "approval", "gratitude", "love", "caring"], strategy: ["感谢", "简洁确认"] },
    { key: "hope", en: "Hope / Relief", zh: "希望与释然", labels: ["desire", "optimism", "relief"], strategy: ["说明进展", "给出下一步"] },
    { key: "sadness", en: "Sadness / Loss", zh: "低落与失落", labels: ["sadness", "disappointment", "grief"], strategy: ["共情", "道歉", "提供补救"] },
    { key: "anger", en: "Anger / Dissatisfaction", zh: "愤怒与不满", labels: ["anger", "annoyance", "disapproval", "disgust"], strategy: ["先道歉", "承认影响", "给出行动"] },
    { key: "anxiety", en: "Anxiety / Fear", zh: "焦虑与担忧", labels: ["fear", "nervousness"], strategy: ["安抚但不淡化", "提供确定信息", "说明反馈时间"] },
    { key: "regret", en: "Self-conscious / Regret", zh: "自责与尴尬", labels: ["embarrassment", "remorse"], strategy: ["避免责备", "降低操作压力"] },
    { key: "uncertainty", en: "Uncertainty / Seeking Information", zh: "困惑与探索", labels: ["confusion", "curiosity", "realization", "surprise"], strategy: ["通俗解释", "必要时补问信息"] },
    { key: "neutral", en: "Neutral", zh: "中性", labels: ["neutral"], strategy: ["直接说明", "给出可执行步骤"] },
  ];

  const EMOTION_RULES = {
    admiration: ["专业", "厉害", "靠谱"], amusement: ["哈哈", "好笑", "逗"], anger: ["开啥玩笑", "开什么玩笑", "气死", "投诉", "骗人"],
    annoyance: ["怎么回事", "一直", "还没", "别再拖", "走点心", "太坑", "真烦", "烦死", "烦透"], approval: ["行", "可以", "好的", "没问题"],
    caring: ["辛苦", "保重"], confusion: ["为什么", "啥意思", "怎么", "不明白", "吗"], curiosity: ["想问", "请问", "是什么", "是啥"],
    desire: ["我就要", "只要", "想要", "希望", "尽快"], disappointment: ["失望", "太差", "掉链子", "没想到"],
    disapproval: ["不接受", "不行", "没法", "不对", "不合适"], disgust: ["恶心", "反胃", "讨厌"], embarrassment: ["尴尬", "不好意思"],
    excitement: ["太棒", "期待", "激动"], fear: ["害怕", "不敢", "过敏", "红肿", "刺痛"], gratitude: ["谢谢", "感谢", "麻烦了"],
    grief: ["悲痛", "去世"], joy: ["开心", "太好了", "高兴"], love: ["喜欢", "爱了"], nervousness: ["担心", "紧张", "不安", "急"],
    optimism: ["希望", "应该可以", "期待"], pride: ["自豪", "骄傲"], realization: ["原来", "明白了", "知道了"], relief: ["终于", "放心", "松口气", "到了到了"],
    remorse: ["后悔", "抱歉", "怪我"], sadness: ["难过", "伤心", "唉"], surprise: ["居然", "竟然", "没想到", "啊"],
  };

  const POSITIVE_LABELS = new Set(["admiration", "amusement", "approval", "caring", "excitement", "gratitude", "joy", "love", "optimism", "pride", "relief"]);
  const NEGATIVE_LABELS = new Set(["anger", "annoyance", "disappointment", "disapproval", "disgust", "fear", "grief", "nervousness", "remorse", "sadness"]);

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
    return compact((safe(text).match(/#\d{2}[^\s，。；、~）)]+/g) || []).map((value) => {
      const shade = value.replace(/[，。！!？?]+$/, "");
      const sentenceSuffix = shade.search(/(?:不适合|不喜欢|原样|就行|就好|没法|不能|换货|收到)/);
      return sentenceSuffix > 3 ? shade.slice(0, sentenceSuffix) : shade;
    }));
  }

  function summarizeRequest(messages, sceneMajor, sceneMinor, order) {
    const buyerText = messages.filter((m) => m["角色"] === "买家").map((m) => safe(m["message_text"])).join(" ");
    const preferenceMessage = [...messages].reverse().find((m) => m["角色"] === "买家" && includesAny(m["message_text"], ["我就要", "只要", "换成", "换回", "还是换", "退", "查", "尽快"]));
    const preferredShades = extractShades(preferenceMessage && preferenceMessage["message_text"]);
    const orderShades = extractShades(order && order["商品名称"]);
    const targetShade = preferredShades[0] || orderShades[0];

    if (includesAny(sceneMajor + sceneMinor, ["错发色号", "换货", "补发"])) {
      return `消费者反馈商品${includesAny(sceneMinor + buyerText, ["错发", "发错", "不一样", "破损", "坏"]) ? "与下单或预期不符" : "需要售后处理"}，希望${targetShade ? `更换为 ${targetShade}` : "完成换货或补发"}，并确认后续安排。`;
    }
    if (includesAny(sceneMajor + sceneMinor, ["退款", "打款", "价保", "补偿"])) {
      return `消费者希望核实${includesAny(buyerText, ["到账", "钱", "退款"]) ? "款项状态与金额" : "可申请的退款或补偿"}，并获得明确处理结果。`;
    }
    if (includesAny(sceneMajor + sceneMinor + buyerText, ["不良反应", "过敏", "发红", "红肿", "刺痛", "瘙痒", "闷痘"])) {
      return "消费者反馈使用产品后出现不适，希望确认安全处理流程及后续安排。";
    }
    if (includesAny(sceneMajor + sceneMinor, ["物流", "未收到", "少件", "破损"])) {
      return "消费者希望核实当前物流或包裹异常，并获得明确的处理进度与反馈时间。";
    }
    if (includesAny(sceneMajor, ["产品咨询"])) {
      return `消费者正在咨询${sceneMinor || "产品信息"}，希望得到适合自身需求的清晰建议。`;
    }
    return `消费者希望解决“${sceneMinor || sceneMajor || "当前服务事项"}”问题，并获得明确、可执行的答复。`;
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

  function summarizeServiceIntent(messages, order) {
    const buyer = messages.filter((m) => m["角色"] === "买家");
    const text = buyer.map((m) => safe(m["message_text"])).join(" ");
    const latestPreference = [...buyer].reverse().find((m) => includesAny(m["message_text"], ["我就要", "只要", "换成", "换回", "还是换"]));
    const targetShade = extractShades(latestPreference && latestPreference["message_text"])[0] || extractShades(order && order["商品名称"])[0];
    const intents = [];
    if (includesAny(text, ["换货", "还是换", "换吧", "换！", "换!", "换回", "换成"])) intents.push("处理方式：换货");
    else if (includesAny(text, ["退款", "退钱", "退掉", "不要了"])) intents.push("处理方式：退款/退货");
    else if (includesAny(text, ["查一下", "查查", "查询", "怎么回事", "为什么"])) intents.push("处理方式：先核实并解释");
    if (targetShade) intents.push(`目标商品：${targetShade}`);
    if (includesAny(text, ["尽快", "马上", "急", "别再拖"])) intents.push("时效要求：尽快处理");
    if (includesAny(text, ["到账", "确认", "结果", "什么时候"])) intents.push("结果要求：给出明确状态或时间");
    return compact(intents).slice(0, 4);
  }

  function labelUtterance(text) {
    const labels = [];
    for (const emotion of GO_EMOTIONS) {
      if (emotion.key === "neutral") continue;
      const hits = (EMOTION_RULES[emotion.key] || []).filter((term) => safe(text).includes(term)).length;
      if (hits) labels.push({ key: emotion.key, zh: emotion.zh, probability: clamp(0.58 + hits * 0.09, 0, 0.94) });
    }
    if (!labels.length) return [{ key: "neutral", zh: "中性", probability: 0.72 }];
    return labels.sort((a, b) => b.probability - a.probability).slice(0, 3);
  }

  function vadFor(labels, text) {
    const keys = new Set(labels.map((item) => item.key));
    const positiveCount = [...keys].filter((key) => POSITIVE_LABELS.has(key)).length;
    const negativeCount = [...keys].filter((key) => NEGATIVE_LABELS.has(key)).length;
    let valence = clamp(3 + positiveCount - negativeCount, 1, 5);
    let arousal = 2;
    let dominance = 3;
    if (["anger", "disgust", "grief"].some((key) => keys.has(key))) valence = 1;
    if (["anger", "annoyance", "fear", "nervousness", "excitement", "surprise"].some((key) => keys.has(key))) arousal += 2;
    if (/[！!]{1,}|急|马上|投诉/.test(safe(text))) arousal += 1;
    if (["fear", "nervousness", "confusion", "sadness", "grief"].some((key) => keys.has(key))) dominance -= 1;
    if (["anger", "desire", "approval", "pride"].some((key) => keys.has(key))) dominance += 1;
    return { valence, arousal: clamp(arousal, 1, 5), dominance: clamp(dominance, 1, 5) };
  }

  function scoreEmotion(messages) {
    const buyer = messages.filter((m) => m["角色"] === "买家");
    const trajectory = buyer.map((message) => {
      const text = safe(message["message_text"]);
      const labels = labelUtterance(text);
      const vad = vadFor(labels, text);
      const group = EMOTION_GROUPS.find((item) => labels.some((label) => item.labels.includes(label.key))) || EMOTION_GROUPS[8];
      return { seq: message["消息序号"], time: message["发送时间"], text, labels, vad, group: group.key, groupZh: group.zh };
    });
    const recent = trajectory.slice(-3);
    const groupScores = EMOTION_GROUPS.map((group) => ({
      ...group,
      score: recent.reduce((sum, point, pointIndex) => sum + point.labels.filter((label) => group.labels.includes(label.key)).reduce((inner, label) => inner + label.probability * (pointIndex + 1), 0), 0),
    }));
    const ranked = groupScores.sort((a, b) => b.score - a.score);
    const primary = ranked[0].score > 0 ? ranked[0] : EMOTION_GROUPS[8];
    const expScores = ranked.map((item) => Math.exp(item.score));
    const confidence = Math.round((expScores[0] / expScores.reduce((sum, score) => sum + score, 0)) * 100);
    const latest = trajectory[trajectory.length - 1] || { labels: [{ key: "neutral", zh: "中性", probability: 0.72 }], vad: { valence: 3, arousal: 2, dominance: 3 } };
    const first = trajectory[0] || latest;
    const trendDelta = latest.vad.valence - first.vad.valence;
    const trend = trendDelta >= 2 ? "明显缓和" : trendDelta === 1 ? "有所缓和" : trendDelta <= -2 ? "明显恶化" : trendDelta === -1 ? "略有升高" : "基本稳定";
    const aggregateLabels = compact(recent.flatMap((point) => point.labels.map((label) => label.key))).map((key) => {
      const found = GO_EMOTIONS.find((item) => item.key === key);
      const probability = Math.max(...recent.flatMap((point) => point.labels.filter((label) => label.key === key).map((label) => label.probability)), 0);
      return { key, zh: found ? found.zh : key, probability };
    }).sort((a, b) => b.probability - a.probability).slice(0, 5);
    return {
      group: primary.key, groupZh: primary.zh, groupEn: primary.en, label: primary.zh,
      labels: aggregateLabels, allLabels: GO_EMOTIONS, vad: latest.vad, trajectory,
      trend, confidence, confidenceLabel: confidence >= 70 ? "较高" : confidence >= 45 ? "中等" : "较低",
      secondaryGroup: ranked[1] && ranked[1].score > 0 ? ranked[1].zh : "无明显次要组",
      responseStrategies: primary.strategy,
      method: "演示规则推断（非训练模型）",
    };
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

  function buildRisk(sceneMajor, sceneMinor, conflicts, unanswered, commitments, emotion, tickets) {
    const reasons = [];
    if (includesAny(sceneMajor + sceneMinor, ["不良反应", "过敏", "就医", "刺痛", "红肿"])) {
      reasons.push({ category: "安全风险", level: "高", title: "涉及产品使用不适", detail: "需要进入企业产品安全专门流程，不提供医疗诊断或因果判断。" });
    }
    conflicts.forEach((item) => reasons.push({ category: "数据一致性", level: item.level === "high" ? "高" : "中", title: item.title, detail: item.detail }));
    unanswered.forEach((item) => reasons.push({ category: "漏答风险", level: "中", title: "消费者问题尚未直接回答", detail: item }));
    commitments.forEach((item) => reasons.push({ category: "承诺履约", level: "中", title: "客服承诺缺少履约证据", detail: item.text }));
    if (["anger", "anxiety", "sadness"].includes(emotion.group) && emotion.vad.arousal >= 4) {
      reasons.push({ category: "情绪升级", level: "中", title: `${emotion.groupZh}且唤醒度较高`, detail: "建议先共情并明确下一步，避免重复解释或空泛安抚。" });
    }
    const weights = { 高: 36, 中: 18, 低: 6 };
    const score = clamp(reasons.reduce((sum, item) => sum + weights[item.level], 8), 0, 100);
    const level = reasons.some((item) => item.level === "高") ? "高" : reasons.length ? "中" : "低";
    const hasSafety = reasons.some((item) => item.category === "安全风险");
    const hasConflict = reasons.some((item) => item.category === "数据一致性");
    return {
      level, score, reasons,
      owner: hasSafety ? "产品安全专员" : hasConflict ? "客服主管 / 业务处理人" : level === "中" ? "当前客服" : "当前客服",
      responseSla: level === "高" ? "立即升级，30 分钟内首次反馈" : level === "中" ? "本次会话内确认，2 小时内跟进" : "按普通服务时效处理",
      nextAction: hasSafety ? "创建安全事件并转产品安全专员复核" : hasConflict ? "核对聊天、订单、工单与实际执行记录" : unanswered.length ? "先直接回答尚未回应的问题" : "记录处理结果并正常闭环",
      openTicketCount: tickets.filter((ticket) => !includesAny(ticket["任务状态"] || ticket["工单状态"], ["已完结", "已关闭"])).length,
    };
  }

  function buildDraft(analysis) {
    const emotionOpening = ["anger", "sadness", "anxiety"].includes(analysis.emotion.group) ? "很抱歉给您添麻烦了。" : "您好，您的情况我已经了解。";
    const request = analysis.request.replace(/^消费者/, "您").replace(/。$/, "");
    const verify = analysis.conflicts.length ? "目前几处记录对不上，我先核对实际处理情况。" : `我现在先为您${analysis.actions[0]}。`;
    return `${emotionOpening}${request}。${verify}确认后，我会把结果、下一步安排和反馈时间一次说明清楚。`;
  }

  function analyzeSession(sessionId, index) {
    const messages = index.sessions.get(sessionId) || [];
    const order = index.orders.get(sessionId) || null;
    const tickets = index.tickets.get(sessionId) || [];
    const first = messages[0] || {};
    const sceneMajor = safe(first["scene_major"]) || "其他服务";
    const sceneMinor = safe(first["scene_minor"]) || "待分类";
    const request = summarizeRequest(messages, sceneMajor, sceneMinor, order);
    const concerns = extractConcerns(messages);
    const preferences = summarizeServiceIntent(messages, order);
    const emotion = scoreEmotion(messages);
    const unanswered = findUnanswered(messages);
    const commitments = findCommitments(messages);
    const conflicts = detectConflicts(messages, order, tickets);
    const actions = buildActions(sceneMajor, sceneMinor, conflicts, unanswered);
    const doNotCommit = buildDoNotCommit(sceneMajor, conflicts);
    const risk = buildRisk(sceneMajor, sceneMinor, conflicts, unanswered, commitments, emotion, tickets);
    const analysis = {
      sessionId, messages, order, tickets, sceneMajor, sceneMinor, request,
      concerns, preferences, emotion, unanswered, commitments, conflicts,
      actions, doNotCommit,
      risk,
      riskLevel: risk.level,
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

  return { buildIndex, analyzeSession, sessionSummary, extractShades, GO_EMOTIONS, EMOTION_GROUPS };
});
