(function (root) {
  "use strict";
  const STORAGE_KEY = "zhimei-openai-api-base-url";
  const config = root.ZHIMEI_CONFIG || {};

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function getBaseUrl() {
    let stored = "";
    try { stored = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) { stored = ""; }
    return normalizeBaseUrl(stored || config.defaultApiBaseUrl);
  }

  function setBaseUrl(value) {
    const normalized = normalizeBaseUrl(value);
    try {
      if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* localStorage may be unavailable */ }
    return normalized;
  }

  function buildPayload(analysis) {
    return {
      sessionId: analysis.sessionId,
      scene: { major: analysis.sceneMajor, minor: analysis.sceneMinor },
      messages: analysis.messages.map((message) => ({
        seq: Number(message["消息序号"]),
        role: message["角色"] === "买家" ? "customer" : "agent",
        time: message["发送时间"],
        text: message["message_text"],
      })),
      order: analysis.order ? {
        orderId: analysis.order["订单号"], product: analysis.order["商品名称"],
        status: analysis.order["订单状态"], amount: analysis.order["实付金额(元)"],
        shippingCompany: analysis.order["快递公司"], shippingTime: analysis.order["发货时间"],
      } : null,
      tickets: analysis.tickets.map((ticket) => ({
        type: ticket._ticket_type, ticketId: ticket["工单号"],
        status: ticket["任务状态"] || ticket["工单状态"], createdAt: ticket["创建时间"],
        completedAt: ticket["完成时间"], action: ticket["处理方案"], product: ticket["发出商品名称"] || ticket["使用商品"],
      })),
      deterministicFindings: {
        conflicts: analysis.conflicts.map((item) => `${item.title}：${item.detail}`),
        unanswered: analysis.unanswered,
        doNotCommit: analysis.doNotCommit,
      },
    };
  }

  async function request(path, options = {}, overrideBaseUrl = "") {
    const baseUrl = normalizeBaseUrl(overrideBaseUrl || getBaseUrl());
    if (!baseUrl) throw new Error("尚未配置AI后端地址");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(config.requestTimeoutMs || 35000));
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `AI后端返回 ${response.status}`);
      return result;
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("AI分析超时，已切换本地规则");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function health(baseUrl = "") { return request("/api/health", {}, baseUrl); }
  function analyze(analysis) {
    return request("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(analysis)),
    });
  }

  root.ZhimeiAI = { getBaseUrl, setBaseUrl, health, analyze, buildPayload };
})(window);
