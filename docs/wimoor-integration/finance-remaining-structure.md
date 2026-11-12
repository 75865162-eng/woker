# 财务剩余结构移植证据与目标契约

本轮只开发本地结构与隔离验证，不运行真实迁移、外部调用或部署。源目录 `/Users/chenjieliang/Documents/wimoor`；表结构及 Java 实体作为字段证据，不以历史数据或源接口目录推断功能验收。

| 已核源证据 | 目标实现 |
| --- | --- |
| `init-config/mysql/数据库结构/db_finance/fin_subject_type.sql` 的 code/name/parent_code/level/category_type/sort_order/is_fixed；`FinSubjectTypeServiceImpl` CRUD | `FinanceSubjectCategory` 的三级类别树、固定名称、排序、启停、revision；仅未引用自定义项可删。分类到启用科目沿原总账。 |
| `db_erp/t_erp_fin_project.sql` name/issys；`t_erp_fin_journalaccount.sql` acct/projectid/ftype/amount | 复用 `FinanceAuxiliaryType` 为项目分类、`FinanceAuxiliaryItem` 为项目，逐凭证分录归属；固定项目名称不可改，启停保留已过账历史，引用项不可删。 |
| `FinAccount.java` 的 paymeth/isdefault/isdelete；`FinTypeJournalMonthly.java` 的 projectid/acct/year/month/rec/pay | `FinanceBankAccount` 支付方式、唯一默认、停用与revision；月收支按已过账银行科目及辅助项目派生。余额使用当前期间正式期初及已过账分录，不复制源可变余额为第二事实源。 |
| `db_finance/fin_closing_template_item.sql` summary/subject_id/direction/amount_field；`fin_closing_template_vouchers.sql` 模板/账套/凭证/日期/日志关联 | 复用版本化 `FinanceReportTemplate` 的 `VOUCHER_MAPPING`：明确字段表达式、科目、方向和摘要，独立激活；目标端显式提供字段值及来源唯一键，预览摘要后仅转草稿，完整字段/模板/来源证据写审计。同一目标来源不可跨模板或账套重复入账。 |
| `db_finance/fin_voucher_inventory_detail.sql` entry_id/material_id/batch_no/warehouse_id/quantity/unit_price | WMS 统一来源提供原成本/批次/仓库证据，交接时保存到现有不可变总账来源审计，并关联非零正式分录行号；冲销回看原依据。缺少来源明细的其他凭证返回空明细，不补造库存数据。 |

入口为现有财务总账页中的科目类别、辅助项目、银行账户、项目月汇总、库存凭证依据及来源凭证模板；统一服务分别位于 `catalog-service.ts`、`auxiliary-service.ts`、`bank-service.ts`、`structure-query.ts`、`voucher-template-service.ts`。来源模板支持有界六位小数四则表达式，负数反转明确借贷方向；不执行任意代码、不猜测 Amazon 或飞书字段、不自动采集字段、不自动过账。

迁移 `20261211040000_three_core_remaining_structure` 在移除旧不可变类别 trigger 后，递归重建已有类别层级；存在超过三级、孤立或循环结构时明确阻断，须先核对目标树。新增默认账户部分唯一索引，目录更新只允许展示/状态字段和递增revision；账户绑定科目、项目所属类型、类别父级/大类保持原身份。

验证覆盖已有类别三级回填/四级阻断、固定项保护、停用与引用保护、默认账户唯一/旧revision冲突、已过账项目收支精度、模板缺字段阻断/负数方向/独立复核/六路幂等草稿，以及真实权限隔离。实际导入历史数据、真实银行/飞书连接、源所有报表样式及正式会计政策不由这些结构测试证明。
