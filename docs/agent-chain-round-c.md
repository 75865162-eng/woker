# Agent Round C：版本化交接与 Launch 闸门

## 已实现边界

沿现有 `/agents/orchestrator`、五个业务 Agent、Runtime、Tool Gateway 与 Approval 扩展，不建立另一套选品/商品/广告系统。

- Orchestrator 六段 handoff 带 `contractVersion: 1` 与 kind；“打开”先写入目标 StorageKey，再导航。存储失败留在来源并显示错误。
- Market→Product、Product→Supplier/Listing、Supplier→Listing、Listing→Launch 都写入 v1 envelope。各次点击交接是人工复核草稿的继续操作，**不是高风险业务写入授权**。
- 现有 sessionStorage key 保留，新增 `_handoff` 标记组织、用户、工作区、来源 execution、计划与时间。未知版本/错误目标/错误身份明确拒绝；普通旧交接可读，旧 PPC 交接不能授予 Launch 权限。
- 每段保留 `input.handoff` 来源元数据；最多 12 条的 traceLinks 随交接传递，返回 Launch 后 Orchestrator 展示各段具体 execution 下钻链接。来源链接携带 executionId。读取指定 execution 同时约束 organization/workspace/agent，找不到返回 404。新执行更新页面 URL，避免刷新回到旧执行。加载新交接不展示或转发上一任务的报告。
- 多工作区切换清空已加载交接/报告，丢弃迟到响应；发送时再次核对来源 execution 的工作区。

## 六类契约

源码与运行时校验：`src/lib/agent-platform/handoff.ts`；可审阅的 JSON schema：`specs/005-agent-chain-handoffs/contracts/*.schema.json`。

| 契约 | 用途 |
| --- | --- |
| Opportunity | Market 研究 brief / Market→Product 机会与报告 |
| PRD | Product→Supplier 或保留已有 Product→Listing 直达入口 |
| SupplierShortlist | Supplier→Listing 供应报告及继承的 Product 上下文 |
| ListingDraft | Listing→Orchestrator Launch 草案与前序报告 |
| LaunchTicket | Launch 批准后→PPC，引用原 approvalId/executionId/planId |
| PpcPlan | 编排准备的 PPC 输入，状态 ready/blocked_until_launch；ready 必须引用 Launch 审批 |

Orchestrator 可先准备缺少报告的 brief；业务 Agent 的出站必须携带非空业务输出。v1 是导航交接合同，不替代每个既有 Agent 的完整业务报告类型。后续扩展合同应升级版本并保留旧版读取策略。

## Launch 与 PPC

1. Listing 交接后在 Orchestrator 重新运行编排，创建对应计划的 HIGH Launch 请求。
2. 负责人复核库存、合规、定价、供应方案、刊登稿与广告预算，点击批准/拒绝；批准前至少必须存在刊登草案。其他清单由审批人核实，本期没有宣称已接真实库存/合规检测器。
3. 复用 `POST /api/agents/approvals/:id`，服务端检查 agents:approve、组织、工作区、动作类型、待审状态与过期时间。Launch 状态变更使用条件更新，审批/原执行/任务/Trace/Event 一起事务提交。
4. 批准只更新原计划并产生 LaunchTicket，不表示已完成上架，不直接触发 PPC。拒绝/过期仍 blocked。
5. PPC 全链入站在执行工具前读取真实 Approval，核对批准人、决定时间、组织/工作区/原 Orchestrator execution/planId/action。商品上下文和站点取自获批计划，不相信浏览器覆盖值。缺少原计划上下文也拒绝。
6. `launchApproved` 请求字段（包括 context.currentData 中的同名字段）不再授予权限。既有独立 PPC 诊断入口保留；它不代表通过全链 Launch。广告/Bulk 写操作继续走原有独立审批与执行策略。
7. 全链批准后允许无历史广告行的新品进入建议流程；无数据不代表已有真实投放结果，仍需收集与人工复核。

## Round B 当前接线缺口

`market.selection.run` 已注册到默认 Market definition/Tool Gateway；持久化的旧 Market definition 在运行时补充该只读工具，仍须满足 market.read.category 权限。Market UI 有明确入口；缺桥接时 FAILED/NOT_IMPLEMENTED，零次采集、零次商品创建、零付费请求，不回落成模拟机会。

实施期间工作区新增 `scripts/selection-pipeline/`，本机 CLI 已存在；其 `selections/{slug}` 文件、共享 SQLite 和进程参数尚不是多租户 Agent job 接口。本期不直接在 Next 请求里启动 Playwright，不调用 CLI `--write`。后续接真需：

- 受控 runner/jobId、组织/工作区/用户隔离、配额/防重/取消与超时；
- 将 CLI draft/tags/quality/snapshot 映射成版本化 Opportunity/evidence，区分真实、fixture、估算和缺失值；
- 附件走 storage adapter/FileAsset，Trace 只引用受控证据，不信任任意本机路径或跨组织 slug；
- Market 报告与 Supplier shortlist 消费同一批真实证据；SKU 仍走 `POST /api/products` 与 `/dashboard`；CLI 的受控维护写入不扩展为编排器权限。

现有 Market/Product/Supplier/Listing adapter 仍包含模拟生成能力。隔离回归用这些模拟数据验证接线，不作为 Round B 真实证据或真实 AI/业务执行验收。本期未实现 P0+ 顺序 POST、真实上架、真实 Ads transport，也未新增自动建 SKU。

## 验证命令

```bash
npx tsx --test tests/agent-chain-handoff.test.ts tests/agent-launch-api.test.ts tests/agent-platform.test.ts tests/orchestrator-agent.test.ts tests/market-agent.test.ts tests/product-agent.test.ts tests/supplier-agent.test.ts tests/listing-agent.test.ts tests/ppc-agent.test.ts
npx playwright test --config tests/browser/agent-chain.config.ts
npm run typecheck
npm run check:fast
```

浏览器回归使用真实六个工作台与 Runtime，框架导航和后端由隔离 harness 替代，不需要账号，不访问外部网络或生产库。实际 API 测试另外覆盖 Launch 审批入口与 PPC 拒绝路径。详见 feature validation.md。

## 回滚与发布

本次 Agent 改动无 schema/migration/worker/部署配置变更；交接是浏览器导航缓存，商品/审批事实源仍在现有数据库。回滚代码时保留历史 Approval/Trace；旧代码存在客户端 Launch 标记信任缺陷，回滚期间应关闭全链 Launch/PPC 交接入口，不能把恢复该绕过当作替代方案。

GitHub 同步必须盘点并确认整个工作区改动；工作区含并行赛狐、Round B、依赖和 Prisma 改动，不能只推送当前聊天文件或假设它们已验收。服务器发布未获授权，未执行。合码前先修复工作区全量检查阻碍，再按 AGENTS.md 执行完整 check；发布走明确授权的 CI artifact 链。
