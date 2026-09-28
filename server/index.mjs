import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import OpenAI from "openai";
import { analysisSchema } from "./schema.mjs";
import { buildModelInput, SYSTEM_INSTRUCTIONS } from "./prompt.mjs";
import { sanitizePayload } from "./validation.mjs";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const model = process.env.OPENAI_MODEL || "gpt-6-luna";
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "http://127.0.0.1:4173,http://localhost:4173")
  .split(",").map((item) => item.trim()).filter(Boolean);
const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
const client = hasApiKey ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 1 }) : null;
const app = express();

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("该来源未被允许"));
  },
  methods: ["GET", "POST"],
}));
app.use(express.json({ limit: "256kb" }));
app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 20),
  standardHeaders: "draft-8",
  legacyHeaders: false,
}));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, provider: "openai", configured: hasApiKey, model: hasApiKey ? model : null });
});

app.post("/api/analyze", async (request, response) => {
  if (!client) return response.status(503).json({ error: "后端尚未配置 OPENAI_API_KEY", fallback: true });
  let payload;
  try {
    payload = sanitizePayload(request.body);
  } catch (error) {
    return response.status(400).json({ error: error.message, fallback: true });
  }

  try {
    const result = await client.responses.create({
      model,
      instructions: SYSTEM_INSTRUCTIONS,
      input: buildModelInput(payload),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "zhimei_customer_service_analysis",
          strict: true,
          schema: analysisSchema,
        },
      },
    });
    if (!result.output_text) throw new Error("模型未返回可解析结果");
    const analysis = JSON.parse(result.output_text);
    response.json({
      sessionId: payload.sessionId,
      analysis,
      meta: { provider: "openai", model, responseId: result.id, generatedAt: new Date().toISOString() },
    });
  } catch (error) {
    const status = Number(error && error.status) || 502;
    const safeStatus = status >= 400 && status < 600 ? status : 502;
    console.error("OpenAI analysis failed", { status: safeStatus, type: error && error.name });
    response.status(safeStatus).json({ error: "OpenAI分析暂时不可用，请使用本地规则结果", fallback: true });
  }
});

app.use((error, _request, response, _next) => {
  const status = error && error.message === "该来源未被允许" ? 403 : 500;
  response.status(status).json({ error: status === 403 ? error.message : "服务暂时不可用", fallback: true });
});

app.listen(port, host, () => {
  console.log(`Zhimei OpenAI backend listening on ${host}:${port}`);
  if (!hasApiKey) console.log("OPENAI_API_KEY is not set; health checks work and analysis uses frontend fallback.");
});
