# 系统管理 + 采购物流升级交付单（2026-11-24）

> 依据：`docs/wimoor-non-amazon-feature-gap-and-transplant-plan-2026-11-24.md` 的 A6 / A1 / B 类差距项。
> 范围：系统管理**重点升级**、采购物流**相当升级**；均按「低风险补齐优先、写功能红线保守」执行。
> 未改导航主链路、未接外部写、未覆盖任何核心主档；全部为本系统内事实与审批。

## 一、交付内容

### A. 系统管理（重点，5 项）

| 功能 | wimoor 对标 | 实现 | 入口 |
| --- | --- | --- | --- |
| 部门管理 | `/sys/dept` | 树形部门主数据 CRUD，编码唯一、上级校验、乐观锁 revision、审计；成员表按名称软关联，**不反向覆盖花名册** | `/settings/system-admin` → 部门管理 |
| 公告发布 | `/sys/notify` | 公告 CRUD，草稿/发布/归档；全员发布投递到通知中心（dedupeKey 幂等、重复发布不重复打扰），定向范围仅登记不臆造成员映射 | 同上 → 公告发布 |
| 个人记事本 | `/sys/notepad` | 按 userId 硬隔离的记事 CRUD，置顶排序，乐观锁 | 同上 → 我的记事本 |
| 在线用户监控 | `/sys/online` | 基于 UserSession 列出组织内有效会话，含用户/角色/登录/过期；管理员可强制下线（approve 权限 + 审计） | 同上 → 在线用户 |
| 权限与导航 | — | 新增 `account.systemAdmin` 入口（settings 模块权限即可见），经 rewrite 落到真实页 | 右上角账号菜单 |

数据模型：`Department` / `Announcement` / `PersonalNote`（+ Organization/WorkspaceScope 反向关系）。

### B. 采购物流（相当，6 项）

| 功能 | wimoor 对标 | 实现 | 入口 |
| --- | --- | --- | --- |
| 集中询价 | quote（询价） | 询价单 CRUD；货件事实（线路/件数/重量/体积/需求日期）仅草稿可改；状态机 DRAFT→SUBMITTED→QUOTED→ACCEPTED/CLOSED/CANCELLED | `/purchase/logistics-quotes` → 集中询价 |
| 报价单 | quote_order | 一询价多报价；首次报价回填询价 QUOTED；接受某报价自动拒绝同询价其它报价并标记询价 ACCEPTED；金额 Decimal(20,6) | 同上 → 报价单 |
| 物流渠道 | quote/channel | 渠道 CRUD，头程方式/目的地/计费规则快照（只读证据，不自动改价） | 同上 → 物流渠道 |
| 关联设置 | quote_set | SKU/仓库/目的地 → 渠道匹配优先级规则 CRUD | 同上 → 关联设置 |
| 采购退货单 | `/erp/purchase/change` | 退货单 CRUD + 三段式审批 DRAFT→SUBMITTED→APPROVED→SHIPPED→CLOSED；仅登记事实与状态，**不自动冲减库存/应付** | 同上 → 采购退货 |
| 采购报表 | 采购 5 类报表 | 付款明细/发票匹配/采购单与计划状态分布/平均采购时效，全部基于现有事实表只读汇总；缺口径保留 null 不造数 | 同上 → 采购报表 |

数据模型：`LogisticsQuoteChannel` / `LogisticsQuoteRule` / `LogisticsQuoteRequest` / `LogisticsQuote` / `PurchaseReturn`。

## 二、架构约束（已遵守）

- **不引入新事实源**：全部为系统内主数据与审批，不接货代/Amazon 写回，不改会话/权限主链路。
- **组织+工作区双围栏**：8 张新表均带 `organizationId` + `workspaceId`，复合唯一 + 索引见迁移 SQL。
- **乐观锁 + 审计**：编辑走 revision 校验，写操作落 `erp.ext.*` 审计。
- **金额规范**：报价/退货金额 `Decimal(20,6)`，`.toString()` 序列化；报表汇总走 `num()` 转数。
- **权限门禁**：所有写 action 经 `requireApiPermission('operations', ...)`；强制下线/接受报价/批准退货走 `approve`。
- **默认关闭外部写**：未触碰 `FbaRemoteExecutionPolicy` / `inboundWriteReadiness`。

## 三、验证记录（循环验证）

| 检查 | 结果 |
| --- | --- |
| `prisma validate` / `prisma generate` | 通过（无警告） |
| `prisma migrate deploy` | 通过；8 张新表建成并记入迁移历史（首次因复合外键缺唯一索引失败，补齐后重跑通过） |
| `npm run typecheck` | 通过 |
| `npx eslint`（改动文件） | 通过 |
| `npm run ui:guard` | 通过（未引入 UI 范式回退） |
| `npm run build` | 通过；`/operations/system-admin`、`/operations/logistics-quotes` 均进入路由清单 |
| 单测（新增 4 项状态机测试） | 通过；导航 20 项测试全过 |
| 全量单测 | 2893 项中 2889 通过；4 项失败为既有基线（`amazon-ads-scope-isolation` Playwright 环境、`production-readiness` Node 22.19 门禁、`sales-plans-workbench` 无关用例），本次改动不涉及 |
| 真实数据冒烟 | 用现有组织/成员跑通 部门新建/记事本增删/公告/渠道/询价/报价/接受/退货审批 全链路；已清理测试数据，无残留 |
| 运行时 HTTP 验收 | dev 起服务：4 个入口未登录 307、登录后 200 且页面含对应文案；10 个只读 kind 带 workspace 头全部 200；POST 写部门 200 且 GET 回读到；API 未带 workspace 头正确 401/400 拒绝；测试数据已清理 |

## 四、待办 / 不在本次范围

- **动态菜单管理**（改导航主链路，风险高，需静态兜底设计）— 未做。
- **客户管理 + 客户订单**（CRM 新事实源，触发写功能红线）— 未做，需产品 go/no-go。
- **飞书连接、代码生成、Swagger 文档页** — 需独立立项。
- **物流报价"免登录门户页"** — 本次只做内部管理；对外门户需 token 安全与访问审计设计。
- **官方 Amazon 建货件/装箱/标签写回** — `inboundWriteReadiness.enabled=false` 硬约束保持只读。
- 上述 4 项基线测试失败与本次升级无关，另行处理。

## 五、文件清单

- `prisma/schema.prisma`：+8 模型（Department/Announcement/PersonalNote + 5 采购物流）与反向关系。
- `prisma/migrations/20261124000000_sysadmin_procurement_logistics_upgrade/`：additive SQL。
- `src/lib/ext/system-admin-service.ts`、`src/lib/ext/logistics-quote-service.ts`：业务服务。
- `src/lib/ext/query-service.ts`：新增 11 个 kind 只读查询。
- `src/lib/ext/service.ts`、`src/app/api/operations/ext/route.ts`：导出与 14 个写 action。
- `src/components/operations/ext/system-admin-workbench.tsx`、`logistics-quote-workbench.tsx`：两套工作台。
- `src/app/(erp)/operations/{system-admin,logistics-quotes}/page.tsx`：页面。
- `src/components/app-shell/business-navigation.ts`、`src/lib/navigation/namespace-routes.ts`：入口与 rewrite。
- `tests/sysadmin-logistics-upgrade.test.ts`：状态机单测。
