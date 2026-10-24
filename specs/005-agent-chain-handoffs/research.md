# Research
- Decision: 复用既有 StorageKey，附加版本化元数据。Reason: 保留旧消费字段，避免平行状态系统。
- Decision: 审批以服务端 AgentApproval + 原 execution output 为准。Reason: launchApproved 请求布尔值可伪造；客户端不能授权。
- Decision: Round B 缺失返回 NOT_IMPLEMENTED。Reason: 开始实施时无对应 CLI；实施期间工作区新增 scripts/selection-pipeline 本机 CLI，已核验。它使用本机 selections/{slug} 与共享 SQLite，尚缺组织/工作区隔离 runner、job 状态、Agent Opportunity 映射；本期仅暴露未实现桥接，禁止页面请求内启动长采集或执行 --write。
- Tooling: 本机 specify CLI 不可用；按本地 Spec Kit skill 直接维护 spec/plan/tasks。constitution 文件仍为未填模板，以 AGENTS.md 为约束。
