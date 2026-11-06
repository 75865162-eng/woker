# 报表只读请求退避交付

日期：2026-11-06。T09/T10 的离线恢复子项，不代表正式合同、常规调度或真实账号验收完成。

## 实际代码

- 新增 `src/lib/amazon-ads/report-retry.ts`：按持久化调用次数计算 1/2/4/8/16/32/60 秒指数退避；支持 Retry-After 秒数和 HTTP 日期，选择更晚时间。60 秒只限制本地退避，不缩短上游等待；无法表示的超长等待阻断。当前为 fixture 策略，不冒充官方限流额度或跨 Worker 限流实现。
- `report-acquisition.ts`：只对 poll/download 的非重定向 429/5xx 响应分类，取消响应 body，并保存 nextPollAt 与固定错误码。等待超出总截止则阻断，保留已消耗预算；create 的错误仍保留未知结果 reservation，不重发。未读取或记录失败正文。
- `report-runtime.ts`：读取 checkpoint 时先校验；损坏状态转 BLOCKED，不在重试分类时崩溃。可重试只读错误受剩余预算和总截止限制；等待时间写入任务 nextAttemptAt，释放 lease，不 sleep 占用 Worker。
- 新增纯函数单测；报表集成覆盖 poll/download × 429/503、响应流取消、持久等待、提前重复消息、恢复成功、预算耗尽、超截止、create 不重发及损坏 checkpoint 的运行收尾。

没有新增 Schema、迁移、API、队列或配置。没有调用真实 Amazon API、使用真实业务数据、提交、推送或部署；保留工作区已有改动及暂存状态。

## 验证路线

- `node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-report-retry.test.ts tests/amazon-ads-report-checkpoint.test.ts`：7/7 通过。
- `node scripts/test-amazon-ads-offline.mjs --reports`：36/36 通过；仅临时 PostgreSQL/Redis、上传目录及 mock transport，网络保护启用。
- 定向 ESLint、全仓 `npm run typecheck` 均通过。
- 无 UI、依赖、Schema 或构建链变化，按相关逻辑与报表专项验证，不运行浏览器和生产构建；合码/上线再执行完整检查。

## 剩余与回滚

此批不实现跨任务/Profile 共享限流、不核验正式 Retry-After 合同、不新增实时生产入口。完整 RT 故障矩阵、流超时资源释放、进程级 kill/restart、正式下载合同和容量验收仍待后续完成，不勾选整体 T09–T11。

回滚仅恢复本批 acquisition/runtime 差异并移除新 helper/测试；无需数据库操作，不重置或删除已有任务、预算、请求或文件。已持久化 nextPollAt 使用原有字段，旧 checkpoint 无新增必填字段。
