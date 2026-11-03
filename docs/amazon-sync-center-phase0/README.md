# Amazon SP-API 数据同步中心 · Phase 0 评审包

评审日期：2026-11-04（Asia/Shanghai）。原始评审包；用户已于本轮明确确认 Phase 1 实施，进度见 [Phase 1 交付记录](../amazon-sync-center-phase1/README.md)。本包审计结论保留为实施前基线。

## 阅读顺序

1. [现有系统审计](audit.md)：能力清单、真实模型、读写链路、文件处置及已有改动。
2. [官方 API 与数据域对照](api-domain-matrix.md)：已核实操作、版本差异、报告与授权待验证项。
3. [后端架构与模型草案](architecture.md)：复用边界、任务/报告状态机、隔离、恢复和迁移方案。
4. [页面及交互设计](ui-design.md)：七页信息架构、兼容入口、指标定义与原型走查。
5. [分阶段任务、风险与验收](delivery-plan.md)：依赖、退出门槛、部署及回滚。
6. [官方模型核对证据](official-model-evidence.json)与[实时文档摘录](official-live-doc-evidence.json)：官方模型 URL、内容 SHA256、操作和参数，以及当前报告文档证据；均非运行时配置。
7. `prototype.html`：七页可交互评审原型；全部记录均为明确标注的演示数据，不连接 ERP、Amazon 或数据库。

## 核心结论

- 现有 `AmazonSyncSchedule → AmazonSyncRun → BullMQ → amazon-sync-worker → Snapshot` 应保留和扩展；已有库存及在线商品执行器，无需重建通用队列或另起一套 Worker。
- 当前整套系统仅允许一组数据库 SP-API 凭证（`provider @unique`），每工作区一组 Seller ID。多 seller 凭证、独立 seller/marketplace/domain 任务与水位是 Phase 1 前置工作。
- `catalog` 当前实际来源是 Listings Items API，表示卖家刊登；不等于 Catalog Items 商品目录。`inventory` 仅覆盖 FBA 库存，不代表 FBM 或在途货件详情。
- 当前有全量分页、事务发布、防重复执行、有限自动重试和中断失败清理；没有持久化分页检查点、报表生命周期、部分补偿或完整质量中心。
- ProductRecord 继续作为人工商品主资料事实源；Amazon 数据只读关联。赛狐补货来源分支保留，后续 Amazon 来源必须显式选择，不能静默替换。
- 官方模型已经存在 Orders `2026-01-01`，不能直接按旧 v0 开发。实时报告文档经官方页面工具成功核验：结算报告不能申请或安排生成；库龄优先评估当前 `GET_FBA_INVENTORY_PLANNING_DATA`。实际店铺资格和区域仍须联调验证。

## 本阶段影响与验证

本阶段只新增本目录中的文档、官方证据与原型；没有数据库迁移、应用 API 变更、真实同步、服务部署、凭证变更或业务数据写入。已有应用和部署修改均保留。验证结果与 GitHub 同步限制见 [交付计划](delivery-plan.md#本次-phase-0-交付记录)。

## 评审决策

建议逐项记录“通过 / 调整 / 暂缓”：

| 决策 | 建议 | 影响 |
| --- | --- | --- |
| `/operations` 导航 | 保留经营中台入口，增加同步中心二级导航及原有业务快捷入口 | 原库存、刊登、补货、PPC 页面仍可达 |
| 持久化复用 | 扩展 Schedule/Run，不平行新建 Plan/Task 同义表 | 减少双状态源及历史迁移 |
| Phase 1 范围 | 先落多凭证隔离、单店铺单站点任务，接入现有两个执行器 | 其余数据域保持规划中 |
| 发布原子性 | 单店铺＋站点＋域验证完成后切换当前快照，父批次可部分成功 | 一个失败站点不遮蔽其他站点 |
| 日志与原始数据 | 结构日志入库；必要原始响应脱敏后经 FileObject/storage 保存 | 需确认保留期限与容量预算 |
| 报告/订单版本 | 最新官方文档与试点授权验证后冻结适配器版本 | 不将模型存在误当作店铺可用 |
| 后续权限 | 先复用 operations/settings；任何更细的店铺权限单独评审 | 不暗改现有权限体系 |

Phase 0 已评审，Phase 1 已获单独的全局／性能影响实施确认；仍未授权生产数据库迁移或服务器发布。
