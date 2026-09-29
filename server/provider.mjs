const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    keyName: "DEEPSEEK_API_KEY",
    modelName: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-flash",
    baseUrlName: "DEEPSEEK_BASE_URL",
    defaultBaseURL: "https://api.deepseek.com",
    strictJsonSchema: false,
  },
  openai: {
    label: "OpenAI",
    keyName: "OPENAI_API_KEY",
    modelName: "OPENAI_MODEL",
    defaultModel: "gpt-6-luna",
    baseUrlName: "OPENAI_BASE_URL",
    defaultBaseURL: undefined,
    strictJsonSchema: true,
  },
};

export function resolveProvider(environment = process.env) {
  const provider = String(environment.AI_PROVIDER || "deepseek").trim().toLowerCase();
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error(`AI_PROVIDER 仅支持：${Object.keys(PROVIDERS).join("、")}`);
  return {
    provider,
    label: definition.label,
    keyName: definition.keyName,
    apiKey: String(environment[definition.keyName] || "").trim(),
    model: String(environment[definition.modelName] || definition.defaultModel).trim(),
    baseURL: String(environment[definition.baseUrlName] || definition.defaultBaseURL || "").trim() || undefined,
    strictJsonSchema: definition.strictJsonSchema,
  };
}

export function buildStructuredFormat(configuration, schema) {
  return {
    type: "json_schema",
    name: "zhimei_customer_service_analysis",
    ...(configuration.strictJsonSchema ? { strict: true } : {}),
    schema,
  };
}
