const safeText = (value, max = 2000) => String(value == null ? "" : value).slice(0, max);

export function sanitizePayload(body) {
  if (!body || typeof body !== "object") throw new Error("请求体必须是 JSON 对象");
  const sessionId = safeText(body.sessionId, 80);
  if (!sessionId || !Array.isArray(body.messages) || !body.messages.length) throw new Error("缺少会话ID或消息");
  if (body.messages.length > 80) throw new Error("单次最多分析 80 条消息");

  const messages = body.messages.map((message) => ({
    seq: Number(message.seq) || 0,
    role: message.role === "customer" ? "customer" : "agent",
    time: safeText(message.time, 40),
    text: safeText(message.text, 2000),
  }));
  const totalCharacters = messages.reduce((sum, message) => sum + message.text.length, 0);
  if (totalCharacters > 50000) throw new Error("会话文本过长");

  const order = body.order && typeof body.order === "object" ? {
    orderId: safeText(body.order.orderId, 100), product: safeText(body.order.product, 500),
    status: safeText(body.order.status, 100), amount: safeText(body.order.amount, 100),
    shippingCompany: safeText(body.order.shippingCompany, 100), shippingTime: safeText(body.order.shippingTime, 100),
  } : null;
  const tickets = Array.isArray(body.tickets) ? body.tickets.slice(0, 20).map((ticket) => ({
    type: safeText(ticket.type, 100), ticketId: safeText(ticket.ticketId, 100), status: safeText(ticket.status, 100),
    createdAt: safeText(ticket.createdAt, 100), completedAt: safeText(ticket.completedAt, 100),
    action: safeText(ticket.action, 500), product: safeText(ticket.product, 500),
  })) : [];
  const deterministicFindings = body.deterministicFindings && typeof body.deterministicFindings === "object" ? {
    conflicts: Array.isArray(body.deterministicFindings.conflicts) ? body.deterministicFindings.conflicts.slice(0, 10).map((item) => safeText(item, 1000)) : [],
    unanswered: Array.isArray(body.deterministicFindings.unanswered) ? body.deterministicFindings.unanswered.slice(0, 10).map((item) => safeText(item, 1000)) : [],
    doNotCommit: Array.isArray(body.deterministicFindings.doNotCommit) ? body.deterministicFindings.doNotCommit.slice(0, 10).map((item) => safeText(item, 1000)) : [],
  } : { conflicts: [], unanswered: [], doNotCommit: [] };

  return {
    sessionId, messages, order, tickets, deterministicFindings,
    scene: { major: safeText(body.scene && body.scene.major, 100), minor: safeText(body.scene && body.scene.minor, 100) },
  };
}
