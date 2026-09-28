(function (root) {
  "use strict";
  const local = ["127.0.0.1", "localhost"].includes(root.location.hostname);
  root.ZHIMEI_CONFIG = Object.freeze({
    defaultApiBaseUrl: local ? "http://127.0.0.1:8787" : "",
    requestTimeoutMs: 35000,
  });
})(window);
