export const GO_EMOTION_KEYS = [
  "admiration", "amusement", "anger", "annoyance", "approval", "caring", "confusion", "curiosity",
  "desire", "disappointment", "disapproval", "disgust", "embarrassment", "excitement", "fear",
  "gratitude", "grief", "joy", "love", "nervousness", "optimism", "pride", "realization", "relief",
  "remorse", "sadness", "surprise", "neutral",
];

export const STRATEGY_GROUP_KEYS = [
  "positive", "appreciation", "hope", "sadness", "anger", "anxiety", "regret", "uncertainty", "neutral",
];

export const RESPONSE_STRATEGY_KEYS = [
  "apology", "empathy", "gratitude", "cheerfulness", "explanation", "request_information", "help_offline", "other",
];

const labelSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string", enum: GO_EMOTION_KEYS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["label", "confidence"],
};
const vadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    valence: { type: "integer", minimum: 1, maximum: 5 },
    arousal: { type: "integer", minimum: 1, maximum: 5 },
    dominance: { type: "integer", minimum: 1, maximum: 5 },
  },
  required: ["valence", "arousal", "dominance"],
};

export const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    request_summary: { type: "string" },
    service_intents: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    emotion: {
      type: "object",
      additionalProperties: false,
      properties: {
        strategy_group: { type: "string", enum: STRATEGY_GROUP_KEYS },
        group_confidence: { type: "number", minimum: 0, maximum: 1 },
        current_labels: { type: "array", items: labelSchema },
        current_vad: vadSchema,
        trend: { type: "string", enum: ["明显缓和", "有所缓和", "基本稳定", "略有升高", "明显恶化"] },
        trajectory: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              seq: { type: "integer" },
              labels: { type: "array", items: labelSchema },
              vad: vadSchema,
            },
            required: ["seq", "labels", "vad"],
          },
        },
      },
      required: ["strategy_group", "group_confidence", "current_labels", "current_vad", "trend", "trajectory"],
    },
    response_strategies: {
      type: "array",
      items: { type: "string", enum: RESPONSE_STRATEGY_KEYS },
    },
    actions: { type: "array", items: { type: "string" } },
    risk_signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: ["安全风险", "数据一致性", "漏答风险", "承诺履约", "情绪升级", "其他"] },
          level: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          detail: { type: "string" },
          evidence_seq: { type: "array", items: { type: "integer" } },
        },
        required: ["category", "level", "title", "detail", "evidence_seq"],
      },
    },
    do_not_commit: { type: "array", items: { type: "string" } },
    reply_draft: { type: "string" },
    needs_human_review: { type: "boolean" },
    review_reason: { type: "string" },
  },
  required: [
    "request_summary", "service_intents", "concerns", "emotion", "response_strategies", "actions",
    "risk_signals", "do_not_commit", "reply_draft", "needs_human_review", "review_reason",
  ],
};
