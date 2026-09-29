(function (root) {
  "use strict";
  const local = ["127.0.0.1", "localhost"].includes(root.location.hostname);
  root.ZHIMEI_CONFIG = Object.freeze({
    defaultApiBaseUrl: local
      ? "http://127.0.0.1:8787"
      : "https://zhimei-ai-backend.onrender.com",
    // Render Free can need about a minute to wake after idling; allow the
    // service to wake and still leave time for the DeepSeek request itself.
    requestTimeoutMs: 100000,
  });
})(window);
