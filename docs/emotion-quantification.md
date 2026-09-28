# 情绪量化模板

## 1. 输出目标

对每条客户发言保留多标签细粒度情绪，对整段会话输出一个客服操作策略组，并用 VAD 描述情绪状态。客服发言不标客户情绪，只标记采用的回应策略。当前 Demo 用透明的关键词规则模拟输出；生产版应替换为经过验证的模型。

## 2. GoEmotions 28 个细标签

一条客户发言可以同时拥有多个标签，不做强制 28 选 1。界面默认只显示命中的前几项，完整列表放在折叠区：

1. admiration（钦佩）
2. amusement（觉得有趣、好笑）
3. anger（愤怒）
4. annoyance（烦躁、不耐烦）
5. approval（认可）
6. caring（关心）
7. confusion（困惑）
8. curiosity（好奇）
9. desire（希望得到）
10. disappointment（失望）
11. disapproval（不赞同）
12. disgust（厌恶）
13. embarrassment（尴尬）
14. excitement（兴奋）
15. fear（恐惧）
16. gratitude（感激）
17. grief（悲痛）
18. joy（喜悦）
19. love（喜爱）
20. nervousness（紧张、不安）
21. optimism（乐观、期待）
22. pride（自豪）
23. realization（意识到）
24. relief（释然）
25. remorse（懊悔）
26. sadness（悲伤）
27. surprise（惊讶）
28. neutral（中性）

## 3. 面向客服动作的 9 个策略组

每个细标签只进入一个组，避免训练和统计时重复计数。

- 积极愉悦：joy、amusement、excitement、pride。保持友好，感谢认可。
- 认可与亲近：admiration、approval、gratitude、love、caring。感谢并简洁确认。
- 希望与释然：desire、optimism、relief。说明进展和下一步。
- 低落与失落：sadness、disappointment、grief。共情、道歉并提供补救。
- 愤怒与不满：anger、annoyance、disapproval、disgust。先承认影响，再给行动。
- 焦虑与担忧：fear、nervousness。安抚但不淡化，提供确定信息和反馈时间。
- 自责与尴尬：embarrassment、remorse。避免责备，降低操作压力。
- 困惑与探索：confusion、curiosity、realization、surprise。通俗解释，必要时补问信息。
- 中性：neutral。直接说明事实和可执行步骤。

`fear` 与 `nervousness` 只属于“焦虑与担忧”，不再重复放进“自责与尴尬”。`desire` 放进“希望与释然”，确保 28 个标签完整覆盖。

## 4. VAD 量表

三个维度都使用 1–5 整数：

- Valence：1 表示非常负面，5 表示非常正面。
- Arousal：1 表示平静，5 表示强烈激动。
- Dominance：1 表示无力、失控，5 表示掌控感强。

界面同时显示当前值和逐轮轨迹。业务升级可重点关注“低 V + 高 A”，以及 D 持续降低的组合；VAD 不能单独代替安全或业务风险规则。

## 5. 置信度

不能使用“最高 logit ÷ 其他 logits 之和”，因为原始 logit 可以为负数，也不是概率。

推荐实现：

- 28 个细标签为多标签任务，每个标签使用 sigmoid 概率并设置验证集阈值。
- 9 个策略组为互斥展示结果时，使用 softmax 概率或经过温度缩放的校准概率。
- 同时保存第一名、第二名和两者差值；低置信度时提示人工确认，不隐藏备选组。
- 在独立验证集上报告 micro/macro F1、多标签准确率、Expected Calibration Error 和分组混淆矩阵。

当前 Demo 的百分比只是规则命中后的演示置信度，界面明确显示“非训练模型”，不得作为生产质量承诺。

## 6. 推荐数据结构

```json
{
  "session_id": "S00018",
  "turn_id": 7,
  "speaker": "customer",
  "text": "行，操作挺方便，那等新的到了我就寄回，麻烦了",
  "emo_labels": [
    {"label": "approval", "probability": 0.78},
    {"label": "gratitude", "probability": 0.74}
  ],
  "strategy_group": {"label": "appreciation", "probability": 0.67},
  "vad": {"valence": 4, "arousal": 2, "dominance": 4},
  "trend": "明显缓和",
  "recommended_response_strategies": ["gratitude", "explanation"],
  "model_version": "emotion-model-x.y",
  "needs_human_review": false
}
```

客服发言使用 `response_strategies`，可包含 apology、empathy、gratitude、cheerfulness、explanation、request_information、help_offline 和 other。

## 7. 上线前训练建议

- GoEmotions 可作为英语细粒度情绪的基础预训练或对照集，但领域来自 Reddit，不能直接代表中文美妆客服。
- EmoTwiCS 更接近客服多轮场景，可用于学习情绪变化与回应策略，但其语种和业务域仍需适配。
- 使用赛事数据及经授权的中文客服数据做领域标注、脱敏、训练和验证；数据切分必须按会话而不是按单条消息，避免同一对话泄漏到训练集和测试集。
- 建立“低置信度转人工”“安全类关键词优先规则”“模型版本回滚”和标注复核机制。
