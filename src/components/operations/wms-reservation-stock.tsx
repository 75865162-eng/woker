import type { ReservationStockContext } from "@/lib/wms/reservation-view";

export function WmsReservationStock({ stock }: { stock: ReservationStockContext | null | undefined }) {
  if (!stock) return <p className="text-sm text-muted-foreground">位置信息不可用，请刷新后核对。</p>;
  return <div className="space-y-1 whitespace-normal text-sm">
    <p>仓库：{stock.warehouseCode} · {stock.warehouseName}</p>
    <p>库位：{stock.locationCode}</p>
    {stock.locationFrozen && <p className="text-amber-600">库位已冻结，暂停库存作业。</p>}
    {stock.sku && <p>SKU：{stock.sku}</p>}
    <p>批次：{stock.lotCode}</p>
    <p>条码：{stock.barcode ?? "未设置"}</p>
  </div>;
}
