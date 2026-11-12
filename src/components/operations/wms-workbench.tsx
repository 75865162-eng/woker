"use client";
import { WmsInventoryRisk } from './wms-inventory-risk';
import { WmsAgingSnapshots } from './wms-aging-snapshots';
import {WmsOverseasPanel} from "./wms-overseas-panel";
import {WmsValuationPanel} from "./wms-valuation-panel";
import {WmsConversions} from "./wms-conversions";
import {WmsConsumables} from "./wms-consumables";
import {WmsCatalogProfile} from "./wms-catalog-profile";
import {WmsTransferOrders} from "./wms-transfer-orders";
import {transferStatusLabels} from "./wms-transfer-table";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw, X } from "lucide-react";
import { emitWorkspaceScopeChanged, workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { useWmsOptions } from "./use-wms-options";
import { WmsOptionsStatus } from "./wms-options-status";
import { WmsProductPicker } from "./wms-product-picker";
import { WmsStocktakePanel } from "./wms-stocktake-panel";
import { WmsCommandPanel } from "./wms-command-panel";
import { WmsReceiptLot } from "./wms-receipt-lot";
import type { ReceiptLotContext } from "@/lib/wms/receipt-view";
import { WmsReceiptDetails } from "./wms-receipt-details";
import type { ApprovalReceiptContext } from "@/lib/wms/approval-receipt-view";
import { WmsApprovalDetails, type ApprovalStocktakeContext, type ApprovalTransferContext } from "./wms-approval-details";
import type { WmsCommandInput } from "@/lib/wms/contracts";
import { WmsReceiptDraftForm } from "./wms-receipt-draft-form";
import { WmsReservationStock } from "./wms-reservation-stock";
import type { ApprovalReservationContext, ReservationStockContext, WmsLocationContext } from "@/lib/wms/reservation-view";
import { WmsLocationFreezeForm } from "./wms-location-freeze-form";
import { WmsStockActionForm } from "./wms-stock-action-form";
import { stockActionLimit, stockActionLabels, type StockAction } from "@/lib/wms/stock-action-view";
import { receiptActionPayload, receiptActionRemaining, type ReceiptAction } from "@/lib/wms/receipt-action-view";
import { localPlanHref, localPlanApprovalHref } from "@/lib/fba-local/links";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";

type Kind = "inventory-valuation" | "cost-rules" | "finance-drafts" | "overseas-transfers" | "stock-aging" | "conversions" | "inventory-history" | "consumables" | "transfer-orders" | "stocktakes" | "reconciliation" | "warehouses" | "areas" | "locations" | "lots" | "receipts" | "outbounds" | "balances" | "approvals" | "reservations" | "movements" | "transfers";
type Item = Record<string, unknown>;

const tabs: Array<{ id: Kind; label: string }> = [
 {id:"inventory-valuation",label:"库存金额"},{id:"cost-rules",label:"库存成本规则"},{id:"finance-drafts",label:"库存财务草稿"},{id:"overseas-transfers",label:"海外调拨装箱"},
  {id:"stock-aging",label:"库存周转估算"},
  {id:"conversions",label:"SKU 转换单"},
  {id:"inventory-history",label:"历史库存"},
  {id:"consumables",label:"出库耗材"},
  {id:"transfer-orders",label:"在途调拨"},
  { id: "warehouses", label: "仓库" }, { id: "areas", label: "区域" }, { id: "locations", label: "库位" }, { id: "lots", label: "商品批次" },
  { id: "stocktakes", label: "盘点" }, { id: "receipts", label: "收货单" }, { id: "outbounds", label: "出库需求" }, { id: "balances", label: "库存余额" }, { id: "approvals", label: "待审批" }, { id: "reservations", label: "预占与出库" }, { id: "movements", label: "库存流水" }, { id: "transfers", label: "调拨流水" }, { id: "reconciliation", label: "库存核对" },
];
const columns: Record<Kind, Array<[string, string]>> = {
 "inventory-valuation":[["stock","库存位置"],["onHand","实物数量"],["dataStatus","计价完整性"],["unvaluedMovements","未计价流水"],["values","账面金额（分币种）"]],
 "cost-rules":[["id","成本规则"]],"finance-drafts":[["id","计价草稿"]],"overseas-transfers":[["id","海外资料"]],
  "stock-aging":[["warehouseCode","仓库"],["sku","SKU"],["quantity","当前数量"],["availableQty","可用数量"],["dataStatus","完整性"],["estimate","周转区间估算"],["asOf","统计时点"]],
  conversions:[["id","转换单"]],
  "inventory-history":[["stock","库存位置"],["dataStatus","流水完整性"],["from","起点（含）"],["to","终点（不含）"],["openingQty","期初数量"],["incomingQty","期间入库"],["outgoingQty","期间出库"],["closingQty","期末数量"],["closingReserved","期末预占"],["volumeStatus","体积完整性"],["openingVolume","期初体积 m³"],["incomingVolume","入库体积 m³"],["outgoingVolume","出库体积 m³"],["closingVolume","期末体积 m³"],["periods","日/月分类汇总"]],
  consumables:[["id","规则"],["units","单件耗用"]],
  "transfer-orders":[["number","调拨单号"],["status","状态"]],
  stocktakes: [["id", "盘点单 ID"], ["number", "盘点单号"], ["warehouseId", "仓库"], ["status", "状态"], ["revision", "版本"]],
  reconciliation: [["id", "余额 ID"], ["warehouseId", "仓库"], ["locationId", "库位"], ["lotId", "批次"], ["reconciliationStatus", "核对结果"], ["movementCount", "流水条数"], ["differences", "流水数量差异"], ["reservationRemaining", "预占单剩余量"], ["reservationDifference", "预占单差异"]],
  reservations: [["id", "预占单 ID"], ["number", "单号"], ["stock", "拣货位置与批次"], ["workflowStatus", "作业状态"], ["remainingQty", "剩余预占"], ["unpickedQty", "待拣数量"], ["requestedQty", "预占"], ["pickedQty", "已拣"], ["dispatchedQty", "已出库"], ["releasedQty", "已释放"], ["revision", "版本"]],
  movements: [["id", "流水 ID"], ["action", "动作"], ["stock", "位置与批次"], ["sourceId", "来源单据"], ["balanceId", "余额 ID"], ["deltaOnHand", "实物变化"], ["deltaPendingQc", "待质检变化"], ["deltaPendingPutaway", "待上架变化"], ["deltaRejected", "拒收变化"], ["deltaReserved", "预占变化"], ["occurredAt", "发生时间"]],
  transfers: [["id", "流水 ID"], ["direction", "调拨方向"], ["sourceId", "调拨命令"], ["stock", "库位与批次"], ["deltaOnHand", "实物变化"], ["balanceId", "余额 ID"], ["occurredAt", "发生时间"]],
  warehouses: [["id", "仓库 ID"], ["code", "仓库编码"], ["name", "仓库名称"], ["enabled", "状态"], ["createdAt", "创建时间"]],
  areas: [["code", "区域编码"], ["name", "区域名称"], ["warehouseId", "仓库"], ["enabled", "状态"]],
  locations: [["id", "库位 ID"], ["code", "库位编码"], ["warehouseId", "仓库"], ["areaId", "区域"], ["kind", "类型"], ["enabled", "状态"], ["frozen", "冻结状态"]],
  lots: [["id", "批次 ID"], ["lotCode", "批次编码"], ["productRecordId", "商品主档"], ["barcode", "条码"], ["createdAt", "创建时间"]],
  receipts: [["number", "收货单号"], ["lines", "收货明细"], ["sourceReference", "来源单号"], ["status", "状态"], ["revision", "版本"], ["createdAt", "创建时间"]],
  outbounds: [["number", "出库需求单号"], ["warehouse", "仓库"], ["lines", "商品需求"], ["status", "状态"], ["revision", "版本"], ["createdAt", "创建时间"]],
  balances: [["id", "余额 ID"], ["revision", "版本"], ["stock", "位置与批次"], ["onHand", "实物数量"], ["pendingQc", "待质检"], ["pendingPutaway", "待上架"], ["rejected", "拒收数量"], ["reserved", "已预占"], ["available", "可用数量"]],
  approvals: [["command", "作业明细"], ["action", "操作"], ["aggregateId", "业务单据"], ["requestedBy", "申请人"], ["status", "状态"], ["expiresAt", "过期时间"]],
};
const receiptActionLabels: Record<ReceiptAction, string> = { RECEIVE: "收货", INSPECT: "质检", PUTAWAY: "上架", RETURN_REJECTED: "退回拒收品" };
const createLabels: Partial<Record<Kind, string>> = { warehouses: "新建仓库", areas: "新建区域", locations: "新建库位", lots: "新建批次", receipts: "新建收货单", outbounds: "新建出库需求" };
const filterFields: Partial<Record<Kind, Array<[string, string]>>> = {
 "inventory-valuation":[["warehouseId","仓库"],["lotId","批次 ID"]],
  "stock-aging":[["warehouseId","仓库"],["productRecordId","商品主档 ID"]],
  "inventory-history":[["granularity","汇总粒度 DAY/MONTH（UTC 整日/月）"],["from","期间起点 UTC（ISO）"],["to","期间终点 UTC（ISO）"],["warehouseId","仓库"],["locationId","库位 ID"],["lotId","批次 ID"]],
  "transfer-orders":[["number","在途调拨单号（精确）"],["status","状态"]],
  stocktakes: [["number", "盘点单号（精确）"], ["warehouseId", "仓库"]],
  outbounds: [["number", "出库需求单号（精确）"], ["warehouseId", "仓库"], ["status", "状态"]],
  areas: [["warehouseId", "仓库"]], locations: [["warehouseId", "仓库"], ["areaId", "区域"]], lots: [["productRecordId", "商品主档 ID"], ["barcode", "条码（精确）"], ["lotCode", "批次编码（精确）"]],
  receipts: [["barcode", "条码（精确）"], ["lotCode", "批次编码（精确）"], ["warehouseId", "仓库"], ["id", "收货单 ID"], ["number", "收货单号（精确）"], ["sourceReference", "来源单号（精确）"], ["status", "收货状态"], ["workflowStatus", "收货作业"]], balances: [["warehouseId", "仓库"], ["locationId", "库位 ID"], ["lotId", "批次 ID"], ["barcode", "条码（精确）"], ["lotCode", "批次编码（精确）"]],
  reconciliation: [["warehouseId", "仓库"], ["locationId", "库位 ID"], ["lotId", "批次 ID"], ["barcode", "条码（精确）"], ["lotCode", "批次编码（精确）"]],
  approvals: [["aggregateId", "业务单据 ID"], ["status", "审批状态"], ["workflowStatus", "审批作业"]], reservations: [["balanceId", "余额 ID"], ["number", "预占单号（精确）"], ["workflowStatus", "预占作业状态"], ["warehouseId", "仓库"], ["locationId", "库位 ID"], ["lotId", "批次 ID"], ["barcode", "条码（精确）"], ["lotCode", "批次编码（精确）"]], movements: [["balanceId", "余额 ID"], ["sourceId", "来源单据"], ["warehouseId", "仓库"], ["locationId", "库位 ID"], ["lotId", "批次 ID"], ["barcode", "条码（精确）"], ["lotCode", "批次编码（精确）"]], transfers: [["sourceId", "调拨命令 ID"], ["warehouseId", "仓库"], ["locationId", "库位 ID"], ["lotId", "批次 ID"], ["barcode", "条码（精确）"], ["lotCode", "批次编码（精确）"]],
};
const filterResources: Record<string, string> = { warehouseId: "warehouses", areaId: "areas", locationId: "locations", lotId: "lots", balanceId: "balances" };
function display(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "无差异";
  if (value === "AWAITING_PICK") return "待拣货";
  if (value === "PARTIALLY_PICKED") return "部分已拣";
  if (value === "AWAITING_DISPATCH") return "待出库";
  if (value === "CLOSED") return "已结束";
  if (value === "MATCH") return "一致";
  if (value === "MISMATCH") return "存在差异";
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "启用" : "停用";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString("zh-CN", { hour12: false });
  return String(value);
}
function approvalExpired(item: Item) {
  return ["PENDING", "APPROVED"].includes(String(item.status)) && typeof item.expiresAt === "string" && Date.parse(item.expiresAt) <= Date.now();
}
function approvalStatus(item: Item) {
  if (approvalExpired(item)) return "已过期";
  return ({ PENDING: "待审批", APPROVED: "已通过", REJECTED: "已拒绝", CONSUMED: "已执行" } as Record<string, string>)[String(item.status)] ?? display(item.status);
}
function reservationStatusTone(status: unknown): "green" | "amber" | "gray" {
  if (status === "CLOSED") return "gray";
  if (status === "AWAITING_DISPATCH") return "green";
  return "amber";
}
function reservationStatusLabel(status: unknown) {
  return ({ AWAITING_PICK: "待拣货", PARTIALLY_PICKED: "部分已拣", AWAITING_DISPATCH: "待出库", CLOSED: "已结束" } as Record<string, string>)[String(status)] ?? display(status);
}

export function WmsWorkbench({ initialTab = "warehouses", initialReceiptId = "", initialReservationNumber = "", initialReceiptFilters = {} }: { initialTab?: string; initialReceiptId?: string; initialReservationNumber?: string; initialReceiptFilters?: { sourceReference?: string; workflowStatus?: string } }) {
  const [stocktakeId, setStocktakeId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("default");
  const [standaloneScopePicker, setStandaloneScopePicker] = useState(false);
  const [workspaceOptions, setWorkspaceOptions] = useState<Array<{ id: string; name: string; accountId?: string | null; marketplace?: string | null }>>([{ id: "default", name: "默认工作区" }]);
  useEffect(() => {
    const updateScope = () => {
      try {
        const scope = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}");
        setWorkspaceId(typeof scope.workspaceId === "string" && scope.workspaceId.trim() ? scope.workspaceId : "default");
      } catch { setWorkspaceId("default"); }
    };
    updateScope();
    window.addEventListener(workspaceScopeChangedEventName, updateScope);
    return () => window.removeEventListener(workspaceScopeChangedEventName, updateScope);
  }, []);
  useEffect(() => {
    const hasShellPicker = Boolean(document.querySelector('select[title="选择工作区"]:not([aria-label="仓库工作区"])'));
    setStandaloneScopePicker(!hasShellPicker);
    if (hasShellPicker) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/workspaces", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.workspaces)) return;
        const options = data.workspaces.filter((item: unknown): item is { id: string; name: string; accountId?: string | null; marketplace?: string | null } => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && typeof (item as { name?: unknown }).name === "string"));
        if (!cancelled && options.length) setWorkspaceOptions(options);
      } catch { /* Keep the current workspace available during temporary scope-list failures. */ }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);
  useEffect(() => {
    // AppShell can finish loading after this workbench mounts.
    const syncPicker = () => setStandaloneScopePicker(!document.querySelector('select[title="选择工作区"]:not([aria-label="仓库工作区"])'));
    const observer = new MutationObserver(syncPicker);
    observer.observe(document.body, { childList: true, subtree: true });
    syncPicker();
    return () => observer.disconnect();
  }, []);
  const [editingReceipt, setEditingReceipt] = useState<Parameters<typeof WmsReceiptDraftForm>[0]["receipt"] | null>(null);
  const [editingOutbound, setEditingOutbound] = useState<Item | null>(null);
  const [freezeLocation, setFreezeLocation] = useState<Item | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<Item | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Item | null>(null);
  const [selectedOutbound, setSelectedOutbound] = useState<Item | null>(null);
  const [stockJob, setStockJob] = useState<{ item: Item; action: StockAction } | null>(null);
  const loadSequence = useRef(0);
  const wmsFetch = useCallback((url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-workspace-id", workspaceId);
    return fetch(url, { ...init, headers });
  }, [workspaceId]);
  const [profile,setProfile]=useState<{item:Item;kind:"lots"|"warehouses"|"locations"}|null>(null);
  const [profileBusy,setProfileBusy]=useState(false);
  const [kind, setKind] = useState<Kind>(tabs.some(item => item.id === initialTab) ? initialTab as Kind : "warehouses");
  useEffect(() => {
    const update = () => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      setKind(tabs.some(item => item.id === tab) ? tab as Kind : "warehouses");
    };
    update(); window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [initialTab]);
  function changeTab(next: Kind) {
    const url = new URL(window.location.href); url.searchParams.set("tab", next);
    if (next !== "outbounds") setEditingOutbound(null);
    if (next !== "receipts") {
      for (const key of ["receiptId", "sourceReference", "workflowStatus"]) url.searchParams.delete(key);
      setFilters(current => { const next = { ...current }; for (const key of ["id", "sourceReference", "workflowStatus"]) delete next[key]; return next; });
      setAppliedFilters(current => { const next = { ...current }; for (const key of ["id", "sourceReference", "workflowStatus"]) delete next[key]; return next; });
    }
    window.history.pushState(null, "", url); setKind(next);
  }
  const [historyDefault]=useState(()=>{const end=new Date();return {from:new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),1)).toISOString(),to:end.toISOString()};});
  const initialFilters = { ...historyDefault, ...(initialTab === "reservations" && initialReservationNumber ? { number: initialReservationNumber } : {}), ...(initialReceiptId ? { id: initialReceiptId } : {}), ...(initialReceiptFilters.sourceReference ? { sourceReference: initialReceiptFilters.sourceReference } : {}), ...(initialReceiptFilters.workflowStatus ? { workflowStatus: initialReceiptFilters.workflowStatus } : {}) };
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>(initialFilters);
  useEffect(() => {
    const update = () => {
      const params = new URLSearchParams(window.location.search);
      const receiptTab = params.get("tab") === "receipts";
      const values = { id: receiptTab ? params.get("receiptId") : null, sourceReference: receiptTab ? params.get("sourceReference") : null, workflowStatus: receiptTab ? params.get("workflowStatus") : null };
      const apply = (current: Record<string, string>) => { const next = { ...current }; for (const key of ["id", "sourceReference", "workflowStatus"]) { const value = values[key as keyof typeof values]; if (value) next[key] = value; else delete next[key]; } return next; };
      setFilters(apply); setAppliedFilters(apply); setCursorHistory([]); setCursor(null);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function openRelated(target: "movements" | "reservations" | "balances" | "approvals", key: "balanceId" | "sourceId" | "lotId" | "aggregateId", id: string) {
    const next = { [key]: id };
    setFilters(next); setAppliedFilters(next); setCursorHistory([]); setCursor(null);
    changeTab(target);
  }
  const [filterOptions, setFilterOptions] = useState<Record<string, Item[]>>({});
  const [filterOptionsHaveMore, setFilterOptionsHaveMore] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [loadedKind,setLoadedKind]=useState<Kind|null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "" });
  const [receiptForm, setReceiptForm] = useState({ number: "", receivingLocationId: "", sourceReference: "", lines: [{ lotId: "", expectedQty: "" }] });
  const [outboundForm, setOutboundForm] = useState({ number: "", warehouseId: "", customer: "", deliveryAddress: "", carrier: "", trackingNumber: "", remark: "", lines: [{ productRecordId: "", requestedQty: "" }] });
  const [catalogForm, setCatalogForm] = useState({ warehouseId: "", areaId: "", code: "", name: "", kind: "RECEIVING", productRecordId: "", lotCode: "", barcode: "" });
  const [actionReceipt, setActionReceipt] = useState<Item | null>(null);
  const [receiptAction, setReceiptAction] = useState<ReceiptAction>("RECEIVE");
  const [actionValues, setActionValues] = useState<Record<string, { quantity: string; acceptedQty: string; rejectedQty: string; locationId: string }>>({});
  const receiptSubmitLock = useRef(false);
  const receiptRequest = useRef<{ fingerprint: string; body: string } | null>(null);
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);

  const warehouseOptions = useWmsOptions("warehouses", workspaceId, createOpen && (kind === "areas" || kind === "outbounds"));
  const areaOptions = useWmsOptions("areas", workspaceId, createOpen && kind === "locations");
  const receivingOptions = useWmsOptions("locations", workspaceId, createOpen && kind === "receipts");
  const lotOptions = useWmsOptions("lots", workspaceId, createOpen && kind === "receipts");
  const storageOptions = useWmsOptions("locations", workspaceId, !!actionReceipt && receiptAction === "PUTAWAY", new URLSearchParams({ warehouseId: String(actionReceipt?.warehouseId ?? "") }).toString());
  const warehouses = warehouseOptions.items.filter(item => item.enabled);
  const areas = areaOptions.items.filter(item => item.enabled);
  const locations = receivingOptions.items.filter(item => item.enabled && !item.frozen && item.kind === "RECEIVING");
  const lots = lotOptions.items;
  const storageLocations = storageOptions.items.filter(item => item.enabled && !item.frozen && item.kind === "STORAGE");

  function changeWorkspace(nextId: string) {
    if (!nextId || nextId === workspaceId) return;
    setProfile(null); setEditingReceipt(null); setEditingOutbound(null); setStockJob(null); setFreezeLocation(null); setSelectedReservation(null); setSelectedReceipt(null); setSelectedOutbound(null); setActionReceipt(null); setCreateOpen(false); setOutboundForm({ number: "", warehouseId: "", customer: "", deliveryAddress: "", carrier: "", trackingNumber: "", remark: "", lines: [{ productRecordId: "", requestedQty: "" }] }); setCursorHistory([]); setCursor(null); setNextCursor(null);
    setWorkspaceId(nextId);
    try {
      const stored = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}");
      const workspace = workspaceOptions.find(option => option.id === nextId);
      const next = { ...stored, workspaceId: nextId, accountId: workspace?.accountId ?? stored.accountId ?? "", marketplace: workspace?.marketplace ?? stored.marketplace ?? "" };
      localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify(next));
      document.cookie = `amazon_bulk_ad_workspace_scope=${encodeURIComponent(JSON.stringify(next))}; Path=/; Max-Age=31536000; SameSite=Lax`;
      emitWorkspaceScopeChanged({ workspaceId: nextId, accountId: next.accountId, marketplace: next.marketplace, source: "manual" });
    } catch { /* The WMS request header remains the authoritative page scope. */ }
  }

  const load = useCallback(async (target: Kind, next?: string | null) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ limit: "30" });
      for (const [key, value] of Object.entries(appliedFilters)) if (value.trim()) query.set(key, value.trim());
      if (next) query.set("cursor", next);
      const response = await wmsFetch(`/api/operations/wms/${target}?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取失败。");
      if (sequence !== loadSequence.current) return;
      const rows: Item[] = data.items ?? [];
      setLoadedKind(target); setItems(rows); setNextCursor(data.nextCursor ?? null); setCursor(next ?? null);
      if (target === "receipts") {
        const receiptId = new URLSearchParams(window.location.search).get("receiptId");
        setSelectedReceipt(receiptId ? rows.find(item => item.id === receiptId) ?? null : null);
      }
      if (target === "outbounds") setSelectedOutbound(current => current && !rows.some(item => item.id === current.id) ? null : current);
    } catch (cause) { if (sequence === loadSequence.current) { setError(cause instanceof Error ? cause.message : "读取失败。"); setItems([]); setSelectedReceipt(null); setSelectedOutbound(null); } }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [appliedFilters, wmsFetch]);

  useEffect(() => {
    const sequence = loadSequence;
    setItems([]); setCursorHistory([]); setCursor(null); setNextCursor(null); setEditingReceipt(null); setStockJob(null); setFreezeLocation(null); setSelectedReservation(null); setSelectedReceipt(null); setSelectedOutbound(null); setActionReceipt(null); setCreateOpen(false); void load(kind);
    return () => { sequence.current++; };
  }, [kind, load]);

  useEffect(() => {
    const resources = [...new Set((filterFields[kind] ?? []).map(([key]) => filterResources[key]).filter((resource): resource is string => Boolean(resource)))];
    if (!resources.length) return;
    let cancelled = false;
    void Promise.all(resources.map(async resource => {
      const response = await wmsFetch(`/api/operations/wms/${resource}?limit=100`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取筛选选项失败。");
      return [resource, data.items as Item[], Boolean(data.nextCursor)] as const;
    })).then(rows => {
      if (cancelled) return;
      setFilterOptions(current => ({ ...current, ...Object.fromEntries(rows.map(([resource, items]) => [resource, items])) }));
      setFilterOptionsHaveMore(current => ({ ...current, ...Object.fromEntries(rows.map(([resource, , hasMore]) => [resource, hasMore])) }));
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "读取筛选选项失败。");
    });
    return () => { cancelled = true; };
  }, [kind, wmsFetch]);

  async function createWarehouse(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const response = await wmsFetch("/api/operations/wms/warehouses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "仓库创建失败。");
      setForm({ code: "", name: "" }); setCreateOpen(false); setNotice("仓库已创建。"); await load("warehouses");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "仓库创建失败。"); }
  }

  async function createReceipt(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const response = await wmsFetch("/api/operations/wms/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: receiptForm.number, receivingLocationId: receiptForm.receivingLocationId, sourceReference: receiptForm.sourceReference || undefined, lines: receiptForm.lines.map(line => ({ lotId: line.lotId, expectedQty: Number(line.expectedQty) })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "收货单创建失败。");
      setReceiptForm({ number: "", receivingLocationId: "", sourceReference: "", lines: [{ lotId: "", expectedQty: "" }] }); setCreateOpen(false); setNotice("收货单已创建。"); await load("receipts");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "收货单创建失败。"); }
  }

  async function createCatalogResource(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    const body = kind === "areas" ? { warehouseId: catalogForm.warehouseId, code: catalogForm.code, name: catalogForm.name }
      : kind === "locations" ? { areaId: catalogForm.areaId, code: catalogForm.code, kind: catalogForm.kind }
        : { productRecordId: catalogForm.productRecordId, lotCode: catalogForm.lotCode, barcode: catalogForm.barcode || undefined };
    try {
      const response = await wmsFetch(`/api/operations/wms/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建失败。");
      setCatalogForm({ warehouseId: "", areaId: "", code: "", name: "", kind: "RECEIVING", productRecordId: "", lotCode: "", barcode: "" });
      setCreateOpen(false); setNotice("记录已创建。"); await load(kind);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败。"); }
  }

  async function saveOutbound(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const lines = outboundForm.lines.map(line => ({ productRecordId: line.productRecordId, requestedQty: Number(line.requestedQty) }));
      const body = { ...outboundForm, lines };
      const editBody = { action: "EDIT", id: editingOutbound?.id, revision: editingOutbound?.revision, customer: outboundForm.customer, deliveryAddress: outboundForm.deliveryAddress, carrier: outboundForm.carrier, trackingNumber: outboundForm.trackingNumber, remark: outboundForm.remark, lines };
      const response = await wmsFetch("/api/operations/wms/outbounds", { method: editingOutbound ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingOutbound ? editBody : body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (editingOutbound ? "出库需求保存失败。" : "出库需求创建失败。"));
      setOutboundForm({ number: "", warehouseId: "", customer: "", deliveryAddress: "", carrier: "", trackingNumber: "", remark: "", lines: [{ productRecordId: "", requestedQty: "" }] });
      setCreateOpen(false); setNotice(editingOutbound ? "出库需求草稿已保存。" : "出库需求草稿已创建，库存未发生变化。"); setEditingOutbound(null); await load("outbounds");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "出库需求保存失败。"); }
  }

  function editOutbound(item: Item) {
    setEditingOutbound(item);
    setOutboundForm({ number: String(item.number ?? ""), warehouseId: String(item.warehouseId ?? ""), customer: String(item.customer ?? ""), deliveryAddress: String(item.deliveryAddress ?? ""), carrier: String(item.carrier ?? ""), trackingNumber: String(item.trackingNumber ?? ""), remark: String(item.remark ?? ""), lines: (Array.isArray(item.lines) ? item.lines : []).map((line: Item) => ({ productRecordId: String(line.productRecordId ?? ""), requestedQty: String(line.requestedQty ?? "") })) });
    setCreateOpen(true); setError(""); setNotice("");
  }

  async function cancelOutboundDraft(item: Item) {
    if (!window.confirm(`确认取消出库需求 ${String(item.number ?? "")}？已完成的出库数量会保留。`)) return;
    setError(""); setNotice("");
    try {
      const response = await wmsFetch("/api/operations/wms/outbounds", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CANCEL", id: item.id, revision: item.revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "出库需求取消失败。");
      setNotice(`出库需求 ${String(item.number)} 已取消。`); await load("outbounds", cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "出库需求取消失败。"); }
  }

  async function decideApproval(item: Item, decision: "APPROVE" | "REJECT") {
    setError(""); setNotice("");
    try {
      const response = await wmsFetch("/api/operations/wms/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalId: item.id, revision: item.revision, decision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "审批处理失败。");
      setNotice(decision === "APPROVE" ? "审批已通过。" : "审批已拒绝。"); await load("approvals");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "审批处理失败。"); }
  }

  function openReceiptAction(receipt: Item, action: ReceiptAction) {
    const lines = Array.isArray(receipt.lines) ? receipt.lines as Item[] : [];
    const values: typeof actionValues = {};
    for (const line of lines) {
      const id = String(line.id);
      const remaining = receiptActionRemaining(line, action);
      values[id] = { quantity: String(Math.max(remaining, 0)), acceptedQty: String(Math.max(remaining, 0)), rejectedQty: "0", locationId: "" };
    }
    setActionValues(values); setActionReceipt(receipt); setReceiptAction(action); setError(""); setNotice("");
  }

  async function requestReceiptAction(event: FormEvent) {
    event.preventDefault();
    if (!actionReceipt || receiptSubmitLock.current) return;
    setError(""); setNotice("");
    receiptSubmitLock.current = true; setReceiptSubmitting(true);
    try {
      const lines = Array.isArray(actionReceipt.lines) ? actionReceipt.lines as Item[] : [];
      const payload = receiptActionPayload(lines, receiptAction, actionValues);
      const request = { aggregateId: actionReceipt.id, expectedRevision: actionReceipt.revision, payload };
      const fingerprint = JSON.stringify({ workspaceId, ...request });
      if (receiptRequest.current?.fingerprint !== fingerprint) {
        receiptRequest.current = { fingerprint, body: JSON.stringify({ ...request, idempotencyKey: crypto.randomUUID() }) };
      }
      const response = await wmsFetch("/api/operations/wms/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: receiptRequest.current.body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "审批申请创建失败。");
      receiptRequest.current = null;
      setActionReceipt(null); setNotice(`${receiptActionLabels[receiptAction]}申请已提交审批。`); changeTab("approvals");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "审批申请创建失败。"); }
    finally { receiptSubmitLock.current = false; setReceiptSubmitting(false); }
  }

  async function executeApproval(item: Item) {
    if (!item.canExecute || !item.command || typeof item.command !== "object") return;
    setError(""); setNotice("");
    try {
      const response = await wmsFetch("/api/operations/wms/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(item.command as Item), approvalId: item.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "库存动作执行失败。");
      setNotice("库存动作已执行，请到对应单据或库存余额查看最新结果。"); await load("approvals");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "库存动作执行失败。"); }
  }

  async function cancelDraft(receipt: Item) {
    if (!window.confirm(`确认取消收货草稿 ${String(receipt.number ?? "")}？`)) return;
    setError(""); setNotice("");
    try {
      const response = await wmsFetch("/api/operations/wms/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          aggregateId: receipt.id,
          expectedRevision: receipt.revision,
          idempotencyKey: crypto.randomUUID(),
          payload: { action: "CANCEL" },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "草稿取消失败。");
      setNotice(`收货草稿 ${String(receipt.number ?? "")} 已取消。`);
      await load("receipts", cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "草稿取消失败。"); }
  }

  async function toggleCatalogEnabled(resourceKind: "warehouses" | "areas" | "locations", item: Item) {
    setError(""); setNotice("");
    try {
      const response = await wmsFetch(`/api/operations/wms/${resourceKind}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, revision: item.revision, enabled: item.enabled !== true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "状态更新失败。");
      setNotice(`${resourceKind === "warehouses" ? "仓库" : resourceKind === "areas" ? "区域" : "库位"}已${data.item.enabled ? "启用" : "停用"}。`);
      await load(resourceKind);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "状态更新失败。"); }
  }

  return <div className="space-y-5">
    {standaloneScopePicker && <label className="grid max-w-xs gap-1 text-sm">仓库工作区<select title="选择工作区" aria-label="仓库工作区" value={workspaceId} onChange={event => changeWorkspace(event.target.value)} className="h-9 rounded border border-input bg-background px-3">{workspaceOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}{!workspaceOptions.some(option => option.id === workspaceId) && <option value={workspaceId}>{workspaceId}</option>}</select></label>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div><h2 className="text-lg font-semibold text-foreground">{kind === "transfers" ? "调拨流水" : kind === "reservations" ? "预占与出库" : kind === "outbounds" ? "出库需求" : "公司仓库"}</h2><p className="mt-1 text-sm text-muted-foreground">{kind === "transfers" ? "只读已执行调拨；每笔调拨分别保留调出与调入库存流水。新建与审批仍从库存余额操作。" : kind === "reservations" ? "以库存预占单跟踪拣货、出库和释放；所有操作沿用版本校验、审批与库存流水。" : kind === "outbounds" ? "登记多商品出库需求草稿；需求建档不会预占或扣减库存，实际拣货仍从库存预占流程执行。" : "管理企业自有库存、收货与库存审批"}</p></div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void load(kind, cursor)} disabled={loading} aria-label="刷新"><RefreshCw className="mr-2 h-4 w-4" />刷新</Button>
        {createLabels[kind] && <Button size="sm" onClick={() => { if (kind === "outbounds") { setEditingOutbound(null); setOutboundForm({ number: "", warehouseId: "", customer: "", deliveryAddress: "", carrier: "", trackingNumber: "", remark: "", lines: [{ productRecordId: "", requestedQty: "" }] }); } setCreateOpen(!createOpen); }}><Plus className="mr-2 h-4 w-4" />{createLabels[kind]}</Button>}
      </div>
    </div>

    {notice && <div role="status" className="text-sm text-emerald-700">{notice}</div>}
    {error && <div role="alert" className="text-sm text-destructive">{error}</div>}

    {editingReceipt && <WmsReceiptDraftForm key={workspaceId + editingReceipt.id} receipt={editingReceipt} workspaceId={workspaceId} onClose={() => setEditingReceipt(null)} onComplete={() => { setEditingReceipt(null); setNotice("收货草稿已保存，请按新版本申请审批。"); void load("receipts"); }} />}
    {freezeLocation && <WmsLocationFreezeForm key={`${workspaceId}:${freezeLocation.id}:${freezeLocation.revision}`} item={freezeLocation} workspaceId={workspaceId} onClose={() => setFreezeLocation(null)} onComplete={() => { setFreezeLocation(null); setNotice("申请已提交，等待另一名成员审批后执行。"); changeTab("approvals"); }} />}
    {stockJob && <WmsStockActionForm key={`${workspaceId}:${stockJob.item.id}:${stockJob.action}:${stockJob.item.revision}`} item={stockJob.item} action={stockJob.action} workspaceId={workspaceId} onClose={() => setStockJob(null)} onComplete={(message, approvalRequired) => { setStockJob(null); setNotice(message); if (approvalRequired) changeTab("approvals"); else void load(kind); }} />}
    <WorkbenchDialog open={!!selectedReservation} title={`预占单详情 · ${String(selectedReservation?.number ?? "")}`} onClose={() => setSelectedReservation(null)} drawer>
      {selectedReservation && <div className="space-y-5">
        <section className="grid gap-x-6 gap-y-4 sm:grid-cols-2" aria-label="预占单信息">
          <div><p className="text-xs text-muted-foreground">预占单号</p><p className="mt-1 font-medium">{display(selectedReservation.number)}</p></div>
          <div><p className="text-xs text-muted-foreground">作业状态</p><div className="mt-1"><Badge tone={reservationStatusTone(selectedReservation.workflowStatus)}>{reservationStatusLabel(selectedReservation.workflowStatus)}</Badge></div></div>
          <div><p className="text-xs text-muted-foreground">创建时间</p><p className="mt-1">{display(selectedReservation.createdAt)}</p></div>
          <div><p className="text-xs text-muted-foreground">版本</p><p className="mt-1">{display(selectedReservation.revision)}</p></div>
          <div><p className="text-xs text-muted-foreground">预占单 ID</p><p className="mt-1 break-all font-mono text-xs">{display(selectedReservation.id)}</p></div>
          <div><p className="text-xs text-muted-foreground">库存余额 ID</p><p className="mt-1 break-all font-mono text-xs">{display(selectedReservation.balanceId)}</p></div>
        </section>
        <section><h3 className="mb-2 border-b border-border pb-2 text-sm font-semibold">数量进度</h3><dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{([["requestedQty", "预占数量"], ["pickedQty", "已拣数量"], ["unpickedQty", "待拣数量"], ["dispatchedQty", "已出库数量"], ["releasedQty", "已释放数量"], ["remainingQty", "剩余预占"]] as const).map(([key, label]) => <div key={key} className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{display(selectedReservation[key])}</dd></div>)}</dl></section>
        <section><h3 className="mb-2 border-b border-border pb-2 text-sm font-semibold">库存位置</h3><WmsReservationStock stock={selectedReservation.stock as ReservationStockContext | null} /></section>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => { setSelectedReservation(null); setStockJob({ item: selectedReservation, action: "PICK" }); }} disabled={!stockActionLimit(selectedReservation, "PICK")}>拣货</Button><Button size="sm" variant="secondary" onClick={() => { setSelectedReservation(null); setStockJob({ item: selectedReservation, action: "DISPATCH" }); }} disabled={!stockActionLimit(selectedReservation, "DISPATCH")}>出库</Button><Button size="sm" variant="secondary" onClick={() => { setSelectedReservation(null); setStockJob({ item: selectedReservation, action: "RELEASE" }); }} disabled={!stockActionLimit(selectedReservation, "RELEASE")}>释放预占</Button><Button size="sm" variant="ghost" onClick={() => { setSelectedReservation(null); openRelated("movements", "sourceId", String(selectedReservation.id)); }}>查看库存流水</Button><Button size="sm" variant="ghost" onClick={() => { setSelectedReservation(null); openRelated("approvals", "aggregateId", String(selectedReservation.id)); }}>查看审批</Button></div>
      </div>}
    </WorkbenchDialog>
    {/* Adapted from Wimoor src/views/erp/warehouse/inbound/components/details.vue.
        Copyright (c) 2022 深圳市万墨信息科技有限公司. MIT: public/licenses/wimoor-MIT.txt. */}
    <WorkbenchDialog open={!!selectedReceipt} title={`收货单详情 · ${String(selectedReceipt?.number ?? "")}`} onClose={() => setSelectedReceipt(null)} drawer>
      {selectedReceipt && <div className="space-y-5">
        <section className="grid gap-x-6 gap-y-4 sm:grid-cols-2" aria-label="收货单信息">
          <div><p className="text-xs text-muted-foreground">单据编码</p><p className="mt-1 font-medium">{display(selectedReceipt.number)}</p></div>
          <div><p className="text-xs text-muted-foreground">入库仓库</p><p className="mt-1">{display((selectedReceipt.receivingLocation as Item | null)?.warehouseName)}</p></div>
          <div><p className="text-xs text-muted-foreground">收货库位</p><p className="mt-1">{display((selectedReceipt.receivingLocation as Item | null)?.locationCode)}</p></div>
          <div><p className="text-xs text-muted-foreground">当前状态</p><p className="mt-1">{display(selectedReceipt.status)}</p></div>
          <div><p className="text-xs text-muted-foreground">来源单号</p><p className="mt-1 break-all">{display(selectedReceipt.sourceReference)}</p></div>
          <div><p className="text-xs text-muted-foreground">入库时间</p><p className="mt-1">{display(selectedReceipt.createdAt)}</p></div>
          <div><p className="text-xs text-muted-foreground">收货单 ID</p><p className="mt-1 break-all font-mono text-xs">{display(selectedReceipt.id)}</p></div>
          <div><p className="text-xs text-muted-foreground">版本</p><p className="mt-1">{display(selectedReceipt.revision)}</p></div>
        </section>
        <section aria-label="入库商品"><h3 className="mb-2 border-b border-border pb-2 text-sm font-semibold">入库商品与数量进度</h3><WmsReceiptDetails receipt={selectedReceipt} /></section>
        <p className="text-xs text-muted-foreground">数量与批次来自当前 ERP WMS 收货记录；未提供的备注、商品图片和可用库存不在此处推算。收货、质检和上架仍按仓库审批流程处理。</p>
        <div className="flex flex-wrap gap-2">{typeof selectedReceipt.sourceReference === "string" && selectedReceipt.sourceReference && <a className="self-center text-sm text-brand hover:underline" href={`/operations?view=purchase-orders&receiptId=${encodeURIComponent(String(selectedReceipt.id))}`}>查询关联采购单</a>}</div>
      </div>}
    </WorkbenchDialog>
    <WorkbenchDialog open={!!selectedOutbound} title={`出库需求详情 · ${String(selectedOutbound?.number ?? "")}`} onClose={() => setSelectedOutbound(null)} drawer>
      {selectedOutbound && <div className="space-y-5">
        <section className="grid gap-x-6 gap-y-4 sm:grid-cols-2" aria-label="出库需求信息">
          <div><p className="text-xs text-muted-foreground">单据编码</p><p className="mt-1 font-medium">{display(selectedOutbound.number)}</p></div>
          <div><p className="text-xs text-muted-foreground">仓库</p><p className="mt-1">{display((selectedOutbound.warehouse as Item | null)?.name)} · {display((selectedOutbound.warehouse as Item | null)?.code)}</p></div>
          <div><p className="text-xs text-muted-foreground">收货方</p><p className="mt-1">{display(selectedOutbound.customer)}</p></div>
          <div><p className="text-xs text-muted-foreground">状态</p><p className="mt-1">{selectedOutbound.status === "DRAFT" ? "草稿（未影响库存）" : display(selectedOutbound.status)}</p></div>
          <div><p className="text-xs text-muted-foreground">收货地址</p><p className="mt-1 break-words">{display(selectedOutbound.deliveryAddress)}</p></div>
          <div><p className="text-xs text-muted-foreground">承运商 / 物流单号</p><p className="mt-1 break-all">{display(selectedOutbound.carrier)} / {display(selectedOutbound.trackingNumber)}</p></div>
          <div><p className="text-xs text-muted-foreground">备注</p><p className="mt-1 break-words">{display(selectedOutbound.remark)}</p></div>
          <div><p className="text-xs text-muted-foreground">创建时间 / 版本</p><p className="mt-1">{display(selectedOutbound.createdAt)} / {display(selectedOutbound.revision)}</p></div>
        </section>
        <section aria-label="出库需求商品"><h3 className="mb-2 border-b border-border pb-2 text-sm font-semibold">出库需求商品与履约进度</h3>
          <div className="overflow-auto"><table aria-label="出库需求明细" className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2">SKU</th><th>商品主档 ID</th><th>需求数量</th><th>已分配</th><th>已出库</th></tr></thead><tbody>{(Array.isArray(selectedOutbound.lines) ? selectedOutbound.lines as Item[] : []).map((line, index) => <tr key={String(line.id ?? index)} className="border-b border-border"><td className="py-2">{display((line.product as Item | undefined)?.sku)}</td><td className="break-all">{display(line.productRecordId)}</td><td>{display(line.requestedQty)}</td><td>{display(line.allocatedQty)}</td><td>{display(line.dispatchedQty)}</td></tr>)}</tbody></table></div>
        </section>
        <p className="text-xs text-muted-foreground">出库需求只保存业务要求；预占、拣货和实际出库须通过库存作业完成。这里展示服务端返回的分配与出库数量，不推算可用库存。</p>
      </div>}
    </WorkbenchDialog>
    {createOpen && kind === "warehouses" && <form onSubmit={createWarehouse} className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <label className="grid gap-1 text-sm">仓库编码<input required maxLength={64} value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} className="h-9 w-48 rounded border border-input bg-background px-3" /></label>
      <label className="grid gap-1 text-sm">仓库名称<input required maxLength={120} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="h-9 w-64 rounded border border-input bg-background px-3" /></label>
      <Button type="submit" size="sm">创建</Button><Button type="button" variant="ghost" size="icon" onClick={() => setCreateOpen(false)} aria-label="关闭"><X className="h-4 w-4" /></Button>
    </form>}
    {createOpen && kind === "areas" && <form onSubmit={createCatalogResource} className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <WmsOptionsStatus label="仓库" options={warehouseOptions} />
      <label className="grid gap-1 text-sm">所属仓库<select aria-label="所属仓库" required value={catalogForm.warehouseId} onChange={event => setCatalogForm({ ...catalogForm, warehouseId: event.target.value })} className="h-9 w-56 rounded border border-input bg-background px-3"><option value="">选择仓库</option>{warehouses.map(item => <option key={String(item.id)} value={String(item.id)}>{String(item.code)} · {String(item.name)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">区域编码<input required maxLength={64} value={catalogForm.code} onChange={event => setCatalogForm({ ...catalogForm, code: event.target.value })} className="h-9 w-40 rounded border border-input bg-background px-3" /></label>
      <label className="grid gap-1 text-sm">区域名称<input required maxLength={120} value={catalogForm.name} onChange={event => setCatalogForm({ ...catalogForm, name: event.target.value })} className="h-9 w-56 rounded border border-input bg-background px-3" /></label>
      <Button type="submit" size="sm" disabled={!warehouses.length}>创建</Button><Button type="button" variant="ghost" size="icon" onClick={() => setCreateOpen(false)} aria-label="关闭"><X className="h-4 w-4" /></Button>
    </form>}
    {createOpen && kind === "locations" && <form onSubmit={createCatalogResource} className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <WmsOptionsStatus label="区域" options={areaOptions} />
      <label className="grid gap-1 text-sm">所属区域<select aria-label="所属区域" required value={catalogForm.areaId} onChange={event => setCatalogForm({ ...catalogForm, areaId: event.target.value })} className="h-9 w-64 rounded border border-input bg-background px-3"><option value="">选择区域</option>{areas.map(item => <option key={String(item.id)} value={String(item.id)}>{String(item.code)} · {String(item.name)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">库位编码<input required maxLength={64} value={catalogForm.code} onChange={event => setCatalogForm({ ...catalogForm, code: event.target.value })} className="h-9 w-40 rounded border border-input bg-background px-3" /></label>
      <label className="grid gap-1 text-sm">类型<select aria-label="类型" value={catalogForm.kind} onChange={event => setCatalogForm({ ...catalogForm, kind: event.target.value })} className="h-9 w-40 rounded border border-input bg-background px-3"><option value="RECEIVING">收货</option><option value="STORAGE">存储</option></select></label>
      <Button type="submit" size="sm" disabled={!areas.length}>创建</Button><Button type="button" variant="ghost" size="icon" onClick={() => setCreateOpen(false)} aria-label="关闭"><X className="h-4 w-4" /></Button>
    </form>}
    {createOpen && kind === "lots" && <form aria-label="创建商品批次" onSubmit={createCatalogResource} className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <WmsProductPicker key={workspaceId} workspaceId={workspaceId} selectedId={catalogForm.productRecordId} onSelect={productRecordId => setCatalogForm(current => ({ ...current, productRecordId }))} />
      <label className="grid gap-1 text-sm">商品主档 ID<input required maxLength={100} value={catalogForm.productRecordId} onChange={event => setCatalogForm({ ...catalogForm, productRecordId: event.target.value })} className="h-9 w-64 rounded border border-input bg-background px-3" /></label>
      <label className="grid gap-1 text-sm">批次编码<input required maxLength={100} value={catalogForm.lotCode} onChange={event => setCatalogForm({ ...catalogForm, lotCode: event.target.value })} className="h-9 w-40 rounded border border-input bg-background px-3" /></label>
      <label className="grid gap-1 text-sm">条码<input maxLength={120} value={catalogForm.barcode} onChange={event => setCatalogForm({ ...catalogForm, barcode: event.target.value })} className="h-9 w-40 rounded border border-input bg-background px-3" /></label>
      <Button type="submit" size="sm">创建批次</Button><Button type="button" variant="ghost" size="icon" onClick={() => setCreateOpen(false)} aria-label="关闭"><X className="h-4 w-4" /></Button>
    </form>}
    {createOpen && kind === "receipts" && <form onSubmit={createReceipt} className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <WmsOptionsStatus label="收货库位" options={receivingOptions} /><WmsOptionsStatus label="商品批次" options={lotOptions} />
      <label className="grid gap-1 text-sm">收货单号<input required maxLength={120} value={receiptForm.number} onChange={event => setReceiptForm({ ...receiptForm, number: event.target.value })} className="h-9 w-44 rounded border border-input bg-background px-3" /></label>
      <label className="grid gap-1 text-sm">收货库位<select required value={receiptForm.receivingLocationId} onChange={event => setReceiptForm({ ...receiptForm, receivingLocationId: event.target.value })} className="h-9 w-56 rounded border border-input bg-background px-3"><option value="">选择库位</option>{locations.map(item => <option key={String(item.id)} value={String(item.id)}>{String(item.code)} · {String(item.warehouseId)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">来源单号<input maxLength={120} value={receiptForm.sourceReference} onChange={event => setReceiptForm({ ...receiptForm, sourceReference: event.target.value })} className="h-9 w-44 rounded border border-input bg-background px-3" /></label>
      <Button type="submit" size="sm" disabled={!locations.length || !lots.length}>创建收货单</Button><Button type="button" variant="ghost" size="icon" onClick={() => setCreateOpen(false)} aria-label="关闭"><X className="h-4 w-4" /></Button>
      <div className="basis-full space-y-2">
        {receiptForm.lines.map((line, index) => <div key={index} className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">商品批次<select required value={line.lotId} onChange={event => setReceiptForm(current => ({ ...current, lines: current.lines.map((item, row) => row === index ? { ...item, lotId: event.target.value } : item) }))} className="h-9 w-56 rounded border border-input bg-background px-3"><option value="">选择批次</option>{lots.map(item => <option key={String(item.id)} value={String(item.id)}>{String(item.lotCode)} · {String(item.productRecordId)}</option>)}</select></label>
          <label className="grid gap-1 text-sm">计划数量<input required type="number" min="1" step="1" value={line.expectedQty} onChange={event => setReceiptForm(current => ({ ...current, lines: current.lines.map((item, row) => row === index ? { ...item, expectedQty: event.target.value } : item) }))} className="h-9 w-28 rounded border border-input bg-background px-3" /></label>
          {receiptForm.lines.length > 1 && <Button type="button" size="icon" variant="ghost" onClick={() => setReceiptForm(current => ({ ...current, lines: current.lines.filter((_, row) => row !== index) }))} aria-label="移除此明细"><X className="h-4 w-4" /></Button>}
        </div>)}
        <Button type="button" size="sm" variant="ghost" disabled={receiptForm.lines.length >= 100} onClick={() => setReceiptForm(current => ({ ...current, lines: [...current.lines, { lotId: "", expectedQty: "" }] }))}><Plus className="mr-2 h-4 w-4" />添加商品明细</Button>
      </div>
    </form>}
    {createOpen && kind === "outbounds" && <form aria-label={editingOutbound ? "编辑出库需求草稿" : "创建出库需求"} onSubmit={saveOutbound} className="space-y-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-end gap-3">
        <WmsOptionsStatus label="仓库" options={warehouseOptions} />
        <label className="grid gap-1 text-sm">出库需求单号<input required maxLength={120} readOnly={Boolean(editingOutbound)} value={outboundForm.number} onChange={event => setOutboundForm(current => ({ ...current, number: event.target.value }))} className="h-9 w-48 rounded border border-input bg-background px-3 read-only:bg-muted" /></label>
        <label className="grid gap-1 text-sm">仓库<select required disabled={Boolean(editingOutbound)} value={outboundForm.warehouseId} onChange={event => setOutboundForm(current => ({ ...current, warehouseId: event.target.value }))} className="h-9 w-56 rounded border border-input bg-background px-3"><option value="">选择仓库</option>{warehouses.map(item => <option key={String(item.id)} value={String(item.id)}>{String(item.code)} · {String(item.name)}</option>)}</select></label>
        <label className="grid gap-1 text-sm">收货方<input maxLength={200} value={outboundForm.customer} onChange={event => setOutboundForm(current => ({ ...current, customer: event.target.value }))} className="h-9 w-48 rounded border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm">收货地址<input maxLength={500} value={outboundForm.deliveryAddress} onChange={event => setOutboundForm(current => ({ ...current, deliveryAddress: event.target.value }))} className="h-9 w-64 rounded border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm">承运商<input maxLength={120} value={outboundForm.carrier} onChange={event => setOutboundForm(current => ({ ...current, carrier: event.target.value }))} className="h-9 w-40 rounded border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm">物流单号<input maxLength={120} value={outboundForm.trackingNumber} onChange={event => setOutboundForm(current => ({ ...current, trackingNumber: event.target.value }))} className="h-9 w-48 rounded border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm">备注<input maxLength={1000} value={outboundForm.remark} onChange={event => setOutboundForm(current => ({ ...current, remark: event.target.value }))} className="h-9 w-56 rounded border border-input bg-background px-3" /></label>
        <Button type="submit" size="sm" disabled={!warehouses.length || outboundForm.lines.some(line => !line.productRecordId || !line.requestedQty)}>{editingOutbound ? "保存草稿" : "创建草稿"}</Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => { setCreateOpen(false); setEditingOutbound(null); }} aria-label="关闭"><X className="h-4 w-4" /></Button>
      </div>
      <p className="text-xs text-muted-foreground">草稿只记录需求；创建后不改变可用库存，需通过库存预占、拣货与出库作业完成履约。</p>
      <div className="space-y-3">{outboundForm.lines.map((line, index) => <div key={index} className="flex flex-wrap items-end gap-3 rounded border border-border p-3">
        <WmsProductPicker key={`${workspaceId}:${index}`} workspaceId={workspaceId} selectedId={line.productRecordId} onSelect={productRecordId => setOutboundForm(current => ({ ...current, lines: current.lines.map((row, rowIndex) => rowIndex === index ? { ...row, productRecordId } : row) }))} />
        <label className="grid gap-1 text-sm">商品主档 ID<input required maxLength={100} value={line.productRecordId} onChange={event => setOutboundForm(current => ({ ...current, lines: current.lines.map((row, rowIndex) => rowIndex === index ? { ...row, productRecordId: event.target.value } : row) }))} className="h-9 w-64 rounded border border-input bg-background px-3" /></label>
        <label className="grid gap-1 text-sm">需求数量<input required type="number" min="1" step="1" value={line.requestedQty} onChange={event => setOutboundForm(current => ({ ...current, lines: current.lines.map((row, rowIndex) => rowIndex === index ? { ...row, requestedQty: event.target.value } : row) }))} className="h-9 w-28 rounded border border-input bg-background px-3" /></label>
        {outboundForm.lines.length > 1 && <Button type="button" size="icon" variant="ghost" onClick={() => setOutboundForm(current => ({ ...current, lines: current.lines.filter((_, rowIndex) => rowIndex !== index) }))} aria-label="移除此明细"><X className="h-4 w-4" /></Button>}
      </div>)}
      <Button type="button" size="sm" variant="ghost" disabled={outboundForm.lines.length >= 100} onClick={() => setOutboundForm(current => ({ ...current, lines: [...current.lines, { productRecordId: "", requestedQty: "" }] }))}><Plus className="mr-2 h-4 w-4" />添加商品明细</Button></div>
    </form>}
    {actionReceipt && <form aria-label={`${receiptActionLabels[receiptAction]}作业`} onSubmit={requestReceiptAction} className="space-y-3 border-b border-border pb-4">
      <fieldset disabled={receiptSubmitting} className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong className="text-sm">{display(actionReceipt.number)}</strong><div className="flex gap-1" role="group" aria-label="收货动作">{(Object.keys(receiptActionLabels) as ReceiptAction[]).filter(action => action !== "RETURN_REJECTED" || (actionReceipt.lines as Item[]).some(line => receiptActionRemaining(line, action) > 0)).map(action => <Button key={action} type="button" size="sm" variant={receiptAction === action ? "secondary" : "ghost"} onClick={() => openReceiptAction(actionReceipt, action)}>{receiptActionLabels[action]}</Button>)}</div></div><Button type="button" size="icon" variant="ghost" onClick={() => setActionReceipt(null)} aria-label="关闭"><X className="h-4 w-4" /></Button></div>
      {receiptAction === "RECEIVE" && <p className="text-xs text-muted">可按实际到货逐批录入；未到货行填 0 会记录短收差异，后续可从采购单创建补收。至少一行实收须大于 0。</p>}
      {receiptAction === "RETURN_REJECTED" && <p className="text-xs text-muted">提交后须经另一名成员审批；确认退回后同步扣减该收货库位的拒收实物和拒收余额。</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2">批次</th><th>计划</th><th>已收</th><th>{receiptAction === "INSPECT" ? "合格" : receiptAction === "PUTAWAY" ? "上架数量" : receiptAction === "RETURN_REJECTED" ? "退回数量" : "实收数量"}</th>{receiptAction === "INSPECT" && <th>拒收</th>}{receiptAction === "PUTAWAY" && <th>目标库位</th>}</tr></thead><tbody>{(Array.isArray(actionReceipt.lines) ? actionReceipt.lines as Item[] : []).map(line => { const id = String(line.id); const value = actionValues[id] ?? { quantity: "0", acceptedQty: "0", rejectedQty: "0", locationId: "" }; return <tr key={id} className="border-b"><td className="py-2"><WmsReceiptLot lotId={String(line.lotId)} lot={line.lot as ReceiptLotContext | null} /></td><td>{display(line.expectedQty)}</td><td>{display(line.receivedQty)}</td><td><input aria-label={`${display(line.lotId)} 数量`} type="number" min="0" step="1" value={receiptAction === "INSPECT" ? value.acceptedQty : value.quantity} onChange={event => setActionValues(current => ({ ...current, [id]: { ...value, ...(receiptAction === "INSPECT" ? { acceptedQty: event.target.value } : { quantity: event.target.value }) } }))} className="h-8 w-24 rounded border border-input bg-background px-2" /></td>{receiptAction === "INSPECT" && <td><input aria-label={`${display(line.lotId)} 拒收数量`} type="number" min="0" step="1" value={value.rejectedQty} onChange={event => setActionValues(current => ({ ...current, [id]: { ...value, rejectedQty: event.target.value } }))} className="h-8 w-24 rounded border border-input bg-background px-2" /></td>}{receiptAction === "PUTAWAY" && <td><select required={Number(value.quantity) > 0} disabled={Number(value.quantity) === 0} value={value.locationId} onChange={event => setActionValues(current => ({ ...current, [id]: { ...value, locationId: event.target.value } }))} className="h-8 min-w-48 rounded border border-input bg-background px-2"><option value="">选择上架库位</option>{storageLocations.map(location => <option key={String(location.id)} value={String(location.id)}>{String(location.code)}</option>)}</select></td>}</tr>; })}</tbody></table></div>
      {receiptAction === "PUTAWAY" && <WmsOptionsStatus label="上架库位" options={storageOptions} />}
      <div className="flex justify-end"><Button size="sm" type="submit">{receiptSubmitting ? "提交中…" : "提交审批申请"}</Button></div></fieldset>
    </form>}

    <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="仓库数据类型">
      {tabs.map(tab => <button key={tab.id} role="tab" aria-selected={kind === tab.id} onClick={() => changeTab(tab.id)} className={`shrink-0 border-b-2 px-3 py-2 text-sm ${kind === tab.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>)}
    </div>

    {kind === "stocktakes" && <WmsStocktakePanel key={workspaceId + (stocktakeId ?? "")} workspaceId={workspaceId} stocktakeId={stocktakeId} onChanged={() => void load(kind, null)} />}
    {kind==="stock-aging"&&<><WmsAgingSnapshots workspaceId={workspaceId}/><WmsInventoryRisk workspaceId={workspaceId}/></>}
    {kind==="stock-aging"&&<p className="text-sm text-muted">按仓库商品的历史库存减去后续净出库估算周转区间（0–30、30–60、60–90、90–180、180–365、365 天以上）；原始流水不足时显示缺数据。</p>}
    {kind === "overseas-transfers" && <WmsOverseasPanel key={workspaceId} workspaceId={workspaceId} items={loadedKind===kind?items:[]} onSaved={()=>void load(kind)}/> }
    {(kind === "cost-rules" || kind === "finance-drafts") && <WmsValuationPanel key={workspaceId+kind} workspaceId={workspaceId} kind={kind} items={loadedKind===kind?items:[]} onSaved={()=>void load(kind)}/> }
    {kind === "transfer-orders" && <div role="tablist" aria-label="调拨状态" className="flex flex-wrap gap-2">{[["", "全部"], ...Object.entries(transferStatusLabels)].map(([status, label]) => <button key={status} role="tab" aria-selected={(appliedFilters.status ?? "") === status} className={`rounded border px-3 py-2 text-sm ${(appliedFilters.status ?? "") === status ? "border-brand text-brand" : "border-border text-muted"}`} onClick={() => { const next = { ...filters, status }; setFilters(next); setAppliedFilters(next); setCursorHistory([]); setCursor(null); }}>{label}</button>)}</div>}
    {filterFields[kind] && <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setAppliedFilters({ ...filters }); if (kind === "receipts") { const url = new URL(window.location.href); for (const key of ["receiptId", "sourceReference", "workflowStatus"]) url.searchParams.delete(key); if (filters.id) url.searchParams.set("receiptId", filters.id); if (filters.sourceReference) url.searchParams.set("sourceReference", filters.sourceReference); if (filters.workflowStatus) url.searchParams.set("workflowStatus", filters.workflowStatus); window.history.replaceState(null, "", url); } }}>
      {filterFields[kind]!.map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}
        {key === "status" || key === "workflowStatus" ? <select aria-label={label} value={filters[key] ?? ""} onChange={event => { const value = event.target.value; const next = { ...filters, [key]: value }; setFilters(next); setAppliedFilters(next); setCursorHistory([]); setCursor(null); }} className="h-9 min-w-40 rounded border border-input bg-background px-3"><option value="">全部</option>{(kind === "transfer-orders" ? Object.entries(transferStatusLabels) : kind === "outbounds" ? [["DRAFT", "草稿"], ["RELEASED", "已释放"], ["COMPLETED", "已完成"], ["CANCELLED", "已取消"]] : kind === "reservations" ? [["ACTIVE", "未结束"], ["AWAITING_PICK", "待拣货"], ["PARTIALLY_PICKED", "部分已拣"], ["AWAITING_DISPATCH", "待出库"], ["CLOSED", "已结束"]] : kind === "approvals" && key === "workflowStatus" ? [["TO_REVIEW", "待我审批"], ["TO_EXECUTE", "本人已批待执行"], ["MY_REQUESTS", "我的申请"], ["EXPIRED", "已过期"]] : kind === "receipts" && key === "workflowStatus" ? [["PENDING_QC", "待质检"], ["PENDING_PUTAWAY", "待上架"], ["HAS_REJECTED", "存在拒收"], ["SHORT_RECEIVED", "存在短收"]] : kind === "receipts" ? [["DRAFT", "草稿"], ["RECEIVED", "已收货"], ["INSPECTED", "已质检"], ["PUTAWAY", "已上架"], ["CANCELLED", "已取消"]] : [["PENDING", "待审批"], ["APPROVED", "已通过"], ["REJECTED", "已拒绝"], ["CONSUMED", "已执行"]]).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select> : filterResources[key] && !filterOptionsHaveMore[filterResources[key]] ? <select aria-label={label} value={filters[key] ?? ""} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))} className="h-9 min-w-48 rounded border border-input bg-background px-3"><option value="">全部</option>{(filterOptions[filterResources[key]] ?? []).map(option => <option key={String(option.id)} value={String(option.id)}>{key === "warehouseId" ? `${String(option.code)} · ${String(option.name)}` : key === "areaId" ? `${String(option.code)} · ${String(option.name)}` : key === "locationId" ? `${String(option.code)} · ${String(option.warehouseId)}` : key === "lotId" ? `${String(option.lotCode)} · ${String(option.productRecordId)}` : `${String(option.id)} · ${String(option.locationId)}`}</option>)}</select> : <input aria-label={label} value={filters[key] ?? ""} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))} placeholder={`输入${label}`} className="h-9 w-48 rounded border border-input bg-background px-3" />}
      </label>)}
      <Button type="submit" size="sm" variant="secondary">筛选</Button>
      <Button type="button" size="sm" variant="ghost" disabled={!filterFields[kind]!.some(([key]) => filters[key] || appliedFilters[key])} onClick={() => { if (kind === "receipts") { const url = new URL(window.location.href); for (const key of ["receiptId", "sourceReference", "workflowStatus"]) url.searchParams.delete(key); window.history.replaceState(null, "", url); } const next = { ...filters }; for (const [key] of filterFields[kind]!) delete next[key]; setFilters(next); setAppliedFilters(next); setCursorHistory([]); setCursor(null); }}>清除</Button>
    </form>}

    {kind === "approvals" && <p className="text-sm text-muted-foreground">待办按本人权限、审批状态和有效期筛选。批准与执行时仍会核验相关成员权限、单据版本和库存。</p>}
    {kind === "receipts" && <p className="text-sm text-muted-foreground">按明细剩余数量筛选作业；部分质检的单据可同时待质检、待上架。拒收与短收仅统计已收货单据，草稿和已取消单据不计入。</p>}
    {kind === "transfers" && <p className="text-sm text-muted-foreground">同一调拨命令在一个事务内生成调出与调入两条流水。库位筛选仅显示该库位的流水，可查看成对流水追溯双方。</p>}
    {kind === "reconciliation" && <p className="text-sm text-muted-foreground">逐页核对余额与全部已入账流水的数量合计。结果只覆盖当前页；发现差异后需人工核查，不自动调整库存。</p>}
    <WorkbenchDialog open={!!profile} busy={profileBusy} title="仓储资料" onClose={()=>setProfile(null)}>{profile&&<WmsCatalogProfile key={`${profile.kind}:${String(profile.item.id)}`} {...profile} workspaceId={workspaceId} onBusy={setProfileBusy} onSaved={()=>{setProfile(null);void load(kind);}}/>}</WorkbenchDialog>
    {kind==="transfer-orders"&&<WmsTransferOrders key={workspaceId} workspaceId={workspaceId} items={loadedKind===kind?items:[]} disabled={loading} onSaved={()=>void load(kind)} onApprovalRequested={orderId=>orderId?openRelated("approvals","aggregateId",orderId):changeTab("approvals")}/>}
    {kind==="consumables"&&<WmsConsumables key={workspaceId} items={loadedKind===kind?items:[]} workspaceId={workspaceId} onSaved={()=>void load(kind)} onApprovalRequested={()=>changeTab("approvals")}/>}
    {kind==="conversions"&&<WmsConversions key={workspaceId} items={loadedKind===kind?items:[]} workspaceId={workspaceId} onApprovalRequested={()=>changeTab("approvals")}/>}
    {kind!=="cost-rules"&&kind!=="finance-drafts"&&kind!=="overseas-transfers"&&kind!=="conversions"&&kind!=="consumables"&&kind!=="transfer-orders"&&<div className="overflow-x-auto">
      <table aria-label={kind === "stocktakes" ? "盘点单列表" : undefined} className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead><tr className="border-b border-border text-xs text-muted-foreground">{columns[kind].map(([key, label]) => <th key={key} className="px-3 py-2.5 font-medium">{label}</th>)}{(["stocktakes", "approvals", "receipts", "outbounds", "balances", "reservations", "warehouses", "areas", "locations", "lots", "transfers"].includes(kind)) && <th className="px-3 py-2.5 font-medium">操作</th>}</tr></thead>
        <tbody>{items.map((item, index) => <tr key={String(item.id ?? index)} data-record-id={String(item.id)} className="border-b border-border/70 hover:bg-muted/30">{columns[kind].map(([key]) => <td key={key} data-column={key} className="max-w-[280px] truncate px-3 py-3" title={key === "status" && kind === "approvals" ? approvalStatus(item) : display(item[key])}>{key === "direction" && kind === "transfers" ? (Number(item.deltaOnHand) < 0 ? "调出" : "调入") : key === "frozen" ? (item.frozen ? "已冻结" : "正常") : key === "stock" ? <WmsReservationStock stock={item.stock as ReservationStockContext | null} /> : key === "lines" && kind === "receipts" ? <WmsReceiptDetails receipt={item} /> : key === "warehouse" && kind === "outbounds" ? `${String((item.warehouse as Item | undefined)?.code ?? item.warehouseId)} · ${String((item.warehouse as Item | undefined)?.name ?? "")}` : key === "lines" && kind === "outbounds" ? (Array.isArray(item.lines) ? item.lines.map((line: Item) => `${String((line.product as Item | undefined)?.sku ?? line.productRecordId)} × ${display(line.requestedQty)}（分配 ${display(line.allocatedQty)} / 出库 ${display(line.dispatchedQty)}）`).join("；") : "-") : key === "status" && kind === "outbounds" ? <Badge tone={item.status === "DRAFT" ? "amber" : item.status === "COMPLETED" ? "green" : "gray"}>{item.status === "DRAFT" ? "草稿（未影响库存）" : display(item.status)}</Badge> : key === "command" && item.command ? <WmsApprovalDetails valuation={item.valuation} conversionReversal={item.conversionReversal as Parameters<typeof WmsApprovalDetails>[0]["conversionReversal"]} consumable={item.consumable as import("@/lib/wms/consumable-view").ConsumableContext|null} conversionTarget={item.conversionTarget as {lotCode:string;sku:string;productRecordId:string}|null} transferOrder={item.transferOrder as ApprovalTransferContext | null} stocktake={item.stocktake as ApprovalStocktakeContext | null} reservation={item.reservation as ApprovalReservationContext | null} receipt={item.receipt as ApprovalReceiptContext | null} command={item.command as WmsCommandInput} stock={item.stock as ReservationStockContext | null} targetLocation={item.targetLocation as WmsLocationContext | null} /> : key === "status" && kind === "approvals" ? approvalStatus(item) : key === "workflowStatus" && kind === "reservations" ? <Badge tone={reservationStatusTone(item.workflowStatus)}>{reservationStatusLabel(item.workflowStatus)}</Badge> : display(item[key])}</td>)}{(["warehouses", "areas", "locations"] as const).includes(kind as "warehouses" | "areas" | "locations") && <td className="px-3 py-2"><Button size="sm" variant="secondary" disabled={loading} onClick={() => void toggleCatalogEnabled(kind as "warehouses" | "areas" | "locations", item)}>{item.enabled === true ? "停用" : "启用"}</Button>{(kind === "warehouses" || kind === "locations") && <Button size="sm" variant="ghost" disabled={loading} onClick={()=>setProfile({item,kind})}>仓储资料</Button>}{kind === "locations" && <Button size="sm" variant="secondary" disabled={loading || (item.enabled !== true && item.frozen !== true)} onClick={() => setFreezeLocation(item)}>{item.frozen === true ? "解冻" : "冻结"}</Button>}</td>}{kind === "approvals" && <td className="px-3 py-2"><div className="flex gap-1">{item.canDecide === true && <><Button size="sm" variant="secondary" disabled={approvalExpired(item)} onClick={() => void decideApproval(item, "APPROVE")} aria-label="通过审批"><Check className="h-4 w-4" /></Button><Button size="sm" variant="ghost" disabled={approvalExpired(item)} onClick={() => void decideApproval(item, "REJECT")} aria-label="拒绝审批"><X className="h-4 w-4" /></Button></>}{localPlanApprovalHref(item.command as WmsCommandInput | undefined) ? <a className="self-center whitespace-nowrap text-xs text-brand hover:underline" href={localPlanApprovalHref(item.command as WmsCommandInput)!}>查看头程计划并执行</a> : item.canExecute === true && <Button size="sm" disabled={approvalExpired(item)} onClick={() => void executeApproval(item)}>执行</Button>}</div></td>}{(kind === "balances" || kind === "reservations") && <td className="px-3 py-2"><div className="flex gap-1">{kind === "reservations" && <><Button size="sm" variant="ghost" disabled={loading} onClick={() => setSelectedReservation(item)} aria-label={`查看预占单详情 ${String(item.number)}`}>详情</Button>{localPlanHref(item.number) && <a className="self-center whitespace-nowrap text-xs text-brand hover:underline" href={localPlanHref(item.number)!}>查看头程计划</a>}</>}{(kind === "balances" ? ["RESERVE", "TRANSFER", "SKU_CONVERT"] : ["PICK", "UNPICK", "DISPATCH", "RELEASE"]).map(value => { const action = value as StockAction; const limit = stockActionLimit(item, action); return <Button key={action} size="sm" variant="secondary" disabled={!limit || loading} onClick={() => setStockJob({ item, action })}>{stockActionLabels[action]}</Button>; })}<Button size="sm" variant="ghost" disabled={loading} onClick={() => openRelated("movements", kind === "balances" ? "balanceId" : "sourceId", String(item.id))}>查看流水</Button><Button size="sm" variant="ghost" disabled={loading} onClick={() => openRelated("approvals", "aggregateId", String(item.id))}>查看审批</Button>{kind === "balances" && <Button size="sm" variant="ghost" disabled={loading} onClick={() => openRelated("reservations", "balanceId", String(item.id))}>查看预占</Button>}</div></td>}{kind === "transfers" && <td className="px-3 py-2"><Button size="sm" variant="ghost" disabled={loading} onClick={() => openRelated("movements", "sourceId", String(item.sourceId))}>查看成对流水</Button></td>}{kind === "stocktakes" && <td className="px-3 py-2"><Button size="sm" onClick={() => setStocktakeId(String(item.id))}>盘点作业</Button></td>}{kind === "lots" && <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={()=>setProfile({item,kind})}>批次体积</Button><Button size="sm" variant="secondary" disabled={loading} onClick={() => openRelated("balances", "lotId", String(item.id))}>查看库存</Button></td>}{kind === "receipts" && <td className="px-3 py-2"><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={loading} onClick={() => setSelectedReceipt(item)} aria-label={`收货单详情 ${String(item.number ?? "")}`}>详情</Button>{typeof item.sourceReference === "string" && item.sourceReference && <a className="self-center whitespace-nowrap text-xs text-brand hover:underline" href={"/operations?view=purchase-orders&receiptId=" + encodeURIComponent(String(item.id))}>查询关联采购单</a>}<Button size="sm" variant="ghost" disabled={loading} onClick={() => openRelated("movements", "sourceId", String(item.id))}>查看流水</Button><Button size="sm" variant="ghost" disabled={loading} onClick={() => openRelated("approvals", "aggregateId", String(item.id))}>查看审批</Button>{item.status === "DRAFT" && <><Button size="sm" variant="secondary" onClick={() => setEditingReceipt(item as unknown as Parameters<typeof WmsReceiptDraftForm>[0]["receipt"])}>编辑草稿</Button><Button size="sm" variant="secondary" onClick={() => openReceiptAction(item, "RECEIVE")}>收货</Button><Button size="sm" variant="ghost" onClick={() => void cancelDraft(item)}>取消草稿</Button></>}{["RECEIVED", "INSPECTED"].includes(String(item.status)) && [...(Array.isArray(item.lines) && item.lines.some((line: Item) => Number(line.receivedQty) > Number(line.acceptedQty) + Number(line.rejectedQty)) ? ["INSPECT"] : []), ...(Array.isArray(item.lines) && item.lines.some((line: Item) => Number(line.acceptedQty) > Number(line.putawayQty)) ? ["PUTAWAY"] : [])].map(action => <Button key={action} size="sm" variant="secondary" onClick={() => openReceiptAction(item, action as ReceiptAction)}>{receiptActionLabels[action as ReceiptAction]}</Button>)}</div></td>}{kind === "outbounds" && <td className="px-3 py-2"><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={loading} onClick={() => setSelectedOutbound(item)} aria-label={`出库需求详情 ${String(item.number ?? "")}`}>详情</Button>{item.status === "DRAFT" && <Button size="sm" variant="secondary" disabled={loading} onClick={() => editOutbound(item)}>编辑草稿</Button>}{!(["COMPLETED", "CANCELLED"].includes(String(item.status))) && <Button size="sm" variant="ghost" disabled={loading || (Array.isArray(item.lines) && item.lines.some((line: Item) => Number(line.allocatedQty) > 0))} onClick={() => void cancelOutboundDraft(item)}>取消需求</Button>}</div></td>}</tr>)}
        {!loading && items.length === 0 && <tr><td colSpan={columns[kind].length + (["stocktakes", "approvals", "receipts", "outbounds", "balances", "reservations", "warehouses", "areas", "locations", "lots", "transfers"].includes(kind) ? 1 : 0)} className="py-12 text-center text-muted-foreground">暂无记录</td></tr>}
        {loading && <tr><td colSpan={columns[kind].length + (["stocktakes", "approvals", "receipts", "outbounds", "balances", "reservations", "warehouses", "areas", "locations", "lots", "transfers"].includes(kind) ? 1 : 0)} className="py-12 text-center text-muted-foreground">读取中…</td></tr>}</tbody>
      </table>
    </div>}
    {kind === "receipts" && items.some(item => Array.isArray(item.lines) && item.lines.some((line: Item) => Number(line.rejectedQty) > Number(line.returnedQty ?? 0))) && <div className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm"><span>待退回拒收品：</span>{items.filter(item => Array.isArray(item.lines) && item.lines.some((line: Item) => Number(line.rejectedQty) > Number(line.returnedQty ?? 0))).map(item => { const lines = item.lines as Item[]; return <Button key={String(item.id)} size="sm" variant="secondary" onClick={() => openReceiptAction(item, "RETURN_REJECTED")}>{String(item.number)} · 退回 {lines.reduce((sum: number, line: Item) => sum + Math.max(0, Number(line.rejectedQty) - Number(line.returnedQty ?? 0)), 0)} 件</Button>; })}</div>}
    <div className="flex items-center justify-between border-t border-border pt-3 text-sm text-muted-foreground">
      <span>当前页 {items.length} 条</span><div className="flex gap-1"><Button size="icon" variant="secondary" aria-label="上一页" disabled={!cursor || loading} onClick={() => { const previous = cursorHistory.at(-1) ?? null; setCursorHistory(history => history.slice(0, -1)); void load(kind, previous); }}><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="secondary" aria-label="下一页" disabled={!nextCursor || loading} onClick={() => { setCursorHistory(history => [...history, cursor]); void load(kind, nextCursor); }}><ChevronRight className="h-4 w-4" /></Button></div>
    </div>
    <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">按单据编号作业</summary><WmsCommandPanel key={workspaceId} workspaceId={workspaceId} /></details>
  </div>;
}
