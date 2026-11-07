# 报表流超时与资源释放交付

日期：2026-11-06。对应 T10/T11、RT10 的离线流读取子项，不代表完整故障矩阵或正式采集已完成。

## 修改

- 新增 `src/lib/amazon-ads/report-body.ts`：从 acquisition 提取有界响应读取，保留状态码、重定向、Content-Length、总字节数和截断校验。读取直接响应原操作 AbortSignal；总时限不会因持续滴流重置。超时取消流、释放 reader lock；不等待失效的 cancel hook，也不让其异常覆盖原始错误。整个读取循环仅使用一次 abort race，不为每块累积 abort Promise 监听。
- `report-acquisition.ts`：JSON envelope 与 gzip 下载共用 helper。超时后才返回的响应在读取及错误分类前取消；429/5xx 的响应取消也不再阻塞等待。原预算、reservation、fence 和提交前超时校验继续保留。
- 新增 `tests/amazon-ads-report-body.test.ts` 六项流测试；报表集成新增两项，实际使用原 5 秒操作时限验证 poll/download 卡住时释放 lease，以及 transport 忽略 signal 后晚到响应不推进状态。

无 Schema、迁移、API、队列入口、凭证或运行配置变化；未调用真实 Amazon API、操作真实数据库或业务文件、提交、推送、部署。仓库其他改动保留。

## 验证

- body/retry/checkpoint 定向单测：13/13 通过。
- `node scripts/test-amazon-ads-offline.mjs --reports`：最终版本38/38通过；临时 PostgreSQL/Redis、隔离上传目录和 mock transport，网络保护启用。
- 定向 ESLint、全仓 `npm run typecheck` 均通过。
- 按局部服务逻辑验证路线执行专项单测、报表全链路隔离集成及类型检查；无 UI、依赖、Schema、构建链变更，不运行浏览器与生产构建。合码/上线再做完整检查。

## 边界、剩余与回滚

测试确认调用 stream.cancel 与释放 reader lock；无法保证不遵守 AbortSignal/cancel 的第三方 transport 会关闭其私有底层连接。尚无正式 HTTP transport，不能将 fixture 结果视为真实网络连接验收。永远不返回的任意注入函数无法被 JavaScript 强制终止；Worker 可以超时退出当前步骤，预算不会补回，晚到提交受原 signal/fence 限制。

下一步仍需进程级 kill/restart、文件成功 DB 失败和完整 RT 故障矩阵；正式 HTTP 的连接、DNS/下载目标及超时策略须随正式合同单独核验。回滚只恢复 acquisition 的 helper 调用并移除新 helper/测试，不变更持久数据、预算、文件或配置。
