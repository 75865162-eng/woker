"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PurchaseReceiptProgress } from "./purchase-receipt-progress";
import { PurchasePaymentRecords } from "./purchase-payment-records";
import { useWmsOptions } from "./use-wms-options";
import { PurchaseSupplierPicker, type PurchaseSupplier } from "./purchase-supplier-picker";
import { WmsProductPicker } from "./wms-product-picker";
import { WmsOptionsStatus } from "./wms-options-status";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { WorkbenchPagination } from "@/components/ui/workbench-pagination";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { Button } from "@/components/ui/button";
import { purchaseReceiptStateLabels, type PurchaseReceiptSummary } from "@/lib/procurement/receipt-summary";
import { purchaseLineAmount, purchaseOrderAmount } from "@/lib/procurement/order-amounts";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Supplier = PurchaseSupplier;
type Product = { productRecordId: string; sku: string; chineseName: string; englishName: string };
type Line = { id: string; productRecordId: string; expectedQty: number; notes: string; unitPrice: string; product: Pick<Product, "sku" | "chineseName" | "englishName"> };
type PaymentApproval = { id: string; kind?: "PAYMENT" | "PAYMENT_REFUND"; amount: string; currency: string; paidAt: string; method: string; reference: string; notes: string; status: string; requestedBy: string; approvedBy: string | null; decisionReason: string; revision: number };
type PurchasePriceReference = { productRecordId: string; price: string; currency: string; orderNumber: string; orderedAt: string };
type Order = { id: string; number: string; status: string; currency: string; expectedAt: string | null; notes: string; wmsReceiptIds: string[]; approval?: { id: string; status: string; requestedBy: string; approvedBy: string | null; decisionReason: string; revision: number } | null; paymentSummary?: { totalAmount: string; grossPaidAmount: string; refundedAmount: string; paidAmount: string; outstandingAmount: string; payments: Array<{ id: string; amount: string; currency: string; paidAt: string; method: string; reference: string; notes: string; createdBy: string; refunds: Array<{ id: string; amount: string; currency: string; refundedAt: string; method: string; reference: string; notes: string }>; activeRefundReservations: string[] }>; approvals: PaymentApproval[]; refundApprovals: PaymentApproval[] }; receiptSummary?: PurchaseReceiptSummary | null; remainingQty: number | null; remainingLines?: Array<{ productRecordId: string; expectedQty: number }> | null; canCreateReceipt: boolean; canCancel?: boolean; revision: number; updatedAt: string; supplier: Pick<Supplier, "id" | "name">; lines: Line[] };
const scopeKey = "amazon_bulk_ad_workspace_scope";
function workspaceId() { try { return (JSON.parse(localStorage.getItem(scopeKey) ?? "{}") as { workspaceId?: string }).workspaceId || "default"; } catch { return "default"; } }
function headers(json = false) { const result = new Headers({ "x-workspace-id": workspaceId() }); if (json) result.set("content-type", "application/json"); return result; }
const orderStatuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "RECEIVING", "CANCELLED"] as const;
function statusLabel(status: string) { return ({ DRAFT: "草稿", PENDING_APPROVAL: "待审批", APPROVED: "审批通过·待下单", ORDERED: "已下单", RECEIVING: "收货处理中", CANCELLED: "已作废", REJECTED: "已拒绝", CONSUMED: "已登记", PAYMENT_PENDING: "付款待复核", PAYMENT_APPROVED: "待申请人确认", PAYMENT_CANCELLED: "已取消" } as Record<string, string>)[status] ?? status; }
function paymentStatusLabel(status: string, kind?: string) { const noun = kind === "PAYMENT_REFUND" ? "退款" : "付款"; return ({ PENDING: `${noun}待复核`, APPROVED: `${noun}复核通过·待确认`, REJECTED: `${noun}已拒绝`, CONSUMED: `${noun}已登记`, CANCELLED: `${noun}已取消` } as Record<string, string>)[status] ?? status; }
function inputClass() { return "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm"; }
function remainingRefundAmount(payment: NonNullable<Order["paymentSummary"]>["payments"][number]) {
  const micros = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0")); };
  const remaining = [...payment.refunds.map(refund => refund.amount), ...payment.activeRefundReservations].reduce((sum, amount) => sum - micros(amount), micros(payment.amount));
  const safeRemaining = remaining > BigInt(0) ? remaining : BigInt(0);
  return `${safeRemaining / BigInt(1_000_000)}.${String(safeRemaining % BigInt(1_000_000)).padStart(6, "0")}`;
}

// Layout adapted from Wimoor purchase/orders, components/receipt.vue, components/payment.vue and baseinfo/supplier; see public/licenses/wimoor-MIT.txt.
export function ProcurementWorkbench({ initialView = "purchase-orders" }: { initialView?: "purchase-orders" | "suppliers" }) {
  const [view, setView] = useState(initialView);
  const user = useAppShellUser();
  const canCreate = roleCanPerformAction(user?.userRole, "operations", "create", user?.rolePermissions);
  const canCreateReceipt = roleCanPerformAction(user?.userRole, "wms", "create", user?.rolePermissions);
  const canEdit = roleCanPerformAction(user?.userRole, "operations", "edit", user?.rolePermissions);
  const canApprove = roleCanPerformAction(user?.userRole, "operations", "approve", user?.rolePermissions);
  const [supplierOpen, setSupplierOpen] = useState(false), [orderOpen, setOrderOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailSection, setDetailSection] = useState<"all" | "receipts" | "payments">("all");
  const [page, setPage] = useState(1);
  const [sourceReceiptId, setSourceReceiptId] = useState("");
  const loadSequence = useRef(0);
  const mutationSequence = useRef(0);
  const pageSize = 20;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]), [products, setProducts] = useState<Product[]>([]), [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""), [statusFilter, setStatusFilter] = useState(""), [supplierFilter, setSupplierFilter] = useState("");
  const [supplierForm, setSupplierForm] = useState({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" });
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [orderForm, setOrderForm] = useState({ number: "", supplierId: "", currency: "CNY", expectedAt: "", notes: "" });
  const [lines, setLines] = useState([{ productRecordId: "", expectedQty: "", unitPrice: "", notes: "" }]);
  const [productPickerLine, setProductPickerLine] = useState<number | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<Supplier[]>([]);
  const [supplierPicker, setSupplierPicker] = useState<"order" | "filter" | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [receivingOrder, setReceivingOrder] = useState("");
  const [receivingLocationId, setReceivingLocationId] = useState("");
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({});
  const [paymentForm, setPaymentForm] = useState({ amount: "", paidAt: new Date().toLocaleDateString("en-CA"), method: "BANK_TRANSFER", reference: "", notes: "" });
  const [refundForm, setRefundForm] = useState({ paymentId: "", amount: "", refundedAt: new Date().toLocaleDateString("en-CA"), method: "BANK_TRANSFER", reference: "", notes: "" });
  useEffect(() => { setRefundForm({ paymentId: "", amount: "", refundedAt: new Date().toLocaleDateString("en-CA"), method: "BANK_TRANSFER", reference: "", notes: "" }); }, [selectedOrder?.id]);
  const [currentWorkspace, setCurrentWorkspace] = useState("default");
  const [priceReferences, setPriceReferences] = useState<PurchasePriceReference[]>([]);
  const [priceReferenceTarget, setPriceReferenceTarget] = useState<HTMLElement | null>(null);
  const priceHistorySequence = useRef(0);
  useEffect(() => {
    if (!orderOpen) { setPriceReferenceTarget(null); return; }
    const frame = window.requestAnimationFrame(() => setPriceReferenceTarget(document.querySelector<HTMLElement>("dialog[open] > div.p-5")));
    return () => window.cancelAnimationFrame(frame);
  }, [orderOpen]);
  const locationOptions = useWmsOptions("locations", currentWorkspace, !!receivingOrder && canCreateReceipt);
  const locations = locationOptions.items.filter(item => item.kind === "RECEIVING" && item.enabled);
  const orderProducts = [...new Map([...products, ...selectedProducts, ...(editingOrder?.lines ?? []).map(line => ({ productRecordId: line.productRecordId, ...line.product }))].map(product => [product.productRecordId, product])).values()];
  const orderSuppliers = [...new Map([...suppliers, ...selectedSuppliers, ...(editingOrder ? [editingOrder.supplier] : [])].map(supplier => [supplier.id, supplier])).values()];
  const priceProductIds = [...new Set(lines.map(line => line.productRecordId).filter(Boolean))].sort();
  const priceProductKey = priceProductIds.join("\u0000");
  useEffect(() => {
    const sequenceRef = priceHistorySequence;
    const sequence = ++sequenceRef.current;
    const productIds = priceProductKey ? priceProductKey.split("\u0000") : [];
    setPriceReferences([]);
    if (!orderOpen || !orderForm.supplierId || !productIds.length) return;
    const params = new URLSearchParams({ view: "price-history", supplierId: orderForm.supplierId });
    for (const id of productIds) params.append("productRecordId", id);
    void fetch(`/api/operations/procurement?${params}`, { headers: headers(), cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data as { prices: PurchasePriceReference[] }; })
      .then(data => { if (sequenceRef.current === sequence && workspaceId() === currentWorkspace) setPriceReferences(data.prices); })
      .catch(() => { if (sequenceRef.current === sequence) setPriceReferences([]); });
    return () => { if (sequenceRef.current === sequence) sequenceRef.current++; };
  }, [currentWorkspace, orderForm.supplierId, orderOpen, priceProductKey]);

  const queryRef = useRef({ view, search, statusFilter, supplierFilter, page, sourceReceiptId });
  queryRef.current = { view, search, statusFilter, supplierFilter, page, sourceReceiptId };
  const [orderPagination, setOrderPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [supplierPagination, setSupplierPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    setSuppliers([]); setProducts([]); setOrders([]); setOrderPagination({ page: 1, pageSize: 20, total: 0 }); setStatusCounts({});
    try {
      const query = queryRef.current;
      const params = new URLSearchParams({ page: String(query.page) });
      params.set("search", query.search);
      if (query.view === "suppliers") params.set("view", "suppliers");
      if (query.view === "purchase-orders") { params.set("status", query.statusFilter); params.set("supplierId", query.supplierFilter); if (query.sourceReceiptId) params.set("receiptId", query.sourceReceiptId); }
      const response = await fetch("/api/operations/procurement?" + params, { headers: headers(), cache: "no-store" });
      const data = await response.json();
      if (sequence !== loadSequence.current) return;
      if (!response.ok) throw new Error(data.error || "采购数据读取失败。");
      setSuppliers(data.suppliers ?? []); setProducts(data.products ?? []); setOrders(data.orders ?? []); if (query.view === "suppliers") setSupplierPagination(data.pagination); else { setOrderPagination(data.pagination); setStatusCounts(data.statusCounts); setSelectedOrder(current => current ? data.orders?.find((order: Order) => order.id === current.id) ?? current : query.sourceReceiptId && data.orders?.length === 1 ? data.orders[0] : null); }
    } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "采购数据读取失败。"); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);

  const invalidateQuery = useCallback(() => { ++loadSequence.current; }, []);
  const invalidateLoad = useCallback(() => { ++loadSequence.current; ++mutationSequence.current; }, []);
  useEffect(() => {
    const update = () => { ++mutationSequence.current; setBusy(false); setCurrentWorkspace(workspaceId()); setSupplierOpen(false); setOrderOpen(false); setEditingOrder(null); setProductPickerLine(null); setSelectedProducts([]); setSelectedSuppliers([]); setSupplierPicker(null); setCancellingOrder(null); setCancelReason(""); setSelectedOrder(null); setReceivingOrder(""); setReceivingLocationId(""); setNotice(""); setSourceReceiptId(""); setSupplierFilter(""); queryRef.current.sourceReceiptId = ""; queryRef.current.supplierFilter = ""; queryRef.current.page = 1; const url = new URL(window.location.href); url.searchParams.delete("receiptId"); url.searchParams.delete("supplierId"); window.history.replaceState(null, "", url); setPage(1); void load(); };
    const initialParams = new URLSearchParams(window.location.search);
    if (initialView === "purchase-orders") { setSourceReceiptId(initialParams.get("receiptId") ?? ""); setSupplierFilter(initialParams.get("supplierId") ?? ""); }
    setCurrentWorkspace(workspaceId()); window.addEventListener(workspaceScopeChangedEventName, update);
    return () => { invalidateLoad(); window.removeEventListener(workspaceScopeChangedEventName, update); };
  }, [load, invalidateLoad, initialView]);
  useEffect(() => {
    ++loadSequence.current;
    setOrders([]); setSuppliers([]); setSelectedOrder(null); setReceivingOrder(""); setLoading(true);
    const timer = window.setTimeout(() => { void load(); }, 180);
    return () => { window.clearTimeout(timer); invalidateQuery(); };
  }, [view, search, statusFilter, supplierFilter, page, sourceReceiptId, load, invalidateQuery]);
  useEffect(() => {
    const update = () => { const params = new URLSearchParams(window.location.search); const next = params.get("view"); setSourceReceiptId(next === "purchase-orders" ? params.get("receiptId") ?? "" : ""); setSupplierFilter(next === "purchase-orders" ? params.get("supplierId") ?? "" : ""); setSearch(""); setStatusFilter(""); if (next === "suppliers" || next === "purchase-orders") { setView(next); setSupplierPicker(null); setPage(1); } };
    window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update);
  }, []);
  function changeView(next: typeof view) {
    setView(next); setSourceReceiptId(""); setSupplierPicker(null); setPage(1); setSearch(""); setStatusFilter(""); setSupplierFilter("");
    const url = new URL(window.location.href); url.searchParams.set("view", next); url.searchParams.delete("receiptId"); url.searchParams.delete("supplierId");
    window.history.pushState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function filterBySupplier(id: string) {
    setSupplierFilter(id); setPage(1);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "purchase-orders");
    if (id) url.searchParams.set("supplierId", id); else url.searchParams.delete("supplierId");
    window.history.pushState(null, "", url);
  }

  function openSupplierOrders(supplier: Supplier) {
    setSelectedSuppliers(current => [...current.filter(item => item.id !== supplier.id), supplier]);
    setView("purchase-orders"); setSearch(""); setStatusFilter(""); setSourceReceiptId(""); setSupplierPicker(null);
    setSupplierFilter(supplier.id); setPage(1);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "purchase-orders"); url.searchParams.set("supplierId", supplier.id); url.searchParams.delete("receiptId");
    window.history.pushState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function openNewOrder(supplier?: Supplier) {
    if (!canCreate || busy) return;
    setEditingOrder(null); setSupplierPicker(null); setProductPickerLine(null); setSelectedProducts([]); setError(""); setNotice("");
    if (supplier) setSelectedSuppliers(current => [...current.filter(item => item.id !== supplier.id), supplier]);
    setOrderForm({ number: "", supplierId: supplier?.id ?? "", currency: "CNY", expectedAt: "", notes: "" });
    setLines([{ productRecordId: "", expectedQty: "", unitPrice: "", notes: "" }]); setOrderOpen(true);
  }

  async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(path, { method, headers: headers(true), body: JSON.stringify(body ?? {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败。");
    return data;
  }

  async function saveSupplier(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const operation = ++mutationSequence.current;
    try {
      if (editingSupplierId) await request("/api/operations/procurement", "PATCH", { action: "supplier", id: editingSupplierId, ...supplierForm });
      else await request("/api/operations/procurement", "POST", { action: "supplier", ...supplierForm });
      if (operation !== mutationSequence.current) return;
      setSupplierForm({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" }); setEditingSupplierId(""); setSupplierOpen(false); setNotice("供应商档案已保存。"); await load();
    }
    catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "供应商保存失败。"); } finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function saveOrder(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const operation = ++mutationSequence.current;
    try {
      const body = { ...orderForm, lines: lines.map(line => ({ ...line, expectedQty: Number(line.expectedQty) })) };
      if (editingOrder) await request("/api/operations/procurement", "PATCH", { action: "edit-order", id: editingOrder.id, revision: editingOrder.revision, ...body });
      else await request("/api/operations/procurement", "POST", { action: "order", ...body });
      if (operation !== mutationSequence.current) return;
      setOrderForm({ number: "", supplierId: "", currency: "CNY", expectedAt: "", notes: "" }); setLines([{ productRecordId: "", expectedQty: "", unitPrice: "", notes: "" }]); setOrderOpen(false); setEditingOrder(null); setNotice(editingOrder ? "采购草稿修改已保存。" : "采购订单已创建并保存到 ERP。"); if (view === "suppliers") { const supplier = [...suppliers, ...selectedSuppliers].find(item => item.id === orderForm.supplierId); if (supplier) { openSupplierOrders(supplier); return; } } await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "采购单创建失败。"); } finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function createReceipt(order: Order) {
    setBusy(true); setError(""); setNotice("");
    const operation = ++mutationSequence.current;
    try {
      if (!receivingLocationId) throw new Error("请选择 WMS 收货库位。");
      const quantities = order.remainingLines?.filter(line => receiptQuantities[line.productRecordId] !== "0").map(line => ({ productRecordId: line.productRecordId, expectedQty: Number(receiptQuantities[line.productRecordId]) }));
      if (quantities && (!quantities.length || quantities.some(line => !Number.isInteger(line.expectedQty) || line.expectedQty <= 0 || line.expectedQty > (order.remainingLines!.find(item => item.productRecordId === line.productRecordId)?.expectedQty ?? 0)))) throw new Error("请填写本次计划收货数量；须为不超过可建数量的整数，0 表示本批不收。");
      const result = await request("/api/operations/procurement", "PATCH", { action: "create-receipt", id: order.id, revision: order.revision, receivingLocationId, ...(quantities ? { lines: quantities } : {}) });
      if (operation !== mutationSequence.current) return;
      setReceivingOrder(""); setNotice(`已创建 WMS 收货草稿 ${result.receipt.number}。请到仓库入库完成实收、质检和上架；当前未增加库存。`); await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "WMS 收货草稿创建失败。"); } finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function placeOrder(order: Order) {
    if (order.status === "DRAFT") { await submitApproval(order); return; }
    setBusy(true); setError(""); setNotice("");
    const operation = ++mutationSequence.current;
    try { await request("/api/operations/procurement", "PATCH", { action: "place-order", id: order.id, revision: order.revision }); if (operation !== mutationSequence.current) return; setNotice(`采购单 ${order.number} 已确认下单。`); await load(); }
    catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "采购单状态更新失败。"); } finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function submitApproval(order: Order) {
    setBusy(true); setError(""); setNotice(""); const operation = ++mutationSequence.current;
    try { await request("/api/operations/procurement", "PATCH", { action: "submit-approval", id: order.id, revision: order.revision }); if (operation !== mutationSequence.current) return; setNotice(`采购单 ${order.number} 已提交独立审批。`); await load(); }
    catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "采购审批申请失败。"); } finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function decideApproval(order: Order, decision: "APPROVE" | "REJECT") {
    if (!order.approval) return;
    const reason = decision === "REJECT" ? window.prompt("请填写拒绝原因")?.trim() : "";
    if (decision === "REJECT" && !reason) return;
    setBusy(true); setError(""); setNotice(""); const operation = ++mutationSequence.current;
    try { await request("/api/operations/procurement/approvals", "PATCH", { id: order.approval.id, revision: order.approval.revision, decision, reason }); if (operation !== mutationSequence.current) return; setNotice(decision === "APPROVE" ? "采购单审批通过，等待申请人确认下单。" : "采购单已拒绝并退回草稿。"); await load(); }
    catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "采购审批处理失败。"); } finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function submitPaymentApproval(event: React.FormEvent) {
    event.preventDefault(); if (!selectedOrder) return;
    setBusy(true); setError(""); setNotice(""); const operation = ++mutationSequence.current;
    try {
      const result = await request("/api/operations/procurement", "PATCH", { action: "submit-payment-approval", id: selectedOrder.id, ...paymentForm });
      if (operation !== mutationSequence.current) return;
      setNotice(result.reused ? "该付款凭证已有申请，未重复提交。" : "付款凭证已提交复核；批准前不会计入已付金额。");
      await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "付款复核申请失败。"); }
    finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function submitRefundApproval(event: React.FormEvent) {
    event.preventDefault(); if (!selectedOrder || !refundForm.paymentId) return;
    setBusy(true); setError(""); setNotice(""); const operation = ++mutationSequence.current;
    try {
      const result = await request("/api/operations/procurement", "PATCH", { action: "submit-refund-approval", ...refundForm });
      if (operation !== mutationSequence.current) return;
      setNotice(result.reused ? "该退款凭证已有申请，未重复提交。" : "退款凭证已提交复核；批准并确认前不会改变净付款余额。");
      await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "退款复核申请失败。"); }
    finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function decidePaymentApproval(order: Order, approval: PaymentApproval, decision: "APPROVE" | "REJECT") {
    const reason = decision === "REJECT" ? window.prompt("请填写付款拒绝原因")?.trim() : "";
    if (decision === "REJECT" && !reason) return;
    setBusy(true); setError(""); setNotice(""); const operation = ++mutationSequence.current;
    try {
      await request("/api/operations/procurement/approvals", "PATCH", { kind: approval.kind ?? "PAYMENT", id: approval.id, revision: approval.revision, decision, reason });
      if (operation !== mutationSequence.current) return;
      const noun = approval.kind === "PAYMENT_REFUND" ? "退款" : "付款";
      setNotice(decision === "APPROVE" ? `${noun} ${approval.reference} 已复核，等待申请人确认登记。` : `${noun} ${approval.reference} 已拒绝，未计入台账。`);
      await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "付款复核处理失败。"); }
    finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function confirmPayment(approval: PaymentApproval) {
    setBusy(true); setError(""); setNotice(""); const operation = ++mutationSequence.current;
    try {
      const isRefund = approval.kind === "PAYMENT_REFUND";
      const result = await request("/api/operations/procurement", "PATCH", { action: isRefund ? "confirm-refund" : "confirm-payment", id: approval.id, revision: approval.revision });
      if (operation !== mutationSequence.current) return;
      const noun = isRefund ? "退款" : "付款";
      setNotice(result.reused ? `该${noun}凭证已登记，未重复计入。` : `${noun} ${approval.reference} 已确认登记。`);
      await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "付款确认登记失败。"); }
    finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function cancelRefundApproval(approval: PaymentApproval) {
    setBusy(true); setError(""); setNotice(""); const operation = ++mutationSequence.current;
    try {
      const result = await request("/api/operations/procurement", "PATCH", { action: "cancel-refund-approval", id: approval.id, revision: approval.revision });
      if (operation !== mutationSequence.current) return;
      setNotice(result.reused ? `退款申请 ${approval.reference} 已撤销。` : `退款申请 ${approval.reference} 已撤销，可退额度已释放。`);
      await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "退款申请撤销失败。"); }
    finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  async function cancelOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!cancellingOrder) return;
    setBusy(true); setError(""); setNotice("");
    const operation = ++mutationSequence.current;
    try {
      await request("/api/operations/procurement", "PATCH", { action: "cancel-order", id: cancellingOrder.id, revision: cancellingOrder.revision, reason: cancelReason.trim() });
      if (operation !== mutationSequence.current) return;
      setCancellingOrder(null); setCancelReason(""); setSelectedOrder(null); setNotice("采购单已作废，原明细及作废审计已保留。"); await load();
    } catch (cause) { if (operation === mutationSequence.current) setError(cause instanceof Error ? cause.message : "采购单作废失败。"); }
    finally { if (operation === mutationSequence.current) setBusy(false); }
  }

  const visibleOrders = orders;

  const visibleSuppliers = suppliers;
  const currentPage = view === "suppliers" ? supplierPagination.page : orderPagination.page;
  const pagedOrders = visibleOrders;
  const pagedSuppliers = visibleSuppliers;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex gap-1" role="tablist" aria-label="采购管理"><button role="tab" aria-selected={view === "purchase-orders"} onClick={() => changeView("purchase-orders")} className={`min-h-9 border-b-2 px-3 text-sm ${view === "purchase-orders" ? "border-brand font-semibold" : "border-transparent text-muted"}`}>采购订单</button><button role="tab" aria-selected={view === "suppliers"} onClick={() => changeView("suppliers")} className={`min-h-9 border-b-2 px-3 text-sm ${view === "suppliers" ? "border-brand font-semibold" : "border-transparent text-muted"}`}>供应商档案</button></div>
      <Button size="sm" variant="secondary" onClick={() => { setSelectedOrder(null); void load(); }} disabled={loading || busy}>刷新</Button>
    </div>
    {view === "purchase-orders" && sourceReceiptId && <div className="flex flex-wrap items-center gap-2 rounded border border-border p-3 text-sm"><span>按收货单关联查询：{sourceReceiptId}</span><Button type="button" size="sm" variant="secondary" onClick={() => { setSourceReceiptId(""); setSelectedOrder(null); setPage(1); const url = new URL(window.location.href); url.searchParams.delete("receiptId"); window.history.replaceState(null, "", url); }}>返回全部采购单</Button><p className="basis-full text-xs text-muted">仅按采购单已保存的收货关联匹配；来源单号相同不代表已关联。</p></div>}
    {orderOpen && priceReferenceTarget && priceReferences.length > 0 && createPortal(<aside aria-label="供应商历史成交价参考" className="mb-4 rounded border border-border p-3 text-xs text-muted"><p className="mb-1 font-medium">供应商历史成交价参考（不自动填入）</p><ul className="space-y-1">{priceReferences.filter(item => item.currency === orderForm.currency && lines.some(line => line.productRecordId === item.productRecordId)).map(item => <li key={`${item.productRecordId}:${item.currency}`}>{orderProducts.find(product => product.productRecordId === item.productRecordId)?.sku ?? item.productRecordId}：{item.price} {item.currency} · {item.orderNumber} · {item.orderedAt.slice(0, 10)}</li>)}</ul></aside>, priceReferenceTarget)}
    {error && !receivingOrder && <p role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface-muted p-3">
      <p className="text-xs text-muted">{view === "suppliers" ? "组织级供应商档案" : "采购单 → 下单 → WMS 收货草稿 → 收货 / 质检 / 上架"}</p>
      <Button size="sm" disabled={loading || busy || !canCreate} onClick={() => { if (view === "suppliers") { setEditingSupplierId(""); setSupplierForm({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" }); setSupplierOpen(true); } else { openNewOrder(suppliers.find(item => item.id === supplierFilter)); } }}>{view === "suppliers" ? "添加供应商" : "添加采购单"}</Button>
    </div>
    {view === "suppliers" ? <div className="space-y-4">
      <section className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">供应商档案 · {supplierPagination.total}</h2><input aria-label="搜索供应商" placeholder="名称 / 联系人 / 电话 / 邮箱" className={inputClass()} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div><div className="overflow-x-auto border border-border"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-surface-muted text-xs text-muted"><tr><th className="px-3 py-2">供应商</th><th className="px-3 py-2">联系人</th><th className="px-3 py-2">电话</th><th className="px-3 py-2">邮箱</th><th className="px-3 py-2">地址</th><th className="px-3 py-2">操作</th></tr></thead><tbody>{pagedSuppliers.map(item => <tr key={item.id} className="border-t border-border"><td className="px-3 py-2 font-medium">{item.name}</td><td className="px-3 py-2">{item.contactName || "—"}</td><td className="px-3 py-2">{item.phone || "—"}</td><td className="px-3 py-2">{item.email || "—"}</td><td className="px-3 py-2">{item.address || "—"}</td><td className="px-3 py-2"><div className="flex gap-2"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => openSupplierOrders(item)}>查看采购记录</Button><Button type="button" size="sm" variant="secondary" disabled={!canCreate || busy} onClick={() => openNewOrder(item)}>新建采购单</Button><Button size="sm" variant="secondary" disabled={!canEdit || busy} onClick={() => { setSupplierOpen(true); setEditingSupplierId(item.id); setSupplierForm({ name: item.name, contactName: item.contactName, phone: item.phone, email: item.email, address: item.address, notes: item.notes }); }}>编辑</Button></div></td></tr>)}{!suppliers.length && !loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted">暂无供应商档案。</td></tr>}</tbody></table></div></section>
      <WorkbenchPagination total={supplierPagination.total} page={currentPage} pageSize={pageSize} onPage={setPage} note="服务端筛选" />
      <WorkbenchDialog open={supplierOpen} title={editingSupplierId ? "编辑供应商" : "添加供应商"} onClose={() => setSupplierOpen(false)} busy={busy}>
      {error && <p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}
      <form onSubmit={saveSupplier} className="space-y-3"><h2 className="text-sm font-semibold">{editingSupplierId ? "编辑供应商" : "新增供应商"}</h2><div className="grid gap-2 sm:grid-cols-2">{([["name", "供应商名称", true], ["contactName", "联系人"], ["phone", "电话"], ["email", "邮箱"], ["address", "地址"], ["notes", "备注"]] as const).map(([key, label, required]) => <label key={key} className="grid gap-1 text-xs text-muted">{label}<input className={inputClass()} required={required ?? false} maxLength={key === "notes" ? 1000 : 500} value={supplierForm[key]} onChange={event => setSupplierForm(form => ({ ...form, [key]: event.target.value }))} /></label>)}</div><div className="flex gap-2"><Button size="sm" disabled={busy}>{editingSupplierId ? "保存修改" : "保存供应商"}</Button>{editingSupplierId && <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingSupplierId(""); setSupplierForm({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" }); }}>取消编辑</Button>}</div></form></WorkbenchDialog>
    </div> : <div className="space-y-5">
      <div role="tablist" aria-label="采购订单状态" className="flex flex-wrap gap-1 border-b border-border">{[["", "全部"], ...orderStatuses.map(status => [status, statusLabel(status)])].map(([value, label]) => <button key={value} role="tab" type="button" aria-selected={statusFilter === value} onClick={() => { setStatusFilter(value); setPage(1); }} className={"min-h-9 border-b-2 px-3 text-xs " + (statusFilter === value ? "border-brand font-semibold text-brand" : "border-transparent text-muted")}>{label} <span className="ml-1 tabular-nums">{value ? statusCounts[value] ?? 0 : Object.values(statusCounts).reduce((sum, count) => sum + count, 0)}</span></button>)}</div>

      <section><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><h2 className="text-sm font-semibold">采购订单 · {orderPagination.total}</h2><div className="flex flex-wrap gap-2"><input aria-label="搜索采购订单" placeholder="单号 / 供应商 / SKU" className={inputClass()} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /><select aria-label="按状态筛选" className={inputClass()} value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="">全部状态</option>{orderStatuses.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select><select aria-label="按供应商筛选" className={inputClass()} value={supplierFilter} onChange={event => { filterBySupplier(event.target.value); }}><option value="">全部供应商</option>{supplierFilter && !orderSuppliers.some(item => item.id === supplierFilter) && <option value={supplierFilter}>供应商未读取（{supplierFilter}）</option>}{orderSuppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button type="button" size="sm" variant="ghost" onClick={() => setSupplierPicker("filter")}>查找供应商筛选</Button></div></div>
        {supplierPicker === "filter" && <div className="mb-3 space-y-2"><PurchaseSupplierPicker key={currentWorkspace} workspaceId={currentWorkspace} onSelect={supplier => { setSelectedSuppliers(current => [...current.filter(item => item.id !== supplier.id), supplier]); filterBySupplier(supplier.id); setSupplierPicker(null); }} /><Button type="button" size="sm" variant="ghost" onClick={() => setSupplierPicker(null)}>关闭供应商搜索</Button></div>}
        <div className="overflow-x-auto border border-border"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="bg-surface-muted text-xs text-muted"><tr><th className="px-3 py-2">采购单号 / 更新时间</th><th className="px-3 py-2">供应商</th><th className="px-3 py-2">商品明细</th><th className="px-3 py-2">数量</th><th className="px-3 py-2">单价 / 币种</th><th className="px-3 py-2" title="扣除已验收上架数量及处理中收货单的预留数量">可建收货数量</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">收货进度 / WMS 关联</th><th className="px-3 py-2">操作</th></tr></thead><tbody>{pagedOrders.map(order => <tr key={order.id} className="border-t border-border align-top"><td className="px-3 py-2 font-medium"><button type="button" className="text-brand hover:underline" onClick={() => { setDetailSection("all"); setSelectedOrder(order); }}>{order.number}</button><span className="block text-[11px] font-normal text-muted">{new Date(order.updatedAt).toLocaleDateString("zh-CN")}</span></td><td className="px-3 py-2">{order.supplier.name}</td><td className="px-3 py-2">{order.lines.map(line => <div key={line.id}>{line.product.sku} · {line.product.chineseName || line.product.englishName || "—"}</div>)}</td><td className="px-3 py-2 tabular-nums">{order.lines.map(line => <div key={line.id}>{line.expectedQty}</div>)}</td><td className="px-3 py-2 tabular-nums">{order.lines.map(line => <div key={line.id}>{line.unitPrice} {order.currency}</div>)}</td><td className="px-3 py-2 tabular-nums">{order.remainingQty ?? "未读取"}</td><td className="px-3 py-2"><span className="rounded border border-border px-2 py-1 text-xs">{statusLabel(order.status)}</span></td><td className="px-3 py-2 text-xs">{order.receiptSummary ? <div className="mb-1 space-y-1"><span className="block font-medium">{purchaseReceiptStateLabels[order.receiptSummary.state]}</span><span className="block tabular-nums">已上架 {order.receiptSummary.putawayQty} / 计划 {order.receiptSummary.plannedQty}</span><span className="block tabular-nums">待上架完成 {order.receiptSummary.remainingToPutawayQty} · 累计拒收 {order.receiptSummary.rejectedQty}</span></div> : <span className="mb-1 block text-muted">收货进度未读取</span>}{order.wmsReceiptIds.length ? `${order.wmsReceiptIds.length} 张 WMS 收货单` : "—"}</td><td className="px-3 py-2"><div className="flex flex-wrap gap-1">{order.status === "DRAFT" && !order.wmsReceiptIds.length && <Button size="sm" variant="secondary" disabled={busy || !canEdit} onClick={() => { setError(""); setEditingOrder(order); setSupplierPicker(null); setProductPickerLine(null); setSelectedProducts([]); setOrderForm({ number: order.number, supplierId: order.supplier.id, currency: order.currency, expectedAt: order.expectedAt?.slice(0, 10) ?? "", notes: order.notes }); setLines(order.lines.map(line => ({ productRecordId: line.productRecordId, expectedQty: String(line.expectedQty), unitPrice: line.unitPrice, notes: line.notes ?? "" }))); setOrderOpen(true); }}>编辑草稿</Button>}{order.status === "DRAFT" && <Button size="sm" variant="secondary" disabled={busy || !canEdit} onClick={() => void submitApproval(order)}>提交审批</Button>}{order.status === "APPROVED" && order.approval?.requestedBy === user?.userId && <Button size="sm" variant="secondary" disabled={busy || !canEdit} onClick={() => void placeOrder(order)}>申请人确认已下单</Button>}{order.status === "PENDING_APPROVAL" && order.approval?.requestedBy !== user?.userId && canApprove && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => void decideApproval(order, "APPROVE")}>通过</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decideApproval(order, "REJECT")}>拒绝</Button></>}{order.paymentSummary && <Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => { setDetailSection("payments"); setSelectedOrder(order); }}>付款与退款</Button>}{order.canCancel && <Button size="sm" variant="ghost" disabled={busy || !canEdit} onClick={() => { setError(""); setCancelReason(""); setCancellingOrder(order); setReceivingOrder(""); }}>作废采购单</Button>}{order.canCreateReceipt && <Button size="sm" variant="secondary" disabled={busy || !canCreate || !canEdit || !canCreateReceipt} onClick={() => { setReceivingLocationId(""); setReceiptQuantities(Object.fromEntries((order.remainingLines ?? []).map(line => [line.productRecordId, String(line.expectedQty)]))); setReceivingOrder(order.id); }}>{order.status === "RECEIVING" ? "创建补收草稿" : "创建收货草稿"}</Button>}{receivingOrder === order.id && <WorkbenchDialog open title="采购分批收货" busy={busy} onClose={() => setReceivingOrder("")}><div className="grid gap-5 md:grid-cols-[1fr_2fr]"><section aria-label="本次收货依据" className="space-y-3 rounded border border-border bg-background p-4"><h3 className="text-sm font-semibold">{order.number}</h3><p className="text-sm">供应商：{order.supplier.name}</p><p className="text-sm">可建收货数量：{order.remainingQty ?? "未读取"}</p><p className="text-xs text-muted">分批收货只为本次选择的商品建立 WMS 草稿。实收、质检和上架由仓库独立登记。</p></section><section className="space-y-3">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{order.remainingLines && <><p className="text-xs text-muted">填写本批计划数量；0 表示本批不收。建单仅预留采购数量，实际收货须在 WMS 完成。</p>{order.remainingLines.filter(line => line.expectedQty > 0).map(line => <label key={line.productRecordId} className="grid gap-1 text-xs">{order.lines.find(item => item.productRecordId === line.productRecordId)?.product.sku ?? line.productRecordId} · 可建 {line.expectedQty}<input aria-label={"本次计划收货 " + (order.lines.find(item => item.productRecordId === line.productRecordId)?.product.sku ?? line.productRecordId)} type="number" min="0" max={line.expectedQty} step="1" value={receiptQuantities[line.productRecordId] ?? ""} onChange={event => setReceiptQuantities(current => ({ ...current, [line.productRecordId]: event.target.value }))} className={inputClass()} /></label>)}</>}<select aria-label="选择收货库位" className={inputClass()} value={receivingLocationId} onChange={event => setReceivingLocationId(event.target.value)}><option value="">收货库位</option>{locations.map(location => <option key={String(location.id)} value={String(location.id)}>{String(location.code)}</option>)}</select><WmsOptionsStatus label="收货库位" options={locationOptions} />{!locationOptions.loading && !locationOptions.error && !locations.length && <span className="text-xs text-muted">当前页无启用的收货库位，请加载下一页或先在仓库中创建。</span>}<Button size="sm" disabled={busy || !receivingLocationId} onClick={() => void createReceipt(order)}>确认</Button><Button size="sm" variant="ghost" onClick={() => setReceivingOrder("")}>取消</Button></section></div></WorkbenchDialog>}</div></td></tr>)}{!visibleOrders.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-muted">{loading ? "正在读取采购订单…" : "没有符合条件的采购单。"}</td></tr>}</tbody></table></div>
        {orders.some(order => order.paymentSummary?.approvals.some(approval => (approval.status === "PENDING" && approval.requestedBy !== user?.userId && canApprove) || (approval.status === "APPROVED" && approval.requestedBy === user?.userId))) && <section aria-label="付款复核任务" className="space-y-2 border-t border-border pt-3"><h2 className="text-sm font-semibold">付款复核任务</h2>{orders.flatMap(order => (order.paymentSummary?.approvals ?? []).filter(approval => (approval.status === "PENDING" && approval.requestedBy !== user?.userId && canApprove) || (approval.status === "APPROVED" && approval.requestedBy === user?.userId)).map(approval => <div key={approval.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm"><span className="font-medium">{order.number}</span><span>{approval.reference}</span><span>{approval.amount} {approval.currency}</span><span>{paymentStatusLabel(approval.status)}</span>{approval.status === "PENDING" && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => void decidePaymentApproval(order, approval, "APPROVE")}>复核通过</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decidePaymentApproval(order, approval, "REJECT")}>拒绝</Button></>}{approval.status === "APPROVED" && <Button size="sm" disabled={busy || !canCreate} onClick={() => void confirmPayment(approval)}>申请人确认登记</Button>}</div>))}</section>}
        {orders.filter(order => order.status === "PENDING_APPROVAL" || order.status === "APPROVED").length > 0 && <section aria-label="采购审批任务" className="space-y-2 border-t border-border pt-3"><h2 className="text-sm font-semibold">采购审批任务</h2>{orders.filter(order => order.status === "PENDING_APPROVAL" || order.status === "APPROVED").map(order => <div key={order.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm"><span className="font-medium">{order.number}</span><span>{order.supplier.name}</span><span>{statusLabel(order.status)}</span>{order.status === "PENDING_APPROVAL" && order.approval?.requestedBy !== user?.userId && canApprove && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => void decideApproval(order, "APPROVE")}>通过</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decideApproval(order, "REJECT")}>拒绝</Button></>}{order.status === "APPROVED" && order.approval?.requestedBy === user?.userId && <Button size="sm" disabled={busy || !canEdit} onClick={() => void placeOrder(order)}>申请人确认已下单</Button>}</div>)}</section>}
        {orders.some(order => order.paymentSummary?.refundApprovals.some(approval => (approval.status === "PENDING" && ((approval.requestedBy !== user?.userId && canApprove) || approval.requestedBy === user?.userId)) || (approval.status === "APPROVED" && approval.requestedBy === user?.userId))) && <section aria-label="退款复核任务" className="space-y-2 border-t border-border pt-3"><h2 className="text-sm font-semibold">退款复核任务</h2>{orders.flatMap(order => (order.paymentSummary?.refundApprovals ?? []).filter(approval => (approval.status === "PENDING" && ((approval.requestedBy !== user?.userId && canApprove) || approval.requestedBy === user?.userId)) || (approval.status === "APPROVED" && approval.requestedBy === user?.userId)).map(approval => <div key={approval.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm"><span className="font-medium">{order.number}</span><span>{approval.reference}</span><span>{approval.amount} {approval.currency}</span><span>{paymentStatusLabel(approval.status, approval.kind)}</span>{approval.status === "PENDING" && approval.requestedBy !== user?.userId && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => void decidePaymentApproval(order, approval, "APPROVE")}>复核通过</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decidePaymentApproval(order, approval, "REJECT")}>拒绝</Button></>}{approval.status === "PENDING" && approval.requestedBy === user?.userId && <Button size="sm" variant="ghost" disabled={busy || !canCreate} onClick={() => void cancelRefundApproval(approval)}>撤销申请</Button>}{approval.status === "APPROVED" && <Button size="sm" disabled={busy || !canCreate} onClick={() => void confirmPayment(approval)}>申请人确认登记</Button>}</div>))}</section>}
        <WorkbenchPagination total={orderPagination.total} page={currentPage} pageSize={pageSize} onPage={setPage} note="服务端筛选" />
        <p className="mt-2 text-xs text-muted">创建 WMS 收货草稿不会增加库存。收货、质检和上架须在仓库入库流程中完成，过账后库存流水保留在 WMS。<a className="ml-2 font-medium text-brand hover:underline" href="/logistics/warehouse?tab=receipts">打开仓库入库</a></p>
      </section>
    </div>}
      <WorkbenchDialog open={orderOpen} title={editingOrder ? "编辑采购草稿" : "添加采购单"} onClose={() => { setOrderOpen(false); setProductPickerLine(null); setSupplierPicker(null); }} busy={busy}>{error && <p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}<section><h2 className="mb-3 text-sm font-semibold">{editingOrder ? "编辑采购草稿" : "新建采购订单"}</h2><form onSubmit={saveOrder} className="space-y-3"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><label className="grid gap-1 text-xs text-muted">采购单号<input required maxLength={80} className={inputClass()} value={orderForm.number} onChange={event => setOrderForm(form => ({ ...form, number: event.target.value }))} /></label><label className="grid gap-1 text-xs text-muted">供应商<select aria-label="供应商" required className={inputClass()} value={orderForm.supplierId} onChange={event => setOrderForm(form => ({ ...form, supplierId: event.target.value }))}><option value="">选择供应商</option>{orderSuppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setSupplierPicker("order")}>搜索更多供应商</Button></label><label className="grid gap-1 text-xs text-muted">币种<input maxLength={3} className={inputClass()} value={orderForm.currency} onChange={event => setOrderForm(form => ({ ...form, currency: event.target.value.toUpperCase() }))} /></label><label className="grid gap-1 text-xs text-muted">预计交期<input type="date" className={inputClass()} value={orderForm.expectedAt} onChange={event => setOrderForm(form => ({ ...form, expectedAt: event.target.value }))} /></label><label className="grid gap-1 text-xs text-muted">备注<input maxLength={1000} className={inputClass()} value={orderForm.notes} onChange={event => setOrderForm(form => ({ ...form, notes: event.target.value }))} /></label></div>
        {supplierPicker === "order" && <div className="space-y-2"><PurchaseSupplierPicker key={currentWorkspace} workspaceId={currentWorkspace} onSelect={supplier => { setSelectedSuppliers(current => [...current.filter(item => item.id !== supplier.id), supplier]); setOrderForm(current => ({ ...current, supplierId: supplier.id })); setSupplierPicker(null); }} /><Button type="button" size="sm" variant="ghost" onClick={() => setSupplierPicker(null)}>关闭供应商搜索</Button></div>}
        <div className="space-y-2">{lines.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[minmax(220px,2fr)_1fr_1fr_auto]"><label className="grid gap-1 text-xs text-muted">商品 SKU<select aria-label="商品 SKU" required className={inputClass()} value={line.productRecordId} onChange={event => setLines(current => current.map((row, i) => i === index ? { ...row, productRecordId: event.target.value } : row))}><option value="">选择商品主档</option>{orderProducts.map(product => <option key={product.productRecordId} value={product.productRecordId}>{product.sku} · {product.chineseName || product.englishName || "—"}</option>)}</select><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setProductPickerLine(index)}>搜索更多商品</Button></label><label className="grid gap-1 text-xs text-muted">采购数量<input required type="number" min="1" max="2147483647" step="1" className={inputClass()} value={line.expectedQty} onChange={event => setLines(current => current.map((row, i) => i === index ? { ...row, expectedQty: event.target.value } : row))} /></label><label className="grid gap-1 text-xs text-muted">单价<input required inputMode="decimal" pattern={String.raw`[0-9]+(\.[0-9]{1,6})?`} className={inputClass()} value={line.unitPrice} onChange={event => setLines(current => current.map((row, i) => i === index ? { ...row, unitPrice: event.target.value } : row))} /></label><div className="flex items-end"><Button type="button" size="sm" variant="secondary" disabled={lines.length <= 1} onClick={() => { setProductPickerLine(null); setLines(current => current.filter((_, i) => i !== index)); }}>移除</Button></div><label className="grid gap-1 text-xs text-muted sm:col-span-2">商品备注<input maxLength={500} className={inputClass()} value={line.notes} onChange={event => setLines(current => current.map((row, i) => i === index ? { ...row, notes: event.target.value } : row))} /></label><p aria-label={"第 " + (index + 1) + " 行采购金额"} className="self-end py-2 text-sm tabular-nums sm:col-span-2">明细金额：{purchaseLineAmount(line) ?? "待填写有效数量及单价"} {purchaseLineAmount(line) !== null ? orderForm.currency : ""}</p></div>)}</div><p aria-label="采购金额合计" className="text-right text-sm font-semibold tabular-nums">采购金额合计：{purchaseOrderAmount(lines) ?? "待填写完整有效明细"} {purchaseOrderAmount(lines) !== null ? orderForm.currency : ""}</p><p className="text-xs text-muted">金额按数量 × 单价计算；不含未录入的运费、税费及折扣，不代表付款或结算。</p>{productPickerLine !== null && <div className="space-y-2"><WmsProductPicker key={currentWorkspace + ":" + productPickerLine} workspaceId={currentWorkspace} selectedId={lines[productPickerLine]?.productRecordId ?? ""} onSelect={(id, product) => { setSelectedProducts(current => [...current.filter(item => item.productRecordId !== id), { productRecordId: id, sku: product.sku, chineseName: product.chineseName, englishName: product.englishName }]); setLines(current => current.map((line, index) => index === productPickerLine ? { ...line, productRecordId: id } : line)); setProductPickerLine(null); }} /><Button type="button" size="sm" variant="ghost" onClick={() => setProductPickerLine(null)}>关闭商品搜索</Button></div>}<div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" disabled={lines.length >= 100} onClick={() => setLines(current => [...current, { productRecordId: "", expectedQty: "", unitPrice: "", notes: "" }])}>添加商品明细</Button><Button size="sm" disabled={busy || (editingOrder ? !canEdit : !canCreate) || !orderSuppliers.length || purchaseOrderAmount(lines) === null || new Set(lines.map(line => line.productRecordId)).size !== lines.length || lines.some(line => !line.productRecordId)}>{editingOrder ? "保存草稿修改" : "保存采购单草稿"}</Button>{!orderSuppliers.length && <span className="self-center text-xs text-amber-800">可使用“搜索更多供应商”查询，或先建立供应商档案。</span>}{new Set(lines.map(line => line.productRecordId).filter(Boolean)).size < lines.filter(line => line.productRecordId).length && <span role="alert" className="self-center text-xs text-amber-800">同一商品不能重复，请合并采购数量。</span>}{!orderProducts.length && <span className="self-center text-xs text-amber-800">首批未读取到商品，可使用“搜索更多商品”查询。</span>}</div></form></section></WorkbenchDialog>
    <WorkbenchDialog open={!!cancellingOrder} title="作废采购单" onClose={() => setCancellingOrder(null)} busy={busy}>
      <form onSubmit={cancelOrder} className="space-y-4">
        <p className="text-sm">确认作废采购单 {cancellingOrder?.number}？作废后不能继续编辑、下单或创建收货单，原采购资料和操作记录会保留。</p>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <label className="grid gap-1 text-sm">作废原因<textarea required maxLength={500} rows={3} className="rounded border border-border bg-background p-2" value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></label>
        <div className="flex gap-2"><Button disabled={busy || !canEdit || !cancelReason.trim()}>确认作废</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setCancellingOrder(null)}>返回</Button></div>
      </form>
    </WorkbenchDialog>
    <WorkbenchDialog open={!!selectedOrder} title="采购单详情" onClose={() => setSelectedOrder(null)} drawer>
      {selectedOrder && <div className="space-y-4"><div role="tablist" aria-label="采购单业务详情" className="flex flex-wrap gap-2 border-b border-border pb-3">{([["all", "全部资料"], ["receipts", "收货进度"], ["payments", "付款与退款"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={detailSection === value} onClick={() => setDetailSection(value)} className={`rounded border px-3 py-2 text-sm ${detailSection === value ? "border-brand text-brand" : "border-border text-muted"}`}>{label}</button>)}</div><dl className="grid grid-cols-2 gap-4 text-sm">
        {[["采购单号", selectedOrder.number], ["供应商", selectedOrder.supplier.name], ["状态", statusLabel(selectedOrder.status)], ["币种", selectedOrder.currency], ["预计交期", selectedOrder.expectedAt?.slice(0, 10) || "—"], ["版本", String(selectedOrder.revision)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1">{value}</dd></div>)}
      </dl><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["SKU", "商品", "计划数量", "单价", "金额", "商品备注"].map(label => <th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{selectedOrder.lines.map(line => <tr key={line.id}><td className="p-2">{line.product.sku}</td><td className="p-2">{line.product.chineseName || line.product.englishName || "—"}</td><td className="p-2">{line.expectedQty}</td><td className="p-2">{line.unitPrice} {selectedOrder.currency}</td><td className="p-2 tabular-nums">{purchaseLineAmount(line) ?? "未读取"} {purchaseLineAmount(line) !== null ? selectedOrder.currency : ""}</td><td className="max-w-64 whitespace-pre-wrap break-words p-2">{line.notes || "—"}</td></tr>)}</tbody></table></div><p aria-label="采购金额合计" className="text-right text-sm font-semibold tabular-nums">采购金额合计：{purchaseOrderAmount(selectedOrder.lines) ?? "未读取"} {purchaseOrderAmount(selectedOrder.lines) !== null ? selectedOrder.currency : ""}</p><p className="text-xs text-muted">金额按数量 × 单价计算；不含未录入的运费、税费及折扣，不代表付款或结算。</p>
      {selectedOrder.receiptSummary ? <section aria-label="采购收货汇总" className="space-y-2 rounded border border-border p-3 text-sm"><h3 className="font-semibold">{purchaseReceiptStateLabels[selectedOrder.receiptSummary.state]}</h3><p>计划 {selectedOrder.receiptSummary.plannedQty} · 已上架 {selectedOrder.receiptSummary.putawayQty} · 尚未完成上架 {selectedOrder.receiptSummary.remainingToPutawayQty}</p><p>累计实收 {selectedOrder.receiptSummary.receivedQty} · 累计合格 {selectedOrder.receiptSummary.acceptedQty} · 累计拒收 {selectedOrder.receiptSummary.rejectedQty}</p><p className="text-xs text-muted">汇总来自当前 WMS 记录；取消的收货单不计入。补收会累计实收数量，上架完成不代表已付款或当前可用库存。</p></section> : <p className="text-sm text-muted">收货汇总未读取，请核对仓库权限及关联单据。</p>}
      {detailSection !== "receipts" && selectedOrder.paymentSummary && <section aria-label="采购付款台账" className="space-y-3 border-t border-border pt-3"><h3 className="text-sm font-semibold">付款记录</h3><dl className="grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted">采购金额</dt><dd>{selectedOrder.paymentSummary.totalAmount} {selectedOrder.currency}</dd></div><div><dt className="text-xs text-muted">已登记付款</dt><dd>{selectedOrder.paymentSummary.paidAmount} {selectedOrder.currency}</dd></div><div><dt className="text-xs text-muted">未付余额</dt><dd>{selectedOrder.paymentSummary.outstandingAmount} {selectedOrder.currency}</dd></div></dl><PurchasePaymentRecords payments={selectedOrder.paymentSummary.payments} />{selectedOrder.paymentSummary.approvals.length > 0 && <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["复核状态", "日期", "金额", "流水号", "操作"].map(label => <th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{selectedOrder.paymentSummary.approvals.map(approval => <tr key={approval.id}><td className="p-2">{paymentStatusLabel(approval.status)}</td><td className="p-2">{approval.paidAt.slice(0, 10)}</td><td className="p-2">{approval.amount} {approval.currency}</td><td className="p-2">{approval.reference}{approval.decisionReason && <span className="block text-xs text-muted">{approval.decisionReason}</span>}</td><td className="p-2"><div className="flex gap-1">{approval.status === "PENDING" && approval.requestedBy !== user?.userId && canApprove && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => void decidePaymentApproval(selectedOrder, approval, "APPROVE")}>复核通过</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decidePaymentApproval(selectedOrder, approval, "REJECT")}>拒绝</Button></>}{approval.status === "APPROVED" && approval.requestedBy === user?.userId && <Button size="sm" disabled={busy || !canCreate} onClick={() => void confirmPayment(approval)}>确认登记</Button>}</div></td></tr>)}</tbody></table></div>}{["ORDERED", "RECEIVING"].includes(selectedOrder.status) && <form onSubmit={submitPaymentApproval} className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2"><label className="grid gap-1 text-xs text-muted">付款申请金额<input aria-label="付款金额" required inputMode="decimal" pattern={String.raw`[0-9]+(\.[0-9]{1,6})?`} max={selectedOrder.paymentSummary.outstandingAmount} className={inputClass()} value={paymentForm.amount} onChange={event => setPaymentForm(form => ({ ...form, amount: event.target.value }))} /></label><label className="grid gap-1 text-xs text-muted">付款日期<input aria-label="付款日期" type="date" required className={inputClass()} value={paymentForm.paidAt} onChange={event => setPaymentForm(form => ({ ...form, paidAt: event.target.value }))} /></label><label className="grid gap-1 text-xs text-muted">付款方式<select aria-label="付款方式" className={inputClass()} value={paymentForm.method} onChange={event => setPaymentForm(form => ({ ...form, method: event.target.value }))}><option value="BANK_TRANSFER">银行转账</option><option value="PAYPAL">PayPal</option><option value="CASH">现金</option><option value="OTHER">其他</option></select></label><label className="grid gap-1 text-xs text-muted">付款流水号<input aria-label="付款流水号" required maxLength={120} className={inputClass()} value={paymentForm.reference} onChange={event => setPaymentForm(form => ({ ...form, reference: event.target.value }))} /></label><label className="grid gap-1 text-xs text-muted sm:col-span-2">备注<input aria-label="付款备注" maxLength={500} className={inputClass()} value={paymentForm.notes} onChange={event => setPaymentForm(form => ({ ...form, notes: event.target.value }))} /></label><div className="sm:col-span-2"><Button size="sm" disabled={busy || !canCreate}>提交付款复核</Button><p className="mt-1 text-xs text-muted">复核并由申请人确认后才计入已付金额；此处不执行转账，也不构成总账结算。</p></div></form>}</section>}
      {detailSection !== "receipts" && selectedOrder.paymentSummary && <section aria-label="采购退款台账" className="space-y-3 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">退款记录</h3>
        <p className="text-xs text-muted">付款累计 {selectedOrder.paymentSummary.grossPaidAmount} · 已退款 {selectedOrder.paymentSummary.refundedAmount} · 净付款 {selectedOrder.paymentSummary.paidAmount} {selectedOrder.currency}</p>
        {selectedOrder.paymentSummary.payments.flatMap(payment => payment.refunds).length ? <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["原付款流水号", "退款日期", "金额", "方式", "退款流水号", "备注"].map(label => <th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{selectedOrder.paymentSummary.payments.flatMap(payment => payment.refunds.map(refund => <tr key={refund.id}><td className="p-2">{payment.reference}</td><td className="p-2">{refund.refundedAt.slice(0, 10)}</td><td className="p-2 tabular-nums">{refund.amount} {refund.currency}</td><td className="p-2">{refund.method}</td><td className="p-2">{refund.reference}</td><td className="p-2">{refund.notes || "—"}</td></tr>))}</tbody></table></div> : <p className="text-sm text-muted">暂无已登记退款。</p>}
        {selectedOrder.paymentSummary.refundApprovals.length > 0 && <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["复核状态", "日期", "金额", "流水号", "操作"].map(label => <th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{selectedOrder.paymentSummary.refundApprovals.map(approval => <tr key={approval.id}><td className="p-2">{paymentStatusLabel(approval.status, approval.kind)}</td><td className="p-2">{approval.paidAt.slice(0, 10)}</td><td className="p-2">{approval.amount} {approval.currency}</td><td className="p-2">{approval.reference}{approval.decisionReason && <span className="block text-xs text-muted">{approval.decisionReason}</span>}</td><td className="p-2"><div className="flex gap-1">{approval.status === "PENDING" && approval.requestedBy !== user?.userId && canApprove && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => void decidePaymentApproval(selectedOrder, approval, "APPROVE")}>复核通过</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decidePaymentApproval(selectedOrder, approval, "REJECT")}>拒绝</Button></>}{approval.status === "PENDING" && approval.requestedBy === user?.userId && <Button size="sm" variant="ghost" disabled={busy || !canCreate} onClick={() => void cancelRefundApproval(approval)}>撤销申请</Button>}{approval.status === "APPROVED" && approval.requestedBy === user?.userId && <Button size="sm" disabled={busy || !canCreate} onClick={() => void confirmPayment(approval)}>确认登记</Button>}</div></td></tr>)}</tbody></table></div>}
        {["ORDERED", "RECEIVING"].includes(selectedOrder.status) && selectedOrder.paymentSummary.payments.length > 0 && <form onSubmit={submitRefundApproval} className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted">原付款<select required aria-label="退款原付款" className={inputClass()} value={refundForm.paymentId} onChange={event => setRefundForm(form => ({ ...form, paymentId: event.target.value }))}><option value="">选择原付款</option>{selectedOrder.paymentSummary.payments.filter(payment => remainingRefundAmount(payment) !== "0.000000").map(payment => <option key={payment.id} value={payment.id}>{payment.reference} · 可退 {remainingRefundAmount(payment)} {payment.currency}</option>)}</select></label>
          <label className="grid gap-1 text-xs text-muted">退款金额<input aria-label="退款金额" required inputMode="decimal" pattern={String.raw`[0-9]+(\.[0-9]{1,6})?`} className={inputClass()} value={refundForm.amount} onChange={event => setRefundForm(form => ({ ...form, amount: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs text-muted">退款日期<input aria-label="退款日期" type="date" required className={inputClass()} value={refundForm.refundedAt} onChange={event => setRefundForm(form => ({ ...form, refundedAt: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs text-muted">退款方式<select aria-label="退款方式" className={inputClass()} value={refundForm.method} onChange={event => setRefundForm(form => ({ ...form, method: event.target.value }))}><option value="BANK_TRANSFER">银行转账</option><option value="PAYPAL">PayPal</option><option value="CASH">现金</option><option value="OTHER">其他</option></select></label>
          <label className="grid gap-1 text-xs text-muted">退款流水号<input aria-label="退款流水号" required maxLength={120} className={inputClass()} value={refundForm.reference} onChange={event => setRefundForm(form => ({ ...form, reference: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs text-muted sm:col-span-2">备注<input aria-label="退款备注" maxLength={500} className={inputClass()} value={refundForm.notes} onChange={event => setRefundForm(form => ({ ...form, notes: event.target.value }))} /></label>
          <div className="sm:col-span-2"><Button size="sm" disabled={busy || !canCreate || !refundForm.paymentId}>提交退款复核</Button><p className="mt-1 text-xs text-muted">退款须关联原付款并经独立复核；确认登记后才冲减净付款余额。</p></div>
        </form>}
      </section>}
      {detailSection !== "payments" && <PurchaseReceiptProgress key={selectedOrder.id} ids={selectedOrder.wmsReceiptIds} workspaceId={currentWorkspace} sourceReference={selectedOrder.number} />}
      {selectedOrder.canCancel && <Button size="sm" variant="ghost" disabled={busy || !canEdit} onClick={() => { setError(""); setCancelReason(""); setCancellingOrder(selectedOrder); }}>作废采购单</Button>}
      <p className="text-sm">备注：{selectedOrder.notes || "—"}</p><p className="text-xs text-muted">WMS 收货单：{selectedOrder.wmsReceiptIds.join("、") || "尚未关联"}</p><a className="text-sm text-brand hover:underline" href="/logistics/warehouse?tab=receipts">打开仓库收货单</a></div>}
    </WorkbenchDialog>
  </div>;
}
