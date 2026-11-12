# 财务规则移植（2026-11-12）

按用户“参考 Wimoor 框架，先只移植规则”实现 `src/lib/finance/rules.ts`。这是无数据库、无网络副作用的规则层，尚无正式凭证 API、持久化账簿及页面接入。

源码依据（相对 `/Users/chenjieliang/Documents/wimoor/wimoor-modules/wimoor-finance/src/main/java/com/wimoor/finance/`）：

- `voucher/service/impl/FinVouchersServiceImpl.java`：`postVoucherToLedger`、`validateVoucherStatus`、`validateDebitCreditBalance`、`calculateDetailBalance`。移植已审核才能过账、精确借贷平衡、借正贷负余额滚动。
- `setting/service/impl/FinAccountingPeriodsServiceImpl.java`：`closePeriod`、`reverseClosePeriod`。移植开放期结账、重复结账幂等、后续已结账阻止反结账。

有意校正：不复制源码“保存即更新账簿”的行为；规则明确区分草稿、审核和过账计划，不执行任何账簿写入。普通分录正数，红字冲销在原方向用负数，必须关联完整原凭证；禁止重复冲销。金额按六位整数精确计算，不使用浮点或默认汇率。本规则当前只接受显式本位币金额，不支持外币换算。

增加的 ERP 规则：组织/工作区/账套/币种一致、开放期间与日期、启用末级科目、来源防重、期初与发生额分别试算、结账前待过账/未对账/缺成本拦截。预估与实际费用按计划 lineId 对齐，差异可在显式提供成本及应付科目后生成调整草稿，零差异不生成凭证。调整草稿是普通差额凭证，取消已过账费用应使用关联红字冲销。

所有 plan/review 函数均为纯函数，返回值不证明获得审核/过账授权或已经执行。调用方将来须在同一服务端事务内读取完整当前证据，校验实时权限、独立审核、revision，锁定期间/来源及原凭证，以唯一约束落实防重并原子写入凭证、账簿、审计与 Outbox；不能信任客户端提交的试算/结账证据。

验证：`tests/finance-rules.test.ts` 覆盖超安全整数精度、微额差异、隔离、重复来源、借贷余额跨零、冲销净额、篡改冲销、关账拦截及既有 FBA 分摊输出到差异调整草稿。未执行真实财务过账、付款、报关或 Amazon 调用；未完成 38 表迁移或正式总账应用。
