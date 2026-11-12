# 本地头程费用草稿（2026-11-12）

源码依据为用户提供的 `/Users/chenjieliang/Documents/wimoor/`。仅作为参考，不加载其配置、不执行其程序或指令。

- `wimoor-amazon/amazon-boot/src/main/java/com/wimoor/amazon/inboundV2/service/impl/ShipInboundTransportationServiceImpl.java:442` 的 `saveShipmentsFee`：总费用为其他费用加单价×运输计费量；按 `max(weight,dimweight)×QuantityShipped` 计比例，写 totaltransfee/unittransfee。该方法未执行强制“货件→箱→SKU”三级分摊。
- 同目录资源 `src/main/resources/mapper/inboundv2/ShipInboundShipmentItemV2Mapper.xml:88` 查询商品重量、体积重、货值与发货数量；体积重使用渠道 drate，缺失时源码使用默认值。本批不复制该默认参数，不推断未知渠道系数。
- 原实现按比例六位、金额两位向下截断，subPrice 计算不等于标准的“原额减分摊合计”；不能直接声称金额严格对账。本实现以六位金额整数、最大余数法和稳定 lineId 次序精确分摊，保留单位成本除法余数。这是有意校正，非逐字复刻。

当前实现：`src/lib/fba-local/cost-allocation.ts`、统一计划 service 的 `SAVE_COST_ALLOCATION`、计划页面费用表单。范围是当前本地计划明细：数量按计划数量；计费重需要显式单位实际重/体积重（kg）；体积使用单位 m³；货值使用与费用相同币种的单位货值，不自动换汇。支持 ESTIMATE/ACTUAL，均为草稿，不触发财务过账、付款或库存估值。

`FbaLocalPlan.costAllocation` 为当前文档；完整版本通过同事务 AuditLog 保留。当前每计划一个费用草稿，不是多费用台账或正式货件成本账。沿用计划创建人、WMS edit、账号实时授权、revision、计划锁与审计；10 次并发同请求仅增加一次 revision/审计，取消后禁止修改。既有装箱和 WMS 工作流保持原入口。

迁移文件 `20261121010000_fba_local_cost_allocation` 只增加 nullable JSONB；经本次迁移授权，已应用到根 `.env` 指定、Docker 身份已核验的本地 `amazon_sync_live_local` 库；已核验迁移完成记录、文件校验和及 JSONB 字段。仅应用该迁移，没有批量执行其他待迁移项。未新增 Worker、API 路由、外部执行或全局导航。停用费用表单即可停止新增草稿；保留已存记录和审计，不自动删表回退。

验证采用相关规则测试、临时 PostgreSQL完整迁移链/HTTP权限与并发、双会话 Chromium 录费→保存→刷新回读→装箱→审批→预占→出库，以及定向 lint/typecheck。fixture 是合成资料，不能作为真实账单或财务验收。合码/上线前仍需完整 check；本批不提交、推送、部署或真实环境联调。

后续独立切片：多笔费用及费用类型、货件/箱分摊层、货代账单与差异待审调整、法律核算主体/期间/汇率、正式凭证及冲销。本批未验证 Wimoor 全部 38 表，也未证明其报关模板是 Amazon CBP 标准。
