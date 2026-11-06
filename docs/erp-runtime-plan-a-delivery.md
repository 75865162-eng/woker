# 最小代码收口与隔离验证：方案 A 交付

用户已在当前聊天明确要求“最小代码收口与隔离验证”。本轮仅执行方案 A，不扩大到真实本地配置清理/归档、现有进程控制、正式迁移、供应商请求、备份启用或服务器发布。

## 本轮改动

- `scripts/amazon-sync-live-preflight.mjs` 删除 dotenv/DOTENV_CONFIG_PATH 独立入口，复用 runtimeEnvironment；保留纯 inspect 函数，拒绝冲突/退役 profile，生产注入配置不能被当成本地联调就绪。加载错误只输出固定脱敏报告，退出 2，不泄露值、不连接数据库或外部服务。
- `tests/amazon-sync-preflight.test.mjs` 增加临时根配置、替代文件、继承冲突、退役 profile 与真实 CLI 生产拒绝验证。fixture 不读取私有配置。
- `tests/integration/runtime-execution.integration.ts` 扩展到 9 个执行测试；新增辅助文件 `runtime-execution-child.ts`，只在带 fixture 标志、erp_fixture 数据库和 IPC 的隔离进程内运行。
- `scripts/test-runtime-integration.mjs` 报告新增断言与未覆盖范围；沿用自己的临时 PostgreSQL/Redis、白名单环境、独立 Prisma config、dist/上传目录及清理逻辑，不改真实库 schema，不改业务 processor。
- 更新 AGENTS 中已经过时的预检入口说明，保留其余已有未提交内容；同步运行说明、CLI 入口清单和 Listing AI schema/API 审阅草案。

## 本次实际通过的验证

| 验证 | 结果与含义 |
| --- | --- |
| `node --test tests/amazon-sync-preflight.test.mjs` | 4/4；配置入口和脱敏拒绝 |
| `tsx --test tests/runtime-unification.test.ts tests/release-runtime.test.ts tests/deployment-plan.test.ts` | 29/29；mock 管理器生命周期、配置、心跳比较、备份与发布规则 |
| `npm run test:runtime:integration` | exit 0；9 个执行测试 + 17 条集成结果记录（不是 17 个独立 test case） |
| `npm run typecheck` | exit 0；源码类型检查，不等价于 Next 完整 build |
| 对本轮 5 个 JS/TS 文件执行 ESLint | exit 0，无输出/告警 |

集成的新增证据：

1. 商品导出旧执行器已写 attempt 文件但尚未发布时，租约过期并由新执行器接管；旧执行器恢复后无法修改结果、FileObject、ExportRecord 或成功审计/版本。最终只引用新执行结果。旧 attempt 文件保留，不自动清理真实 Storage。
2. 在隔离库用 trigger 让最后一条 export_record_save 审计失败，确认 job 成功状态、文件结果引用、ExportRecord 及成功 DataChangeVersion/AuditLog 一起回滚；随后错误状态及失败审计可记录。移除 fixture trigger 后重试成功且只生成一个发布记录。
3. 对实际 product_export processor 的 Excel 生成后/数据库发布前 gate，以及实际 image processor 的 mock CPU engine gate 执行 SIGKILL；仅修改临时任务的 lease 为过期后恢复，确认新 token、attempt=2、最终结果发布成功且不重复。

集成仍实际运行 Next dev、数据库登录、四类真实 Worker 子进程、健康 API 与 Chrome 设置页、合成无效上传消费、停止离线、管理器重启、父进程强杀无孤儿、Redis 中断持久化与队列丢失恢复、PG 重启后心跳更新，以及 custom dump 恢复到另一个临时空库。全部为 mock/隔离实例，不代表供应商业务成功。

测试中的租约到期采用临时 SQL 将时间提前，不等待真实 120 秒；证明的是数据库过期后的接管与发布边界。未把它写成真实时长超时演练。SIGKILL 的 import 分支为 product_export，不是 Bulk 解析；图片计算为 mock，不是原生 Real-ESRGAN。

首次集成运行 7/9 通过，两个辅助子进程因 TS/CJS 顶层 await 格式失败，尚未进入强杀 gate；已改为 async main 后完整重跑通过。失败日志保留在临时目录 `erp-runtime-integration-sZXhGY/fixture.log`，不删除历史证据。最终摘要日志为 `/tmp/erp-runtime-plan-a-integration.log`，类型检查为 `/tmp/erp-runtime-plan-a-types-final.log`。本机临时日志不是提交产物或正式生产验收记录。

最终核对本轮 fixture label 下无剩余容器，tsconfig.json 无新增 diff。成功 fixture 的进程、dist 与临时目录已清理；未停止既有 Worker/网页或修改其配置。原有未提交工作区内容保留，未 commit/push。

## 收口结论与剩余门槛

方案 A 的预检入口代码、补充隔离验证、CLI 盘点和 AI 草案可按本范围收口；不能据此宣布生产级全部完成。

- 原生 Real-ESRGAN/Bulk 解析内部强杀、运行中数据库发布事务被 PG 重启打断，仍未覆盖。此次验证了 mock CPU/导出发布前故障与 PG 重连，不扩大结论。
- CLI 其他入口只盘点及提交建议 diff，未静默改为统一 loader；见 `erp-runtime-plan-a-cli-and-ai-draft.md`。
- Listing AI 后台化仅是 schema/API 草案；凭据版本、授权与未知计费结果恢复必须先定稿，现有业务 API/UI 未改变。
- 正式备份/异机对象与密钥恢复、真实配置归档、GitHub 同步及 CI build、服务器部署/开机自启，仍按 B/C 单独审阅审批。

本轮采用定向测试、类型和 lint，加一次完整隔离运行验收。未运行全仓 check:fast/check、生产 build 或真实页面任务演练：本轮业务热路径/schema/权限未改，完整构建留到批准合码并确认整个工作区发布范围时执行。
