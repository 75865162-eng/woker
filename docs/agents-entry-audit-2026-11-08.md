# AGENTS 入口精简审计（2026-11-08）

本次为文档入口审计，依据修改前工作区 AGENTS.md（556 行，SHA256 `662fb9261ae1fb67e230799c438e90e8960e4a913b25a25886c61a6fb34982d5`）与定向源码检查。工作区原有大量未提交业务改动，包含 AGENTS.md；本次在其当前内容上迁移，不回退到 HEAD，不修改业务代码、真实配置或运行态。未执行 commit/push/外部 API/服务器操作。

## 发现与处理

| 发现 | 核对依据 | 处理 |
| --- | --- | --- |
| 通用规范、专项细节、历史验收混在总入口 | 原 AGENTS.md 全文 | 总入口压缩为 96 行，按任务索引；专项不要求全读 |
| 小改动 ssh patch、源码同步与 CI artifact 冲突 | `.github/workflows/ci-cd.yml`、`scripts/deployment-plan.mjs`、用户本次要求 | 移除旧分流；只允许现有 CI artifact 发布并独立审批 |
| 2026-11-06 profile 例外与根 .env 规则冲突 | `scripts/runtime/environment.mjs` 明确拒绝 ERP_LOCAL_INTEGRATION_PROFILE；runtime 文档记载 11-07 切换 | 例外仅留历史追溯，禁止恢复旧入口 |
| 按受影响 Worker 重启的旧描述已落后 | `scripts/deployment-plan.mjs` 对所有应用发布设置四类 Worker restart | 部署专项改为当前全注册 Worker 切换；文档发布不重启 |
| Windows 目录、Next/React 版本过时 | pwd、package.json（Next ^15.5.25，React ^19.3.0） | 用实际仓库根目录及 package.json，不固化过时机器路径／补丁版本 |
| “仅两资源／US CA／无持续采集／不含退货”等阶段描述相互冲突 | `docs/amazon-automatic-sync.md` 最新章节、automatic-schedule/策略源码 | 标为历史阶段；具体范围按当前实现和最新调度文档核对，不据此删安全闸门 |
| Product、PPC、外部报表事实源不可混用 | product-record-repository.ts、product-detail-service.ts、产品域文档 | 核心底线保留总入口，商品性能／编辑器／缓存约束原文迁移 |
| 出价执行不可凭开关放行 | `src/lib/amazon/ads-client.ts` 仍抛 NOT_IMPLEMENTED | 专项约束继续保留，不把读取适配器当成写入能力 |
| 手工验收条款可能误触真实 API | 原验证清单、长期审批及分级验证规则 | 文件／AI 验证按风险走隔离路线，真实连接独立审批 |

这不是全面业务代码验收；未逐个重新核实专项历史测试数字、服务器状态或已有真实数据。规则迁移不授权历史操作，也不改变应用的 API、数据库、权限、存储或调度行为。

## 原文去向与覆盖

原 1–24、40–99 行的安全、优先级、最小修改、兼容及验证原则合并到总入口；旧“更新分流”由用户当前 CI-only 要求替换。以下段落迁入专项正文，保留业务约束及其已有进一步文档链接；迁移位置带原始行号标记。目录与技术栈留作按需开发参考。

| 原 AGENTS 行 | 去向 | 处理 |
| --- | --- | --- |
| 25–39 | [delivery-traceability.md](delivery-traceability.md) | 注明适用范围／纠正已核实冲突 |
| 100–203 | [development-guide.md](development-guide.md) | 注明适用范围／纠正已核实冲突 |
| 204–231 | [product-domain-simple-architecture-plan.md](product-domain-simple-architecture-plan.md) | 保留专项约束 |
| 232–252 | [erp-runtime-operations.md](erp-runtime-operations.md) | 注明适用范围／纠正已核实冲突 |
| 253–316 | [ci-cd.md](ci-cd.md) | 注明适用范围／纠正已核实冲突 |
| 317–321 | [product-domain-simple-architecture-plan.md](product-domain-simple-architecture-plan.md) | 保留专项约束 |
| 322–332 | [amazon-agent-boundaries.md](amazon-agent-boundaries.md) | 保留专项约束 |
| 333–394 | [development-guide.md](development-guide.md) | 注明适用范围／纠正已核实冲突 |
| 395–411 | [delivery-traceability.md](delivery-traceability.md) | 注明适用范围／纠正已核实冲突 |
| 412–424 | [sellfox-agent-read.md](sellfox-agent-read.md) | 保留专项约束 |
| 425–446 | [amazon-agent-boundaries.md](amazon-agent-boundaries.md) | 注明适用范围／纠正已核实冲突 |
| 447–466 | [sellfox-agent-read.md](sellfox-agent-read.md) | 保留专项约束 |
| 467–472 | [selection-round-d.md](selection-round-d.md) | 保留专项约束 |
| 473–479 | [agent-chain-round-c.md](agent-chain-round-c.md) | 保留专项约束 |
| 480–485 | [selection-round-d.md](selection-round-d.md) | 保留专项约束 |
| 486–551 | [amazon-agent-boundaries.md](amazon-agent-boundaries.md) | 注明适用范围／纠正已核实冲突 |
| 552–556 | [amazon-agent-boundaries.md](amazon-agent-boundaries.md) | 注明适用范围／纠正已核实冲突 |

## 维护规则与验证

新增内容落到对应模块文档；仅新增跨任务安全底线或改变索引时才改总入口。不要把本审计作为每次开发前置阅读，不为迁移增加第二份全量历史 AGENTS 归档。

本次检查总入口行数、相对文档链接、迁移区段覆盖及本次文档 diff 空白错误。纯 Markdown 变更不运行 TypeScript、应用测试、E2E 或生产构建；代码／API／运行配置实际变化时再按 AGENTS 分级升级。已有工作区改动不属于本次验证或同步结果。

## 后续补充：项目概览与核心术语（2026-11-08）

按用户后续要求，总入口行数目标调整为 120～180 行，在当前工作区版本上增加模块职责、MCP/AI/ERP 调用关系、核心对象、跨模块协作边界和知识维护分层；保留期间已有用户编辑，不恢复先前版本的规则文本。上文 96 行是首次精简的交付状态。

定向依据：现有 app 页面入口、`src/lib/lili/catalog.ts`、`src/lib/lili/runtime-server.ts`、`src/lib/selection-research/server.ts`、`src/lib/logistics/types.ts` 与 PPC `src/lib/types.ts`。明确 Logistics 当前以文件／箱规／货件工具为主；Lili 是工具与工作流接口，客户端承载聊天；模块定义不等同于适配器或真实执行已经完成。Snapshot 按模块区分业务证据与派生数据，避免把全部快照误当可删除缓存。

开发指南增加页面知识的分层维护入口。此次只修改 Markdown，检查入口行数、路径与空白差异，不运行应用测试、构建或真实服务。
