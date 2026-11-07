# 财务、库存事件、赔偿、结算修复审阅方案

状态：本方案已获本地代码实施批准。既有模型内的修复与真实只读验证见 `amazon-four-domain-repair-delivery-2026-11-06.md`；结算存储扩展待单独批准，未执行真实配置或任务恢复。

## 已核实的最小范围

- 实际 Amazon 主链路为 `src/lib/amazon-sync/service.ts`、`scheduler.ts`、`processor.ts`、`finance.ts`、`domain-reports.ts` 和 `src/lib/amazon/sp-api-client.ts`；不是 Sellfox 或 Ads 的 `sync-service.ts`。
- 当前工作区已有财务两年边界保护及恢复预览的未提交修改，同时存在 worker、Returns、配置等其他改动。本方案保留它们，不覆盖、不提交、不推送混合改动。
- `docs/amazon-live-full-sync-execution-2026-11-06.md` 已记录财务 `400 / InvalidInput / Start date cannot be before 2 years from now`、结算多 marketplace 返回与排队后日期过期、赔偿 FATAL、库存事件创建拒绝。本文未重新请求真实 Amazon，也未连接数据库核查九个店铺；九店实际绑定清单仍待单独受控核验。
- 当前财务使用 Finances v2024-06-19 `listTransactions`，参数名是 `postedAfter` / `postedBefore`，不是 `startDate`。
- 库存事件已经使用 `GET_LEDGER_DETAIL_VIEW_DATA`、`marketplaceIds: [source.marketplaceId]` 和日期、eventType；尚无证据证明 reportType 拼写或 marketplace 值就是 400 根因。
- 赔偿使用 `GET_FBA_REIMBURSEMENTS_DATA`，现在通过 `createSnapshotReport` 创建，未传日期。不能仅由 FATAL 判定账号缺权限。
- 结算 `parseGetReportsPage` 和随后 `getReport` 都要求恰好一个 marketplace；文档按 `sourceId + reportId` 标识，所有明细沿用 source 的站点归属。仅放宽数组长度会导致重复发布或错误归属。

## 拟实施内容

### 1. 财务

复用现有未提交的 `financeRetentionFloor`、`assertFinanceRequestWindow`、`previewFinanceRetentionRecovery`，避免另建日期规则。核对 UTC ISO 8601、滚动两年、结束时间安全延迟、180 天最大窗口及排队后重新校验。为新建自动财务窗口生成留有排队余量的可用起点，同时明确保存排除的历史区间；不得把这个策略用于静默推进旧游标。

旧冻结任务继续保留原窗口/token/已提交页；过期时给出明确阻断与恢复预览，后续真实恢复必须绑定具体任务、进度证据和缺口单独批准。不同窗口不得复用 nextToken。

涉及：`finance.ts`、`automatic-connection.ts` / `scheduler.ts`（仅生成新窗口所需处）、`processor.ts`、相关单测。

### 2. 库存事件

保留已核实的 Detailed View 类型。核对官方报告契约中的日期及 eventType 选项；确认空 eventType 是否应省略后再改变请求，不先猜测类型名。请求前验证非空且与冻结授权一致的 marketplace。日期保持已闭合、单次最多 31 日和既有历史边界。

补充脱敏的上游 HTTP status、固定/受限错误 code、requestId 诊断；不把原始响应、凭证或业务明细放进日志/UI。诊断变更只在这四域启用，避免改变其他客户端消费者的错误契约。400 明确拒绝可保留再次申请能力；创建结果不明时仍须核对，不盲目再次 POST。

涉及：`sp-api-client.ts`、`domain-reports.ts`、`processor.ts`、契约和 mock transport 测试。

### 3. 赔偿

按官方契约确认可使用 dataStartTime/dataEndTime 后，为新赔偿任务增加显式冻结窗口，首轮覆盖最近 30 个已闭合 UTC 日期。复用 `createReport` 而不是无日期 snapshot 请求；冻结字段、cursor、创建结果核对及报告元数据日期校验保持一致。30 天只是初次验证范围，coverage 必须明确，不能宣称历史已完整；不自动覆盖已有报告或水位。

将 FATAL、CANCELLED、缺文档 ID 分开诊断。若 FATAL 带诊断文档，不得按业务报告解析或发布。保留现有角色检查与上游权限校验，不自动改角色、不伪造权限证明、不自动重建 FATAL 报告。

涉及：`domain-reports.ts`、`service.ts`、`scheduler.ts`、`processor.ts`、必要的任务窗口类型及测试。旧无日期检查点保持兼容；不能把旧检查点误解释为新的 30 天任务。

### 4. 结算

映射必须来自组织/工作区内的有效授权与明确 Seller ID 绑定，不能硬编码“第几个店铺”或按店名/SKU/币种推测。

报告发现保留 reportId、授权身份、返回 marketplaceIds 与创建时间；只接受授权范围内的集合。报告多站点不等于所有行都属于当前 source。轮询重复核对同一身份，不能仅修改发现校验。

持久化方案门槛：在落实前盘点现有唯一键，确保同一卖家报告跨站点只归档/发布一次，并使行归属与查询权限一致。行有可信 marketplace 标识且可映射时才发布到该站点；缺失、冲突、无法区分的卖家级费用保留加密隔离，普通站点查询不展示。若现有表无法表达卖家级报告和隔离记录，另提交具体 schema/migration diff 审阅，不通过虚构单站归属绕过。

新发现窗口按请求时可用的最近 90 天边界预留排队余量，冻结实际有效起止和被截断区间。执行前再次检查；旧窗口过期时阻断并生成恢复方案，不原地改冻结窗口，不将旧 nextToken 用于新窗口。90 天指报告创建时间，不是结算业务日。

涉及：`domain-reports.ts`、`automatic-schedule.ts`（实际日期 helper 所在文件为准）、`scheduler.ts`、`processor.ts`、`domain-reports-query.ts`（归属需要时）及单元/隔离集成测试。

## 官方依据与待核实项

- 财务：<https://developer-docs.amazon.com/sp-api/reference/listtransactions>，仓库已有 `docs/amazon-finance-p3-plan.md`；本次公开页面被人机验证拦截，未绕过，不能声称完成最新在线复核。
- 库存事件：`src/data/amazon-contracts/inventory-ledger-detail-contract.json` 与 `docs/amazon-data-domains-official-evidence.json` 已保存官方依据。
- 赔偿：需再次核实官方 FBA report-type 文档的日期支持，不能从通用 createReport schema 推断特定类型支持。
- 结算：需复核 getReports 的滚动保留期和分页约束；现有分页已正确仅传 nextToken，保留此行为。

## 影响、回滚与验证

影响范围为四域任务生成、冻结窗口、共享报告执行器及结算归属/查询。请求仍按现有预算串行分片，不引入额外轮询或自动 FATAL 重试；结算去重预期减少重复下载，新增归属检查带来少量数据库查询，实际性能未 benchmark。尽量复用已读取绑定并保持批量查询，避免逐行查库。

回滚首先停用受影响计划和隔离活动任务（真实操作另批），保留 raw、cursor、失败记录和新数据；回退代码必须兼容新增 checkpoint。若需要迁移，采用向前兼容扩展，单独审阅；禁止删表或自动回滚数据库。

代码获批后使用 mock transport 验证：财务闰年/滚动边界/排队过期/不推进旧游标；库存准确请求体/400 code 脱敏/未知创建结果不重发；赔偿 30 天冻结窗口/FATAL 不发布/旧检查点兼容；结算多站/越权/缺失归属隔离/重复报告/分页恢复/90 天边界。运行相关单测、lint、TypeScript；共享改动按 `npm run check:fast` 完成回归。数据库归属需隔离临时库 mock 集成验证，先审阅 runner，确保不读真实 dotenv、不访问现有库或 Amazon。方案阶段未运行测试；尚无实施代码可验证。

完整 build/E2E 在准备合码或页面契约改变时再执行，真实重试需另外列出环境、授权/店铺/站点、日期、最多请求数、任务 ID 和停止条件。库存“重试一次”指一次新 createReport 尝试，不授权无限重试或全店重建。不得自动 commit/push、部署、写配置、迁移或重启。

## 待确认范围

批准本方案的本地代码与 mock 验证范围后实施。若结算所需共享模型超出现有表能力，先产出具体迁移方案再确认。真实九店映射核验、历史任务恢复及真实 API 重试均不包含在本次代码批准中。
