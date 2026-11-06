# 经营中台八大板块

## 范围

`/operations` 按以下八类展示总览卡片、分组导航和字段/来源说明。仅调整本地页面组织，复用既有业务组件、API、筛选、分页、版本和审批流程；不迁移、删除或重写数据，不新增自动请求 Amazon 的路径。

| 板块 | 复用的 view 参数 | 新增说明入口（待接入） |
| --- | --- | --- |
| 商品与 Listing | catalog、listing_details、catalog_items | product-types、a-plus |
| 订单与销售 | orders、order-items | 无；销售日报在经营分析板块 |
| 库存与仓储 | inventory、inventory_age、inventory_events、replenishment | awd |
| 物流与履约 | fulfillment | merchant-shipping、mcf |
| 价格与竞争报价 | pricing、buy_box_history | fee-estimates、offer-notifications |
| 财务、结算与税务 | finance、settlements、reimbursements | tax-invoices |
| 经营与品牌分析 | sales-traffic、brand_analytics、ads | repeat-purchase、data-kiosk |
| 退货、售后与账户健康 | returns | buyer-messages、account-health |

同步计划、同步任务、审批、数据域管理、数据质量、店铺授权和同步设置仍为独立管理入口。原有 `?view=` 链接保留，新增说明入口支持刷新恢复及浏览器前进后退。

## 字段和数据边界

- 字段说明为板块范围，不保证每个来源、站点或历史版本已返回全部字段。各面板仍按实际返回和安全白名单显示；未返回不补零、不伪造。
- Listing / Catalog 观察保留既有“完整业务字段”展开入口；仍为外部观察，不覆盖 ProductRecord。
- 订单商品复用订单详情策略；不新增独立采集源，不向普通页面暴露买家、收货等 PII。
- 当前库存、库龄、库存事件、货件申报数量与补货结果分别保留口径，不交叉回写。
- 财务、结算、赔偿与退货保持服务端角色、组织/工作区、店铺、站点及授权边界；板块导航不授予数据权限。
- 销售、PPC 和品牌报告保持各自来源、日期、报告版本及资格限制。
- 新增的 12 个说明入口明确标注“待接入”，列出目标字段、来源及资格/接入要求；没有相应数据读取器或采集按钮，不代表已实现新 API。真实接入需另行明确范围和审批。

展示清单在 `src/components/operations/operations-sections.tsx`，不作为服务端同步能力或权限 allowlist。业务视图的同步状态统一复用 `section=sources`，实际数据继续由既有面板按需查询；同时修正 Listing / Catalog 原先误用页面名作为 section 的问题。

## 验证与回滚

使用 `tests/browser/sync-center.spec.ts` 的隔离浏览器 harness（模拟全部 HTTP，无真实数据库/外部 API），覆盖旧入口、筛选/审批/导出、八类分组、12 个待接入入口、导航恢复、Listing/Catalog 读取契约及 360px 窄屏；配合 TypeScript 和相关文件 ESLint。

不涉及 schema、配置、Worker、依赖或构建链变更，无需迁移、重启或启动同步。回滚仅撤销本次页面分组、清单组件及相应测试/文档增量；保留同文件内其他既有改动。合码或发布前再按仓库要求执行完整检查。真实页面的数据展示验收和 GitHub 同步未包含在本地 mock 验证中。
