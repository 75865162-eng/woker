# Sync P5 实施追踪

问题定性：三资源增量执行已实现，P5收口调度状态和安全观测。源码核对发现run终止/暂停/lease恢复与cursor状态未在全部分支对齐，以及Finance/Returns复用Orders错误码；属于运维一致性风险。没有读取真实配置或证明生产故障。

## Spec / plan

用户在P4完整离线回归通过后要求继续，进入P5方案核对。文件级计划、现有契约差异、影响、回滚与验证见 `docs/amazon-sync-p5-plan.md`。涉及共享scheduler/processor/DTO，用户已确认该具体方案，已完成实现。不改变逐次审批执行边界，不新增自动定时任务或外部告警。

## Tasks

- [x] 只读核对scheduler、worker-policy、processor/service、read/契约、cursor/run模型及现有测试。
- [x] 列出与原始统一调度/字段/告警要求的差异，形成5A—5D文件级方案。
- [x] 用户确认具体共享影响方案。
- [x] 调度与生命周期run/cursor同事务同步；历史成功/跨run进度保护。
- [x] Finance/Returns资源失败码与安全进度DTO/站内提示。
- [x] 全三资源离线生命周期集成、旧三链路回归、类型与lint。
- [x] 统一运维指引、PR草案、验收/逐条自检与人工事项。

## Validation / risks

P5已实现并完成开发验收：完整离线85单元+143PG集成+7浏览器通过；最后仅增加事务回滚测试，由专项85单元+28PG集成通过覆盖。核心764、最终类型检查、全仓lint无错误（5项既有warning）、diff检查通过。无P5迁移或新端点，临时测试容器已清理；未读取真实凭证或启动真实任务。详见 `docs/amazon-sync-p5-validation.md` 和本地PR描述。收口HEAD为41bd94c，P5仍为未提交本地改动；正式PR、Node22 CI/生产构建、生产参数/值班/保留与发布审批仍待人工处理。
