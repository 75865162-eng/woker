import { isSellfoxDate } from "@/lib/sellfox/sync-contract";

function singleShopPage(shopExternalId: string, pageNo: number) {
  if (!shopExternalId.trim()) throw new Error("赛狐店铺 ID 不能为空。");
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 10_000) throw new Error("赛狐页码无效。");
  return { shopIdList: [shopExternalId], pageNo: String(pageNo), pageSize: "100" };
}

export function sellfoxInventoryRequest(shopExternalId: string, pageNo: number) {
  return {
    ...singleShopPage(shopExternalId, pageNo),
    hideZero: "false", hideDeletedPrd: "false", needMergeShare: "false",
  };
}

export function sellfoxSalesRequest(shopExternalId: string, reportDate: string, pageNo: number, metric: "productNum" | "salePrice" | "orderNum") {
  if (!isSellfoxDate(reportDate)) throw new Error("赛狐销量日期无效。");
  return {
    ...singleShopPage(shopExternalId, pageNo), type: metric, groupType: "msku", statTimeType: 1,
    startDate: reportDate, endDate: reportDate, currency: "",
  };
}
