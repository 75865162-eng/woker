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

## Round B 已有产物接线

`market.selection.run` 复用默认 Market definition/Tool Gateway，只读消费实际 Round B `derived/draft.json`。持久化旧 definition 在运行时补充该工具，仍检查 `market.read.category`。Market 页面上传后点击“从 Round B 证据生成机会”，沿原 Runtime 保存执行/工具/Trace，并可人工发送到 Product。

- `POST /api/agents/market/selection-evidence` 需要 `agents:create`，继承现有组织与工作区鉴权。请求为原始 `application/octet-stream` JSON 文件，流式限制 2 MB，超限 413。
- 仅接收 schemaVersion=1、fixture=false 的非空竞品草稿；检查 Amazon US ASIN/链接、采集时间、有限数值、标签引用和 1688 商品 URL。导入是操作者提供的采集线索，不是独立真实性认证。测试中的 fixture=false 样本仅供隔离契约回归，不代表真实采数。
- 仅保留 brief/竞品观测/评论引用/供应商线索；丢弃正式 product payload、fileId、本地路径及任意附加字段。通过 storage adapter + 既有 FileObject 保存规范化研究 JSON，数据库失败清理新对象。
- 工具只接受 fileId，加载时精确过滤 organization/workspace、done/JSON 及专用存储前缀；身份由鉴权 route 闭包传入，不能从客户端 context 覆盖。Trace/report 保存 fileId、规范化证据 SHA256、原采集时间；超过 7 天提示重新核实。刷新可读取原执行报告，工作区切换丢弃迟到上传/执行。
- 不把 BSR 转成真实销量，也不由小样本推断市场需求、趋势、利润或风险；缺失信号及商业机会分为 null。保留真实零值。`evidenceCompleteness` 单独表示竞品 price/rating/reviewsCount/bsr 字段覆盖率，不作为 `opportunityScore` 传给下一段；置信度保守为 0，UI 标待评估。旧数字型报告继续兼容。
- 机会与报告通过原 Opportunity v1 handoff 传给 Product，供应商线索保留在 `report.selectionSource.suppliers`。Supplier 已消费这些线索并保留原链接、fileId/hash；仅整理线索和未发送询价草稿，不表示正式询价或供应商核验完成。

**操作**：本机 Round B 生成实际草稿 → 在 `/agents/market` 选择 `selections/<slug>/derived/draft.json` → 生成机会 → 人工核对证据 → 发送到 Product。研究原始文件仍不提交 GitHub；上传只保存规范化证据。

**后台实时采集仍未接入**：未在 Next 请求启动 Playwright/CLI，未增加任务/worker/定时计划，未上传竞品图片或创建 SKU；未提供 evidence fileId 的旧入口仍明确 NOT_IMPLEMENTED。后续实时采集须另接受控 job、配额、防重、取消和超时，再决定专用 worker 资源上限。SKU 正式资料仍走 Product 聚合与 `/dashboard`，Orchestrator 无业务写工具。

现有 Market/Product/Supplier/Listing adapter 仍包含模拟生成能力。隔离回归用这些模拟数据验证接线，不作为 Round B 真实证据或真实 AI/业务执行验收。本期未实现 P0+ 顺序 POST、真实上架、真实 Ads transport，也未新增自动建 SKU。

## 验证命令

```bash
npx tsx --test tests/agent-chain-handoff.test.ts tests/agent-launch-api.test.ts tests/agent-platform.test.ts tests/orchestrator-agent.test.ts tests/market-agent.test.ts tests/product-agent.test.ts tests/supplier-agent.test.ts tests/listing-agent.test.ts tests/ppc-agent.test.ts
npx playwright test --config tests/browser/agent-chain.config.ts
npx tsx --test tests/selection-evidence.test.ts tests/selection-evidence-api.test.ts
npm run typecheck
npm run check:fast
```

浏览器回归使用真实六个工作台与 Runtime，框架导航和后端由隔离 harness 替代，不需要账号，不访问外部网络或生产库。实际 API 测试另外覆盖证据上传/隔离加载、Launch 审批入口与 PPC 拒绝路径。详见 feature validation.md。

## 回滚与发布

本次 Agent 改动无 schema/migration/worker/部署配置变更；交接是浏览器导航缓存，商品/审批事实源仍在现有数据库。回滚代码时保留历史 Approval/Trace；旧代码存在客户端 Launch 标记信任缺陷，回滚期间应关闭全链 Launch/PPC 交接入口，不能把恢复该绕过当作替代方案。

GitHub 同步必须盘点并确认整个工作区改动；工作区含并行赛狐、Round B、依赖和 Prisma 改动，不能只推送当前聊天文件或假设它们已验收。服务器发布未获授权，未执行。合码前先修复工作区全量检查阻碍，再按 AGENTS.md 执行完整 check；发布走明确授权的 CI artifact 链。

## Round B 供应线索接线

Product 原报告中的 `sourceMarketReport.selectionSource` 通过既有 Product→Supplier handoff 传入。Supplier 复用六个 Tool Gateway 工具；来源存在时禁止模拟工厂回退，包括空短名单和工具失败。无 Round B 来源的旧独立流程维持兼容。

- 保留 1688 原始商品链接、页面价格和 MOQ 原文，不转换币种、不补造联系人、交期、样品费或正式报价；评分 null、置信度 0，询价草稿尚未发送。
- `sourcingStatus=NEEDS_VERIFICATION` 表示线索待核实；空短名单为 `NEEDS_DATA`，UI 禁止交接 Listing。非法来源/非 1688 商品 URL/工具失败或来源不匹配直接停止，不产出模拟成功报告。
- 页面显示来源、待核实提示和过期状态；采购人工复核后通过既有 Supplier→Listing 按钮传递完整 supplierReport，包括 selectionSource 和未知字段。这是草稿交接，不代表已采购、已核价或已签约。
- 未新增表、worker、依赖或业务写权限；无外部询价/采购请求。回滚本次 Supplier 代码可撤销接线，原始 Market 文件与历史执行保留；回滚期间不要将旧模拟供应报告作为真实证据。

相关验证：`npx tsx --test tests/supplier-evidence.test.ts tests/supplier-agent.test.ts`；浏览器六段回归新增 Round B Market→Product→Supplier→Listing 实际页面路径。
