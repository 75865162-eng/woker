import { AppShell } from "@/components/app-shell/app-shell";
import { WmsWorkbench } from "@/components/operations/wms-workbench";

export default async function WarehousePage({ searchParams }: { searchParams: Promise<{ tab?: string; number?: string; receiptId?: string; sourceReference?: string; workflowStatus?: string }> }) {
  const { tab, number, receiptId, sourceReference, workflowStatus } = await searchParams;
  const transfers = tab === "transfers";
  return <AppShell title={transfers ? "调拨流水" : "公司仓库存"} subtitle={transfers ? "按调拨命令查看审核执行后产生的成对库存记录；源库位与目标库位流水分别保留。" : "企业自有仓库、批次、收货和库存余额"}><WmsWorkbench initialTab={tab} initialReservationNumber={tab === "reservations" ? number : undefined} initialReceiptId={tab === "receipts" ? receiptId : undefined} initialReceiptFilters={tab === "receipts" ? { sourceReference, workflowStatus } : undefined} /></AppShell>;
}
