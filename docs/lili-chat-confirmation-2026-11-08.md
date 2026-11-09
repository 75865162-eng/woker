# Lili 研究对话确认

用户要求后续批准和审批在对话框完成，浏览器只作可选入口。本次范围仅限 Lili 选品研究，不扩展 Amazon 店铺写操作、部署、账号管理或其他业务审批。

## 流程与边界

新增显式授权工具 research_confirm，要求当前 agents/approve 权限及凭证中的独立工具授权。客户端先通过 research_read 展示当前候选/结论/请求及状态，等待用户明确回复，再提交 runId、workspaceId、expectedRevision、gateId、决定及 userConfirmation 原话。SELECT 选择细分，CONFIRM 确认最终研究结论；无预先付费授权时可 AUTHORIZE_TOOL；异常结果可在用户提供回执/费用信息后 RECONCILE。没有扩大预算操作；已有硬调用上限保持。

使用已有 POST /api/selection-research/[id] operation=decide、请求级已验证身份、Run ownership/credential 绑定和租约/CAS。原子事务内核对 revision、gate、具体候选或请求，拒绝过期和重复提交。决定记录保存 confirmation.channel=chat 与 text，操作者/时间由服务端填写，浏览器审批记录可显示对话确认原话。确认本身不 dispatch 市场请求，最终确认只允许后续保存报告，不授权创建商品或修改店铺。

可信客户端负责准确引用人类回复；服务端不能独立验证客户端提交文字是否确实来自聊天原文。因此这是对指定 MCP 客户端的显式审批代理授权，不是密码学证明。工具说明明确禁止编造同意或把供应商/模型输出当作人类同意。旧凭证不自动获得此工具；research_start/step 等其他工具仍不能借用 approve 权限。匿名可见工具定义不等于可执行，仍返回认证要求。

## 当前连接启用

仅给此前已核实属于当前 owner、同一组织/default 工作区的普通 lili 和 lili_research_acceptance 两条连接及各自上级凭证添加 research_confirm。每条变更记录 AuditLog action=lili.credential.chat_confirmation.enabled，保存 before/after 工具清单及 revision。没有修改密钥、Token、有效期、店铺范围或账号角色。没有提交任何真实研究决定，没有新增付费查询；原生 MCP 工具发现用于核验当前连接可用性。

## 回滚

按上述审计中的 beforeTools 及最新 revision 进行受控 CAS 撤销四条明确凭证的 research_confirm 授权，保留其他后续授权；记录回滚审计。需要回滚应用时一并撤销工具注册、research_confirm 专属 approve 路由和对话提示，保留历史决定记录及现有页面入口。已确认的业务决定或已发请求不会随源码回滚撤销。

测试覆盖独立工具授权、实时 approve 权限、其他模块不得借用权限、空回复/非法类型/工作区冒用拒绝、精确路由映射、stale revision、重复 gate、保存原话和两个业务节点。原有页面继续可用。未 commit/push、部署、迁移或重启服务。

最终验证：check:fast 通过（1232 项测试全部通过，lint 0 error / 7 项既有 warning，TypeScript 通过）；13 项隔离研究页面浏览器回归通过；相关已跟踪文件 git diff --check 通过。原生 Codex MCP 对 lili 与 lili_research_acceptance 均返回 connected 且工具目录包含 research_confirm。未提交真实业务决定作测试；生产构建/服务器验收未运行，准备合码或上线时执行。
