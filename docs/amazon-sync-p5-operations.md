# SP-API 订单／财务／退货运维指引（P5）

本页描述本地实现及经批准的运行边界，不授予生产配置、部署、迁移或真实同步权限。沿用现有 adapter/client → approval/service → processor → Prisma；ProductRecord、库存扣减、付款/退款及PPC工作区不受这些只读采集自动修改。

## 执行与审批

配置申请、批准、应用与任务执行分离。每次执行批准一个服务端冻结的有界窗口，执行授权自应用起24小时。支持组织有效owner/database_admin在现有权限下自批，仍保留请求、范围、版本、摘要、有效期和审计；普通成员不能自批。worker在HTTP前及事务提交前再次核验当前角色、seller/site/region、源/授权revision、审批人与操作人权限。

`tickSyncCenter` 只派发已持久化且批准有效的任务，不根据source配置自动生成下一历史窗口。Redis丢失后由数据库intent重建队列；dispatchVersion拒绝重复/旧投递，fenceVersion/lease拒绝旧worker提交。标准worker模式仍包含现有其他业务；需要真实受控运行时必须另行审阅approved-only模式、允许的task/export ID、目标环境和范围。**不要为了验证本功能直接执行worker入口、启动systemd或默认启动所有Docker服务。**

## 存储契约映射

| 原始要求 | 现有持久模型与字段 |
| --- | --- |
| 每资源job | `AmazonSyncRun.resource`，三资源均incremental；订单列表与可选详情共用同一job |
| resource/seller_id/marketplace_id | `AmazonSyncResourceCursor.resource/amazonSellerId/marketplaceId`，另有tenant/workspace/source作用域；ERP店铺是sellerAccountId，不等于Amazon sellerId |
| watermark_from/to | `watermarkFrom/watermarkTo`；原始API窗口语义分别按资源契约解释，不把成功窗口误当全业务完整 |
| next_token | Orders/Finance `nextTokenCiphertext`，AES-GCM且AAD绑定tenant/workspace/cursor；无明文token字段 |
| Reports续传 | `reportStateCiphertext`包含report/document/archive/解析offset，Reports本身无nextToken；不伪造token |
| last_success_at/status | cursor `lastSuccessAt/status`；状态暂停/取消/过期阻断保留成功水位和已提交进度 |
| run_id/起止/请求/写入/跳过/失败/429 | run `id/executionStartedAt/finishedAt/apiRequests/insertedCount/updatedCount/skippedCount/failedCount/throttles`；`startedAt`是入队时间，不能替代实际执行开始 |
| 原始报文 | `AmazonSyncRawPage.rawCiphertext/bodySha256/requestMetadata`；Reports原文以加密JSON envelope保存，不落明文临时文件；不向普通API/UI输出 |
| 请求观测 | `AmazonSyncTaskLog`的event/stage/code/statusCode/requestId/rateLimit；只允许非敏感元数据，不保存Authorization/header全集、分页token、签名URL、报文内容 |

## 状态与恢复

run描述一次执行，cursor描述持续业务窗口。健康执行时，run可能WAITING/QUEUED等待下一片或预算，而cursor保持RUNNING表示窗口尚未完成；两者不要求逐片完全同值。P5补齐控制/异常迁移的同步：

| 场景 | run / 所属未完成cursor | 处理 |
| --- | --- | --- |
| 暂停 | PAUSED / PAUSED | 运行中的任务先设control，提交检查点前处理；经新审批resume，进入WAITING，保留密文进度 |
| 取消/解绑 | CANCELLED / CANCELLED | 取消该job并fence旧投递；未完成窗口仍保留，新任务需再次审批；取消不删除事实或raw |
| 有剩余尝试的lease过期 | RETRY_WAIT / RETRY_WAIT | 增加fence/dispatch，从原nextToken或reportId继续；不新扫历史，不重新create报告 |
| 尝试耗尽 | FAILED / FAILED | 不无限重试；人工核查后申请retry，保留历史计数，授予新的有限尝试预算 |
| 执行授权过期/审批撤销 | BLOCKED / BLOCKED | 结构日志EXECUTION_EXPIRED/APPROVAL_UNAVAILABLE；核对后重新审批，不延长旧许可绕过审批 |
| 执行前绑定/权限不符 | BLOCKED / BLOCKED | 无HTTP；P1/P2原有部分角色/响应校验在执行阶段记录FAILED，仍零HTTP且不放宽权限 |
| 成功 | SUCCEEDED / SUCCEEDED | 只有整个窗口/报告完成才推进成功证据；P5异常迁移不覆盖已成功cursor |

状态更新同一scope锁/事务，且cursor须activeRunId匹配当前run。旧run不能改新run持有的cursor。run迁移失败时cursor迁移一起回滚；不更改watermark/token/reportState/lastSuccessAt。

## 资源、角色、版本和限流

| 资源 | 契约/角色 | 窗口与预算 |
| --- | --- | --- |
| Orders | v2026-01-01 searchOrders/getOrder；配置的已批准角色，PII数据集还需对应restricted角色及明确用途。用户已确认新版免RDT，PII仅密文原件/详情 | 配置更新时间窗口+回查+安全延迟；searchOrders最多0.0056rps/burst20，getOrder最多0.5rps/burst30；低请求预算需结合积压估算窗口，不每次扫历史 |
| Finance | v2024-06-19 listTransactions；Finance and Accounting | postedAfter/postedBefore+nextToken；配置卖家级全部站点及预算（当前上限0.5rps/burst10）；实际site归属，未知归属加密隔离；DEFERRED/延迟入账不代表最终结算 |
| FBA Returns | Reports v2021-06-30唯一allowlist FBA仓收类型；Pricing或Amazon Fulfillment，且实际FBA资格 | 配置窗口与至少一天安全延迟；createReport 0.0167rps/burst15，getReport 2rps/burst15，getReportDocument 0.0167rps/burst15；下载有界GZIP/UTF-8、批次落库；单报告发布和查询 |

额度按seller/application/operation持久令牌桶处理；有较低 `x-amzn-RateLimit-Limit` 时收紧，缺头不依赖该头。P4退货同时尊重既有Reports API budget；旧三链路保留原预算机制，不宣称本阶段重写为全局同一限流器。预算等待通过nextAttemptAt释放worker，不占用真实sleep。

官方操作URL/版本：Orders见 `amazon-orders-p1.md`/`amazon-orders-p2-plan.md`；Finance见 `amazon-finance-p3-plan.md`；Reports见 `amazon-returns-p4-plan.md`及official-evidence.json。P5不新增外部端点。ORDER_STATUS_CHANGE通知未接入。External Fulfillment Returns v2024-09-11存在，但不属于本次FBA仓收报告范围。

## 异常处理与告警

- API400/403：终止，不自动重试。查看安全RequestId、阶段和错误码；400核对批准参数，403核对Amazon角色/卖家资格/授权状态及ERP范围。若授权标ERROR，必须走授权验证/变更审批，不直接改库恢复。LWA invalid grant安全终止，不向用户回显上游报文。
- 429：记录throttles/RequestId，持久blockedUntil，指数退避+抖动并尊重有界Retry-After；不要用新applicationId/source/任务绕过预算。
- 5xx/网络：有限重试，从已提交检查点继续。创建报告响应不确定是例外：无法确认reportId时禁止自动重新create，须人工核查；本实现不提供假“强制恢复”按钮。
- Reports404/IN_QUEUE/IN_PROGRESS：有界退避，非直接失败；达到次数/时限保留报告状态等待人工处理。签名下载403/404重新取document metadata，不重复create、不误禁用LWA；FATAL/CANCELLED不猜成空报告。
- 校验错误：ORDER_*兼容旧码；财务FINANCE_VALIDATION/FINANCE_ROLE_OR_SCOPE，退货RETURN_VALIDATION/RETURN_ROLE_OR_SCOPE。故障提示不含原始token/PII。
- 站内任务错误、结构日志及operatorAction是当前告警入口；没有邮件/Slack/webhook值班推送。外部渠道、责任人、阈值和通知频率须另行确认，不能宣称已有主动外呼告警。

查询/API只提供cursor资源、UTC窗口、status、lastSuccessAt、updatedAt及未完成标记。标记未完成不保证可直接重试（可能创建结果不确定、审批过期或格式未确认）。任务和source过滤沿用tenant/workspace/seller/site grants；Finance保持管理员卖家级边界，不通过站点grant扩大访问。日志/进度不提供raw或密文下载。

## 数据正确性与人工口径

订单业务键Amazon order+site并含tenant/seller；保留原始和标准状态。财务transactionId按实际API字段，金额保留原字符串+NUMERIC，汇率来源/版本/有效期外置，无FX明确未折算，非订单交易单独分类。退货键reportId+行hash仅报告内幂等，不将重叠报告累加为独立退货；quantity可大于1，相同行折叠计入质量证据。日期必须明确offset转UTC，保留配置站点时区；无offset格式及中文原因映射不能猜。

原件回溯复用既有密文证据和cursor续传；没有新增任意报文手工重放/解密下载入口。raw保留清理仍是review-only，未自动删除历史。首次上线前需确定保留期限、访问人、最大文件/批次/事务预算和P95；临时fixture容量数据不是生产性能承诺。

## 凭证轮换与解绑

client secret每180天轮换；refresh token按每年重新授权处理，采用原任务保守口径。Application Management自动化可单独评估，但本阶段不增加端点/自动轮换任务。access token缓存至expires_in减5分钟，同revision并发刷新单飞；所有token禁止明文日志/数据库。应用加密密钥与client secret不是同一密钥，不能直接覆盖加密主密钥导致旧密文不可读。

实际轮换须先审阅目标环境/授权ID/影响任务/回滚，走现有凭证变更批准→应用→验证；旧任务的revision fence将阻断，不以复制新密钥到旧run绕过。解绑使用现有授权/source停用流程，级联取消相关新资源任务并保留cursor；不删除事实、raw、数据库或存储。

## 离线验证与发布界限

- `npm run test:amazon-sync:lifecycle`：新三资源pause/resume/cancel、lease过期恢复、权限/审批阻断、旧dispatch、成功/跨run游标保护及DTO安全。
- `npm run test:amazon-sync:offline`：全部fixture单元、临时PG/Redis集成和浏览器，一条命令覆盖原三链路与Orders/Finance/Returns。需本机已有Docker和预装image；不pull，不加载dotenv，不启动实际worker入口。应用HTTP是mock，浏览器route.fulfill，网络guard限制外连。
- UI/共享逻辑用核心测试+TypeScript/lint；合码还需Node22 CI与完整生产构建。真实账号E2E、生产迁移、部署、真实任务和GitHub混合改动区同步仍需明确范围审批。
- 回滚P5应用代码至P4，保留已有表、事实和密文；P5无新迁移/依赖。实际停用配置或重启worker是单独操作，不由本文自动执行。
