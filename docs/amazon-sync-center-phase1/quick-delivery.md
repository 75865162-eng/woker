# 第一版可运行闭环补齐（本地评审）

在已推送且通过 CI 的 `42f8c1f` 基础上补齐；本轮按用户最新回复**不提交、不推送**，不生产迁移／发布。不进入 Phase 2。

## 本轮实际变化

- 任务详情增加“查看本次快照”：成功任务按 50 行分页，显示 Seller、Marketplace、任务、SKU、源更新时间、采集时间、版本和当前／历史标记。暂存数据禁止查询，历史已清理返回 410，空快照明确显示有效 0 条。
- 新增 GET `/api/operations/sync-center?section=snapshots&id=<taskId>&page=1`；复用 operations:view、真实工作区校验和租户／源范围。快照读取使用短只读 RepeatableRead 事务，避免并发保留清理产生前后不一致的结果。
- 授权页保留最近验证失败的安全错误码和时间。401/403 标记 ERROR 并阻断新执行；临时网络错误保留上次有效授权状态并显示警告。更新凭证清除旧验证结果；停用授权必须更新后才能再验证。
- 所有中心 API 再校验最终选择的 Workspace，避免 header/query 指向不一致时绕过范围校验；Worker 开始和发布时确认工作区仍存在。
- 新增可空字段 `validationAttemptedAt` / `validationErrorCode`，迁移 `20261104010000_amazon_authorization_validation_state`；不删除或猜测历史归属，不修改原 Phase 1 迁移。

## 本地运行与真实联调条件

1. 在专用本地开发库应用仓库迁移并 generate，配置现有数据库、Redis、数据库登录与 `AMAZON_SP_API_ENCRYPTION_KEY`。不要指向生产库；本轮自动迁移仅发生在测试脚本创建的一次性 PostgreSQL。
2. `AMAZON_SYNC_CENTER_SCOPES` 精确配置组织／工作区（见 rollout.md）；目标工作区必须已登记；旧计划停用、旧任务排空。web 和 worker 使用一致的开关与密钥。
3. 启动 `npm run dev` 和独立的 `npm run worker:amazon-sync`，访问 `/operations`。
4. “店铺与授权”录入应用 LWA Client ID／Secret、Seller 授权获得的 Refresh Token、明确声明的 Seller ID 和区域，验证参与站点，绑定 ERP 店铺／Marketplace／域。
5. 建立计划或手动执行，任务在后台运行；查看状态、分页、日志；成功后进入“查看本次快照”，失败可重试完整快照。

当前授权流程为凭证录入／更新和旧凭证显式导入；没有新增 Seller Central 浏览器 OAuth 回调。公共应用仍需先在 Amazon 完成合法授权获得 Refresh Token；私有应用需完成自授权。参与站点验证不证明 Seller ID 身份和所有域权限，仍需核对应用角色、区域和 Listings／FBA 资格。

自动化验证使用模拟 Amazon，不将模拟记录展示为真实生产同步。现有 ProductRecord 和 `/sellfox` 补货逻辑本轮无改动。

## 回滚与待办

新增可空字段可保留；若仅回滚本轮，恢复到兼容版本 `42f8c1f`，不删列。完整中心回滚仍按 rollout.md。真实 Amazon 联调、生产容量和终止进程演练仍待单独验收；本轮构建为本地校验，不替代未来发布所需 CI artifact。

## 本轮验证

- 全仓 `check:fast`：669 项测试通过，lint 无错误／4 条既有警告，全量 TypeScript 通过。
- 一次性 PostgreSQL＋Redis：16 项通过，实际应用两次迁移，保留旧计划；新增数据库登录会话→授权／重授权→创建任务→真实 BullMQ→Worker→快照 API，校验 Seller B 凭证、跨租户 404、非法工作区 403、未完成快照 409、已清理 410、授权异常脱敏和工作区撤销阻断。
- 中心浏览器最初 6 项通过（本轮 UI 回归已扩展为 8 项），真实 Tailwind、模拟 API；新增快照分页、授权异常和密码输入验证。
- Prisma validate／generate、diff 检查通过。`npm run build` 生产模式构建通过；只有本地编译，不启动生产服务。保留既有 BullMQ 可选 @valkey/valkey-glide 缺模块编译警告（当前 Redis 执行路径集成通过），未为此新增依赖。
- 原有 17 项经营中台浏览器回归已在上一轮通过，本轮不修改其业务模块，不机械重复。

完整通过的是模拟 Amazon 条件下的执行闭环；真实账号仍需准备合法 Refresh Token、应用角色、正确 Seller／区域／参与站点。不会将模拟结果记为真实同步验收。

## 浏览器到后台的完整回归

`npm run test:amazon-sync:integration` 现包含真实 Chromium 浏览器操作：进入中心→新增授权→验证 Marketplace→绑定店铺／域→手动创建任务→真实 Redis／BullMQ Worker 执行→页面查看失败→点击重试→查询并浏览正确 Seller／Marketplace 的成功快照。API 和数据库请求不再模拟，仅 Amazon 响应受控。凭证不进入浏览器恢复缓存，外部浏览器请求被拒绝。

测试使用专用 HTTP fixture 承载实际 React 组件和实际 Next Route Handler；数据库登录会话、权限查询、持久化、队列和处理器均执行真实代码。它没有启动完整 Next App Router 服务，不能替代生产反向代理、登录页或真实 Amazon 联调。需本机预装 Playwright Chromium；脚本不自动安装浏览器或拉镜像。所有测试资源执行后清理。

本次仅增加端到端测试，应用代码未变化；因此复用上一轮全仓 669 项测试、6 项组件浏览器回归和本地生产构建结果。本轮补跑 16 项集成、全仓 TypeScript、相关 lint 与差异检查，均通过。

## 按评审截图调整实际 UI

同步中心组件已按用户截图落地：顶部路径栏、174px 左侧导航、浅灰内容区、两行三列指标、五列健康表、并排趋势／异常卡片及底部状态栏。真实操作保留，健康表增加“配置计划”入口；趋势改为真实任务桶柱形图并保留可展开明细。不展示原型里的演示标签或未实现的 P95。

截图 `ui-overview.png` 是真实组件配合明确测试 fixture 的视觉验证，不能作为真实 Amazon 同步结果。页面在 ERP 全局壳内展示；全局导航和登录权限保持原状。七页浏览器回归现为 8 项，包含 1280px 排列、360px 无整页溢出与计划跳转；16 项完整集成、全仓 TypeScript、相关 lint 和 diff 检查通过。本次是局部 UI 改动，复用此前生产构建结果，不重复全量构建；后台 API、数据模型、权限与调度本轮无变更。

同步计划采用左侧分组数据域＋右侧配置面板；选择在线商品默认每天、FBA 库存默认每小时，均可修改。规划中数据域禁止创建计划；切换数据域关闭未保存编辑器，已有计划的编辑、复制、暂停、恢复与历史入口保留。数据域详情复用分组导航。补充 `ui-plans.png`、`ui-tasks.png`、`ui-connections.png`，均为实际组件＋测试数据截图。最新 8 项浏览器、全量 TypeScript、局部 lint 通过；本次只改 UI，复用先前 16 项集成结果和构建，不重复数据库／队列验证。

## 任务详情、质量与设置页收尾

数据质量页增加按当前健康状态统计的问题表格（影响店铺／站点、数据域、快照范围、建议操作、关联任务）；不虚构独立发现时间。任务失败信息使用可访问的错误提示，任务类型显示中文。设置页心跳改为表格，空心跳明确未知后台在线情况；授权操作窄屏可换行，导航清除上一页成功提示。`ui-quality.png` 与 `ui-task-detail.png` 为实际组件测试数据截图。

最新 9 项浏览器回归、全量 TypeScript、局部 ESLint、diff 检查通过，覆盖质量关联任务、Worker 在线／无心跳和 360px 布局。本轮只调整 UI，不变更 API、数据库与 Worker；复用此前集成及构建结果，不重复全量构建。撤销本轮组件与测试差异即可回退，无新增迁移或部署步骤；所有增量继续保留本地。

## 全新库与统一业务导航（当前要求）

2026-11-06：`src/app/operations/page.tsx` 增加顶部快捷入口，顺序为财务、退货、库龄、库存事件、赔偿、结算、销售日报，分别链接现有 `view=finance|returns|inventory_age|inventory_events|reimbursements|settlements|sales-traffic`。使用普通页面链接重新初始化目标 view；沿用同步中心页面、数据读取与服务端权限，不新增页面或同步操作。回退仅需移除该页的快捷入口配置与导航。

当前 /operations 不再回退旧经营中台，忽略旧 legacy／tab 链接参数，仅使用 view 导航；未启用同步中心时显示明确错误。授权页移除旧凭证导入。直接使用专用新库 amazon_sync_live_local，不导入旧数据，保留本地超级账号。

“原有业务入口”已整理为统一的“业务数据”导航：库存浏览、在线商品、补货计划、PPC 经营指标均在新页面内展示；PPC 工作台保留直达原模块的链接。复用已有业务面板的展示与计算，不变更 API、数据模型、ProductRecord 或 /sellfox。库存触发走新中心数据源任务；没有可用数据源时转店铺与授权，不调用旧 sync-runs。业务页使用自身筛选，不展示不起作用的同步中心店铺／站点筛选。仅挂载当前业务面板并加载对应数据，避免隐藏页面额外请求；切换页面先清理旧内容，防止重复挂载。

验证：同步中心浏览器 11／11、经营中台业务面板回归 17／17、全量 TypeScript、局部 ESLint、diff 检查通过。实际专用新库／完整 Next 页面登录后依次打开四个业务页，API 均 200，刷新 URL 可恢复，Amazon 请求与意外写入均 0，见 merged-business-result.json；ui-merged-business.png 为本地新库实际空状态截图。此次 UI 修改没有新增迁移／API／部署操作，未重复生产构建。回退仅恢复组件／测试差异；不删除或回滚数据库。全部本地保留，不提交／推送／部署。
