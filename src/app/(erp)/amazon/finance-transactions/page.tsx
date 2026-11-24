import { AppShell } from "@/components/app-shell/app-shell";
import { FinanceTransactionAnalyticsWorkbench } from "@/components/operations/finance-transaction-analytics-workbench";

export const metadata = { title: "财务交易费用透视 · 亚马逊数据" };

/**
 * /amazon/finance-transactions：迁移自 Wimoor 交易报告的「费用统计 + 月度经营报告」。
 * 纯 Amazon Finances 数据源，与赛狐隔离；原币不折算、按币种分列、已归属行统计。
 */
export default function FinanceTransactionsPage() {
  return (
    <AppShell title="财务交易费用透视" subtitle="费用类型统计与月度经营透视 · 仅 Amazon Finances 已归属交易，原币分列不折算">
      <FinanceTransactionAnalyticsWorkbench />
    </AppShell>
  );
}
