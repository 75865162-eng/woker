# Lili 全流程单次对话审批实施记录

## 已实施

2026-11-08 用户确认 docs/lili-all-workflows-chat-approval-plan-2026-11-08.md 后实施。Lili 全部技能入口、12个中英文工作流模板、MCP 初始化说明及 Skill manifest 统一携带 approvalPolicy：channel=codex_chat、approvalUnit=specific_task_plan、repeatApprovalWithinScope=false、browserRequired=false。保留原始 SOP 正文和哈希，不修改网站缓存或上游流程原文。模板中的用户指定业务暂停点仍有效，选择/最终结论在对话中确认；新范围只确认新增部分，不以一次批准授权无限未来任务。

共享策略位于 src/lib/lili/approval-policy.ts，catalog 生成中英文提示，skill-manifest 对原始 SOP 附带主机策略。网页 /lili/v2/approvals 改为说明对话审批和可选查看入口。未映射 API/工具返回 UNSUPPORTED_EXECUTOR、browserRequired=false，保留旧 nextPath 字段供兼容查看，不要求导航；不会返回虚假执行成功。

## 已接入执行域

| 执行域 | 对话处理方式 | 实际边界 |
| --- | --- | --- |
| Skills/工作流定义及ERP只读分析 | 复用现有注册工具；不增加重复审批 | 仍按凭证和实际数据权限读取 |
| 五阶段开品研究及付费市场查询 | 已保存付费授权直接运行，research_confirm 保存业务决定 | 已有任务预算、费用记录、未知结果核对和两个人工业务节点保持 |
| 已有有界数据同步申请 | workflow_sync_review 展示本人请求；workflow_sync_confirm 引用当前指纹/revision及用户原话，一次批准后直接应用 | 只支持 operation=run；最多来源数和时间窗口由原 requestChange/decideChange/applyChange 校验，不支持配置/权限变更 |
| 广告写入、上架、货件等未映射目录步骤 | 对话中说明未执行部分，保留分析/草稿 | 不恢复或虚构执行器，不要求浏览器批准 |

上述规则覆盖12个模板入口：周一经营例会、广告止血、销量下滑全链路诊断、新品从上架到开广告、从选品到开品文档、竞品全拆解、补货到发货一条龙、利润体检、大促备战、老品清退、退货攻坚、月度经营报告。模板存在不等于它的所有写入步骤已接通。

## 同步执行器与权限

新同步工具使用显式工具授权和 operations/view、operations/approve，不能借用 agents/approve。执行前逐次重新认证原Bearer并核对revision；申请限定同组织/工作区、requestedByUserId=当前用户、operation=run。要求凭证同时具有 data_sync_start，且来源处于凭证 seller/site 与当前 MCP sync 数据授权的交集。沿用现有变更申请的存储、密封命令、摘要、过期判断、基线版本、审批CAS和applyCAS。决定将用户原话保存为 decisionReason（Codex chat前缀），操作者和时间由服务端填写；没有另造任务数据库或直接SQL执行器。

已APPLIED请求重复确认直接返回当前已应用状态；APPROVED但应用中断可重读状态后继续，无需第二次人类批准。STALE/EXPIRED/REJECTED等不能进入apply。网络中断后必须查当前状态，不新建或重放任务。客户端负责只转交真实人类的明确回复；服务端无法独立证明文字来自聊天，因此此能力是对指定客户端的显式审批代理授权。

当前两条已核实的lili连接及各自上级凭证新增 workflow_sync_review/workflow_sync_confirm；AuditLog action=lili.workflow.chat_approval.enabled 保存before/after工具及revision。没有增加data_sync_start，没有修改AmazonDataAccessGrant。当前用户的MCP数据授权只有view，因此新工具可发现，但现有连接不能启动同步；后续具体同步需求须在对话中说明目标数据及需新增的权限，不可默认为权限已齐。其他账号、组织、工作区不会自动新增工具授权。

## 实际运行验收

通过 scripts/lili/native-smoke.py 的 NativeCodex 原生客户端核验：lili、lili_research_acceptance 均为connected，目录包含 research_confirm、workflow_sync_review、workflow_sync_confirm。meta_list_workflows 返回12个模板且全部携带codex_chat策略。此次仅做认证、工具发现、模板只读检查和已批准的工具清单更新；未创建/批准/应用真实同步申请，未调用付费市场API，未修改店铺数据。

## 回滚

撤销当前四条明确凭证的新同步工具授权，使用审计beforeTools与最新revision做CAS并另记审计；先比较后续授权变化，不覆盖其他改动。应用代码可回滚新增同步工具注册、执行器和共享提示，原网页仍保留为可选入口；保留研究和同步审批、费用、调用及任务记录。代码回滚不会撤销已经执行的外部动作。禁用新工具不会撤销已批准/已排队的同步任务，若未来有实际任务，必须按已有任务控制服务单独暂停/取消。

不改schema、迁移、.env、worker或服务器编排。未commit/push、部署或重启。当前工作区存在大量其他并行改动，未将它们归入本任务或同步到GitHub；如需合码/发布须先完整盘点并明确范围。

## 最终验证

check:fast通过：1238项测试全部通过、lint 0 error / 7项既有warning、TypeScript通过。随后新增的服务器权限隔离测试单独通过，补跑TypeScript及新增文件/页面ESLint通过。13项隔离研究页面浏览器回归通过，相关已跟踪文件git diff --check通过。测试覆盖全部技能与12模板提示、一次批准应用、重复提交不重发、APPROVED中断恢复、过期/变更/拒绝不执行、独立operations权限、工作区/请求owner/来源范围/数据授权交集及凭证撤销。未运行真实同步或其他外部写入验收，未跑生产构建；准备合码/发布时按仓库规则执行完整check和运行环境专项验收。
