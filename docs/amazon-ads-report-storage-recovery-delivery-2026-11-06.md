# 报表文件与数据库故障恢复交付

日期：2026-11-06。T06/T11 的文件/数据库非原子边界子项，不代表正式采集或完整故障矩阵完成。

## 实际代码与数据边界

- `src/lib/amazon-ads/report-acquisition.ts`：文件 put 返回后收集内部 storageKey、SHA256 和字节数。后续数据库提交失败时，在原事务之外尝试写 `amazon.ads.report.storage_commit_unconfirmed` 审计，关联 workspace/task/request/version、dispatch/fence 和阶段。原事务结果不确定时，只称“提交未确认”，不判定对象一定孤立。
- 继续复用 `AuditLog`、`FileObject`、`AmazonAdsReportDocument`、任务/版本及原 storage driver。没有新增 Schema、迁移、API、队列、配置或公开原始数据入口。
- 审计只在已知文件写入后发生提交失败时增加一次有界事务，maxWait 500ms、事务超时 2000ms、SQL statement_timeout 1000ms；成功路径无额外数据库往返。该失败路径未做生产延迟 benchmark，不承诺 P95。
- 审计失败只输出固定码 `ADS_REPORT_STORAGE_EVIDENCE_UNAVAILABLE` 和内部任务/请求 ID；不覆盖原异常、不伪造持久审计成功，不打印 SQL、数据库错误正文、签名 URL、凭证或报表正文。

## 故障验收

`tests/integration/amazon-ads-reports.integration.ts` 在临时数据库安装并移除失败 trigger：

1. gzip 文件已保存，FileObject 插入失败：无元数据、document 或 fact 残留，持久审计能定位文件及 hash。
2. FileObject 已插入，ReportDocument 插入失败：整个数据库事务回滚，文件保留。两种情况随后重试消耗第二次 download 预算、沿用原 request/report/version，最终一个版本、一行事实、一份有效 FileObject，不重发 create。
3. create 的加密原始证据已保存，FileObject 插入失败：未知结果 reservation 保留，任务阻断，不重发 create；审计只记录加密对象引用。
4. 文件元数据及审计写入同时失败：原失败不被覆盖，只输出固定诊断，任务与 Attempt 安全结束。

还复验仓库已有的 `--report-worker` 专项：14/14通过，包含真实子进程 SIGKILL 后 create 未知阻断、download 用新 fence 恢复。该子进程测试为已有并行工作，本批复用验收，不重复归为新增实现。

## 验证路线

- `node scripts/test-amazon-ads-offline.mjs --reports`：41/41通过。
- `node scripts/test-amazon-ads-offline.mjs --report-worker`：14/14通过。
- 定向 ESLint、全仓 `npm run typecheck` 均通过。
- 两套集成均使用独立临时 PostgreSQL/Redis、uploads 和 mock transport，并加载网络 guard；没有真实 API、凭证或持久数据库操作。只修改局部采集故障路径，采用专项集成与静态检查；未运行 UI/E2E、生产构建和全量 check，合码/上线时执行对应关口。

## 剩余、回滚和安全事项

不自动删除或回收对象。审计不是清理授权，也不能代替对账；同一对象后续重试可能已被成功引用。人工处理须先检查当前 FileObject/Document 和任务/版本引用。数据库不可用、进程在 put 后立即被 kill、或 put 结果本身未知时，仍可能无法持久保存 receipt；本批未实现存储事务 outbox 或自动孤立对象扫描。

回滚仅恢复 acquisition 的 receipt/审计差异及新增测试，不删除已记录审计、文件、任务或事实。未提交、推送、部署或启用正式报告采集，保留其他工作区改动。

下一步仍需完成 RT07/RT08 的跨 Profile 相同远端 ID、发布提交响应未知等组合，并按正式报告合同核验下载目标、任务创建/审批和重叠日期版本裁决。
