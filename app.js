(function () {
  "use strict";

  const data = window.ZHIMEI_DATA;
  const core = window.ZhimeiCore;
  if (!data || !core) {
    document.body.innerHTML = "<p style='padding:24px'>数据或分析模块加载失败。请运行数据构建脚本并通过本地服务器打开。</p>";
    return;
  }

  const index = core.buildIndex(data);
  const state = {
    summaries: [],
    filtered: [],
    selectedId: "S00018",
    activeTab: "assist",
    riskFilter: "",
    risks: readStorage("zhimei-risk-events", []),
    cases: readStorage("zhimei-cases", []),
  };

  const el = {
    clock: byId("clock"), sessionCount: byId("session-count"), sessionList: byId("session-list"),
    search: byId("session-search"), filter: byId("scene-filter"), header: byId("conversation-header"),
    order: byId("order-strip"), messages: byId("message-list"), content: byId("copilot-content"),
    reply: byId("reply-input"), draftSource: byId("draft-source"), toast: byId("toast-region"),
    queue: byId("queue-summary"), context: byId("conversation-context"), copilotSession: byId("copilot-session"),
  };

  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
  }
  function readStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function saveStorage(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function selected() { return state.summaries.find((item) => item.id === state.selectedId) || state.summaries[0]; }
  function riskClass(level) { return level === "高" ? "risk-high" : level === "中" ? "risk-medium" : "risk-low"; }
  function shortTime(value) { return String(value || "").slice(5, 16); }

  function initialise() {
    state.summaries = [...index.sessions.entries()].map(([id, messages]) => core.sessionSummary(id, messages, index));
    state.summaries.sort((a, b) => String(b.lastTime).localeCompare(String(a.lastTime)));
    if (!state.summaries.some((s) => s.id === state.selectedId)) state.selectedId = state.summaries[0] && state.summaries[0].id;
    populateSceneFilter();
    filterSessions();
    bindEvents();
    updateClock();
    setInterval(updateClock, 1000);
  }

  function populateSceneFilter() {
    const scenes = [...new Set(state.summaries.map((s) => s.sceneMajor).filter(Boolean))].sort();
    el.filter.insertAdjacentHTML("beforeend", scenes.map((scene) => `<option value="${esc(scene)}">${esc(scene)}</option>`).join(""));
  }

  function bindEvents() {
    el.search.addEventListener("input", filterSessions);
    el.filter.addEventListener("change", filterSessions);
    document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
      renderCopilot();
    }));
    byId("clear-reply").addEventListener("click", () => { el.reply.value = ""; el.draftSource.textContent = "等待客服输入"; });
    byId("simulate-send").addEventListener("click", () => {
      if (!el.reply.value.trim()) return showToast("请输入回复内容后再发送。", true);
      showToast("已模拟发送。真实版本需要接入客服平台发送接口。", false);
      el.draftSource.textContent = "人工已确认并模拟发送";
    });
  }

  function updateClock() {
    el.clock.textContent = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(new Date());
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
      </button>
    `).join("") || `<div class="empty-state">没有符合筛选条件的会话。</div>`;
    el.sessionList.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", () => selectSession(button.dataset.session)));
  }

  function selectSession(id) {
    state.selectedId = id;
    renderSessionList();
    renderWorkspace();
  }

  function renderWorkspace() {
    const item = selected();
    if (!item) return;
    const a = item.analysis;
    el.header.innerHTML = `
      <div class="conversation-person"><h2>${esc(item.buyer)}</h2><p>${esc(item.id)} · ${esc(a.sceneMajor)} / ${esc(a.sceneMinor)}</p></div>
      <div class="conversation-meta"><strong>${a.messages.length} 条消息</strong><span>${a.tickets.length} 张关联工单 · ${a.order ? "已关联订单" : "无关联订单"}</span></div>`;
    el.copilotSession.textContent = `${item.id} · ${a.sceneMinor}`;
    renderOrder(a.order);
    renderContext(a);
    renderMessages(a.messages);
    renderCopilot();
  }

  function renderContext(a) {
    const commitments = a.commitments.length;
    const unresolved = a.unanswered.length;
    el.context.innerHTML = `
      <span class="context-label">本次处理重点</span>
      <span class="context-chip important">${esc(a.riskLevel)}风险</span>
      <span class="context-chip">${a.conflicts.length} 项数据差异</span>
      <span class="context-chip">${unresolved} 个待回答问题</span>
      <span class="context-chip">${commitments} 项承诺待核验</span>`;
  }

  function renderOrder(order) {
    if (!order) {
      el.order.innerHTML = `<span class="no-data">当前会话没有关联订单。插件保持空结果，不补造订单信息。</span>`;
      return;
    }
    el.order.innerHTML = `<div class="order-card"><div><strong>${esc(order["商品名称"])}</strong><p>订单 ${esc(order["订单号"])} · ${esc(order["订单状态"])} · ${esc(order["快递公司"] || "暂无物流")}</p></div><div class="order-amount">¥${esc(order["实付金额(元)"])}<br><span class="status-chip">${esc(order["发货时间"] || "待发货")}</span></div></div>`;
  }

  function renderMessages(messages) {
    el.messages.innerHTML = messages.map((m) => {
      const roleClass = m["角色"] === "买家" ? "buyer" : "agent";
      const image = m["内容类型"] === "图片" ? `<div class="image-placeholder">图片消息路径：${esc(m["image_path"])}<br>当前数据未提供真实文件，等待人工核验。</div>` : "";
      return `<article id="msg-${esc(m["消息序号"])}" class="message-row ${roleClass}"><div class="message-bubble"><div class="message-meta"><span>${esc(m["发送方"] || m["角色"])}</span><span>${esc(m["发送时间"])}</span></div><div class="message-text">${esc(m["message_text"])}${image}</div></div></article>`;
    }).join("");
    requestAnimationFrame(() => { el.messages.scrollTop = el.messages.scrollHeight; });
  }

  function renderCopilot() {
    updateWorkflowSteps();
    if (state.activeTab === "assist") renderAssist();
    if (state.activeTab === "risk") renderRisk();
    if (state.activeTab === "case") renderCases();
  }

  function updateWorkflowSteps() {
    const activeStep = state.activeTab === "assist" ? 3 : 4;
    document.querySelectorAll(".workflow-step").forEach((step, index) => {
      const number = index + 1;
      step.classList.toggle("completed", number < activeStep || (state.activeTab === "case" && number <= activeStep));
      step.classList.toggle("active", number === activeStep && state.activeTab !== "case");
    });
  }

  function infoCard(title, body, extraClass = "") {
    return `<section class="info-card ${extraClass}"><header class="info-card-header"><div class="card-title-row"><h3>${esc(title)}</h3></div></header><div class="info-card-body">${body}</div></section>`;
  }
  function sectionBlock(title, caption, body) {
    return `<section class="content-section"><header class="section-heading"><h3>${esc(title)}</h3><p>${esc(caption)}</p></header>${body}</section>`;
  }
  function collapsibleCard(title, body, open = false, extraClass = "") {
    return `<details class="info-card collapsible ${extraClass}" ${open ? "open" : ""}><summary>${esc(title)}</summary><div class="info-card-body">${body}</div></details>`;
  }
  function list(items, numbered = false) {
    return `<ol class="list-clean ${numbered ? "number-list" : ""}">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`;
  }

  function renderAssist() {
    const a = selected().analysis;
    const conflictHtml = a.conflicts.map((conflict) => infoCard(conflict.title, `
      <div class="conflict-title">记录差异，需要人工核验</div><p class="conflict-detail">${esc(conflict.detail)}</p>
      <div class="source-row">${conflict.sources.map((source) => `<span class="source-tag">${esc(source)}</span>`).join("")}<button class="source-link" data-evidence="true" type="button">定位聊天证据</button></div>`, "conflict-card")).join("");
    const unresolved = a.unanswered.length ? list(a.unanswered) : `<span class="fact-value">未发现明显漏答问题</span>`;
    el.content.innerHTML = `
      <section class="ai-summary"><div class="ai-summary-top"><h3>当前核心诉求</h3><span class="summary-risk">${esc(a.riskLevel)}风险</span></div><p>${esc(a.request)}</p></section>
      ${sectionBlock("1. 理解消费者", "诉求、顾虑与情绪", infoCard("消费者处境", `<div class="fact-grid"><div><span class="fact-label">关键顾虑</span><span class="fact-value">${esc(a.concerns.join("；"))}</span></div><div><span class="fact-label">明确偏好</span><span class="fact-value">${esc(a.preferences.join("；") || "未提取到明确偏好")}</span></div><div><span class="fact-label">情绪信号</span><span class="fact-value">${esc(a.emotion.label)}，趋势${esc(a.emotion.trend)}</span></div><div><span class="fact-label">判断置信度</span><span class="fact-value">${esc(a.emotion.confidence)}，需人工确认</span></div></div>`) + collapsibleCard("尚未回应的问题", unresolved, a.unanswered.length > 0))}
      ${sectionBlock("2. 核验业务事实", `${a.conflicts.length} 项记录差异`, conflictHtml || infoCard("核验结果", `<span class="fact-value">暂未发现聊天、订单与工单之间的明确冲突。</span>`))}
      ${sectionBlock("3. 制定处理方案", "行动顺序与服务边界", infoCard("建议下一步", list(a.actions, true)) + collapsibleCard("暂时不能承诺", list(a.doNotCommit), true, "do-not"))}
      ${sectionBlock("4. 准备人工回复", "AI 起草，人工确认发送", infoCard("回复草稿", `<div class="draft-card"><textarea id="ai-draft">${esc(a.draft)}</textarea><button id="insert-draft" class="button primary" type="button">插入人工回复框</button></div>`))}
      ${sectionBlock("依据与可追溯性", "支持人工复核", collapsibleCard("查看证据与来源", `<div class="source-row">${a.evidence.map((source) => `<span class="source-tag">${esc(source)}</span>`).join("")}</div>`))}
    `;
    el.content.querySelectorAll("[data-evidence]").forEach((button) => button.addEventListener("click", focusEvidence));
    const insert = byId("insert-draft");
    if (insert) insert.addEventListener("click", () => {
      el.reply.value = byId("ai-draft").value;
      el.draftSource.textContent = "AI 草稿，等待人工审核";
      showToast("草稿已插入。请审核、修改后再模拟发送。", false);
    });
  }

  function focusEvidence() {
    const a = selected().analysis;
    const target = a.preferences[0] ? a.messages.find((m) => String(m["message_text"]).includes(a.preferences[0])) : a.messages.find((m) => m["角色"] === "买家");
    const node = target && byId(`msg-${target["消息序号"]}`);
    if (!node) return;
    document.querySelectorAll(".evidence-focus").forEach((item) => item.classList.remove("evidence-focus"));
    node.classList.add("evidence-focus");
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => node.classList.remove("evidence-focus"), 2200);
  }

  function currentRisks() { return state.risks.filter((risk) => risk.sessionId === state.selectedId); }
  function renderRisk() {
    const a = selected().analysis;
    const autoRisks = [
      ...a.conflicts.map((c) => ({ title: c.title, detail: c.detail, level: c.level === "high" ? "高" : "中" })),
      ...a.unanswered.map((u) => ({ title: "消费者问题尚未被直接回答", detail: u, level: "中" })),
      ...a.commitments.map((c) => ({ title: "承诺待履约核验", detail: c.text, level: "中" })),
    ];
    const autoHtml = autoRisks.length ? autoRisks.map((risk) => `<div class="risk-event"><div class="card-title-row"><h4>${esc(risk.title)}</h4><span class="risk-tag ${riskClass(risk.level)}">${esc(risk.level)}风险</span></div><p>${esc(risk.detail)}</p></div>`).join("") : `<div class="empty-state">当前没有自动识别的明确风险。客服仍需根据实际业务判断。</div>`;
    const events = currentRisks();
    const eventHtml = events.length ? events.map((event) => riskEventHtml(event)).join("") : `<div class="empty-state">尚未创建人工确认的风险事件。</div>`;
    el.content.innerHTML = `
      ${sectionBlock("风险识别", "AI 候选，需人工确认", infoCard("AI 识别的风险候选", autoHtml))}
      ${sectionBlock("人工跟进", `${events.length} 个已创建事件`, infoCard("风险事件与状态", eventHtml))}
      ${sectionBlock("承诺履约", `${a.commitments.length} 项待检查`, a.commitments.length ? infoCard("承诺清单", list(a.commitments.map((c) => `${c.time}：${c.text}（${c.status}）`))) : infoCard("承诺清单", `<span class="fact-value">当前会话未提取到明确承诺。</span>`))}
      <div class="action-footer"><button id="create-risk" class="button primary" type="button">人工确认并创建风险事件</button></div>
    `;
    byId("create-risk").addEventListener("click", createRisk);
    el.content.querySelectorAll("[data-risk-id][data-status]").forEach((button) => button.addEventListener("click", () => updateRisk(button.dataset.riskId, button.dataset.status)));
  }

  function riskEventHtml(event) {
    const statuses = ["已确认并分派", "处理中", "待核验", "已关闭"];
    return `<div class="risk-event"><div class="card-title-row"><h4>${esc(event.title)}</h4><span class="status-chip active">${esc(event.status)}</span></div><p>负责人：${esc(event.owner)} · 下一步：${esc(event.nextAction)}<br>创建时间：${esc(event.createdAt)}</p><div class="risk-actions">${statuses.map((status) => `<button class="button small ${event.status === status ? "primary" : "secondary"}" data-risk-id="${esc(event.id)}" data-status="${esc(status)}" type="button">${esc(status)}</button>`).join("")}</div></div>`;
  }

  function createRisk() {
    const a = selected().analysis;
    const primary = a.conflicts[0] || { title: a.unanswered.length ? "消费者问题未回应" : "服务事项需要跟进" };
    const event = {
      id: `RISK-${Date.now()}`,
      sessionId: state.selectedId,
      title: primary.title,
      status: "已确认并分派",
      owner: "客服主管",
      nextAction: a.actions[0],
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    };
    state.risks.unshift(event);
    saveStorage("zhimei-risk-events", state.risks);
    showToast("风险事件已创建并分派给客服主管。", false);
    renderRisk();
  }

  function updateRisk(id, status) {
    const event = state.risks.find((item) => item.id === id);
    if (!event) return;
    if (status === "已关闭" && event.status !== "待核验") return showToast("关闭前必须先进入待核验状态并确认关闭依据。", true);
    event.status = status;
    event.updatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    saveStorage("zhimei-risk-events", state.risks);
    showToast(`风险状态已更新为“${status}”。`, false);
    renderRisk();
  }

  function renderCases() {
    const current = selected();
    const similar = state.summaries
      .filter((item) => item.id !== current.id && (item.sceneMinor === current.sceneMinor || item.sceneMajor === current.sceneMajor))
      .slice(0, 5);
    const similarHtml = similar.length ? similar.map((item) => `<div class="case-item"><div class="card-title-row"><h4>${esc(item.sceneMinor)} · ${esc(item.id)}</h4><span class="case-score">${item.sceneMinor === current.sceneMinor ? "高" : "中"}适用度</span></div><p>${esc(item.analysis.request)}<br>复用前需核对订单、规则版本和执行阶段。</p><div class="case-actions"><button class="button secondary small" data-open-session="${esc(item.id)}" type="button">查看原始会话</button></div></div>`).join("") : `<div class="empty-state">没有找到同类会话。</div>`;
    const custom = state.cases.filter((item) => item.sessionId === state.selectedId || item.status === "已审核");
    const customHtml = custom.length ? custom.map((item) => `<div class="case-item"><div class="card-title-row"><h4>${esc(item.title)}</h4><span class="status-chip ${item.status === "已审核" ? "active" : ""}">${esc(item.status)}</span></div><p>可借鉴：${esc(item.lesson)}<br>不可照搬：${esc(item.boundary)}</p><div class="case-actions">${item.status !== "已审核" ? `<button class="button primary small" data-approve-case="${esc(item.id)}" type="button">人工审核通过</button>` : ""}<button class="button secondary small" data-stop-case="${esc(item.id)}" type="button">停止推荐</button></div></div>`).join("") : `<div class="empty-state">当前没有人工沉淀的案例。</div>`;
    el.content.innerHTML = `
      ${sectionBlock("相似经验", "仅供参考，不直接套用", infoCard("相似历史会话", similarHtml))}
      ${sectionBlock("案例治理", "候选案例需人工审核", infoCard("案例审核", customHtml))}
      <div class="action-footer"><button id="prepare-case" class="button primary" type="button">根据当前处理生成候选案例</button></div>
    `;
    byId("prepare-case").addEventListener("click", prepareCase);
    el.content.querySelectorAll("[data-open-session]").forEach((button) => button.addEventListener("click", () => { selectSession(button.dataset.openSession); state.activeTab = "assist"; syncTabs(); }));
    el.content.querySelectorAll("[data-approve-case]").forEach((button) => button.addEventListener("click", () => updateCase(button.dataset.approveCase, "已审核")));
    el.content.querySelectorAll("[data-stop-case]").forEach((button) => button.addEventListener("click", () => updateCase(button.dataset.stopCase, "停止推荐")));
  }

  function prepareCase() {
    const a = selected().analysis;
    state.cases.unshift({
      id: `CASE-${Date.now()}`,
      sessionId: state.selectedId,
      title: `${a.sceneMinor}处理案例`,
      status: "待审核",
      lesson: a.actions.join("；"),
      boundary: a.doNotCommit.join("；"),
      createdAt: new Date().toISOString(),
    });
    saveStorage("zhimei-cases", state.cases);
    showToast("候选案例已生成。审核通过前不会作为正式处理模板。", false);
    renderCases();
  }

  function updateCase(id, status) {
    const item = state.cases.find((entry) => entry.id === id);
    if (!item) return;
    item.status = status;
    saveStorage("zhimei-cases", state.cases);
    showToast(`案例状态已更新为“${status}”。`, false);
    renderCases();
  }

  function syncTabs() {
    document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.activeTab));
    renderCopilot();
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
