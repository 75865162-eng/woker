# P5 PR 草案：补齐增量同步生命周期与安全观测

状态：本地描述草案，未创建GitHub PR。本轮没有执行commit/push、生产迁移、部署、真实同步或配置写入。收口时仓库HEAD为 `41bd94c`（feat: complete Amazon sync data domains）；此前P1—P4文件已进入该本地基线，P5改动仍在工作区。正式提交/同步前重新盘点全改动区；既有 `.next-amazon-live/` 是生成目录，不作为应用源码提交。

现有Orders、Finance、Returns任务在暂停、租约恢复或审批阻断时，run状态会改变，但cursor可能仍显示RUNNING；财务/退货校验失败还沿用订单错误码。本次在同一事务中同步所属未完成游标，保留原检查点；为查询提供安全窗口进度和固定运维提示，并区分新资源的错误码。

## 最终变更

- `service.ts syncIncrementalCursorStatus`：只更新同tenant/workspace/source/resource且activeRunId匹配当前run、状态非SUCCEEDED的cursor。调用方持有scopeLock，先成功变更run；不清空分页密文、报告状态、窗口或成功水位。
- scheduler租约过期、执行截止/审批撤销，与processor preflight/运行中pause/cancel、service显式resume/retry接入该规则。执行截止和审批失效增加安全结构码，dispatch/fence继续抵御旧队列与旧worker。旧三链路不走新增cursor更新。
- Finance/Returns使用FINANCE_*/RETURN_*校验码；Orders既有ORDER_*码和原有部分角色失败为FAILED的行为保持兼容，不为改观测文案改变执行权限。
- `read.ts/contracts.ts`：source关系只select安全cursor字段；保留既有tenant/seller/site及Finance管理员过滤。taskSummary固定operatorAction，不接受上游报文作为提示。UI显示窗口和需要核对审批/日志的提醒，不暴露token/密文/raw/PII，也不把未完成标记解释为可无条件重试。
- 既有runner纳入三资源生命周期集成；新增 `npm run test:amazon-sync:lifecycle`。统一运维指引明确角色/版本/预算、表字段映射、状态、恢复、告警和凭证轮换。

## 设计与影响

无schema、迁移、依赖或Amazon端点变更。仍每次审批一个有界窗口，24小时执行授权；不增加自动采集、任意raw重放、外部消息告警、自动清理或轮换。既有LWA单飞、PII加密、P3卖家级归属、P4单报告统计不变。没有业务金额、库存或商品主数据写入变化。

每次新资源状态迁移增加一个有作用域/activeRunId的cursor条件update；source进度随现有关联读取，不新增每source请求/轮询。没有生产P95承诺；生产容量仍需评审。事务回滚专项验证cursor写失败时run/fence/日志一起回滚，减少误报和误恢复。

回滚为恢复P4应用代码，保留现有持久事实和加密证据。实际停用source、worker重启、配置及部署仍需独立目标/范围审批。

## 验证与未完成项

完整离线：85单元+143数据库集成+7浏览器通过；随后只新增事务回滚测试，生命周期专项85单元+28集成通过，业务代码未再变化。核心764、类型检查、全仓lint（0 errors / 5既有warnings，排除既有生成目录）与diff检查通过。完整命令下次将包含新增回滚用例；本次以专项覆盖避免重复运行等价的旧链路。

证据、逐条自检和剩余人工门槛见 `amazon-sync-p5-validation.md`。Node22 CI与生产构建、正式PR/推送范围、真实站点参数、FX/日期格式/原因口径、raw保留/访问和外部值班策略仍待确认；不以本地测试代替发布审批。P5没有新增端点，官方版本/URL沿用P1—P4文档，不虚构Tokens/通知或Application Management API实现。
