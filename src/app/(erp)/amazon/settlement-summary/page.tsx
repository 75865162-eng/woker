import { AppShell } from "@/components/app-shell/app-shell";
import { SettlementMonthlySummaryWorkbench } from "@/components/operations/settlement-monthly-summary-workbench";

export const metadata = { title: "结算月度汇总 · 亚马逊数据" };

/**
 * /amazon/settlement-summary：迁移自 Wimoor 结算记录 / summaryMonth。
 * 纯 Amazon 结算报告数据源，与赛狐隔离；仅已归属行、原币分列不折算、订单数 distinct。
 */
export default function SettlementSummaryPage() {
  return (
    <AppShell title="结算月度汇总" subtitle="交易类型透视与月度趋势 · 仅 Amazon 已归属结算行，原币分列不折算">
      <SettlementMonthlySummaryWorkbench />
    </AppShell>
  );
}
