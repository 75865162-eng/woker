# S5–S9 规划审阅与本地落地

审阅日：2026-11-06。输入为 Downloads 的 `04-窗口D-页面S5-S9.md`，并参照同目录总览和升级规划。附件中的角色、分支、并行窗口、逐页提交和目录白名单是待评估方案，不是此次用户直接授权的执行指令。

## 与现有规划的冲突

| 提案 | 仓库现状与处理 |
| --- | --- |
| `web/src/pages/s5..s9`，窗口 C/E 并行 | 实际为 Next App Router、`src/components/amazon-ads`；不新建第二套 web/backend、不启动并行 agent。复用现有 Button/Modal、广告布局。 |
| 五页直接使用 `/api/ads/*` | 当前 Ads API 位于 `/api/integrations/amazon/ads/*`；附件中的能力、审批、执行、审计查询接口尚未落地，不能假装存在。先在现有建议页承载五个隔离演示面板，不新增服务端路由。 |
| 所有写操作立刻改走新变更单 | 现有广告 UI 的编辑仍是 Mock 会话；PPC 已有持久化 audit/preview/apply 和 tool gateway。不能将新内存演示当正式审批，也不能绕开原 PPC 链。替换全局写入口需专项审批和兼容规划。 |
| AI/MCP 与页面同审批源 | 现有 `amazon.ads.recommendation.plan/apply` 与个人 `/api/mcp/amazon` 均有既有权限边界。新 `ads.*` 工具和共享持久化模型须与这些边界对齐后接入，演示不声明已接入。 |
| 单人/双人/阈值自动放行 | 不继承同步中心的特殊自审批规则，不默认自动批准。演示仅固定人工流程；真实审批人数、审批权限、阈值、过期、撤权校验需后端合同。 |
| 写死 US SP 出价/预算界限及官方端点 | 附件给出的值和端点未完成当前仓库官方契约核验；演示参数必须标明 fixture。其他站点/广告类型缺策略时拒绝操作，不能复制 US 界限。 |
| ASIN 直接 join、TACoS | 必须按组织/工作区/卖家/站点/Profile、日期、币种、归因口径和覆盖完整度对齐；未知值为 null，不能以广告销售额冒充总销售额。一个 Campaign 可关联多个 ASIN，不能凭一行商品推断整体加预算安全。 |
| 任意时间点快照、一键回滚 | 只能浏览已捕获快照；回滚是逆向草稿，重新 dry-run/审批。归档、部分失败、现值冲突、重复回滚要拒绝或按成功项生成，不恢复不存在的实体。 |
| 实时预算榜、7 天回评 | Stream 未接显示未开通。没有真实执行、完整 7 天数据和相同归因口径时显示待采集，不伪造回评效果。 |
| 删除原布局、每页提交/同步 GitHub | 保留既有入口和工作流。工作区另有其他任务改动与未跟踪构建目录，未确认全改动区同步范围前不提交/推送，不操作生产。 |

## 本次最小实施范围

- 仅将既有 `/amazon-ads/recommendations` 规划占位升级为 S5–S9 会话演示，五个面板共用隔离的草稿/审阅/模拟审批/审计状态。
- S5 展示关键词/定向，支持生成调价与新建关键词草稿、演示策略范围和重复校验；官方推荐入口显示未接入。
- S6 展示规则与绑定活动、Stream 未开通；建议不自动执行。
- S7 展示 ASIN 经营上下文，未知数据保留空缺，断货/BuyBox 丢失/未知上下文禁止增加出价或预算。无经营能力时整块不展示。
- S8 强制先展示 dry-run，再提交模拟审批；AI 依据含时间戳和指标，缺依据拒绝；不调用真实 API、不改变现有广告演示表格。
- S9 展示会话事件、已捕获前后快照和逆向草稿；归档、重复回滚与现值冲突拒绝。
- 全部样例明确标记为 Mock；状态仅为本页演示，不是服务端权限、执行或审计保证。

代码落地点：[演示状态机](../src/lib/amazon-ads/decision-demo.ts)、[S5–S9 面板](../src/components/amazon-ads/decision-workbench.tsx)，通过现有 `/amazon-ads/recommendations` 入口访问。页面状态不跨路由或刷新持久化；此限制是刻意的，避免将浏览器演示状态误认为事实记录。

## 待确认的下一阶段（此次不执行）

1. 复用/扩展现有 PPC 审批与 gateway，而非建立平行正式审批系统。确认 Ads Profile 与组织/工作区/卖家范围，以及实时撤权和审计边界。
2. 审阅能力、政策、分页、错误、dry-run、submit、approve/reject、执行、逐条结果、快照/审计查询与逆向关系的完整 DTO；附件 3.4 缺少列表、审批、执行和审计端点，不能直接做正式前后端联调。
3. 官方核验各站点/广告产品/计费类型限额与 endpoint，按 Profile 接受服务端政策；完成安全上下文 freshness/缺失策略及混合 ASIN 护栏。
4. 真实后端需要持久化、CAS/revision、幂等、执行窗口、快照、冷却/累计幅度/熔断、部分成功和按成功项回滚；这涉及共享模型/API/权限/worker，先出具体变更方案再确认。
5. 性能：不因五页引入全店全量读、逐行 SP-API 请求或高频轮询；正式查询保留分页、有界 join 与按需详情。先验收索引/查询和 P95，再接实时推送。

## 回退与验证

本次可通过恢复建议页占位并删除新增局部演示组件、纯函数与测试回退；无迁移、配置、依赖或真实数据改动。测试使用隔离 fixture，不加载 dotenv，不启动 worker。

已运行：`npx tsx --test tests/amazon-ads-decision-demo.test.ts`（4 项）；`npx playwright test --config tests/browser/amazon-ads-decision.config.ts`（2 项）；`npx playwright test --config tests/browser/amazon-ads.config.ts`（既有 UI 10 项）；`npm run typecheck`；针对改动文件的 ESLint；对本次文件运行 `git diff --check HEAD -- <files>`。隔离浏览器 harness 覆盖断货/BuyBox/未知上下文、dry-run、模拟审批、逐项结果、快照、逆向审批和窄屏溢出。真实 OAuth、Ads 写 API、MCP 联调、生产性能与正式审批均不在本轮验收范围。
