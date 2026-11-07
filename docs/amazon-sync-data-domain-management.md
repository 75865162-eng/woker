# Amazon 数据域管理规划

数据域目录由 `src/lib/amazon-sync/policy.ts` 的 `syncDomains` 维护，页面 `/operations?view=domains` 只消费这份目录和当前工作区的数据源。目录是能力与规划元数据，不是授权证明，也不创建计划或任务。

每个域必须明确以下信息：

- `implemented`：是否已有可执行适配器。为 `false` 时保持规划中，不能保存计划或发起 Amazon 请求。
- `mode`：`snapshot`（完整快照）、`incremental`（有界增量）、`report`（异步报告）或 `external`（独立接口）。
- `frequency` / `priority`：建议调度频率和优先级，只用于规划及 UI 展示，不替代 Amazon usage plan 或服务端容量限制。
- `authorization`：当前授权核验状态。参与站点验证成功不等于该数据域角色已获授权。
- `nextStep`：该域进入下一阶段前必须完成的核验或实现工作。

数据域详情还会显示当前工作区的真实数据源覆盖。没有数据源、成功快照或已发布报告时显示为空状态，不用默认频率、模拟任务或规划状态伪造覆盖。Amazon 观察数据仍独立于 `ProductRecord`，不自动覆盖商品主数据；PPC/赛狐报表保持各自事实源。

新增数据域的准入顺序：冻结官方 operation/report 版本和哈希，确认角色、区域、站点资格，定义字段白名单、分页/报告完成条件、业务键和幂等规则，再添加适配器、审批边界、数据质量证据和隔离测试。无法核验的域继续保持 `implemented: false`，不要为了展示而开放计划或请求。

本次目录升级只改变规划元数据和详情展示，没有新增 Amazon endpoint、数据库迁移、定时任务、凭证写入或生产执行权限。
