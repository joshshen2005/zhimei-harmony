# DeepSeek / OpenAI 接入与部署

当前项目默认接入 DeepSeek，同时保留 OpenAI 切换能力。前端不直接调用模型厂商，而是把当前会话发给 `server/` 中的受控后端；后端从环境变量读取密钥，调用 Responses API，再返回符合 JSON Schema 的结构化结果。

## 一、安全架构

```text
客服浏览器
  └─ POST /api/analyze
       └─ 知美 Node.js 后端
            ├─ 输入校验、长度限制、CORS 和限流
            ├─ DEEPSEEK_API_KEY（只存在后端）
            └─ DeepSeek Responses API + JSON Schema
```

这样设计的目的是避免 API Key 出现在 HTML、JavaScript、浏览器存储或 GitHub 仓库中。前端配置弹窗只接收后端 URL，不接收密钥。

## 二、本地启动

1. 在 DeepSeek 开放平台创建 API Key。不要将密钥发给其他人，也不要提交到 Git。
2. 进入后端目录并创建本地环境文件：

```bash
cd server
cp .env.example .env
```

3. 打开 `server/.env`，至少填写：

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的DeepSeek密钥
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
PORT=8787
ALLOWED_ORIGINS=http://127.0.0.1:4173,http://localhost:4173
```

4. 安装依赖并启动：

```bash
npm install
npm start
```

5. 检查健康接口：

```bash
curl http://127.0.0.1:8787/api/health
```

正常情况下应返回 `ok: true`、`configured: true` 和当前模型名称。

6. 启动前端静态服务，访问 `http://127.0.0.1:4173`。点击右侧副驾顶部的 AI 状态，确认后端地址为 `http://127.0.0.1:8787`，点击“测试连接”和“保存并启用”。

## 三、页面如何使用真实 AI

选中会话后，前端会自动请求一次真实分析，并在本次页面会话中缓存结果。返回内容包括：

- 经归纳的核心诉求、处理意向与关键顾虑。
- GoEmotions 28 类多标签情绪、9 个服务策略组、VAD 1–5 分和逐轮变化。
- 道歉、共情、解释、补充询问和转人工渠道等回复策略。
- 需执行动作、不可承诺的边界、风险信号和通俗回复草稿。
- 是否需要人工复核及原因。

真实 AI 结果不会替换确定性的订单、工单和时间线核验。两者会合并显示，且 AI 不能降低本地证据已触发的风险等级。草稿只能由客服审阅后手动插入，不会自动发送。

## 四、部署到 Render

仓库根目录已包含 `render.yaml`。

1. 登录 Render，选择从 GitHub Blueprint 创建服务。
2. 选择 `zhimei-harmony` 仓库。Render 会读取 `render.yaml` 并将 `server/` 作为后端根目录。
3. 在 Render 的环境变量中填写 `DEEPSEEK_API_KEY`。它必须作为 Secret 保存。
4. 部署成功后，访问 `https://<你的服务名>.onrender.com/api/health`，确认 `configured: true`。
5. 打开 GitHub Pages 演示页，点击 AI 状态，将后端地址填为 `https://<你的服务名>.onrender.com`，测试并保存。

`ALLOWED_ORIGINS` 已默认允许 `https://joshshen2005.github.io`。如后续更换域名，需在 Render 中把新的完整 Origin 加入该环境变量，多个值用英文逗号分隔。

## 五、模型与费用控制

默认服务商是 `deepseek`，默认模型是 `deepseek-flash`。可通过 `DEEPSEEK_MODEL` 替换 DeepSeek 模型，不需改前端代码。如需切回 OpenAI，配置 `AI_PROVIDER=openai`、`OPENAI_API_KEY` 和 `OPENAI_MODEL`。当前服务还已配置：

- 每个后端实例默认每分钟 20 次 API 请求限制。
- 单条消息、会话消息数和总字符数限制。
- 30 秒模型请求超时、1 次重试和前端 35 秒超时。
- `store: false`，请求不用于服务端返回结果的持久存储。

正式上线前还应增加用户身份认证、按账号限流、用量告警、敏感数据脱敏和请求审计。CORS 只是浏览器来源限制，不是身份认证。

## 六、故障排查

- 显示“本地规则”：尚未保存 AI 后端地址。
- 显示“AI失败 · 规则兜底”：后端不可达、超时、未配置密钥或模型请求失败。点击状态查看连接检测结果。
- 显示“后端可访问，但尚未设置 DEEPSEEK_API_KEY”：将密钥加到后端 `.env` 或托管平台 Secret，然后重启后端。
- 浏览器报 CORS：确认前端 Origin 与 `ALLOWED_ORIGINS` 完全一致，包括协议和端口。
- 结果未更新：切换会话后重新打开，或在 AI 配置弹窗中重新保存地址，以清除当前页面的 AI 缓存。

## 七、与 DeepSeek 官方接口的对应关系

- 服务端 SDK：DeepSeek 官方支持的 OpenAI 兼容 JavaScript SDK。
- 主接口：`client.responses.create(...)`。
- 接口基址：`https://api.deepseek.com`。
- 结构化输出：Responses API 的 `text.format` + `json_schema`。
- 密钥来源：后端 `DEEPSEEK_API_KEY` 环境变量。

官方参考：

- [DeepSeek 首次 API 调用](https://api-docs.deepseek.com/guides/harness)
- [DeepSeek Responses API](https://api-docs.deepseek.com/guides/responses_api/)
- [DeepSeek Responses API 参数](https://api-docs.deepseek.com/api/create-response/)
