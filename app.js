(function () {
  "use strict";

  const data = window.ZHIMEI_DATA;
  const core = window.ZhimeiCore;
  const aiClient = window.ZhimeiAI;
  if (!data || !core) {
    document.body.innerHTML = "<p style='padding:24px'>数据或分析模块加载失败。请通过本地服务器打开。</p>";
    return;
  }

  const index = core.buildIndex(data);
  const state = {
    summaries: [], filtered: [], selectedId: "S00018", riskFilter: "",
    risks: readStorage("zhimei-risk-events", []), cases: readStorage("zhimei-cases", []),
    aiCache: new Map(), aiLoading: new Set(), aiErrors: new Map(), aiAttempted: new Set(),
  };
  const el = {
    clock: byId("clock"), sessionCount: byId("session-count"), sessionList: byId("session-list"),
    search: byId("session-search"), filter: byId("scene-filter"), header: byId("conversation-header"),
    order: byId("order-strip"), messages: byId("message-list"), content: byId("copilot-content"),
    reply: byId("reply-input"), draftSource: byId("draft-source"), toast: byId("toast-region"),
    queue: byId("queue-summary"), context: byId("conversation-context"), copilotSession: byId("copilot-session"),
    modal: byId("case-modal"), modalTitle: byId("case-modal-title"), modalContent: byId("case-modal-content"),
    analysisState: byId("analysis-state"), aiConfigModal: byId("ai-config-modal"),
    apiBaseUrl: byId("api-base-url"), aiConfigResult: byId("ai-config-result"),
  };

  function byId(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]); }
  function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } }
  function saveStorage(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function selected() { return state.summaries.find((item) => item.id === state.selectedId) || state.summaries[0]; }
  function riskClass(level) { return level === "高" ? "risk-high" : level === "中" ? "risk-medium" : "risk-low"; }
  function shortTime(value) { return String(value || "").slice(5, 16); }
  function list(items, numbered = false) { return `<ol class="list-clean ${numbered ? "number-list" : ""}">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`; }
  function unique(items) { return [...new Set((items || []).filter(Boolean))]; }
  function providerLabel(meta) {
    if (!meta) return "AI";
    if (meta.providerLabel) return meta.providerLabel;
    return meta.provider === "deepseek" ? "DeepSeek" : meta.provider === "openai" ? "OpenAI" : "AI";
  }

  const RESPONSE_STRATEGY_ZH = {
    apology: "道歉", empathy: "共情", gratitude: "感谢", cheerfulness: "积极友好",
    explanation: "解释原因", request_information: "补充询问信息", help_offline: "转其他渠道处理", other: "其他",
  };

  function analysisFor(item) {
    if (!item) return null;
    const base = item.analysis;
    const result = state.aiCache.get(item.id);
    if (!result || !result.analysis) return base;
    const ai = result.analysis;
    const group = core.EMOTION_GROUPS.find((entry) => entry.key === ai.emotion.strategy_group) || core.EMOTION_GROUPS[8];
    const labelMeta = new Map(core.GO_EMOTIONS.map((entry) => [entry.key, entry]));
    const mapLabels = (labels) => (labels || []).map((label) => ({
      key: label.label,
      zh: (labelMeta.get(label.label) || {}).zh || label.label,
      probability: Number(label.confidence) || 0,
    }));
    const currentLabels = mapLabels(ai.emotion.current_labels);
    const trajectory = (ai.emotion.trajectory || []).map((point) => {
      const labels = mapLabels(point.labels);
      const pointGroup = core.EMOTION_GROUPS.find((entry) => labels.some((label) => entry.labels.includes(label.key))) || core.EMOTION_GROUPS[8];
      const source = base.messages.find((message) => Number(message["消息序号"]) === Number(point.seq)) || {};
      return {
        seq: point.seq, time: source["发送时间"], text: source["message_text"] || "原始客户发言待定位",
        labels, vad: point.vad, group: pointGroup.key, groupZh: pointGroup.zh,
      };
    });
    const aiRiskReasons = (ai.risk_signals || []).map((risk) => ({
      category: risk.category,
      level: risk.level === "high" ? "高" : risk.level === "medium" ? "中" : "低",
      title: risk.title,
      detail: `${risk.detail}${risk.evidence_seq && risk.evidence_seq.length ? `（证据：客户消息第 ${risk.evidence_seq.join("、")} 条）` : ""}`,
    }));
    const riskReasons = [...base.risk.reasons];
    aiRiskReasons.forEach((risk) => { if (!riskReasons.some((item) => item.title === risk.title)) riskReasons.push(risk); });
    const aiMaxLevel = aiRiskReasons.some((risk) => risk.level === "高") ? "高" : aiRiskReasons.some((risk) => risk.level === "中") ? "中" : "低";
    const rank = { 低: 1, 中: 2, 高: 3 };
    const riskLevel = rank[aiMaxLevel] > rank[base.riskLevel] ? aiMaxLevel : base.riskLevel;
    const confidence = Math.round((Number(ai.emotion.group_confidence) || 0) * 100);
    const responseStrategies = (ai.response_strategies || []).map((key) => RESPONSE_STRATEGY_ZH[key] || key);
    return {
      ...base,
      request: ai.request_summary || base.request,
      preferences: ai.service_intents && ai.service_intents.length ? ai.service_intents : base.preferences,
      concerns: ai.concerns && ai.concerns.length ? ai.concerns : base.concerns,
      actions: unique([...base.actions, ...(ai.actions || [])]).slice(0, 5),
      doNotCommit: unique([...base.doNotCommit, ...(ai.do_not_commit || [])]).slice(0, 6),
      draft: ai.reply_draft || base.draft,
      riskLevel,
      risk: {
        ...base.risk,
        level: riskLevel,
        score: Math.max(base.risk.score, aiMaxLevel === "高" ? 75 : aiMaxLevel === "中" ? 45 : 20),
        reasons: riskReasons,
      },
      emotion: {
        ...base.emotion,
        group: group.key, groupZh: group.zh, groupEn: group.en,
        labels: currentLabels.length ? currentLabels : base.emotion.labels,
        vad: ai.emotion.current_vad || base.emotion.vad,
        trajectory: trajectory.length ? trajectory : base.emotion.trajectory,
        trend: ai.emotion.trend,
        confidence,
        confidenceLabel: confidence >= 70 ? "较高" : confidence >= 45 ? "中等" : "较低",
        responseStrategies: responseStrategies.length ? responseStrategies : group.strategy,
        method: `${providerLabel(result.meta)} ${result.meta && result.meta.model ? result.meta.model : "模型"} · 信心未校准`,
      },
      aiMeta: result.meta,
      needsHumanReview: Boolean(ai.needs_human_review),
      reviewReason: ai.review_reason,
    };
  }

  function initialise() {
    state.summaries = [...index.sessions.entries()].map(([id, messages]) => core.sessionSummary(id, messages, index));
    state.summaries.sort((a, b) => String(b.lastTime).localeCompare(String(a.lastTime)));
    if (!state.summaries.some((item) => item.id === state.selectedId)) state.selectedId = state.summaries[0] && state.summaries[0].id;
    const scenes = [...new Set(state.summaries.map((item) => item.sceneMajor).filter(Boolean))].sort();
    el.filter.insertAdjacentHTML("beforeend", scenes.map((scene) => `<option value="${esc(scene)}">${esc(scene)}</option>`).join(""));
    bindEvents();
    filterSessions();
    updateClock();
    setInterval(updateClock, 1000);
  }

  function bindEvents() {
    el.search.addEventListener("input", filterSessions);
    el.filter.addEventListener("change", filterSessions);
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => {
      const target = byId(button.dataset.jump);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    byId("clear-reply").addEventListener("click", () => { el.reply.value = ""; el.draftSource.textContent = "等待客服输入"; });
    byId("simulate-send").addEventListener("click", () => {
      if (!el.reply.value.trim()) return showToast("请输入回复内容后再发送。", true);
      showToast("已模拟发送。真实版本需要接入客服平台发送接口。", false);
      el.draftSource.textContent = "人工已确认并模拟发送";
    });
    byId("close-case-modal").addEventListener("click", closeCaseModal);
    el.modal.addEventListener("click", (event) => { if (event.target === el.modal) closeCaseModal(); });
    el.analysisState.addEventListener("click", openAIConfig);
    byId("close-ai-config").addEventListener("click", closeAIConfig);
    byId("test-ai-connection").addEventListener("click", testAIConnection);
    byId("save-ai-config").addEventListener("click", saveAIConfig);
    el.aiConfigModal.addEventListener("click", (event) => { if (event.target === el.aiConfigModal) closeAIConfig(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeCaseModal(); closeAIConfig(); } });
  }

  function updateClock() { el.clock.textContent = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(new Date()); }

  function updateAIStatus(item) {
    const baseUrl = aiClient && aiClient.getBaseUrl();
    let label = "本地规则";
    let statusClass = "offline";
    if (item && state.aiLoading.has(item.id)) { label = "AI分析中"; statusClass = "loading"; }
    else if (item && state.aiCache.has(item.id)) {
      const result = state.aiCache.get(item.id);
      label = `${providerLabel(result.meta)} · ${(result.meta && result.meta.model) || "已连接"}`;
      statusClass = "connected";
    } else if (item && state.aiErrors.has(item.id)) { label = "AI失败 · 规则兜底"; statusClass = "error"; }
    else if (baseUrl) { label = "AI待分析"; statusClass = "ready"; }
    el.analysisState.className = `analysis-state ${statusClass}`;
    el.analysisState.innerHTML = `<span></span><b>${esc(label)}</b>`;
  }

  async function loadAIAnalysis(item, force = false) {
    if (!item || !aiClient || !aiClient.getBaseUrl()) return updateAIStatus(item);
    if (force) {
      state.aiCache.delete(item.id);
      state.aiErrors.delete(item.id);
      state.aiAttempted.delete(item.id);
    }
    if (state.aiCache.has(item.id) || state.aiLoading.has(item.id) || state.aiAttempted.has(item.id)) return updateAIStatus(item);
    state.aiAttempted.add(item.id);
    state.aiLoading.add(item.id);
    updateAIStatus(item);
    try {
      const result = await aiClient.analyze(item.analysis);
      state.aiCache.set(item.id, result);
      state.aiErrors.delete(item.id);
    } catch (error) {
      state.aiErrors.set(item.id, error.message || "AI分析失败");
    } finally {
      state.aiLoading.delete(item.id);
      if (selected() && selected().id === item.id) renderWorkspace();
    }
  }

  function resetAIState() {
    state.aiCache.clear();
    state.aiErrors.clear();
    state.aiAttempted.clear();
    state.aiLoading.clear();
  }

  function openAIConfig() {
    el.apiBaseUrl.value = aiClient ? aiClient.getBaseUrl() : "";
    el.aiConfigResult.className = "connection-result";
    el.aiConfigResult.textContent = "点击“测试连接”检查后端与模型服务配置。";
    el.aiConfigModal.hidden = false;
  }
  function closeAIConfig() { el.aiConfigModal.hidden = true; }

  async function testAIConnection() {
    if (!aiClient) return;
    const baseUrl = el.apiBaseUrl.value.trim();
    if (!baseUrl) {
      el.aiConfigResult.className = "connection-result error";
      el.aiConfigResult.textContent = "请先填写AI后端地址。";
      return;
    }
    el.aiConfigResult.className = "connection-result loading";
    el.aiConfigResult.textContent = "正在检测后端连接…";
    try {
      const result = await aiClient.health(baseUrl);
      el.aiConfigResult.className = `connection-result ${result.configured ? "success" : "warning"}`;
      el.aiConfigResult.textContent = result.configured
        ? `连接成功，服务商：${result.providerLabel || result.provider || "AI"}；模型：${result.model}`
        : `后端可访问，但尚未设置 ${result.requiredKey || "API_KEY"}。`;
    } catch (error) {
      el.aiConfigResult.className = "connection-result error";
      el.aiConfigResult.textContent = error.message || "无法连接AI后端。";
    }
  }

  async function saveAIConfig() {
    if (!aiClient) return;
    const baseUrl = aiClient.setBaseUrl(el.apiBaseUrl.value);
    resetAIState();
    closeAIConfig();
    showToast(baseUrl ? "AI后端地址已保存，正在分析当前会话。" : "已关闭真实AI，继续使用本地规则。", false);
    renderWorkspace();
  }

  function filterSessions() {
    const query = el.search.value.trim().toLowerCase();
    const scene = el.filter.value;
    state.filtered = state.summaries.filter((item) => {
      const haystack = `${item.id} ${item.buyer} ${item.sceneMajor} ${item.sceneMinor} ${item.lastText}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!scene || item.sceneMajor === scene) && (!state.riskFilter || item.riskLevel === state.riskFilter);
    });
    if (state.filtered.length && !state.filtered.some((item) => item.id === state.selectedId)) state.selectedId = state.filtered[0].id;
    renderQueueSummary();
    renderSessionList();
    renderWorkspace();
  }

  function renderQueueSummary() {
    const counts = ["高", "中", "低"].map((level) => ({ level, count: state.summaries.filter((item) => item.riskLevel === level).length }));
    el.queue.innerHTML = counts.map(({ level, count }) => `<button class="queue-metric ${state.riskFilter === level ? "active" : ""}" data-risk-filter="${level}" type="button"><strong>${count}</strong>${level}风险</button>`).join("");
    el.queue.querySelectorAll("[data-risk-filter]").forEach((button) => button.addEventListener("click", () => {
      state.riskFilter = state.riskFilter === button.dataset.riskFilter ? "" : button.dataset.riskFilter;
      filterSessions();
    }));
  }

  function renderSessionList() {
    el.sessionCount.textContent = state.filtered.length;
    el.sessionList.innerHTML = state.filtered.map((item) => `
      <button class="session-item ${item.id === state.selectedId ? "active" : ""}" data-session="${esc(item.id)}" type="button">
        <div class="session-item-top"><span class="session-buyer">${esc(item.buyer)}</span><span class="session-time">${esc(shortTime(item.lastTime))}</span></div>
        <div class="session-scene"><span class="scene-tag">${esc(item.sceneMinor || item.sceneMajor)}</span><span class="risk-tag ${riskClass(item.riskLevel)}">${esc(item.riskLevel)}风险</span></div>
        <div class="session-preview">${esc(item.lastText)}</div>
      </button>`).join("") || `<div class="empty-state">没有符合筛选条件的会话。</div>`;
    el.sessionList.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", () => {
      state.selectedId = button.dataset.session;
      renderSessionList();
      renderWorkspace();
    }));
  }

  function renderWorkspace() {
    const item = selected();
    if (!item) return;
    const a = analysisFor(item);
    el.header.innerHTML = `<div class="conversation-person"><h2>${esc(item.buyer)}</h2><p>${esc(item.id)} · ${esc(a.sceneMajor)} / ${esc(a.sceneMinor)}</p></div><div class="conversation-meta"><strong>${a.messages.length} 条消息</strong><span>${a.tickets.length} 张关联工单 · ${a.order ? "已关联订单" : "无关联订单"}</span></div>`;
    el.copilotSession.textContent = `${item.id} · ${a.sceneMinor}`;
    renderOrder(a.order);
    el.context.innerHTML = `<span class="context-label">本次处理重点</span><span class="context-chip important">${esc(a.riskLevel)}风险 · ${a.risk.score}分</span><span class="context-chip">${a.conflicts.length} 项数据差异</span><span class="context-chip">${a.unanswered.length} 个待回答问题</span><span class="context-chip">${a.commitments.length} 项承诺待核验</span>`;
    renderMessages(a.messages);
    renderDashboard();
    updateAIStatus(item);
    void loadAIAnalysis(item);
  }

  function renderOrder(order) {
    if (!order) return void (el.order.innerHTML = `<span class="no-data">当前会话没有关联订单。插件保持空结果，不补造订单信息。</span>`);
    el.order.innerHTML = `<div class="order-card"><div><strong>${esc(order["商品名称"])}</strong><p>订单 ${esc(order["订单号"])} · ${esc(order["订单状态"])} · ${esc(order["快递公司"] || "暂无物流")}</p></div><div class="order-amount">¥${esc(order["实付金额(元)"])}<br><span class="status-chip">${esc(order["发货时间"] || "待发货")}</span></div></div>`;
  }

  function renderMessages(messages) {
    el.messages.innerHTML = messages.map((message) => {
      const roleClass = message["角色"] === "买家" ? "buyer" : "agent";
      const image = message["内容类型"] === "图片" ? `<div class="image-placeholder">图片路径：${esc(message["image_path"])}<br>演示数据未提供真实文件，等待人工核验。</div>` : "";
      return `<article id="msg-${esc(message["消息序号"])}" class="message-row ${roleClass}"><div class="message-bubble"><div class="message-meta"><span>${esc(message["发送方"] || message["角色"])}</span><span>${esc(message["发送时间"])}</span></div><div class="message-text">${esc(message["message_text"])}${image}</div></div></article>`;
    }).join("");
    requestAnimationFrame(() => { el.messages.scrollTop = el.messages.scrollHeight; });
  }

  function renderDashboard() {
    const a = analysisFor(selected());
    const emotion = a.emotion;
    const analysisSource = a.aiMeta ? `${providerLabel(a.aiMeta)}真实模型` : "本地规则归纳";
    const conflicts = a.conflicts.length ? a.conflicts.map((item) => `<div class="timeline-alert"><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p><div class="source-row">${item.sources.map((source) => `<span class="source-tag">${esc(source)}</span>`).join("")}<button class="source-link" data-evidence type="button">定位聊天证据</button></div></div>`).join("") : `<div class="timeline-alert clear"><strong>未发现明确的跨源冲突</strong><p>仍需由客服按实际业务结果完成最终核验。</p></div>`;
    const labels = emotion.labels.map((label) => `<span class="emotion-tag">${esc(label.zh)} <b>${Math.round(label.probability * 100)}%</b></span>`).join("");
    const activeLabels = new Set(emotion.labels.map((item) => item.key));
    const taxonomy = emotion.allLabels.map((item) => `<div class="taxonomy-item ${activeLabels.has(item.key) ? "active" : ""}"><b>${esc(item.zh)}</b><span>${esc(item.key)}</span></div>`).join("");
    const risks = a.risk.reasons.length ? a.risk.reasons.map((item) => `<article class="risk-reason"><div><span class="risk-category">${esc(item.category)}</span><span class="risk-tag ${riskClass(item.level)}">${esc(item.level)}</span></div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`).join("") : `<div class="empty-state compact">当前未识别到明确风险触发项，仍需人工确认。</div>`;
    const manualRisks = currentRisks();
    const manualRiskHtml = manualRisks.length ? manualRisks.map(riskEventHtml).join("") : `<p class="inline-empty">尚未创建人工确认的风险事件。</p>`;
    const similar = state.summaries.filter((item) => item.id !== a.sessionId && (item.sceneMinor === a.sceneMinor || item.sceneMajor === a.sceneMajor)).slice(0, 3);
    const similarHtml = similar.length ? similar.map((item) => `<article class="experience-row"><div><strong>${esc(item.sceneMinor)} · ${esc(item.id)}</strong><p>${item.sceneMinor === a.sceneMinor ? "高" : "中"}适用度 · 复用前需核对当前规则和执行阶段</p></div><button class="button secondary small" data-preview-session="${esc(item.id)}" type="button">查看 AI 摘要</button></article>`).join("") : `<div class="empty-state compact">暂无可参考的同类会话。</div>`;
    const caseHtml = state.cases.filter((item) => item.sessionId === state.selectedId || item.status === "已审核").map(caseItemHtml).join("") || `<p class="inline-empty">暂无人工沉淀案例。</p>`;

    el.content.innerHTML = `
      <section id="module-overview" class="dashboard-section overview-section">
        <div class="decision-hero"><div><span class="hero-kicker">当前核心诉求 · ${esc(analysisSource)}</span><h3>${esc(a.request)}</h3></div><span class="risk-score-pill ${riskClass(a.riskLevel)}">${esc(a.riskLevel)}风险 ${a.risk.score}</span></div>
        <div class="decision-grid"><article><span>下一步先做</span><strong>${esc(a.actions[0])}</strong></article><article><span>处理意向</span><strong>${esc(a.preferences.join("；") || "客户未明确选择处理方式")}</strong></article><article><span>服务边界</span><strong>${esc(a.doNotCommit[0])}</strong></article></div>
        ${a.needsHumanReview ? `<div class="ai-review-notice"><strong>需要人工复核</strong><span>${esc(a.reviewReason || "模型对当前判断信心不足或存在高风险信息。")}</span></div>` : ""}
      </section>

      <section id="module-emotion" class="dashboard-section">
        <header class="module-heading"><div><span class="module-index">01</span><h3>情绪与沟通策略</h3></div><span class="method-badge">${esc(emotion.method)}</span></header>
        <div class="emotion-overview"><div><span class="small-label">当前策略组</span><strong class="emotion-name">${esc(emotion.groupZh)}</strong><span class="emotion-en">${esc(emotion.groupEn)}</span></div><div class="emotion-stat"><b>${emotion.confidence}%</b><span>组别置信度 · ${esc(emotion.confidenceLabel)}</span></div></div>
        <div class="emotion-tags">${labels}</div>
        <div class="vad-grid">${vadMeter("V", "愉悦度", emotion.vad.valence, "越低越负面")} ${vadMeter("A", "唤醒度", emotion.vad.arousal, "越高越激动")} ${vadMeter("D", "掌控感", emotion.vad.dominance, "越高越有控制感")}</div>
        <div class="emotion-facts"><div><span>情绪变化</span><b>${esc(emotion.trend)}</b></div><div><span>建议策略</span><b>${esc(emotion.responseStrategies.join("、"))}</b></div><div><span>客户希望我们怎么解决</span><b>${esc(a.preferences.join("；") || "尚未表达明确处理方式")}</b></div></div>
        <details class="sub-details"><summary>查看每轮客户情绪变化</summary><div class="emotion-trajectory">${emotion.trajectory.map(trajectoryPoint).join("")}</div></details>
        <details class="sub-details"><summary>查看 GoEmotions 28 种完整标签</summary><p class="detail-note">细标签可多选；高亮项为本会话近期识别结果。客服界面不要求 28 项始终展开。</p><div class="taxonomy-grid">${taxonomy}</div></details>
      </section>

      <section id="module-verify" class="dashboard-section">
        <header class="module-heading"><div><span class="module-index">02</span><h3>业务事实核验</h3></div><span>${a.conflicts.length} 项差异</span></header>
        <div class="business-timeline">${buildTimeline(a).map(timelineItem).join("")}</div>
        <div class="timeline-alerts">${conflicts}</div>
      </section>

      <section id="module-risk" class="dashboard-section">
        <header class="module-heading"><div><span class="module-index">03</span><h3>风险面板</h3></div><span>识别 → 分派 → 跟进 → 关闭</span></header>
        <div class="risk-overview"><div class="risk-ring" style="--risk-score:${a.risk.score * 3.6}deg"><b>${a.risk.score}</b><span>风险分</span></div><div class="risk-meta"><p><span>风险等级</span><b class="${riskClass(a.riskLevel)} text-risk">${esc(a.riskLevel)}</b></p><p><span>建议负责人</span><b>${esc(a.risk.owner)}</b></p><p><span>响应要求</span><b>${esc(a.risk.responseSla)}</b></p><p><span>立即动作</span><b>${esc(a.risk.nextAction)}</b></p></div></div>
        <div class="risk-reason-grid">${risks}</div>
        <details class="sub-details" ${manualRisks.length ? "open" : ""}><summary>人工跟进事件（${manualRisks.length}）</summary><div>${manualRiskHtml}</div></details>
        <button id="create-risk" class="button primary full-button" type="button">人工确认并创建风险事件</button>
      </section>

      <section id="module-reply" class="dashboard-section">
        <header class="module-heading"><div><span class="module-index">04</span><h3>处理方案与回复</h3></div><span>AI 起草，人工发送</span></header>
        <div class="solution-columns"><div><span class="small-label">建议行动</span>${list(a.actions, true)}</div><div class="boundary-box"><span class="small-label">暂时不能承诺</span>${list(a.doNotCommit)}</div></div>
        ${a.unanswered.length ? `<div class="unanswered-box"><strong>尚未直接回答</strong>${list(a.unanswered)}</div>` : ""}
        <div class="draft-card"><label for="ai-draft">通俗版回复草稿</label><textarea id="ai-draft">${esc(a.draft)}</textarea><div class="draft-actions"><span>请核对事实、语气与承诺后再发送</span><button id="insert-draft" class="button primary" type="button">插入人工回复框</button></div></div>
      </section>

      <section id="module-experience" class="dashboard-section">
        <header class="module-heading"><div><span class="module-index">05</span><h3>经验参考</h3></div><span>摘要弹窗，不离开当前会话</span></header>
        <div class="experience-list">${similarHtml}</div>
        <details class="sub-details"><summary>案例沉淀与审核</summary><div>${caseHtml}</div></details>
        <button id="prepare-case" class="button secondary full-button" type="button">将当前处理生成候选案例</button>
      </section>`;

    bindDashboardEvents();
  }

  function vadMeter(letter, label, value, note) { return `<div class="vad-item"><div><b>${letter}</b><span>${esc(label)}</span><strong>${value}/5</strong></div><div class="vad-track"><span style="width:${value * 20}%"></span></div><small>${esc(note)}</small></div>`; }
  function trajectoryPoint(point) { return `<article><span class="trajectory-dot"></span><div><div class="trajectory-head"><b>第 ${esc(point.seq)} 条 · ${esc(point.groupZh)}</b><span>V${point.vad.valence} A${point.vad.arousal} D${point.vad.dominance}</span></div><p>${esc(point.text)}</p><small>${point.labels.map((label) => esc(label.zh)).join("、")}</small></div></article>`; }

  function buildTimeline(a) {
    const rows = [];
    const firstBuyer = a.messages.find((item) => item["角色"] === "买家");
    if (firstBuyer) rows.push({ time: firstBuyer["发送时间"], source: "聊天", title: "消费者提出问题", detail: a.request, state: "normal" });
    if (a.order) {
      [["下单时间", "订单创建"], ["付款时间", "订单付款"], ["发货时间", "订单发货"]].forEach(([key, title]) => { if (a.order[key]) rows.push({ time: a.order[key], source: "订单", title, detail: `${a.order["订单号"]} · ${a.order["订单状态"]}`, state: "normal" }); });
    }
    a.tickets.forEach((ticket) => {
      rows.push({ time: ticket["创建时间"] || "时间待核验", source: ticket._ticket_type, title: `工单 ${ticket["工单号"] || ""} 创建`, detail: ticket["处理方案"] || ticket["任务状态"] || ticket["工单状态"] || "等待处理", state: "ticket" });
      if (ticket["完成时间"]) rows.push({ time: ticket["完成时间"], source: ticket._ticket_type, title: `工单 ${ticket["工单号"] || ""} 完成`, detail: ticket["任务状态"] || ticket["工单状态"] || "已完成", state: "done" });
    });
    a.commitments.forEach((item) => rows.push({ time: item.time, source: "客服承诺", title: "承诺待核验", detail: item.text, state: "warning" }));
    return rows.sort((left, right) => String(left.time).localeCompare(String(right.time))).slice(0, 9);
  }
  function timelineItem(item) { return `<article class="timeline-item ${item.state}"><div class="timeline-marker"></div><div><div class="timeline-top"><span>${esc(shortTime(item.time))}</span><b>${esc(item.source)}</b></div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div></article>`; }

  function bindDashboardEvents() {
    el.content.querySelectorAll("[data-evidence]").forEach((button) => button.addEventListener("click", focusEvidence));
    el.content.querySelectorAll("[data-preview-session]").forEach((button) => button.addEventListener("click", () => openCaseModal(button.dataset.previewSession)));
    el.content.querySelectorAll("[data-risk-id][data-status]").forEach((button) => button.addEventListener("click", () => updateRisk(button.dataset.riskId, button.dataset.status)));
    el.content.querySelectorAll("[data-approve-case]").forEach((button) => button.addEventListener("click", () => updateCase(button.dataset.approveCase, "已审核")));
    el.content.querySelectorAll("[data-stop-case]").forEach((button) => button.addEventListener("click", () => updateCase(button.dataset.stopCase, "停止推荐")));
    byId("insert-draft").addEventListener("click", () => { el.reply.value = byId("ai-draft").value; el.draftSource.textContent = "AI 草稿，等待人工审核"; showToast("草稿已插入，请审核后再发送。", false); });
    byId("create-risk").addEventListener("click", createRisk);
    byId("prepare-case").addEventListener("click", prepareCase);
  }

  function focusEvidence() {
    const a = analysisFor(selected());
    const target = [...a.messages].reverse().find((message) => message["角色"] === "买家" && /换|到账|退款|发错|过敏|物流/.test(message["message_text"])) || a.messages.find((message) => message["角色"] === "买家");
    const node = target && byId(`msg-${target["消息序号"]}`);
    if (!node) return;
    document.querySelectorAll(".evidence-focus").forEach((item) => item.classList.remove("evidence-focus"));
    node.classList.add("evidence-focus");
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => node.classList.remove("evidence-focus"), 2200);
  }

  function currentRisks() { return state.risks.filter((risk) => risk.sessionId === state.selectedId); }
  function riskEventHtml(event) {
    const statuses = ["已确认并分派", "处理中", "待核验", "已关闭"];
    return `<article class="manual-event"><div class="card-title-row"><strong>${esc(event.title)}</strong><span class="status-chip active">${esc(event.status)}</span></div><p>负责人：${esc(event.owner)}<br>下一步：${esc(event.nextAction)}</p><div class="risk-actions">${statuses.map((status) => `<button class="button small ${event.status === status ? "primary" : "secondary"}" data-risk-id="${esc(event.id)}" data-status="${esc(status)}" type="button">${esc(status)}</button>`).join("")}</div></article>`;
  }
  function createRisk() {
    const a = analysisFor(selected());
    state.risks.unshift({ id: `RISK-${Date.now()}`, sessionId: state.selectedId, title: a.risk.reasons[0] ? a.risk.reasons[0].title : "服务事项需要跟进", status: "已确认并分派", owner: a.risk.owner, nextAction: a.risk.nextAction, createdAt: new Date().toLocaleString("zh-CN", { hour12: false }) });
    saveStorage("zhimei-risk-events", state.risks);
    showToast("风险事件已创建并分派。", false);
    renderDashboard();
  }
  function updateRisk(id, status) {
    const event = state.risks.find((item) => item.id === id);
    if (!event) return;
    if (status === "已关闭" && event.status !== "待核验") return showToast("关闭前需先进入“待核验”并确认关闭依据。", true);
    event.status = status;
    saveStorage("zhimei-risk-events", state.risks);
    showToast(`风险状态已更新为“${status}”。`, false);
    renderDashboard();
  }

  function openCaseModal(sessionId) {
    const item = state.summaries.find((entry) => entry.id === sessionId);
    if (!item) return;
    const a = analysisFor(item);
    el.modalTitle.textContent = `${a.sceneMinor} · ${item.id}`;
    el.modalContent.innerHTML = `<div class="modal-summary"><span>AI 归纳的核心诉求</span><strong>${esc(a.request)}</strong></div><div class="modal-grid"><div><span>可借鉴</span>${list(a.actions)}</div><div class="boundary-box"><span>不可照搬</span>${list(a.doNotCommit)}</div></div><div class="modal-notice">相似案例只提供处理思路。使用前仍需核对当前订单、规则版本、消费者选择和业务执行状态。</div>`;
    el.modal.hidden = false;
  }
  function closeCaseModal() { el.modal.hidden = true; }
  function caseItemHtml(item) { return `<article class="manual-event"><div class="card-title-row"><strong>${esc(item.title)}</strong><span class="status-chip ${item.status === "已审核" ? "active" : ""}">${esc(item.status)}</span></div><p>可借鉴：${esc(item.lesson)}<br>不可照搬：${esc(item.boundary)}</p><div class="case-actions">${item.status !== "已审核" ? `<button class="button primary small" data-approve-case="${esc(item.id)}" type="button">人工审核通过</button>` : ""}<button class="button secondary small" data-stop-case="${esc(item.id)}" type="button">停止推荐</button></div></article>`; }
  function prepareCase() {
    const a = analysisFor(selected());
    state.cases.unshift({ id: `CASE-${Date.now()}`, sessionId: state.selectedId, title: `${a.sceneMinor}处理案例`, status: "待审核", lesson: a.actions.join("；"), boundary: a.doNotCommit.join("；"), createdAt: new Date().toISOString() });
    saveStorage("zhimei-cases", state.cases);
    showToast("候选案例已生成，审核前不会进入正式推荐库。", false);
    renderDashboard();
  }
  function updateCase(id, status) {
    const item = state.cases.find((entry) => entry.id === id);
    if (!item) return;
    item.status = status;
    saveStorage("zhimei-cases", state.cases);
    showToast(`案例状态已更新为“${status}”。`, false);
    renderDashboard();
  }

  function showToast(message, isError) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.style.borderLeft = `3px solid ${isError ? "#d92d20" : "#33a474"}`;
    toast.textContent = message;
    el.toast.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  initialise();
})();
