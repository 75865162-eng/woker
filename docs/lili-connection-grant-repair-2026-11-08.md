# Lili 当前连接研究工具授权修复（2026-11-08）

用户明确要求修复当前连接工具授权或账号权限。只读核验确认：账号为 active owner；普通 lili 与 lili_research_acceptance 原生 MCP 均认证成功，属于相同账号、组织及 default 工作区。普通 lili 的旧凭证只有 ERP 只读工具，故 marketAccess 在工具授权检查提前返回 RESEARCH_PERMISSION_REQUIRED；不是付费预算未批准。

## 本次操作

仅给普通 lili 当前 OAuth 设备凭证（19345a79-e444-430a-bd3d-c0bc7b49279f）及其上级凭证（8be15d07-c24d-441d-92a5-fd73f2b72b1e）补充 researchCredentialTools 所列十个研究工具。事务内复核 owner、agents 各动作权限、父子身份及数据范围一致、ACTIVE 与有效期，并以 revision CAS 保存。没有调整账号角色、Seller/站点范围、有效期、Token、OAuth 配置或其他设备；不授予 approve 权限。

每条变更写入 AuditLog，action 为 lili.credential.research_grant.repaired；记录 beforeTools/afterTools、beforeRevision/afterRevision、workspaceId 和用户授权说明。没有调用模型或付费供应商；没有批准研究任务。

## 验证

修复前后均使用 scripts/lili/native-smoke.py 的 NativeCodex 原生 MCP 客户端进行有界检查，不以 HTTP 成功替代原生验收。修复后普通 lili runtimeStatus=connected，tools/list 出现全部十个研究工具，lili_ping authenticated=true，meta_get_market_access research_access=true；SellerSprite、西柚 configured=true / allowed=true。状态仅表示配置及权限可见，未探测供应商业务请求或验证扣费。

reason 现在为 PAID_CALLS_REQUIRE_PERSISTED_RESEARCH_APPROVAL，表示实际查询仍须走已保存的任务首次授权流程，不表示 RESEARCH_PERMISSION_REQUIRED 仍存在。现有会话可能缓存工具目录，需要刷新连接或在新会话重新发现；新建原生客户端已验收通过。

## 回滚及边界

如需回滚，先只读取得上述两条凭证最新 revision 及对应审计 beforeTools；确认修复后没有新的授权调整后，在事务中用 CAS 将工具清单恢复为审计 beforeTools，revision 递增并另记回滚审计。若已有后续授权变动，先对比差异，不能直接覆盖。回滚不删除既有研究任务、证据或供应商费用记录。不得复制、打印或更换密钥来完成回滚。

本次为当前本地运行数据库中的授权修复，无应用源码修改，不需生产部署、数据库迁移或服务重启；未 commit/push。未运行构建或全量测试，验证聚焦实际连接工具发现、认证和研究权限状态。
