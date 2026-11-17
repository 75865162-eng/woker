"use client";

import { type DataTableColumn } from "@/components/ui/data-table";
import { TaskProgress, TaskStatePill, type EditableColumn, type TableGroup } from "@/components/ui/table-variants";
import { type StatItem } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

export type DemoRow = {
  id: string;
  sku: string;
  name: string;
  price: string;
  status: string;
  statusTone: StatusTone;
  owner: string;
};

export const demoRows: DemoRow[] = [
  { id: "1", sku: "AMZ-0026", name: "折叠收纳箱 大号", price: "128.00", status: "选品待提交", statusTone: "warning", owner: "陈爱盈" },
  { id: "2", sku: "AMZ-0027", name: "硅胶厨房垫 双面", price: "46.50", status: "开发中", statusTone: "info", owner: "陈爱盈" },
  { id: "3", sku: "AMZ-0028", name: "宠物饮水机 静音", price: "215.00", status: "已上架", statusTone: "success", owner: "李文博" },
  { id: "4", sku: "AMZ-0029", name: "车载手机支架", price: "32.80", status: "已超时", statusTone: "danger", owner: "未分配" },
  { id: "5", sku: "AMZ-0030", name: "旅行收纳袋 六件套", price: "89.00", status: "待审核", statusTone: "neutral", owner: "王思远" },
];

export const demoColumns: DataTableColumn<DemoRow>[] = [
  {
    key: "sku",
    header: "SKU",
    width: 110,
    render: (row) => <span className="block truncate font-semibold text-brand">{row.sku}</span>,
  },
  { key: "name", header: "品名", width: 200, render: (row) => <span className="block truncate text-foreground">{row.name}</span> },
  { key: "price", header: "采购价格", width: 100, numeric: true, render: (row) => row.price },
  { key: "status", header: "主状态", width: 120, render: (row) => <StatusPill tone={row.statusTone} dot>{row.status}</StatusPill> },
  { key: "owner", header: "当前负责人", width: 110, render: (row) => <span className="block truncate text-muted">{row.owner}</span> },
  {
    key: "actions",
    header: "操作",
    width: 90,
    align: "right",
    render: () => <span className="text-meta font-semibold text-brand">查看</span>,
  },
];

export type FinanceRow = { id: string; date: string; voucher: string; summary: string; debit: string; credit: string; state: string };

export const financeRows: FinanceRow[] = [
  { id: "1", date: "2026-11-02", voucher: "记-0412", summary: "亚马逊结算（US）", debit: "0.00", credit: "184230.55", state: "已过账" },
  { id: "2", date: "2026-11-03", voucher: "记-0413", summary: "头程运费（深圳→ONT8）", debit: "26480.00", credit: "0.00", state: "已审核" },
  { id: "3", date: "2026-11-05", voucher: "记-0414", summary: "FBA 仓储费", debit: "8912.40", credit: "0.00", state: "草稿" },
];

export const financeColumns: DataTableColumn<FinanceRow>[] = [
  { key: "date", header: "日期", width: 100, render: (row) => <span className="metric-tabular">{row.date}</span> },
  { key: "voucher", header: "凭证号", width: 90, render: (row) => <span className="font-semibold text-brand">{row.voucher}</span> },
  { key: "summary", header: "摘要", width: 240, render: (row) => <span className="block truncate">{row.summary}</span> },
  { key: "debit", header: "借方", width: 110, numeric: true, render: (row) => row.debit },
  { key: "credit", header: "贷方", width: 110, numeric: true, render: (row) => row.credit },
  {
    key: "state",
    header: "状态",
    width: 90,
    render: (row) => (
      <StatusPill tone={row.state === "已过账" ? "success" : row.state === "已审核" ? "info" : "warning"}>{row.state}</StatusPill>
    ),
  },
];

export type GroupRow = { id: string; sku: string; qty: string; price: string; amount: string };

export const groupData: TableGroup<GroupRow>[] = [
  {
    key: "PO-2026-0412",
    label: "采购单 PO-2026-0412 · 深圳市恒达包装有限公司 · 预计 11-20 到仓",
    tone: "default",
    summary: "小计 12,400.00 元 · 3 个 SKU",
    rows: [
      { id: "1", sku: "AMZ-0026", qty: "200", price: "32.00", amount: "6400.00" },
      { id: "2", sku: "AMZ-0031", qty: "100", price: "48.00", amount: "4800.00" },
      { id: "3", sku: "AMZ-0032", qty: "40", price: "30.00", amount: "1200.00" },
    ],
  },
  {
    key: "PO-2026-0413",
    label: "采购单 PO-2026-0413 · 东莞市昌盛家居用品 · 逾期 2 天",
    tone: "warning",
    summary: "小计 8,150.00 元 · 2 个 SKU",
    rows: [
      { id: "4", sku: "AMZ-0040", qty: "50", price: "95.00", amount: "4750.00" },
      { id: "5", sku: "AMZ-0041", qty: "100", price: "34.00", amount: "3400.00" },
    ],
  },
];

export const groupColumns: DataTableColumn<GroupRow>[] = [
  { key: "sku", header: "SKU", width: 120, render: (row) => <span className="font-semibold text-brand">{row.sku}</span> },
  { key: "qty", header: "数量", width: 80, numeric: true, render: (row) => row.qty },
  { key: "price", header: "单价", width: 80, numeric: true, render: (row) => row.price },
  { key: "amount", header: "金额", width: 100, numeric: true, render: (row) => row.amount },
];

export type TaskRow = { id: string; name: string; state: "queued" | "running" | "success" | "failed" | "canceled"; done: number; total: number; elapsed: string };

export const taskRows: TaskRow[] = [
  { id: "1", name: "同步 Amazon 订单（US）", state: "success", done: 1284, total: 1284, elapsed: "42s" },
  { id: "2", name: "拉取广告报表（Sponsored Products）", state: "running", done: 640, total: 1200, elapsed: "18s" },
  { id: "3", name: "计算补货建议", state: "queued", done: 0, total: 420, elapsed: "—" },
  { id: "4", name: "同步库存快照（EU）", state: "failed", done: 12, total: 380, elapsed: "6s" },
];

export const taskColumns: DataTableColumn<TaskRow>[] = [
  { key: "name", header: "任务", width: 280, render: (row) => <span className="block truncate">{row.name}</span> },
  { key: "state", header: "状态", width: 100, render: (row) => <TaskStatePill state={row.state} /> },
  { key: "progress", header: "进度", width: 180, render: (row) => <TaskProgress done={row.done} total={row.total} /> },
  { key: "elapsed", header: "耗时", width: 80, numeric: true, render: (row) => row.elapsed },
  {
    key: "actions",
    header: "操作",
    width: 80,
    align: "right",
    render: (row) => <span className="text-meta font-semibold text-brand">{row.state === "failed" ? "重试" : "日志"}</span>,
  },
];

export const editableColumns: EditableColumn<DemoRow>[] = [
  { key: "sku", header: "SKU", width: 120, render: (row) => <span className="font-semibold text-brand">{row.sku}</span> },
  { key: "name", header: "品名", width: 200, render: (row) => <span className="block truncate">{row.name}</span> },
  {
    key: "price",
    header: "盘点价",
    width: 120,
    numeric: true,
    align: "right",
    editable: true,
    inputType: "number",
    value: (row) => row.price,
    validate: (value) => (value.trim() === "" || Number.isNaN(Number(value)) ? "请输入数字" : null),
    render: (row) => row.price,
  },
  { key: "owner", header: "负责人", width: 110, render: (row) => <span className="text-muted">{row.owner}</span> },
];

export const kpiItems: StatItem[] = [
  { key: "sku", label: "在售 SKU", value: "1,284", hint: "较上周 +18" },
  { key: "order", label: "待发货订单", value: "62", tone: "warning", hint: "超 24h 3 单" },
  { key: "stock", label: "库存周转天数", value: "48.5", hint: "目标 ≤ 60" },
  { key: "acos", label: "近 7 日 ACOS", value: "18.4%", tone: "success", hint: "较上周 −1.2pt" },
  { key: "payable", label: "应付账款", value: "¥ 486,200.00", tone: "danger", hint: "7 日内到期" },
];

export function sumAmounts(values: string[]): string {
  const cents = values.reduce((total, value) => total + Math.round(Number(value.replace(/,/g, "")) * 100), 0);
  return (cents / 100).toFixed(2);
}

export function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-section text-foreground">{title}</h2>
        {note ? <p className="text-meta text-muted">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function TokenRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-1.5 last:border-b-0">
      <code className="w-44 shrink-0 truncate text-meta text-muted">{name}</code>
      <span className="min-w-0 truncate text-meta text-foreground">{value}</span>
    </div>
  );
}
