# P5 统一调度与观测验收（2026-11-05）

P5已按用户确认的5A—5D计划完成本地实现、离线验证、运维文档和PR描述草案。P1—P5开发范围收口；**尚不等于生产启用或正式GitHub PR交付**。本轮无schema/迁移、依赖或Amazon端点变更，不开放定时自动采集、外部告警通道、raw下载/人工重放或自动保留清理。

## 验证路线与证据

| 验证 | 结果 |
| --- | --- |
| `npm run test:amazon-sync:offline` | **85单元 +143数据库集成 +7浏览器通过，退出码0**；`/tmp/codex-p5-all.log`。数据库集成含新三资源27项生命周期契约及既有116项，浏览器为Orders3/Finance2/Returns2 |
| `npm run test:amazon-sync:lifecycle` | 完整回归后新增1项事务回滚测试，仅测试代码变化；专项 **85单元 +28生命周期集成通过，退出码0**；`/tmp/codex-p5-lifecycle-complete.log`。不为相同业务代码机械重复全量旧链路 |
| 全仓核心 | 白名单环境 `tsx --test tests/*.test.ts`（等价 `npm run test`）：**764通过 /0失败**；`/tmp/codex-p5-core.log` |
| TypeScript | 最终 `npm run typecheck` 通过；`/tmp/codex-p5-types-complete.log` |
| lint | 全仓 `eslint --ignore-pattern '.next-amazon-live/**'`：**0 errors /5既有无关warnings**；`/tmp/codex-p5-lint.log`。最终新增事务测试专项lint为0；未改全局lint配置或删除生成目录 |
| Diff | `git diff --check` 通过；未擅自提交、stash、reset或推送工作区 |
| 临时服务 | runner仅创建随机loopback PG/Redis（预装image，--pull=never），退出码0并清理完成。结束标签盘点无遗留测试容器；无真实配置/数据清理 |

Node为24.18.0；Node22 CI、完整生产构建及真实账号E2E未执行。共享逻辑按核心测试+lint+类型与新增专项/全资源回归验证；不运行会加载真实dotenv的worker或生产流程。完整生产构建属于后续明确合码门槛，不把当前开发检查冒充发布通过。

## 本次新增断言

新文件 `tests/integration/amazon-sync-lifecycle.integration.ts` 使用现有仓库fixture，经真实申请→批准→应用，再走mock transport和临时数据库；所有URL为fixture.invalid或loopback，网络guard在应用import前启用。

1. **三资源pause/resume/cancel**：任务与所属cursor进入PAUSED/WAITING/CANCELLED，分页/报告密文、窗口、成功水位不变；旧dispatch零HTTP。
2. **lease恢复与耗尽**：有预算进入RETRY_WAIT，无预算FAILED，cursor同步，fence/dispatch推进；旧执行版本零HTTP。新执行从原分页token继续，退货查询已有reportId而不重新create；显式retry保留cursor并授予有限预算。
3. **截止/审批/preflight阻断**：三资源共9项，任务/cursor BLOCKED、密文进度不变、零HTTP；source安全进度和任务operatorAction正确。Orders既有部分角色失败为FAILED的兼容语义未改。
4. **成功与跨run保护**：共享状态更新不改SUCCEEDED及lastSuccessAt；错误run ID不能覆盖当前持有者进度。
5. **HTTP中请求暂停**：用可控Promise barrier，在响应回来前审批pause；提交检查点前处理control，任务和cursor PAUSED，原进度未推进。没有真实sleep。
6. **资源错误码**：无效响应在Orders/Finance/Returns分别记录ORDER_VALIDATION/FINANCE_VALIDATION/RETURN_VALIDATION；静态unit还验证403对应ROLE_OR_SCOPE及旧Orders码兼容。
7. **事务回滚**：临时PG trigger故意拒绝cursor更新，lease恢复的run状态、dispatch/fence、leaseOwner、cursor进度和LEASE_EXPIRED日志全部回滚；无HTTP。trigger只在本次隔离库创建并在finally清理。
8. **隐私**：进度DTO只selectresource/UTC窗口/status/lastSuccessAt/updatedAt；测试检索无Ciphertext、fixture-access/secret、分页值、reportState、leaseOwner。任务建议为固定文案，不使用原始错误内容。

既有116集成和85单元还覆盖Orders/Finance金额精度、UTC、版本/授权边界、分页/幂等、400/403/404/429/500、LWA单飞刷新、raw加密、退货单报告及断点恢复、原三链路兼容、MCP/权限和fixture队列/worker闭环。这里的worker只处理隔离fixture，不是启动实际同步服务。

## 最终自检：是/否 + 证据

| 原始要求 | 结论与证据 |
| --- | --- |
| 三类新同步能在隔离环境跑通 | **是**：完整回归85单元+143PG+7浏览器；最后增加的事务用例由28项生命周期专项覆盖 |
| 没有真实网络请求与真实凭证参与 | **是（Amazon业务调用与测试）**：白名单环境、无dotenv、mock transport、网络guard、loopback临时库和route.fulfill；无真实Amazon/LWA请求、任务或凭证。前期公开官方网页只读核验另有记录 |
| 全部新端点都有官方URL/版本 | **是**：P1/P2 Orders v2026-01-01、P3 Finances v2024-06-19、P4 Reports v2021-06-30的client注释与PR/计划；P5不新增端点；没有伪造RDT/通知/轮换API实现 |
| 幂等重放通过 | **是**：Orders/Finance原业务键重放、退货reportId+rowHash重放与单报告查询；PG唯一索引和既有集成断言 |
| 断点续传通过 | **是**：分页第2页/退货归档offset跨run恢复；新增lease恢复仍请求原token/reportId，旧dispatch不可执行 |
| 403/429行为符合预期 | **是**：400/403终止，429有界退避/持久预算/计数；签名下载403只刷新文档元数据；通过完整离线分支测试 |
| 金额与时区断言通过 | **是**：Orders/Finance字符串+NUMERIC精度与UTC三层测试；退货UTC+站点时区、无金额字段。无FX保留未折算，不假设汇率 |
| 日志中检索不到token/PII | **是（fixture范围）**：合成secret/access/评论/签名URL不进入原日志或DTO；新增安全进度无密文/token/内部lease字段。未访问真实日志，原件只加密留档 |
| secret轮换与年度重授权已写文档 | **是**：README与 `amazon-sync-p5-operations.md` 明确client secret180天、refresh token年度重授权、主密钥不可直接覆盖及审批/验证流程；未实际轮换 |
| 已输出待人工确认清单 | **是**：下表；已确认P2免RDT、P3卖家级范围、P4单报告FBA仓收以及P5最小状态/观测范围，不重复索要相同确认 |

## 待人工确认与发布限制

- **真实业务参数**：Orders角色/PII数据集目的与状态映射；Finance全部站点/FX来源、版本、有效期、舍入及延迟入账/DEFERRED对账；Returns真实无offset日期的解释、原因中文归类和跨报告对账。无配置不猜测、不硬编码。
- **持续采集授权**：目前仍逐次批准有界窗口。若需自动下一窗口/定时任务，另定执行授权期限、预算、积压策略及撤销边界，不复用配置审批当无限执行权。
- **告警与保留**：当前站内任务错误/结构日志/固定建议，不存在邮件/Slack主动通知。需确定外部渠道、责任人、阈值/SLA；raw保留期、解密权限、存储和事务/P95预算仍独立审批，自动清理/解密下载未开放。
- **GitHub交付**：收口HEAD为 `41bd94c`；本轮未执行commit/push，P5文件仍为本地改动，已有 `.next-amazon-live/` 生成目录不属源码。正式PR与推送前应重新盘点整个工作区、明确范围；当前交付本地PR草案，不谎称已经有PR URL或远端对齐。
- **合码/上线**：Node22 CI与完整生产构建；P1—P4迁移和真实配置人工审阅；明确目标环境/数据范围/灰度/回滚。P5本身无新迁移。不启动真实服务、不自动部署、轮换、重启或变更生产。

## 交付文件

`docs/amazon-sync-p5-plan.md` 为已批准方案，`amazon-sync-p5-operations.md` 为统一值班/恢复/凭证指引，`amazon-sync-p5-pr.md` 为本地PR描述；`specs/004-amazon-operations-hub/sync-p5.md` 记录问题→计划→实现→验收链路。运行实现沿用scheduler/processor/service/read/contracts和既有UI，没有新框架或平行事实表。
