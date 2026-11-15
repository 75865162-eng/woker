import { receiptActionRemaining } from "@/lib/wms/receipt-action-view";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { WmsReceiptLot } from "./wms-receipt-lot";
import type { ReceiptLotContext, ReceiptLocationContext } from "@/lib/wms/receipt-view";

const fields = [["expectedQty", "计划"], ["receivedQty", "实收"], ["acceptedQty", "合格"], ["rejectedQty", "拒收"], ["returnedQty", "已退回"], ["putawayQty", "已上架"]] as const;

type ReceiptLine = Record<string, unknown>;

interface RowView {
  line: ReceiptLine;
  valid: boolean;
  pendingQc: number;
  pendingPutaway: number;
  shortage: string | number;
}

export function WmsReceiptDetails({ receipt }: { receipt: Record<string, unknown> }) {
  const lines = Array.isArray(receipt.lines) ? receipt.lines as ReceiptLine[] : [];
  const location = receipt.receivingLocation as ReceiptLocationContext | null | undefined;

  const rows: RowView[] = lines.map((line) => {
    const valid = fields.every(([key]) => typeof line[key] === "number" && Number.isSafeInteger(line[key]) && (line[key] as number) >= 0);
    return {
      line,
      valid,
      pendingQc: valid ? receiptActionRemaining(line, "INSPECT") : NaN,
      pendingPutaway: valid ? receiptActionRemaining(line, "PUTAWAY") : NaN,
      shortage: !valid ? "需刷新" : ["DRAFT", "CANCELLED"].includes(String(receipt.status)) ? "—" : Math.max(0, Number(line.expectedQty) - Number(line.receivedQty)),
    };
  });

  const columns: DataTableColumn<RowView>[] = [
    {
      key: "lot",
      header: "批次与条码",
      render: (row) => <WmsReceiptLot lotId={String(row.line.lotId ?? "未读取")} lot={row.line.lot as ReceiptLotContext | null} />,
      className: "break-all",
    },
    ...fields.map(([key, label]): DataTableColumn<RowView> => ({
      key,
      header: label,
      numeric: true,
      render: (row) => (typeof row.line[key] === "number" ? String(row.line[key]) : "未读取"),
      cellAttributes: () => ({ "data-quantity": key }),
    })),
    {
      key: "shortage",
      header: "短收差异",
      numeric: true,
      render: (row) => row.shortage,
      cellAttributes: () => ({ "data-quantity": "shortage" }),
    },
    {
      key: "pendingQc",
      header: "待质检",
      numeric: true,
      render: (row) => (Number.isSafeInteger(row.pendingQc) && row.pendingQc >= 0 ? row.pendingQc : "需刷新"),
      cellAttributes: () => ({ "data-quantity": "pendingQc" }),
    },
    {
      key: "pendingPutaway",
      header: "待上架",
      numeric: true,
      render: (row) => (Number.isSafeInteger(row.pendingPutaway) && row.pendingPutaway >= 0 ? row.pendingPutaway : "需刷新"),
      cellAttributes: () => ({ "data-quantity": "pendingPutaway" }),
    },
  ];

  return <details className="min-w-64 whitespace-normal text-sm">
    <summary className="cursor-pointer">查看收货明细</summary>
    <div className="my-2 break-all"><p>仓库：{location ? `${location.warehouseCode} · ${location.warehouseName}` : "当前资料不可用"}</p><p>收货库位：{location?.locationCode ?? "当前资料不可用"}</p><p className="text-xs text-muted">库位 ID：{String(receipt.receivingLocationId ?? "未读取")}</p></div>
    {lines.length
      ? <DataTable
          ariaLabel="收货批次数量"
          density="compact"
          columns={columns}
          rows={rows}
          getRowKey={(row) => String(row.line.id)}
          rowAttributes={(row) => ({ "data-receipt-line": String(row.line.id) })}
          className="my-2"
        />
      : <p className="my-2">明细尚未读取，请刷新收货单。</p>}
  </details>;
}
