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
    copilotView: { insight: "emotion", bottom: "workbench" },
    copilotChats: new Map(), replyPreviews: new Map(),
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
    el.analysisState.title = item && state.aiErrors.has(item.id) ? state.aiErrors.get(item.id) : "点击配置或检查AI连接";
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
    const item = selected();
    const currentError = item && state.aiErrors.get(item.id);
    el.aiConfigResult.className = `connection-result${currentError ? " error" : ""}`;
    el.aiConfigResult.textContent = currentError || "点击“测试连接”检查后端与模型服务配置。";
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
    const appealQuotes = customerAppealQuotes(a);
    const intensity = Number(emotion.vad.arousal) >= 4 ? "高" : Number(emotion.vad.arousal) >= 3 ? "中" : "低";
    const trendIcon = /升|加剧|恶化|上/.test(emotion.trend) ? "↗" : /降|缓和|改善|下/.test(emotion.trend) ? "↘" : "→";
    const eventTags = unique([a.sceneMinor, ...(a.conflicts.length ? [`${a.conflicts.length}项数据差异`] : []), ...(a.unanswered.length ? [`${a.unanswered.length}个问题待答`] : []), ...(a.commitments.length ? ["承诺待核验"] : [])]).slice(0, 4);
    const chats = ensureCopilotChat(a);
    const preview = state.replyPreviews.get(state.selectedId) || a.draft;

    el.content.innerHTML = `
      <div class="copilot-board">
        <section id="module-overview" class="copilot-zone overview-zone" aria-label="当前判断概览">
          <div class="zone-tabs" role="tablist" aria-label="情绪与风险">
            <button class="zone-tab ${state.copilotView.insight === "emotion" ? "active" : ""}" data-insight-tab="emotion" role="tab" aria-selected="${state.copilotView.insight === "emotion"}" type="button">情绪</button>
            <button class="zone-tab ${state.copilotView.insight === "risk" ? "active" : ""}" data-insight-tab="risk" role="tab" aria-selected="${state.copilotView.insight === "risk"}" type="button">风险 <span class="mini-risk ${riskClass(a.riskLevel)}">${esc(a.riskLevel)}</span></button>
          </div>

          <div id="module-emotion" class="insight-panel" data-insight-panel="emotion" ${state.copilotView.insight === "emotion" ? "" : "hidden"}>
            <div class="insight-compact" tabindex="0">
              <div><span class="insight-label">当前策略组</span><strong>${esc(emotion.groupZh)}</strong><small>${esc(emotion.groupEn)}</small></div>
              <div class="insight-metrics"><span><b>${intensity}</b>强度</span><span><b>${trendIcon}</b>${esc(emotion.trend)}</span><span><b>${emotion.confidence}%</b>置信度</span></div>
              <div class="insight-hover-tip">悬停或展开查看判断依据</div>
            </div>
            <details class="compact-details"><summary>情绪依据与沟通策略</summary><div class="insight-detail-scroll">
              <div class="emotion-tags">${labels}</div>
              <div class="vad-grid">${vadMeter("V", "愉悦度", emotion.vad.valence, "正负面")} ${vadMeter("A", "唤醒度", emotion.vad.arousal, "激动程度")} ${vadMeter("D", "掌控感", emotion.vad.dominance, "控制感")}</div>
              <div class="emotion-facts"><div><span>建议策略</span><b>${esc(emotion.responseStrategies.join("、"))}</b></div><div><span>明确偏好</span><b>${esc(a.preferences.join("；") || "客户尚未明确选择处理方式")}</b></div><div><span>判断来源</span><b>${esc(emotion.method)}</b></div></div>
              <details class="sub-details"><summary>每轮客户情绪变化</summary><div class="emotion-trajectory">${emotion.trajectory.map(trajectoryPoint).join("")}</div></details>
              <details class="sub-details"><summary>GoEmotions 28 种完整标签</summary><p class="detail-note">细标签允许多选；高亮项是本会话当前识别结果。</p><div class="taxonomy-grid">${taxonomy}</div></details>
            </div></details>
          </div>

          <div id="module-risk" class="insight-panel" data-insight-panel="risk" ${state.copilotView.insight === "risk" ? "" : "hidden"}>
            <div class="risk-compact" tabindex="0">
              <div class="risk-ring small" style="--risk-score:${a.risk.score * 3.6}deg"><b>${a.risk.score}</b><span>风险分</span></div>
              <div class="risk-summary-copy"><span class="risk-tag ${riskClass(a.riskLevel)}">${esc(a.riskLevel)}风险</span><strong>${esc(a.risk.nextAction)}</strong><small>${esc(a.risk.owner)} · ${esc(a.risk.responseSla)}</small></div>
            </div>
            <details class="compact-details"><summary>异常依据与跟进闭环</summary><div class="insight-detail-scroll">
              <div class="risk-reason-grid">${risks}</div>
              <details class="sub-details" ${manualRisks.length ? "open" : ""}><summary>人工跟进事件（${manualRisks.length}）</summary><div>${manualRiskHtml}</div></details>
              <button id="create-risk" class="button primary full-button" type="button">人工确认并创建风险事件</button>
            </div></details>
          </div>

          <div class="appeal-brief">
            <div class="event-tag-row">${eventTags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
            <div class="appeal-row"><span>核心诉求</span><blockquote>“${esc(appealQuotes.primary)}”</blockquote></div>
            <div class="appeal-row secondary"><span>次要诉求</span><p>${esc(appealQuotes.secondary)}</p></div>
            <div class="appeal-row action"><span>建议解决方式</span><p>${esc(a.actions[0] || "先核验事实，再向客户说明可执行方案")}</p></div>
          </div>
          ${a.needsHumanReview ? `<div class="ai-review-notice"><strong>需人工复核</strong><span>${esc(a.reviewReason || "模型对当前判断信心不足或存在高风险信息。")}</span></div>` : ""}
        </section>

        <section id="module-verify" class="copilot-zone timeline-zone" aria-label="业务核验时间线">
          <header class="zone-heading"><div><span class="zone-index">02</span><div><h3>业务核验时间线</h3><p>只保留会改变状态、责任或判断的节点</p></div></div><span class="difference-count">${a.conflicts.length} 项差异</span></header>
          <div class="timeline-scroll"><div class="business-timeline">${buildTimeline(a).map(timelineItem).join("")}</div></div>
          <details class="timeline-differences"><summary>查看数据差异与证据</summary><div class="timeline-alerts">${conflicts}</div></details>
        </section>

        <section class="copilot-zone workbench-zone" aria-label="回复与经验工作台">
          <div class="zone-tabs bottom-tabs" role="tablist" aria-label="回复工作台页面">
            <button class="zone-tab ${state.copilotView.bottom === "workbench" ? "active" : ""}" data-bottom-tab="workbench" role="tab" aria-selected="${state.copilotView.bottom === "workbench"}" type="button">回复与 AI 对话</button>
            <button class="zone-tab ${state.copilotView.bottom === "experience" ? "active" : ""}" data-bottom-tab="experience" role="tab" aria-selected="${state.copilotView.bottom === "experience"}" type="button">模拟与经验</button>
          </div>

          <div id="module-reply" class="workbench-page" data-bottom-panel="workbench" ${state.copilotView.bottom === "workbench" ? "" : "hidden"}>
            <article class="reply-pane">
              <header><div><strong>建议回复</strong><span>可直接编辑</span></div><span class="source-tag">${esc(analysisSource)}</span></header>
              <textarea id="ai-draft" aria-label="AI 建议回复">${esc(a.draft)}</textarea>
              <details class="reply-guidance"><summary>行动与承诺边界</summary><div><span>建议行动</span>${list(a.actions, true)}<span>暂不能承诺</span>${list(a.doNotCommit)}</div></details>
              <div class="pane-actions"><button id="preview-draft" class="button secondary small" type="button">预览效果</button><button id="insert-draft" class="button primary small" type="button">插入人工回复</button></div>
            </article>
            <article class="chat-pane">
              <header><div><strong>AI 对话</strong><span>围绕当前会话追问</span></div><span class="online-dot" title="基于当前分析"></span></header>
              <div id="copilot-chat-log" class="chat-log">${chats.map((message) => `<div class="chat-message ${message.role}"><span>${message.role === "assistant" ? "AI" : "我"}</span><p>${esc(message.text)}</p></div>`).join("")}</div>
              <div class="chat-suggestions"><button data-chat-prompt="风险点是什么？" type="button">风险点</button><button data-chat-prompt="我该先做什么？" type="button">下一步</button></div>
              <form id="copilot-chat-form" class="chat-form"><input id="copilot-chat-input" aria-label="向 AI 追问" placeholder="追问当前会话…" autocomplete="off"><button type="submit" aria-label="发送">↑</button></form>
            </article>
          </div>

          <div id="module-experience" class="workbench-page experience-page" data-bottom-panel="experience" ${state.copilotView.bottom === "experience" ? "" : "hidden"}>
            <article class="simulation-pane">
              <header><strong>回复模拟结果</strong><span>发送前预览</span></header>
              <div class="simulated-bubble">${esc(preview)}</div>
              <div class="simulation-checks"><span>✓ 通俗表达</span><span>✓ 保留人工确认</span><span>${a.riskLevel === "高" ? "! 高风险需复核" : "✓ 风险可控"}</span></div>
            </article>
            <article class="experience-pane">
              <header><strong>经验参考</strong><span>点击后弹窗查看 AI 摘要</span></header>
              <div class="experience-list">${similarHtml}</div>
              <details class="sub-details"><summary>案例沉淀与审核</summary><div>${caseHtml}</div></details>
              <button id="prepare-case" class="button secondary full-button" type="button">生成候选案例</button>
            </article>
          </div>
        </section>
      </div>`;

    bindDashboardEvents();
  }

  function customerAppealQuotes(a) {
    const buyerTexts = a.messages.filter((item) => item["角色"] === "买家").map((item) => String(item["message_text"] || "").trim()).filter(Boolean);
    const meaningful = buyerTexts.filter((text) => text.length >= 5 && !/^(好|好的|谢谢|嗯|行|可以)[。！!？?]*$/.test(text));
    const primary = [...meaningful].reverse().find((text) => /退|换|到账|过敏|物流|发错|补发|积分|怎么|为什么|何时|多久/.test(text)) || meaningful[0] || buyerTexts[0] || a.request;
    const secondary = meaningful.find((text) => text !== primary) || a.preferences[0] || a.unanswered[0] || "未发现第二项明确诉求";
    return { primary, secondary };
  }

  function ensureCopilotChat(a) {
    if (!state.copilotChats.has(state.selectedId)) {
      state.copilotChats.set(state.selectedId, [{ role: "assistant", text: `我已读完当前会话。第一步建议：${a.actions[0] || "核验业务事实"}。需要我解释情绪、风险或回复理由都可以。` }]);
    }
    return state.copilotChats.get(state.selectedId);
  }

  function buildCopilotChatReply(a, prompt) {
    if (/风险|升级|危险/.test(prompt)) return `当前为${a.riskLevel}风险（${a.risk.score}分）。主要依据是${a.risk.reasons.slice(0, 2).map((item) => item.title).join("、") || "暂无明确触发项"}。建议由${a.risk.owner}按“${a.risk.nextAction}”推进。`;
    if (/情绪|态度|生气|心情/.test(prompt)) return `客户当前更接近“${a.emotion.groupZh}”，强度${Number(a.emotion.vad.arousal) >= 4 ? "高" : Number(a.emotion.vad.arousal) >= 3 ? "中" : "低"}，建议采用${a.emotion.responseStrategies.join("、")}。`;
    if (/回复|怎么说|话术/.test(prompt)) return `可以先明确回应客户的问题，再说明正在核验，最后给出下一步。现有草稿是：“${a.draft}” 请在发送前核对事实和承诺。`;
    if (/事实|核验|冲突|差异/.test(prompt)) return a.conflicts.length ? `目前有${a.conflicts.length}项数据差异：${a.conflicts.map((item) => item.title).join("、")}。可在时间线下方定位聊天证据。` : "当前没有发现明确的跨源冲突，但仍需按实际业务结果做最终确认。";
    if (/下一步|先做|处理/.test(prompt)) return `建议按顺序处理：${a.actions.slice(0, 3).join("；")}。暂时不要承诺：${a.doNotCommit[0] || "未经核验的时效或结果"}。`;
    return `结合当前会话，核心是先处理“${a.request}”。我建议先${a.actions[0] || "核验事实"}，并避免承诺${a.doNotCommit[0] || "未经确认的处理结果"}。`;
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
    const switchPanels = (buttonSelector, panelSelector, activeValue, stateKey) => {
      state.copilotView[stateKey] = activeValue;
      el.content.querySelectorAll(buttonSelector).forEach((button) => {
        const selected = button.dataset[`${stateKey}Tab`] === activeValue;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      el.content.querySelectorAll(panelSelector).forEach((panel) => { panel.hidden = panel.dataset[`${stateKey}Panel`] !== activeValue; });
    };
    el.content.querySelectorAll("[data-insight-tab]").forEach((button) => button.addEventListener("click", () => switchPanels("[data-insight-tab]", "[data-insight-panel]", button.dataset.insightTab, "insight")));
    el.content.querySelectorAll("[data-bottom-tab]").forEach((button) => button.addEventListener("click", () => switchPanels("[data-bottom-tab]", "[data-bottom-panel]", button.dataset.bottomTab, "bottom")));
    el.content.querySelectorAll("[data-evidence]").forEach((button) => button.addEventListener("click", focusEvidence));
    el.content.querySelectorAll("[data-preview-session]").forEach((button) => button.addEventListener("click", () => openCaseModal(button.dataset.previewSession)));
    el.content.querySelectorAll("[data-risk-id][data-status]").forEach((button) => button.addEventListener("click", () => updateRisk(button.dataset.riskId, button.dataset.status)));
    el.content.querySelectorAll("[data-approve-case]").forEach((button) => button.addEventListener("click", () => updateCase(button.dataset.approveCase, "已审核")));
    el.content.querySelectorAll("[data-stop-case]").forEach((button) => button.addEventListener("click", () => updateCase(button.dataset.stopCase, "停止推荐")));
    byId("insert-draft").addEventListener("click", () => { el.reply.value = byId("ai-draft").value; el.draftSource.textContent = "AI 草稿，等待人工审核"; showToast("草稿已插入，请审核后再发送。", false); });
    byId("preview-draft").addEventListener("click", () => {
      const draft = byId("ai-draft").value.trim();
      if (!draft) return showToast("请先填写回复内容。", true);
      state.replyPreviews.set(state.selectedId, draft);
      const bubble = el.content.querySelector(".simulated-bubble");
      if (bubble) bubble.textContent = draft;
      switchPanels("[data-bottom-tab]", "[data-bottom-panel]", "experience", "bottom");
    });
    const chatForm = byId("copilot-chat-form");
    const chatInput = byId("copilot-chat-input");
    const submitChat = (prompt) => {
      const value = String(prompt || chatInput.value).trim();
      if (!value) return;
      const a = analysisFor(selected());
      const messages = ensureCopilotChat(a);
      messages.push({ role: "user", text: value }, { role: "assistant", text: buildCopilotChatReply(a, value) });
      chatInput.value = "";
      const log = byId("copilot-chat-log");
      log.insertAdjacentHTML("beforeend", `<div class="chat-message user"><span>我</span><p>${esc(value)}</p></div><div class="chat-message assistant"><span>AI</span><p>${esc(messages[messages.length - 1].text)}</p></div>`);
      log.scrollTop = log.scrollHeight;
    };
    chatForm.addEventListener("submit", (event) => { event.preventDefault(); submitChat(); });
    el.content.querySelectorAll("[data-chat-prompt]").forEach((button) => button.addEventListener("click", () => submitChat(button.dataset.chatPrompt)));
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
