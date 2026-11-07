# Amazon Ads 核心续批：Product Ad 结构闭环

日期：2026-11-06。用户要求“先做核心功能，先跑通再优化”，且当前没有真实凭证。本批完成一个实际缺失的数据域，复用现有结构任务、数据库和查询，不扩展新架构。

## 本批结果

`POST /sp/productAds/list` → 既有 SP adapter → 结构 worker/checkpoint/fence → `AmazonAdsEntityRecord` 幂等 upsert → 数据查询/API → 已同步数据页与现有 MCP。

SP 结构现在包含 Campaign、Ad Group、Product Ad、Keyword、Target、两级 Negative Keyword/Target，共九类。没有新增表、迁移、队列、权限或事实来源。正式报告仍关闭；未将原始报告存储、JSON 语法通过或结构读取当成日报发布。

## 官方合同与实现

- 重新只读获取公开官方 OAS：`https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/SponsoredProducts_prod_3p.json`，SHA256 `9ce8a6b6bc8b33d34d04b7ee416fd78be787699e932075d101941176a215df2e`。这是文档核验，不是已授权账号 API 验证。
- `ListSponsoredProductsProductAds`，媒体类型 `application/vnd.spProductAd.v3+json`，ClientId/Scope 使用已有 SP v3 头。OAS 声明权限 `advertiser_campaign_edit` 或 `advertiser_campaign_view`，实际账号权限尚未验证。
- ProductAd 必需 `adId`、`adGroupId`、`campaignId`、`state`；ID 保留字符串，直接父级为 Ad Group。`sku`、`asin`、`customText`、`globalAdId` 可选字符串，其他实际字段原样保留在已有 payload。Seller 的 SKU、Vendor 的 ASIN 不互相补造。
- reader 验证必需 ID、状态、上述可选字段类型与扩展更新时间；沿用现有分页/重复实体校验、429 退避和错误脱敏。
- 当前对象状态/关系更新经过已有 worker 的组织/workspace/Profile 键和版本/来源时间防倒退约束。ARCHIVED 状态可被保存；本次未返回的对象不会被推断删除，未新增 tombstone 或结构历史。

## 检查点与运行边界

旧编号 `0 campaigns / 1 ad-groups / 2 keywords / 3 targets / 4 negatives / 5 reports` 不重排。Product Ad 新增编号 6；结构顺序变为 `0 → 1 → 2 → 3 → 4 → 6 → 5（完成标记）`。编号 5 的历史未完成报表检查点仍在 token refresh 前阻断，不被解释为 Product Ad。

`nextAdsStructureStage` 代替连续编号大小判断；Product Ad 分页未完时固定留在 6，独立保存游标和页数。结构 scheduler/dispatch/恢复使用原白名单，只增加 product-ads 阶段，不接管报告任务。已完成的旧八类任务不会被后台改写或自动补成九类验收，下次已授权结构同步才读取新增域。

每轮多出 Product Ad 实际分页请求及相应入库写入；继续沿用单页、客户端共享配额、每阶段页数限制和逐步队列执行，没有新增并发或全量内存加载。规模/P95 未测，本批不做性能承诺。

## 页面与 MCP

- 页面复用现有 Ads 已同步数据入口及其数据源/API：增加 Product Ad 快捷筛选、Ad Group → 广告商品入口、只读详情的 SKU/ASIN；保持当前 Profile、Campaign 和 Ad Group 筛选。生产数据库无该域时显示既有空数据状态，不使用 Demo 回填。
- MCP 复用 `amazon.ads.entities.list` 与 generic `ads_entities` 数据集的既有授权/范围检查，仅扩展实体枚举；Product Ad 的 `adId/sku/asin/globalAdId` 进入白名单 fields，不泄露原始 payload、Token 或扩展私有字段。其他实体不会因此暴露这些字段。
- 这是广告对象与商品标识关系，不修改 ProductRecord，不读取商品中心代替广告实体，不包含广告商品表现指标或日报。

## 验证结果

- 相关单测：32/32（Product Ad reader、检查点兼容、capability、task routing、MCP dataset、原有 SP 读取）。
- 一次性 PostgreSQL/Redis 结构集成：21/21，包括九类 reader 经 worker 入库、实际 BullMQ 消费、重复同步不增重复对象、分页检查点恢复、状态更新、查询及 Profile 隔离。
- MCP 一次性数据库专项：14/14，包括新增 Product Ad 查询、字段脱敏及跨站点范围拒绝。结构和 MCP 分别以同一隔离 runner 的不同执行完成；初次 MCP 新增用例复用了前一撤权测试的已撤销 credential，已改用独立测试 credential 后专项通过，不恢复被撤销的授权来通过测试。
- 浏览器定向：2/2，覆盖原规范字段优先级/层级导航，以及新增 Ad Group → Product Ad、Profile/父级筛选、SKU显示和缺失 ASIN 显示“—”。浏览器全部模拟 API，不访问生产。
- TypeScript 全库 `tsc --noEmit`：通过。定向 ESLint：通过。首次类型检查发现本批详情字段 helper 类型不匹配，已改用现有 payload 文字 helper 后复验通过。
- `npm run check:fast`：974/974 单测通过；全仓 lint 被未跟踪的 `.next-amazon-live` 产物扫描污染，报告 3055 errors / 30035 warnings，因此该命令未进入其 typecheck 阶段。未删改该目录或仓库 ESLint 配置；独立类型检查结果如上。源码 lint 临时排除该产物的结果见下方补记。

初次结构集成有旧八类总数断言和新用例计划前置条件未调整的问题，均已修复后通过。没有把失败执行记为通过；没有为本批重复生产构建。

## 剩余核心缺口与回滚

Reporting v1 通用官方 OAS（同日重新读取）仅定义字符串 fields/filter、创建/轮询/分片信封，没有 SP Campaign 字段兼容组合、日报日期/归因合同或下载 host 证据。本批不从 V3 fixture 推测 V1 字段，正式解析发布、历史/增量与专属表现数据仍待补齐。

当前无凭证，真实 API/真实记录数/目标库/UI/MCP 数据对账未验收。没有读取或改写真实配置、启动真实任务、执行真实数据库迁移、commit/push 或部署。其他窗口改动保留，GitHub 未同步。

回滚本批 reader、阶段流转、路由白名单、capability、页面/MCP和相应测试即可，无数据库回滚。旧代码不能处理编号 6，会在原检查点解析处阻断，因此回退前须暂停已授权结构计划并保留这些任务，恢复新版后再继续，不手工重排/清空游标。保留已保存的实体及来源记录；不自动删除 Product Ad 数据。

补充验证：全仓 ESLint 临时排除预存 `.next-amazon-live/**` 后通过，0 errors / 5 warnings（均在其他模块）。该命令行忽略没有写入配置。`git diff --check` 本批相关文件通过。单元复验 64/64 通过。
