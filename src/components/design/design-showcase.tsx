"use client";

import { useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  DenseDataTable,
  EditableDataTable,
  FinanceDataTable,
  GroupedDataTable,
  StandardDataTable,
  TaskDataTable,
  TaskProgress,
  TaskStatePill,
  type EditableColumn,
  type TableGroup,
} from "@/components/ui/table-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { Section, SectionBody, SectionHeader } from "@/components/ui/section";
import { StatStrip, type StatItem } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { ToolbarField } from "@/components/ui/toolbar";
import {
  Checkbox,
  DatePicker,
  Field,
  FormGrid,
  Input,
  Radio,
  SegmentedControl,
  Select,
  Textarea,
} from "@/components/ui/form-controls";
import { Dialog, Drawer, Dropdown, Popover, Tooltip } from "@/components/ui/overlays";
import {
  Breadcrumb,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  Pagination,
  Tabs,
} from "@/components/ui/page-chrome";
import {
  ChartPanel,
  DetailGroup,
  DetailItem,
  FormPageTemplate,
  HealthIndicator,
  ListPageTemplate,
} from "@/components/templates/page-templates";
import { DENSITY_HINTS, DENSITY_LABELS, DENSITY_ORDER, useDensityStore } from "@/lib/stores/density-store";

/**
 * 设计系统自检页。
 *
 * 这里的示例数据是虚构的展示样本，不来自任何业务表。
 * 所有公共组件必须先在本文通过肉眼验收，才允许进入业务页面。
 */

/* ------------------------------------------------------------------ 演示数据 */

type DemoRow = {
  id: string;
  sku: string;
  name: string;
  price: string;
  status: string;
  statusTone: StatusTone;
  owner: string;
};

const demoRows: DemoRow[] = [
  { id: "1", sku: "AMZ-0026", name: "折叠收纳箱 大号", price: "128.00", status: "选品待提交", statusTone: "warning", owner: "陈爱盈" },
  { id: "2", sku: "AMZ-0027", name: "硅胶厨房垫 双面", price: "46.50", status: "开发中", statusTone: "info", owner: "陈爱盈" },
  { id: "3", sku: "AMZ-0028", name: "宠物饮水机 静音", price: "215.00", status: "已上架", statusTone: "success", owner: "李文博" },
  { id: "4", sku: "AMZ-0029", name: "车载手机支架", price: "32.80", status: "已超时", statusTone: "danger", owner: "未分配" },
  { id: "5", sku: "AMZ-0030", name: "旅行收纳袋 六件套", price: "89.00", status: "待审核", statusTone: "neutral", owner: "王思远" },
];

const demoColumns: DataTableColumn<DemoRow>[] = [
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

type FinanceRow = { id: string; date: string; voucher: string; summary: string; debit: string; credit: string; state: string };

const financeRows: FinanceRow[] = [
  { id: "1", date: "2026-11-02", voucher: "记-0412", summary: "亚马逊结算（US）", debit: "0.00", credit: "184230.55", state: "已过账" },
  { id: "2", date: "2026-11-03", voucher: "记-0413", summary: "头程运费（深圳→ONT8）", debit: "26480.00", credit: "0.00", state: "已审核" },
  { id: "3", date: "2026-11-05", voucher: "记-0414", summary: "FBA 仓储费", debit: "8912.40", credit: "0.00", state: "草稿" },
];

const financeColumns: DataTableColumn<FinanceRow>[] = [
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

type GroupRow = { id: string; sku: string; qty: string; price: string; amount: string };

const groupData: TableGroup<GroupRow>[] = [
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

const groupColumns: DataTableColumn<GroupRow>[] = [
  { key: "sku", header: "SKU", width: 120, render: (row) => <span className="font-semibold text-brand">{row.sku}</span> },
  { key: "qty", header: "数量", width: 80, numeric: true, render: (row) => row.qty },
  { key: "price", header: "单价", width: 80, numeric: true, render: (row) => row.price },
  { key: "amount", header: "金额", width: 100, numeric: true, render: (row) => row.amount },
];

type TaskRow = { id: string; name: string; state: "queued" | "running" | "success" | "failed" | "canceled"; done: number; total: number; elapsed: string };

const taskRows: TaskRow[] = [
  { id: "1", name: "同步 Amazon 订单（US）", state: "success", done: 1284, total: 1284, elapsed: "42s" },
  { id: "2", name: "拉取广告报表（Sponsored Products）", state: "running", done: 640, total: 1200, elapsed: "18s" },
  { id: "3", name: "计算补货建议", state: "queued", done: 0, total: 420, elapsed: "—" },
  { id: "4", name: "同步库存快照（EU）", state: "failed", done: 12, total: 380, elapsed: "6s" },
];

const taskColumns: DataTableColumn<TaskRow>[] = [
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

const editableColumns: EditableColumn<DemoRow>[] = [
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

const kpiItems: StatItem[] = [
  { key: "sku", label: "在售 SKU", value: "1,284", hint: "较上周 +18" },
  { key: "order", label: "待发货订单", value: "62", tone: "warning", hint: "超 24h 3 单" },
  { key: "stock", label: "库存周转天数", value: "48.5", hint: "目标 ≤ 60" },
  { key: "acos", label: "近 7 日 ACOS", value: "18.4%", tone: "success", hint: "较上周 −1.2pt" },
  { key: "payable", label: "应付账款", value: "¥ 486,200.00", tone: "danger", hint: "7 日内到期" },
];

/** 金额求和：按字符串千分位解析，避免浮点累加误差 */
function sumAmounts(values: string[]): string {
  const cents = values.reduce((total, value) => total + Math.round(Number(value.replace(/,/g, "")) * 100), 0);
  return (cents / 100).toFixed(2);
}

/* ---------------------------------------------------------------- 布局小件 */

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
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

function TokenRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-1.5 last:border-b-0">
      <code className="w-44 shrink-0 truncate text-meta text-muted">{name}</code>
      <span className="min-w-0 truncate text-meta text-foreground">{value}</span>
    </div>
  );
}

export function DesignShowcase() {
  const density = useDensityStore((state) => state.density);
  const setDensity = useDensityStore((state) => state.setDensity);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "detail" | "history">("overview");
  const [segmented, setSegmented] = useState<"all" | "pending" | "done">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  return (
    <div className="flex flex-col gap-8">
      <Section>
        <SectionBody className="space-y-2">
          <p className="text-body text-foreground">
            本页是设计系统的验收基准。所有公共组件先在这里通过肉眼验收，才允许进入业务页面；
            <code className="mx-1 rounded-sm bg-surface-muted px-1 text-meta">npm run ui:guard</code>
            会拦住绕过组件的写法。
          </p>
          <p className="text-meta text-muted">
            轮廓：桌面优先，验收分辨率 1366×768 / 1440×900 / 1920×1080。壳层导航 224px（折叠 64px）、顶栏 48px、多标签栏 36px、页面留白 24px。
          </p>
        </SectionBody>
      </Section>

      {/* ------------------------------------------------------- 1 排版 */}
      <Block title="1 · 排版尺度" note="六档字号，字重只有 400 / 600 两级">
        <Section>
          <SectionBody className="space-y-0">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
              <span className="text-display text-foreground">商品主档 · 1,284 个 SKU</span>
              <code className="shrink-0 text-meta text-muted">display 20/28/600</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-y border-border py-2">
              <span className="text-title text-foreground">采购单 PO-2026-0412</span>
              <code className="shrink-0 text-meta text-muted">title 18/26/600</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-section text-foreground">筛选结果 · 共 1,284 个商品</span>
              <code className="shrink-0 text-meta text-muted">section 15/20/600</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-body text-foreground">正文与表单项 13px，长时间阅读不疲劳，单屏可容纳更多行。</span>
              <code className="shrink-0 text-meta text-muted">body 13/20/400</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-table text-foreground">表格单元格 13px，数字列叠加 tabular-nums 纵向对齐</span>
              <code className="shrink-0 text-meta text-muted">table 13/20/400</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-meta text-muted">辅助信息、表头、计数、时间戳统一 12px</span>
              <code className="shrink-0 text-meta text-muted">meta 12/16/400</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 pt-2">
              <span className="text-micro text-muted">导航分组标签</span>
              <code className="shrink-0 text-meta text-muted">micro 11/16/600（仅此一处）</code>
            </div>
          </SectionBody>
        </Section>
      </Block>

      {/* ------------------------------------------------------- 2 颜色 */}
      <Block title="2 · 颜色令牌" note="语义命名，业务页不允许写裸色值">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="表面与文字" />
            <SectionBody className="space-y-0">
              {[
                ["bg-background", "页面底色 #f6f7f9"],
                ["bg-surface", "卡片 / 表格 #ffffff"],
                ["bg-surface-muted", "表头 / 悬停 #eef2f5"],
                ["bg-surface-sunken", "次级凹面 #f8fafb"],
                ["text-foreground", "主文字 #111827"],
                ["text-muted", "辅助文字 #667085"],
                ["border-border", "分隔线 #d9e0e7"],
                ["text-brand", "品牌 / 链接 #176b87"],
              ].map(([name, desc]) => (
                <TokenRow key={name} name={name} value={desc} />
              ))}
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="状态：浅底 + 墨色成对出现" />
            <SectionBody className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-md bg-success-soft px-2 py-1 text-meta text-success-ink">成功 / 已上架</span>
                <span className="rounded-md bg-warning-soft px-2 py-1 text-meta text-warning-ink">警告 / 待处理</span>
                <span className="rounded-md bg-danger-soft px-2 py-1 text-meta text-danger-ink">错误 / 已超时</span>
                <span className="rounded-md bg-info-soft px-2 py-1 text-meta text-info-ink">信息 / 进行中</span>
                <span className="rounded-md bg-surface-muted px-2 py-1 text-meta text-neutral-ink">中性 / 草稿</span>
              </div>
              <p className="text-meta text-muted">
                浅底只配墨色使用。把 <code>text-success</code> 直接放在浅底上对比度只有 3.4:1，不合格。
              </p>
            </SectionBody>
          </Section>
        </div>
      </Block>

      {/* --------------------------------------------- 3 间距/圆角/阴影 */}
      <Block title="3 · 间距 · 圆角 · 阴影 · 层级 · 动效" note="4px 基数">
        <div className="grid gap-4 lg:grid-cols-3">
          <Section>
            <SectionHeader title="间距" />
            <SectionBody className="space-y-0">
              {[
                ["--space-1", "4px"],
                ["--space-2", "8px"],
                ["--space-3", "12px"],
                ["--space-4", "16px"],
                ["--pad-card", "16px 卡片内距"],
                ["--pad-page", "24px 页面留白"],
                ["--gap-section", "16px 区块间距"],
              ].map(([name, value]) => (
                <TokenRow key={name} name={name} value={value} />
              ))}
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="圆角与阴影" />
            <SectionBody className="space-y-3">
              <div className="flex items-end gap-3">
                {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((cls) => (
                  <div key={cls} className="text-center">
                    <div className={`h-10 w-11 border border-border bg-surface ${cls}`} />
                    <code className="mt-1 block text-label text-muted">{cls.replace("rounded-", "")}</code>
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-3">
                {["shadow-1", "shadow-2", "shadow-3", "shadow-pop"].map((cls) => (
                  <div key={cls} className="text-center">
                    <div className={`h-8 w-11 rounded-md border border-border bg-surface ${cls}`} />
                    <code className="mt-1 block text-label text-muted">{cls}</code>
                  </div>
                ))}
              </div>
              <p className="text-meta text-muted">平面内容一律用边框分层，阴影只给浮层。</p>
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="层级与动效" />
            <SectionBody className="space-y-0">
              {[
                ["--z-sticky", "10 表头 / 吸底"],
                ["--z-dropdown", "30 下拉 / 浮层"],
                ["--z-drawer", "40 抽屉"],
                ["--z-modal", "50 弹窗"],
                ["--z-toast", "60 全局提示"],
                ["--motion-fast", "120ms 悬停 / 聚焦"],
                ["--motion-base", "180ms 展开 / 切换"],
                ["--motion-slow", "260ms 抽屉 / 弹窗"],
              ].map(([name, value]) => (
                <TokenRow key={name} name={name} value={value} />
              ))}
            </SectionBody>
          </Section>
        </div>
      </Block>

      {/* ------------------------------------------------------- 4 密度 */}
      <Block title="4 · 信息密度" note="真实改变行高、内距、控件高与字号，不是换按钮状态">
        <Section>
          <SectionBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                ariaLabel="信息密度"
                value={density}
                onChange={(value) => setDensity(value)}
                options={DENSITY_ORDER.map((item) => ({ value: item, label: DENSITY_LABELS[item] }))}
              />
              <span className="text-meta text-muted">
                当前：{DENSITY_LABELS[density]} · {DENSITY_HINTS[density]}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table>
                <thead>
                  <tr>
                    <th>档位</th>
                    <th>行高</th>
                    <th>单元格内距</th>
                    <th>控件高度</th>
                    <th>正文字号</th>
                    <th>适用</th>
                  </tr>
                </thead>
                <tbody>
                  {DENSITY_ORDER.map((item) => (
                    <tr key={item} className={item === density ? "bg-brand/5" : undefined}>
                      <td className="font-semibold">{DENSITY_LABELS[item]}</td>
                      <td className="metric-tabular">{item === "compact" ? "32px" : item === "standard" ? "40px" : "48px"}</td>
                      <td className="metric-tabular">
                        {item === "compact" ? "6 / 10" : item === "standard" ? "10 / 12" : "14 / 14"}
                      </td>
                      <td className="metric-tabular">{item === "compact" ? "32px" : item === "standard" ? "36px" : "40px"}</td>
                      <td className="metric-tabular">{item === "comfortable" ? "14px" : "13px"}</td>
                      <td className="text-muted">{DENSITY_HINTS[item]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-meta text-muted">
              偏好保存在 localStorage（键 <code>erp-density</code>），壳层顶栏也有入口。切换后本页下方所有表格立即跟随。
            </p>
          </SectionBody>
        </Section>
      </Block>

      {/* ------------------------------------------------------- 5 按钮 */}
      <Block title="5 · 按钮与七态" note="Default / Hover / Focus / Active / Disabled / Loading / Error">
        <Section>
          <SectionBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>主操作</Button>
              <Button variant="secondary">次要操作</Button>
              <Button variant="ghost">文字按钮</Button>
              <Button variant="danger">危险操作</Button>
              <Button size="sm">小号</Button>
              <Button size="icon" aria-label="添加">
                <Plus aria-hidden className="h-3.5 w-3.5" />
              </Button>
              <Button disabled>禁用</Button>
              <Button disabled>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                保存中
              </Button>
            </div>
            <div className="grid gap-2 text-meta text-muted md:grid-cols-2">
              <p>悬停：主按钮加深到 brand-dark；次按钮加浅底并加深描边。</p>
              <p>聚焦：统一 2px 品牌色焦点环 + 1px 偏移；键盘可见，鼠标不显示。</p>
              <p>禁用：透明度 50% + 关闭指针事件，不改变布局占位。</p>
              <p>加载：按钮内转圈、文案改「保存中」，同时禁用避免重复提交。</p>
            </div>
          </SectionBody>
        </Section>
      </Block>

      {/* ------------------------------------------------------- 6 表单 */}
      <Block title="6 · 表单控件" note="高度走 --control-h，standard 档 36px">
        <Section>
          <SectionBody className="space-y-4">
            <FormGrid columns={3}>
              <Field label="SKU" required htmlFor="d-sku">
                <Input id="d-sku" placeholder="AMZ-0000" leading={<Search aria-hidden className="h-3.5 w-3.5" />} />
              </Field>
              <Field label="采购价" htmlFor="d-price" hint="含税，单位元">
                <Input id="d-price" defaultValue="32.80" numeric />
              </Field>
              <Field label="校验失败示例" htmlFor="d-err" error="该 SKU 已存在">
                <Input id="d-err" defaultValue="AMZ-0026" invalid />
              </Field>
              <Field label="站点" htmlFor="d-site">
                <Select
                  id="d-site"
                  defaultValue="US"
                  options={[
                    { value: "US", label: "美国 US" },
                    { value: "CA", label: "加拿大 CA" },
                    { value: "MX", label: "墨西哥 MX" },
                  ]}
                />
              </Field>
              <Field label="生效日期" htmlFor="d-date">
                <DatePicker id="d-date" defaultValue="2026-11-15" />
              </Field>
              <Field label="禁用" htmlFor="d-disabled">
                <Input id="d-disabled" defaultValue="只读字段" disabled />
              </Field>
            </FormGrid>
            <Field label="备注" htmlFor="d-note">
              <Textarea id="d-note" placeholder="供应商交期调整说明…" />
            </Field>
            <div className="flex flex-wrap gap-6">
              <Checkbox label="自动补货" description="库存低于安全库存时生成补货建议" defaultChecked />
              <Checkbox label="禁用项" disabled />
              <Radio name="d-radio" label="按 SKU 采购" defaultChecked />
              <Radio name="d-radio" label="按箱采购" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-meta text-muted">分段单选</span>
              <SegmentedControl
                ariaLabel="示例分段"
                value={segmented}
                onChange={setSegmented}
                options={[
                  { value: "all", label: "全部", count: 1284 },
                  { value: "pending", label: "待处理", count: 62 },
                  { value: "done", label: "已完成", count: 1222 },
                ]}
              />
            </div>
          </SectionBody>
        </Section>
      </Block>

      {/* ------------------------------------------------------- 7 反馈 */}
      <Block title="7 · 状态与反馈" note="StatusPill / Badge / Alert / Empty / Loading / Error">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="状态药丸与徽标" />
            <SectionBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="success" dot>已上架</StatusPill>
                <StatusPill tone="info" dot>开发中</StatusPill>
                <StatusPill tone="warning" dot>选品待提交</StatusPill>
                <StatusPill tone="danger" dot>已超时</StatusPill>
                <StatusPill tone="neutral" dot>草稿</StatusPill>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">已同步</Badge>
                <Badge tone="warning">待补数据</Badge>
                <Badge tone="danger">同步失败</Badge>
                <Badge tone="info">NEEDS_DATA</Badge>
                <Badge>默认</Badge>
              </div>
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="提示条" />
            <SectionBody className="space-y-2">
              <Alert tone="info" title="数据来源" description="本页数据由同步中心于 06:00 拉取，缓存 4 小时。" />
              <Alert tone="warning" title="缺少必要数据" description="3 个 SKU 缺少采购价，补货建议无法计算。" />
              <Alert tone="danger" title="同步失败" description="Amazon Ads 报表拉取超时，可重试。" />
            </SectionBody>
          </Section>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="空状态" />
            <SectionBody>
              <EmptyState
                title="还没有采购计划"
                description="从补货建议生成，或手工新建一张采购计划。"
                action={
                  <Button size="sm">
                    <Plus aria-hidden className="h-3 w-3" />
                    新建采购计划
                  </Button>
                }
              />
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="加载与错误" />
            <SectionBody className="space-y-3">
              <LoadingState rows={3} />
              <ErrorState message="拉取 Amazon 广告报表时上游返回 503，已自动重试 2 次。" onRetry={() => undefined} />
            </SectionBody>
          </Section>
        </div>
      </Block>

      {/* ------------------------------------------------------- 8 浮层 */}
      <Block title="8 · 浮层" note="Tooltip / Popover / Dropdown / Dialog / Drawer">
        <Section>
          <SectionBody className="flex flex-wrap items-center gap-2">
            <Tooltip content="沿用最近一次同步的库存快照">
              <Button size="sm" variant="secondary">悬停看提示</Button>
            </Tooltip>
            <Popover trigger={<Button size="sm" variant="secondary">Popover</Button>} label="示例浮层">
              <div className="space-y-1 px-2 py-1.5 text-meta text-muted">
                <p className="text-body text-foreground">任意内容</p>
                <p>点击外部或按 Esc 关闭。</p>
              </div>
            </Popover>
            <Dropdown
              trigger={<Button size="sm" variant="secondary">操作菜单</Button>}
              header="批量操作"
              items={[
                { key: "export", label: "导出选中", icon: <Download aria-hidden className="h-3.5 w-3.5" /> },
                { key: "assign", label: "调整负责人", description: "需采购权限" },
                { key: "delete", label: "删除", danger: true, dividerBefore: true },
              ]}
            />
            <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
              打开弹窗
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDrawerOpen(true)}>
              打开抽屉
            </Button>
          </SectionBody>
        </Section>

        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="新建采购计划"
          description="弹窗使用原生 dialog，焦点陷阱与焦点归还由浏览器负责。"
          footer={
            <>
              <Button size="sm" variant="secondary" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={() => setDialogOpen(false)}>
                确认创建
              </Button>
            </>
          }
        >
          <FormGrid columns={2}>
            <Field label="供应商" htmlFor="dlg-supplier">
              <Select
                id="dlg-supplier"
                defaultValue="hd"
                options={[
                  { value: "hd", label: "深圳市恒达包装" },
                  { value: "cs", label: "东莞市昌盛家居" },
                ]}
              />
            </Field>
            <Field label="预计到仓" htmlFor="dlg-eta">
              <DatePicker id="dlg-eta" />
            </Field>
          </FormGrid>
        </Dialog>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="采购单 PO-2026-0412"
          description="右侧抽屉用于详情与编辑，不打断列表上下文。"
          footer={
            <>
              <Button size="sm" variant="secondary" onClick={() => setDrawerOpen(false)}>
                关闭
              </Button>
              <Button size="sm" onClick={() => setDrawerOpen(false)}>
                保存
              </Button>
            </>
          }
        >
          <DetailGroup title="基础信息" columns={2}>
            <DetailItem label="供应商" value="深圳市恒达包装有限公司" />
            <DetailItem label="预计到仓" value="2026-11-20" />
            <DetailItem label="结算方式" value="月结 30 天" />
            <DetailItem label="仓位" value="深圳仓" />
          </DetailGroup>
        </Drawer>
      </Block>

      {/* ------------------------------------------------- 9 导航与分页 */}
      <Block title="9 · 导航、标签页与分页">
        <Section>
          <SectionBody className="space-y-4">
            <div className="space-y-2">
              <Breadcrumb items={[{ label: "采购管理", href: "#" }, { label: "采购订单", href: "#" }, { label: "PO-2026-0412" }]} />
              <PageHeader
                title="采购单 PO-2026-0412"
                status={<StatusPill tone="warning" dot>待审核</StatusPill>}
                meta="创建于 2026-11-12 · 陈爱盈"
                secondaryActions={
                  <Button size="sm" variant="secondary">
                    打印
                  </Button>
                }
                actions={<Button size="sm">提交审核</Button>}
              />
            </div>
            <Tabs
              ariaLabel="详情分区"
              value={tab}
              onChange={setTab}
              items={[
                { key: "overview", label: "概览" },
                { key: "detail", label: "明细", count: 5 },
                { key: "history", label: "操作历史", count: 12 },
              ]}
            />
            <Pagination total={1284} page={page} pageSize={50} onPage={setPage} onPageSizeChange={() => undefined} />
          </SectionBody>
        </Section>
      </Block>

      {/* --------------------------------------------------- 10 六种表格 */}
      <Block title="10 · 六种表格" note="同一内核，不同行组织结构；不要用同一种表硬套所有业务">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-meta text-muted">StandardDataTable · 默认列表，带搜索与列显隐</p>
            <StandardDataTable
              ariaLabel="标准表格示例"
              title="筛选结果"
              meta="共 5 条"
              search={{ value: "", onChange: () => undefined, placeholder: "搜索 SKU / 品名" }}
              columnToggle
              pinnedColumnKeys={["sku"]}
              columns={demoColumns}
              rows={demoRows}
              getRowKey={(row) => row.id}
              selection={{
                selectedKeys: selected,
                onToggle: (key) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  }),
                onToggleAll: (checked) => setSelected(checked ? new Set(demoRows.map((row) => row.id)) : new Set()),
              }}
            />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">DenseDataTable · 32px 行高，适合库存、库龄、对账明细</p>
            <DenseDataTable ariaLabel="紧凑表格示例" columns={demoColumns} rows={demoRows} getRowKey={(row) => row.id} maxHeight="240px" />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">FinanceDataTable · 等宽数字 + 合计行，金额全程字符串</p>
            <FinanceDataTable
              ariaLabel="财务表格示例"
              title="凭证明细"
              columns={financeColumns}
              rows={financeRows}
              getRowKey={(row) => row.id}
              totalLabel="合计"
              totalColumns={[
                { key: "debit", compute: (rows) => sumAmounts(rows.map((row) => row.debit)) },
                { key: "credit", compute: (rows) => sumAmounts(rows.map((row) => row.credit)) },
              ]}
            />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">GroupedDataTable · 一行主体 + N 行明细，保留配对语义</p>
            <GroupedDataTable ariaLabel="分组表格示例" columns={groupColumns} groups={groupData} getRowKey={(row) => row.id} />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">EditableDataTable · 逐格编辑，Enter 提交、Esc 取消</p>
            <EditableDataTable
              ariaLabel="可编辑表格示例"
              title="库存盘点"
              columns={editableColumns}
              rows={demoRows}
              getRowKey={(row) => row.id}
            />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">TaskDataTable · 状态 + 进度，作业类页面</p>
            <TaskDataTable
              ariaLabel="任务表格示例"
              title="同步任务"
              columns={taskColumns}
              rows={taskRows}
              getRowKey={(row) => row.id}
              stateOf={(row) => row.state}
            />
          </div>
        </div>
      </Block>

      {/* --------------------------------------------------- 11 六种模板 */}
      <Block title="11 · 六种页面模板" note="ListPage / DetailPage / Workbench / Dashboard / FormPage / Console">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-meta text-muted">ListPage：页头 + KPI + 筛选（含已选条件）+ 表格 + 分页</p>
            <Section>
              <SectionBody>
                <ListPageTemplate
                  header={
                    <PageHeader
                      description="列表页不在页面内重复标题，壳层顶栏已经渲染页面名。"
                      secondaryActions={
                        <Button size="sm" variant="secondary">
                          <Download aria-hidden className="h-3 w-3" />
                          导出
                        </Button>
                      }
                      actions={
                        <Button size="sm">
                          <Plus aria-hidden className="h-3 w-3" />
                          新建
                        </Button>
                      }
                    />
                  }
                  stats={<StatStrip items={kpiItems.slice(0, 4)} />}
                  filters={
                    <FilterBar
                      resultSummary="已筛出 5 条"
                      activeFilters={[
                        { key: "site", label: "站点：US", onRemove: () => undefined },
                        { key: "status", label: "状态：开发中", onRemove: () => undefined },
                      ]}
                      onReset={() => undefined}
                    >
                      <ToolbarField label="站点">
                        <Select
                          defaultValue="US"
                          options={[
                            { value: "US", label: "美国" },
                            { value: "CA", label: "加拿大" },
                          ]}
                        />
                      </ToolbarField>
                    </FilterBar>
                  }
                  table={<DataTable ariaLabel="模板示例表格" columns={demoColumns} rows={demoRows.slice(0, 3)} getRowKey={(row) => row.id} />}
                  pagination={<Pagination total={1284} page={1} pageSize={50} onPage={() => undefined} />}
                />
              </SectionBody>
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section>
              <SectionBody>
                <p className="mb-2 text-meta text-muted">DetailPage 分组详情</p>
                <DetailGroup title="基础信息" columns={2}>
                  <DetailItem label="采购单号" value="PO-2026-0412" />
                  <DetailItem label="供应商" value="深圳市恒达包装有限公司" />
                  <DetailItem label="预计到仓" value="2026-11-20" hint="逾期 2 天将标记" />
                  <DetailItem label="结算方式" value="月结 30 天" />
                </DetailGroup>
              </SectionBody>
            </Section>
            <Section>
              <SectionBody>
                <p className="mb-2 text-meta text-muted">Workbench / Dashboard 图表容器</p>
                <ChartPanel title="近 14 日广告花费" description="示例占位，真实页面接入现有图表组件" height={180}>
                  <div className="flex h-full items-end gap-1.5">
                    {[38, 52, 44, 61, 58, 70, 66, 74, 62, 80, 72, 88, 78, 92].map((value, index) => (
                      <div key={index} className="flex-1 rounded-t-sm bg-brand/20" style={{ height: `${value}%` }} />
                    ))}
                  </div>
                </ChartPanel>
              </SectionBody>
            </Section>
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">FormPage：分组 + 未保存提醒 + 粘性保存条</p>
            <Section>
              <SectionBody>
                <FormPageTemplate
                  dirty
                  sticky={false}
                  onSave={() => undefined}
                  onCancel={() => undefined}
                  actions={
                    <Button size="sm" variant="ghost">
                      保存为草稿
                    </Button>
                  }
                >
                  <FormGrid columns={3}>
                    <Field label="单据编号">
                      <Input defaultValue="PO-2026-0412" disabled />
                    </Field>
                    <Field label="供应商" required>
                      <Select defaultValue="hd" options={[{ value: "hd", label: "深圳市恒达包装" }]} />
                    </Field>
                    <Field label="预计到仓">
                      <DatePicker />
                    </Field>
                  </FormGrid>
                </FormPageTemplate>
              </SectionBody>
            </Section>
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">Console：运行状态 + 成败统计 + 任务 + 新鲜度</p>
            <Section>
              <SectionBody className="space-y-3">
                <HealthIndicator
                  items={[
                    { key: "api", label: "同步服务", state: "ok", detail: "02:14 前正常" },
                    { key: "queue", label: "任务队列", state: "warn", detail: "积压 18" },
                    { key: "ads", label: "Ads 报表", state: "down", detail: "上游 503" },
                  ]}
                />
                <StatStrip
                  items={[
                    { key: "ok", label: "今日成功", value: "1,284", tone: "success" },
                    { key: "fail", label: "今日失败", value: "3", tone: "danger" },
                    { key: "fresh", label: "订单数据新鲜度", value: "18 分钟", tone: "success" },
                  ]}
                />
              </SectionBody>
            </Section>
          </div>
        </div>
      </Block>

      {/* ---------------------------------------------- 12 遗留表格归化 */}
      <Block title="12 · 遗留表格归化层" note="左：归化后（默认生效）；右：加 .erp-table-reset 豁免后的原始标记">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="归化后（默认生效）" description="表头浅底 + 12px 常规字重、行分隔线、悬停、吸顶、等宽数字" />
            <div>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>品名</th>
                    <th className="text-right">数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>AMZ-0026</td>
                    <td>折叠收纳箱 大号</td>
                    <td className="metric-tabular text-right">200</td>
                  </tr>
                  <tr>
                    <td>AMZ-0031</td>
                    <td>硅胶厨房垫 双面</td>
                    <td className="metric-tabular text-right">100</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
          <Section>
            <SectionHeader title="豁免后（原始标记）" description="同一份标记，去掉归化层后的样子；用来说明这层到底做了什么" />
            <div className="erp-table-reset">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>品名</th>
                    <th>数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>AMZ-0026</td>
                    <td>折叠收纳箱 大号</td>
                    <td>200</td>
                  </tr>
                  <tr>
                    <td>AMZ-0031</td>
                    <td>硅胶厨房垫 双面</td>
                    <td>100</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </Block>
    </div>
  );
}
