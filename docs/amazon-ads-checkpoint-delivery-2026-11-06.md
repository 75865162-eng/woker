# 报表 checkpoint 损坏状态保护

日期：2026-11-06。T09/T10 的离线恢复保护子项，不代表正式报表合同、常规调度或真实账号验收完成。

## 本批实现

- `src/lib/amazon-ads/report-checkpoint.ts`：读取持久化 JSON 时校验版本、阶段、三类调用预算、nextPollAt、reservation 的操作/阶段/扣费/持有者/fence 一致性，以及证据引用和行数边界。预算必须为范围内的安全整数，不接受字符串、负数、缺项或小数。只校验，不重置预算或修复 checkpoint。
- `report-acquisition.ts`：在现有 `live` 事务中、scope 摘要核对及 transport reservation 之前校验 checkpoint。异常固定返回 `ADS_REPORT_CHECKPOINT_INVALID`，不包含原始 checkpoint 或上游正文。
- 新增单测与报表集成案例；测试辅助函数显式接受字符串 ID，消除 UUID 默认值推断导致的类型检查错误。

没有 Schema、迁移、Repository、API 或运行配置变化；没有打开正式采集或修改生产任务。工作区已有的报表 runtime、截止保护等并行修改不归为本批新增成果。

## 验证

- `node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-report-checkpoint.test.ts`：4/4 通过，包含多组非法计数、reservation、阶段和证据参数。
- `node scripts/test-amazon-ads-offline.mjs --reports`：32/32 通过。使用临时 PostgreSQL/Redis、隔离上传目录、fixture transport 和网络保护，不读取真实凭证或 dotenv。新案例验证调用数和任务 apiRequests 为零、损坏状态保持原样、无事实落库。
- 定向 ESLint、全仓 `npm run typecheck` 最终通过。同文件并发用例的 UUID 参数推断问题已通过辅助函数显式字符串类型修正；中间复查遇到的并行 MCP 注册表递归类型错误由对应并行工作修复，不计入本批成果。
- 按最小验证路线执行相关单测、报表专项集成和全仓类型检查；未运行全量核心测试、浏览器或生产构建，因为本批未改变 UI、Schema、依赖、构建链或正式队列接线。合码/上线时仍需完整检查。

## 边界与回滚

校验仅针对内部离线 acquisition checkpoint，不能替代正式 API 字段合同、完整 JSON Schema 或任务创建权限；不把校验通过当成执行授权。损坏记录保持原值供后续人工分析，不自动恢复、不扩大预算、不重新 create。

可通过恢复 acquisition 的校验调用并移除新增 helper/测试回滚代码，不需数据库回滚，不改任务或文件。下一步仍按 T09–T11 落实限流/退避、运行恢复及故障矩阵；正式下载目标及版本合同按 T02/T07 单独核验。
