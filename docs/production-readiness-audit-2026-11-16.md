# 当前 ERP 上线准入审计（2026-11-16）

## 结论与范围

当前不建议开放公网生产使用。可继续本地开发与受控验证。

基线：`tiaotiao-erp` / `7f71316`；目录 `/Users/chenjieliang/Documents/amazon ad bulk operation`。
本轮为安全、数据与发布关键路径的定向审计，包含全量单测、类型、lint、UI 门禁及依赖扫描；不是全部页面、全部 API、真实外部接口或生产目标机验收。历史报告和“页面存在”均不作为完成依据。
未修改业务代码、配置、数据库、权限、运行进程，未提交、推送或部署。仅新增此报告。已有未跟踪 Next 目录保留。

## 本次验证

| 项目 | 结果 | 限制 |
| --- | --- | --- |
| 全量 TS 单测 | 1971 tests / 1971 pass / 0 fail | `env -i`，仅 PATH/TMPDIR/NODE_ENV=test；不加载根 .env，不代表真实 API 验收 |
| npm run typecheck | exit 0 | 当前已生成 Prisma 客户端；非生产构建 |
| npm run lint | exit 0，0 errors / 3 warnings | 图片标签性能建议 2 项、fixture 未用变量 1 项 |
| npm run ui:guard | exit 0 | 只覆盖当前 UI 静态基线 |
| git diff --check | 通过 | 文档生成后再验 |
| npm audit --omit=dev | 6 个受影响包：1 critical / 4 high / 1 moderate | npm 级别不是已证实可利用性；需逐路径评估 |
| 账号跨组织更新注入验证 | 真实 syncRosterLoginUsers 在假客户端上对外组织用户 ID 发出 email/passwordHash 更新 | 未访问数据库，未做真实账号攻击；完整 HTTP 复现待隔离 fixture |
| 最近生产 CI | run 43886999015：build 成功，performance/runtime 失败，deploy 跳过 | 此 run 对应 e2c8bb7；7f71316 性能 Redis 补齐尚未取得 CI 绿灯 |

日志位于本机 `/tmp/tiaotiao-production-audit-*`，为临时证据，不包含真实连接串或凭据，不保证长期保存。

## 上线阻断：必须修复或关闭受影响能力

### SEC-02：客户端账号 ID 可进入全局 User 更新（P0，多租户）

证据：`src/lib/accounts/team-roster.ts:108-122` 保留客户端 id；`src/app/api/accounts/team-members/route.ts:228-321` 仅按当前组织写 roster，随后调用同步；`src/lib/accounts/roster-auth-sync.ts:53-89` 无组织过滤读取全局用户，并按 `User.id` upsert，更新 email/status/passwordHash；后续为当前组织创建 membership。
本轮注入验证：传入 org-a + victim-in-org-b 后，真实同步函数向客户端发出 `where: {id: victim-in-org-b}` 和新 email/passwordHash 更新，未检查原 membership。
影响：拥有 accounts:edit 的恶意成员若获得其他组织用户 ID，存在覆盖全局身份与凭据的路径。全链 HTTP 攻击尚未执行，不宣称已有实际泄露。
处理：新增用户 ID 由服务端生成；已有用户管理先证明当前组织关系和操作权限；共享身份的全局邮箱/密码不能由普通组织 roster 同步覆盖，邀请加入与凭据修改走明确合同。
验收：双组织、共享身份、伪造/已知 ID、批量导入均不能修改他组织身份；拒绝时事务零副作用。

### SEC-03：角色授予缺乏明确能力上限（P1，上线阻断）

证据：`src/lib/accounts/role-definitions.ts:145-150` 默认 database_admin 有 accounts:edit；team-members PUT 使用提交 roleId 更新 membership；`shouldProtectAccountFromUser` 的主管保护不是通用授予规则。
影响：可编辑账号不应自动等同能授予 owner/审批能力；现有 bootstrap 账号保护也不能防止提升其他账号。
处理：服务端定义可授予角色/权限集合，自提权、越权授权与任意角色定义变更均拒绝；不要以角色字符串大小或简单线性排名替代业务规则。
验收：覆盖 database_admin、主管、自定义角色、新账号、批量编辑、自身与他人；批准权限不能间接自授。

### SEC-04：工作区检查与业务解析不一致（P1，上线阻断）

证据：`src/lib/auth/api-permissions.ts:17,38-49` request 可选且仅 application/json 解析 body；`src/app/api/ai-settings/route.ts:196-215` 无条件 request.json 后使用 body.workspaceId；`src/lib/workspace/scope.ts` body 优先；`src/lib/workspace/access.ts` 只证明组织内工作区存在，不证明具体成员权限。
影响：非 JSON Content-Type 携带 JSON body 可绕过本入口的 body selector 检查；仍有 organizationId 过滤，不能误报为所有租户均无隔离。最终影响按下游服务是否补验逐条验证。
处理：统一一次解析后的可信授权 scope，API 必传 request，multipart/body/header/query 全部一致检查；通用工作区成员访问规则与 Amazon Seller 授权分开明确。
验收：跨组织、同组织未授权工作区、selector 冲突、text/plain JSON、multipart、缺省工作区均有隔离行为测试，失败不能写入。

### SEC-05：权限库故障可回退默认授权（P1，上线阻断）

证据：`src/lib/accounts/role-catalog-server.ts:110-119` 数据库不可用时返回 defaultRoleCatalog；authorization-context → role-permissions-server 将该结果用于授权。normalizeRoleRow 还合并内置权限。
影响：已收紧/撤销的权限在特定故障窗口可能被恢复为默认值；不是无条件绕过身份登录，但违反授权失败应拒绝原则。
处理：授权读取故障拒绝/503；初始化默认角色是明确操作，与运行时读取分离；空权限、缺失权限、未映射模块各有单一合同。
验收：session 查询成功、权限查询单独失败时仍无业务写入；撤权、停用和跨组织请求保留断言。

### SEC-06：公开注册、固定初始密码与 bootstrap 生命周期（P1，上线阻断）

证据：`src/app/api/auth/register/route.ts:52-77` 自动加入配置组织，首个成员 owner，其余 viewer，无邀请；`src/lib/accounts/roster-auth-sync.ts:40-41` 默认 1/12345678；`scripts/seed-admin.mjs` upsert 更新已有密码；bootstrap 账号又被特殊锁定 owner/active。
影响：公网用户可自行进入既定组织；空组织首次注册风险更高；固定初始密码可猜测；重复 seed 可能重置密码。
处理：选择邀请制或关闭公网注册；一次性初始化/重置、到期与首次改密；seed 幂等且普通重跑不覆盖凭据；保留最后管理员保护，移除按 username=1 识别超管的混淆。
验收：匿名不能加入已有租户；重复 seed 不重置；初始凭据不可长期复用；正常管理员可受控轮换/停用。

### DATA-01：缺成本仍可能进入真实库存估值（P1，上线阻断）

证据：`src/lib/wms/assembly-service.ts:91` purchasePrice 缺失补 0；`:144` 无成本补 0.000000；后续用于行金额、组装成本及产成品估值。
处理：缺成本阻断过账或进入明确待估价流程；真实零成本需要明确来源与授权。使用 Decimal/定点计算，避免金额经 Number 丢精度。
验收：缺价不能生成已完成的零成本产成品；重复执行不重复扣库存；并发、撤销、舍入、源凭证和成本对账通过。

### DATA-02：广告未知数据补零及编造比率（P1，上线阻断受影响决策）

证据：`src/lib/sellfox/sync-service.ts:159-166` 小时/指标缺失补 0；`src/lib/metrics.ts:12` ACOS=999，其他公式还有 1.18/1.32 固定系数；`src/lib/ads-inventory/constraint.ts:244,282` 缺 currentDailySpend 当 0。
影响：缺失被当真实零，或人为系数被当事实指标，可能影响规则、加投与经营判断。
处理：按字段区分未知、真零、无分母、空集合和估算；估算明确标注且不能当真实事实源；规则和草稿逻辑同步适配，不能只把 999 改 null。
验收：缺字段、部分日期、不完整同步、真实零、零销售有花费分别测试；不完整数据不能输出可执行的确定性加投建议。

### DEP-01：锁文件命中生产依赖高危通告（P1，上线阻断）

本次安装版本：Next 15.5.25、sharp 0.35.4、undici 8.10.2；npm audit --omit=dev：next critical；sharp/undici/brace-expansion/source-map-js high；fast-uri moderate。
Next 官方仓库通告描述 glibc Linux 上图片优化上游库的潜在 RCE，当前 Ubuntu 目标需核对真实可达性；未执行漏洞利用。公告修复版本为 Next 15.5.28，或该问题的临时措施 sharp >=0.35.5。这不代表只改这两个版本即可消除其余全部通告。
来源：https://github.com/advisories/GHSA-2464-fhr4-w9xw （含原作者通告链接）。
处理：逐项核对实际依赖链与受影响功能，最小升级及锁文件更新，复跑生产构建/图片/文件处理回归，不直接 npm audit fix --force。
验收：生产 artifact 实际安装版本不命中受影响范围；残余风险有具体不可达证据和负责人。

## 上线前运行与业务验收门槛

| ID | 当前证据／缺口 | 完成标准 |
| --- | --- | --- |
| OPS-01 最小权限与 MCP | 六个业务 systemd unit 为 root；Amazon 原始读服务缺只读 URL 回退主连接；角色配置 mcp_amazon_ro 与授权 SQL amazon_mcp_ro 不一致；MCP 隔离页面用主连接可见 information_schema 子集审计 | 非 root 服务与目录权限验证；迁移身份和应用身份明确分离；按能力设置最小 DB 权限；启用 MCP 才要求双身份真实事务审计，同池可读/异池拒绝/写入拒绝/错误身份均验证；缺配置不回退高权限连接。未核实生产主连接是否 superuser，不能凭代码断言 |
| OPS-02 恢复、备份、监控 | 备份 timer 标明不由部署启用，脚本 list/校验和不等于恢复成功；文件和解密密钥不在数据库 dump 内 | 明确 RPO/RTO、异机副本、保留期、容量、恢复演练；数据库+文件+密钥能共同恢复；备份失败、磁盘、队列积压、过期 lease、同步水位延迟可告警，指定接收人。未读取当前服务器配置，状态为待验 |
| OPS-03 CI 与应用就绪 | 最近 run 43886999015 性能登录 503；7f71316 补 Redis 未推送验证；runtime 在 FBA 本地计划区域超时；server-artifact-release 默认只 GET /login 并检查进程状态 | 当前精确 SHA 的所有 CI job 通过，失败原因明确；不能删除门禁或重试到偶然变绿；发布后验证数据库登录、核心读写权限、Worker 实际消费及版本/连接，不能以登录页 200 代替业务就绪 |
| OPS-04 HTTPS 与生产配置 | 当前只是本地 dev；request-security 对公网生产强制 HTTPS 与可信 Caddy IP 头 | 真实域名 TLS/Caddy/可信代理合同验证；密钥管理、上传持久目录、大小和资源限额、systemd enable/restart、数据库/Redis 私网端口；检查实际环境，不套用本地 .env |
| BIZ-01 首发业务闭环 | 已有采购/WMS/财务代码及部分隔离测试，但本轮没有真实业务链路验收 | 按启用范围验收采购→收货→库存流水→估值→付款/退款→对账；角色审批、并发、幂等、撤销、结账、舍入、附件与源单追溯有数据证据；库存数量、成本、财务金额守恒 |
| BIZ-02 外部能力范围 | Amazon Ads 写 transport 明确 NOT_IMPLEMENTED；部分报表适配与数据集为 UNVERIFIED/NOT_IMPLEMENTED；广告页面默认 initialView=synced，演示入口仍存在 | 不误报整个广告模块都是 mock；首发默认真实查询，演示显式隔离。未实现/未验真能力隐藏或禁用，不产生成功提示；启用的 Amazon/Sellfox 资源逐项真实样本、授权、分页、限流、完整发布、恢复与对账验收 |
| BIZ-03 多组织会话 | session 按 memberships createdAt 排序取首条 | 若首发支持多组织，显式当前组织与会话授权一致；若只支持单组织则服务端约束此范围；不得只靠 UI 切换组织 |

OPS/BIZ 各项按首发范围决定是否阻断：禁用某外部能力可以缩小验收范围，但不能绕过共用认证、身份、数据与恢复门槛。

## 可上线后迭代

大文件拆分、无业务影响的死代码清理、图片标签建议和 UI 细节可以延后；不得与安全修复混成全仓重构。MFA/SSO、跨地域 HA 等按实际团队和可用性目标排期，不一概要求全部完成才可首发。审计日志保留/访问控制、审批防重、恢复和告警则是首发要明确的基础合同。

## 建议执行批次与准入条件

1. 先修 SEC-01～06，包含跨组织全局身份更新；补真实 HTTP handler 的隔离测试，所有拒绝零副作用。
2. 修 DATA-01～02，建立字段口径和库存/成本/财务守恒验收；只改有证据的错误默认，不全局替换零值。
3. 修 DEP-01 与 OPS-01，按批准实施迁移、依赖和系统服务；保留应用回退与数据库向前迁移方案。
4. 取得当前 SHA 完整 CI 证据，并在隔离预发布环境完成 BIZ-01～03 与故障恢复。
5. 完成目标主机配置、备份恢复与告警验收，再按 GitHub Actions artifact + deployment-plan 发布；上线后进行受控核心流程冒烟。

可以发布的标准：所有启用能力的阻断项关闭；关键拒绝/幂等/金额/库存/恢复测试通过；当前 SHA CI 全绿；真实接口与业务范围验收清晰；目标环境具备可用恢复与监控。不能用“页面能开”“空库迁移成功”或“单测全过”替代。
