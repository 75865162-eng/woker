import { metricSnapshots } from "@/data/mock-data";
import { aggregateMetricsForCampaignGroups, formatCurrency, formatNumber, formatPercent } from "@/lib/metrics";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function KpiGrid({ campaignGroupIds }: { campaignGroupIds: string[] }) {
  const performanceRows = useWorkspaceStore((state) => state.performanceRows);
  const snapshot =
    campaignGroupIds.length <= 1
      ? metricSnapshots.filter((item) => item.campaignGroupId === campaignGroupIds[0]).at(-1) ?? metricSnapshots[0]
      : aggregateMetricsForCampaignGroups(campaignGroupIds, performanceRows);
  const metrics = [
    { label: "Sales", value: formatCurrency(snapshot.sales), delta: "+12.4%" },
    { label: "Spend", value: formatCurrency(snapshot.spend), delta: "-3.1%" },
    { label: "ACOS", value: formatPercent(snapshot.acos), delta: "-5.8%" },
    { label: "ROAS", value: formatNumber(snapshot.roas, 2), delta: "+9.6%" },
    { label: "CTR", value: formatPercent(snapshot.ctr), delta: "+1.2%" },
    { label: "CPC", value: `$${formatNumber(snapshot.cpc, 2)}`, delta: "-2.2%" },
    { label: "Orders", value: formatNumber(snapshot.orders), delta: "+18" },
    { label: "CVR", value: formatPercent(snapshot.cvr), delta: "+0.8%" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-lg border border-border bg-white p-4">
          <p className="text-xs font-bold uppercase text-muted">{metric.label}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="metric-tabular text-2xl font-bold text-foreground">{metric.value}</p>
            <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-bold text-green-700">{metric.delta}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
