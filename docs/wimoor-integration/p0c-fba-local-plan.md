# P0-C 首批：FBA 本地计划与 WMS 预占交接

日期：2026-11-11。用户已在当前会话批准本批本地模型/API/WMS 事务入口改动及隔离验证。目标环境为本地源码和 runner 创建的临时 PostgreSQL；现有库不迁移，不调用 Amazon，不新增 Worker、队列或调度。

## 范围与数据合同

新增 `FbaLocalPlan`、`FbaLocalPlanLine` 和迁移 `20261118010000_fba_local_plan`。复用现有 Organization/Workspace、SellerAccount、WmsStockBalance、WmsReservation、WmsApproval、WmsCommand、WmsMovement 和 AuditLog。复合外键限制跨范围关联，计划行唯一关联预占，不建立 SKU/商品主档。

计划身份使用内部 sellerAccountId 和 Amazon marketplaceId；每次查询/动作复用 `amazonAccountReadAccess` 并核对 AmazonSellerIdentity。当前账号分配与授权状态锁定后复查，不能把账号读取权限当作 Amazon 修改权限。WMS 操作仍在事务内复核当前角色、成员、工作区和独立审批。

计划状态只有 DRAFT、ACTIVE、CANCELLED：DRAFT 只记录意向、不占库存；首次成功预占后 ACTIVE，部分明细成功仍是 ACTIVE。每行数量固定，审批绑定行 ID、余额 ID、数量和余额 revision；本批不支持编辑明细或更换已关联预占，调整通过取消后新建或后续明确流程处理。

计划不保存虚构外部计划 ID、sellerSku、ASIN 或 FNSKU。不具备 Listing 映射的本地计划仍不能提交 Amazon；查询明确返回 `amazonSubmission=NOT_IMPLEMENTED`，并不表示外部建计划已完成。

## API 与操作流程

入口：`/api/operations/fba-local-plans`，需要数据库登录会话；工作区通过现有 `x-workspace-id` Header 或 URL `workspaceId` 选择，body 不接收 organizationId/workspaceId/actorUserId。所有响应 `Cache-Control: no-store`。

1. POST 创建：`{number,sellerAccountId,marketplaceId,idempotencyKey,lines:[{balanceId,quantity}]}`。1–100 行，余额不重复、正整数数量，当前必须为可用 STORAGE 余额。数据库复查可用量，但草稿不会预占，也不保证稍后仍有库存。相同键同内容同人返回原计划，不同内容拒绝。
2. GET 查询：`?sellerAccountId=...&marketplaceId=...&page=1`；可选精确 `id`。按创建时间/id 降序，每页 20 条，最多 1000 页，返回 `{items,page,hasMore}`。同一事务快照批量关联当前余额/批次/预占，不返回原件或凭证。页面、未来 MCP 均须调用同一查询服务，不另建查询口径。
3. POST 申请：`{action:"REQUEST_RESERVATION",id,expectedRevision,lineId,balanceRevision}`。仅创建人且有 WMS edit 可申请，返回 WMS 审批 item。相同库存版本且仍有效的待审/已批申请返回原审批；版本变化、审批过期或拒绝后可重新申请，使用新命令键和独立审批。
4. 审批：沿现有 `/api/operations/wms/approvals`，独立主管批准，禁止自批，执行仍复核双方权限及批准有效性。
5. POST 执行：`{action:"EXECUTE_RESERVATION",id,expectedRevision,lineId,balanceRevision,approvalId}`。在同一事务执行 WMS 命令、保存明细 reservationId、递增计划 revision 和记审计。调用失败整笔回滚；不同明细分别审批执行，不承诺整张计划多行原子预占。
6. 预占后的拣货、撤拣、释放、实际出库继续走 WMS 原有命令及审批。计划查询从当前数量计算进度，释放后不再 `stockReady`；重复 FBA 执行只返回原命令结果，不能补占或重复扣减。通用 WMS 执行入口拒绝直接执行本地计划专用预占，避免绕过关联事务。
7. POST 取消：`{action:"CANCEL",id,expectedRevision}`。未预占或全部释放且未出库才可取消，重复相同取消返回既有结果；不能靠取消逆转库存或实物发货。取消后旧审批不能经计划入口执行。

错误采用现有 WMS 响应：400 输入、401 会话、403 权限/归属、404 同范围不存在、409 revision/幂等/状态冲突、422 数量/库位不足。审批结果与计划已就绪是不同状态。

## 实现文件与事务边界

- `src/lib/fba-local/rules.ts`：严格输入、规范化摘要、审批命令、实时预占进度及取消约束。
- `src/lib/fba-local/service.ts`：统一查询、创建、申请/执行/取消，账号及 WMS 权限、锁、审计。
- `src/app/api/operations/fba-local-plans/route.ts`：会话与 HTTP 入口，不复制业务规则。
- `src/lib/wms/approvals.ts` 和 `application-service.ts`：保留原事务包装，抽出可在调用方事务内使用的入口，原有验证不删除。
- `prisma/schema.prisma` 只增加两模型及关系，迁移只增表/约束/索引。没有写已有业务数据。

本批使用明确同步服务合同，不为了事件化增加后台基础设施。后续外部异步工作流再按纠正版方案设计 Outbox、执行记录和 RESULT_UNKNOWN；本批不声称具备这些能力。

## 验证与运行

规则测试：`env -i PATH="$PATH" node node_modules/tsx/dist/cli.mjs --test tests/fba-local-rules.test.ts tests/wms-rules.test.ts`。

隔离集成：`env -i PATH="$PATH" node scripts/test-fba-local-offline.mjs`。runner 只使用已有本地 `postgres:16-alpine` 镜像，随机命名并标记容器，在临时空库执行当前全部 migration；子进程使用现有 WMS preload，禁止外网和根 dotenv。仅清理本 runner 创建且标签匹配的容器。fixture 全为合成数据，不能作为实际 Amazon/仓库验收。

集成覆盖真实本地 HTTP Route Handler 和数据库会话、重复创建/执行、双人审批、账号撤权、WMS 主管撤权、关联失败后事务整体回滚、两个计划竞争同库存、释放后的查询状态、取消和流水对账。默认命令不包含 Next 页面或真人仓库验证。页面验证增加 `--browser`：以临时 Next 和双会话 Chromium 验证建计划、审批回读、独立主管批准、预占、仓库交接链接与取消；并在仓库页面执行两次部分拣货、独立审批出库，回到计划核对部分及全部出库数量。

原 WMS 完整回归可通过 `env -i PATH="$PATH" node scripts/test-fba-local-offline.mjs --wms-regression` 在另一个新建临时库运行，复用原 `wms-first-loop.integration.ts`，包含原有 HTTP 和双会话 Next/Chromium 仓库、采购流程；不复用 FBA 测试产生的数据。

2026-11-11 本批验证：Prisma validate/generate、11 项相关单测、FBA 临时 PostgreSQL/真实 HTTP 集成、原 WMS 完整隔离回归（含双会话浏览器）、独立 typecheck 和定向 ESLint 通过。全量 `check:fast` 单测为 1521 项中 1520 通过、1 失败：`tests/performance-architecture.test.ts` 的共享 AppShell 路由断言，涉及工作区同时进行的路由变更；因此快检在单测阶段停止，后续全量 lint/typecheck 未由该命令执行，不能称全量快检通过。独立 typecheck 和本批定向 lint 已另行执行。未运行生产构建/完整 check，当前不准备合码或上线。没有真人仓库、真实 Amazon、生产数据或新 FBA 页面验收。

出库回读增量：统一计划查询返回 `fulfillment` 数量和作业阶段，复用 WMS 待拣/已拣计算；页面显示待预占、剩余预占、待拣、已拣待出库、累计出库及释放差额。部分释放不再显示为全部释放，已出库不等于 Amazon 收货；不增加存储或外部调用。13 项相关单测、完整临时库/HTTP 集成、双会话 Chromium 部分和全部出库流程、typecheck 与定向 lint 通过。

页面接入批验证：12 项相关单测、临时库完整迁移链与 HTTP 集成、双会话 Next/Chromium 头程流程、独立 typecheck、定向 ESLint 均通过。修复了头程页误依赖管理员 settings 读取导致仓库主管无法进入的问题；未扩大服务端权限。

多行操作增量：页面复用既有单行接口，提供连续申请、独立主管连续批准、连续执行；每条执行前重新读取同一计划与实时审批，逐条提交，失败停止并保留已成功结果，离开当前范围后停止后续请求。临时库故障注入验证第二条失败后仅保留第一条、刷新续办不重复预占；双会话浏览器验证两条明细申请/审批/预占及分别出库，typecheck、定向 lint 和 13 项相关单测通过。本批无新 API、表或真实环境操作。

仓库交接入口增量（2026-11-12）：FBA 专属预占审批以“查看头程计划并执行”进入原计划事务，预占单提供返回计划链接。统一查询新增精确 `lineId` 定位，在当前工作区解析真实计划并实时复核账号、站点及 WMS 读取权限；关联视图只显示该计划，不依赖同步配置/店铺筛选。隔离 HTTP 覆盖匿名、跨工作区、伪造账号/站点/计划及撤权；双会话浏览器覆盖仓库审批→计划执行、预占单→计划进度回读。相关 13 项单测、定向 lint 和临时库集成通过；全局 typecheck 被同时修改的采购审批/库位冻结 Prisma 类型错误阻断，不能报告通过。未新增表、未迁移现有库或操作真实环境。

本地装箱增量（2026-11-12）：`FbaLocalPlan.packing` 保存当前装箱文档；增量迁移 `20261119010000_fba_local_packing` 只增加 nullable JSONB。`SAVE_PACKING` 接收箱号、cm 尺寸/kg 毛重字符串（最多三位小数）、lineId/quantity；200 箱及 2000 条箱内明细上限，逐行合计与计划严格一致。沿用计划创建人、WMS edit、实时账号权限、revision、事务与完整装箱审计快照；保存锁定关联预占以和 WMS 释放/出库串行，取消、释放及出库后拒绝改箱。相同请求仅重放紧邻已提交版本。页面保存、刷新回读、箱内明细查看和出库后锁定已接入；不是 Amazon packing/placement 方案，不生成外部货件或报关文件。17 项相关单测、临时库迁移及 HTTP、混箱后双会话预占/出库流程、定向 lint/typecheck 通过。现有库未迁移；上线前按正式迁移流程执行，本批不部署。

## 后续与回退

头程页面入口为 `/operations?view=first-mile`，复用店铺/站点选择及统一服务；展示实时审批、拒绝/过期重申和仓库预占单链接。商品/Listing/站点映射及多行工作流后续完善；完整 Inbound 写 Schema、异步 Operation 追踪、装箱/分仓、运输、报关和成本/总账仍未实施。跨模块后续批次继续说明具体影响后确认。

部署前应复核当时工作树、迁移链及完整 check，按现有 CI artifact/deployment-plan 发布；本次不提交、推送、迁移或部署。问题出现时停止新增本地计划入口，保留新增表、审批/命令和库存事实，用前向修复处理；不删流水、不降级删表，也不自动撤销实际发货。
