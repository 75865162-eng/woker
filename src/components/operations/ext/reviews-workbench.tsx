"use client";

import { useEffect, useRef, useState } from "react";
import { WorkbenchPageTemplate } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import { AreaField, Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, bp, extPost, today, useExt, statusLabel } from "./kit";
import { PerformanceCards } from "./performance-cards";

type Review = {
  id: string; marketplace: string; asin: string; sellerSku: string; rating: number; sentiment: string;
  title: string; content: string; reviewer: string; reviewedAt: string; source: string; status: string;
  replyText: string; revision: number;
};
type Summary = { total: number; positive: number; neutral: number; negative: number; replied: number; negativeRateBp: number; replyRateBp: number };
type AsinDetail = { id: string; marketplace: string; asin: string; rating: number; sentiment: string; vp: boolean; title: string; content: string; status: string; reviewedAt: string };
type AsinGroup = {
  id: string; marketplace: string; asin: string; total: number; avgRating: number | null;
  positive: number; neutral: number; negative: number; vp: number;
  negativeRateBp: number; latestReviewedAt: string; details: AsinDetail[];
};
type AsinResponse = { items: AsinGroup[]; total: number; reviewTotal: number };
type ReviewTrend = { date: string; total: number; negative: number };

/** 迷你折线：纯 SVG，数据来自服务端按日聚合；无数据时留空，不画假线。 */
function Sparkline({ values, tone }: { values: number[]; tone?: "warn" | "good" }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - min) / span) * 24}`).join(" ");
  const stroke = tone === "warn" ? "var(--danger)" : tone === "good" ? "var(--success)" : "var(--brand)";
  return (
    <svg width="72" height="30" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`近 ${values.length} 日趋势`}>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 环比：当前半段合计相对上一半段合计的变化百分比；上段为 0 时返回 null（不造无穷大）。 */
function changeOverPrevious(values: number[]): number | null {
  if (values.length < 2) return null;
  const half = Math.floor(values.length / 2) || 1;
  const prev = values.slice(0, half).reduce((a, b) => a + b, 0);
  const curr = values.slice(half).reduce((a, b) => a + b, 0);
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

/** KPI 卡右侧：迷你趋势 + 环比上期（后 7 天 vs 前 7 天）。 */
function TrendHint({ trend, field }: { trend?: ReviewTrend[]; field: "total" | "negative" }) {
  const values = (trend ?? []).slice(-14).map(row => row[field]);
  if (values.length < 2) return null;
  const change = changeOverPrevious(values);
  const up = change != null && change > 0;
  const down = change != null && change < 0;
  return <>
    <Sparkline values={values} tone={field === "negative" ? "warn" : undefined} />
    {change != null ? <span className={field === "negative" ? (up ? "text-danger-ink" : down ? "text-success-ink" : "") : (up ? "text-success-ink" : down ? "text-danger-ink" : "")}>
      {up ? "▲" : down ? "▼" : "—"} 环比 {change > 0 ? "+" : ""}{change}%
    </span> : null}
  </>;
}

type Performance = {
  id: string; marketplace: string; periodStart: string; periodEnd: string; totalOrders: number;
  orderDefectRateBp: number; lateShipmentRateBp: number; cancellationRateBp: number;
  validTrackingRateBp: number; negativeFeedbackRateBp: number; policyReference: string;
  verdict: { ok: boolean; breached: string[]; flags: Array<{ metric: string; valueBp: number; thresholdBp: number; ok: boolean; rule: string }> };
};

const blankReview = { marketplace: "US", asin: "", sellerSku: "", rating: "1", title: "", content: "", reviewer: "", reviewedAt: today(), source: "MANUAL", externalId: "" };
const blankPerf = {
  marketplace: "US", periodStart: today(), periodEnd: today(), totalOrders: "0", orderDefectRateBp: "0",
  lateShipmentRateBp: "0", cancellationRateBp: "0", validTrackingRateBp: "10000", negativeFeedbackRateBp: "0",
  policyReference: "亚马逊卖家绩效公开阈值：ODR ≤ 1%、迟发率 ≤ 4%、取消率 ≤ 2.5%、有效追踪率 ≥ 95%",
};

export function ReviewsWorkbench() {
  const [tab, setTab] = useState<"REVIEW" | "ASIN" | "PERF">("REVIEW");
  const [expandedAsin, setExpandedAsin] = useState("");
  const [filter, setFilter] = useState({ sentiment: "", status: "", site: "", rating: "", from: "", to: "", keyword: "", page: "1", pageSize: "20" });
  const [keywordDraft, setKeywordDraft] = useState("");
  const [form, setForm] = useState({ ...blankReview });
  const [editId, setEditId] = useState("");
  const [reply, setReply] = useState({ id: "", text: "" });
  const [perf, setPerf] = useState({ ...blankPerf });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // 处置乐观更新：点击后行状态立即变为处理中，成功落定、失败回滚，用户不必盯着整页转圈。
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  // 批量选择：仅当前已加载行可选，动作逐行调用既有 decide-review，不新增写接口。
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reviews = useExt<{ items: Review[]; summary: Summary; trend?: ReviewTrend[]; pagination?: { page: number; pageSize: number; total: number; pageCount: number } }>("reviews", filter);
  const byAsin = useExt<AsinResponse>("reviews-by-asin", {}, tab === "ASIN");
  const performance = useExt<{ items: Performance[] }>("performance");

  // 搜索词写 sessionStorage，切页回来自动回填；300ms 防抖避免逐字打出请求风暴。
  const searchKey = "operations-reviews-search";
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(searchKey) ?? "";
      setKeywordDraft(saved);
      setFilter(current => ({ ...current, keyword: saved, page: "1" }));
    } catch { /* 存储不可用时忽略 */ }
  }, []);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onKeywordChange(value: string) {
    setKeywordDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try { sessionStorage.setItem(searchKey, value); } catch { /* 忽略 */ }
      setFilter(current => ({ ...current, keyword: value, page: "1" }));
    }, 300);
  }
  function patchFilter(patch: Partial<typeof filter>) {
    setFilter(current => ({ ...current, ...patch, page: patch.page ?? "1" }));
  }
  const pagination = reviews.data?.pagination;

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  /** 处置乐观更新：点击即刻把行状态改成目标态，请求成功后刷新、失败则回滚到原状态。 */
  async function decideOptimistic(id: string, message: string, body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    setOptimistic(current => ({ ...current, [id]: "pending" }));
    try {
      await extPost("decide-review", body);
      setNotice(message);
      await reviews.reload();
      setOptimistic(current => { const next = { ...current }; delete next[id]; return next; });
    } catch (cause) {
      setOptimistic(current => { const next = { ...current }; delete next[id]; return next; });
      setError(cause instanceof Error ? cause.message : "操作失败。");
    } finally { setBusy(false); }
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleSelectAll(ids: string[], checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
      return next;
    });
  }
  /** 批量处置：逐行调用既有 decide-review（带各自 revision 防并发覆盖），完成后清空选择。 */
  async function bulkDecide(action: "reply" | "ignore") {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBusy(true); setError(""); setNotice("");
    setOptimistic(current => { const next = { ...current }; for (const id of ids) next[id] = "pending"; return next; });
    let ok = 0; let failed = 0;
    for (const id of ids) {
      const row = reviews.data?.items.find(item => item.id === id);
      try {
        await extPost("decide-review", { id, action, ...(action === "reply" ? { replyText: row?.replyText || "批量标记已回复" } : {}), revision: row?.revision });
        ok += 1;
      } catch { failed += 1; }
    }
    await reviews.reload();
    setOptimistic({});
    setSelected(new Set());
    setBusy(false);
    setNotice(`批量处置完成：成功 ${ok} 条${failed ? `，失败 ${failed} 条` : ""}。`);
  }
  function exportSelected() {
    const rows = (reviews.data?.items ?? []).filter(row => selected.has(row.id));
    if (!rows.length) return;
    const header = ["日期", "站点", "ASIN", "SKU", "星级", "情绪", "标题", "状态"];
    const lines = [header, ...rows.map(row => [row.reviewedAt, row.marketplace, row.asin, row.sellerSku, String(row.rating), row.sentiment, row.title, row.status])];
    // 导出前先脱敏：移除评论正文中的邮箱（PII 默认不明文导出）。
    const sanitize = (value: string) => value.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[已隐藏]");
    const csv = `\uFEFF${lines.map(line => line.map(value => `"${sanitize(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `reviews-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setNotice(`已导出选中 ${rows.length} 条（邮箱已脱敏，未写入数据库）。`);
  }

  const current = reviews.data?.items.find(row => row.id === editId);
  const summary = reviews.data?.summary;

  return <WorkbenchPageTemplate context={<Notice error={error || reviews.error || performance.error || ""} notice={notice} />} main={<div className="space-y-5">
    <Tabs value={tab} onChange={value => { setTab(value as "REVIEW" | "ASIN" | "PERF"); setExpandedAsin(""); }} tabs={[{ id: "REVIEW", label: "评论与差评", count: summary?.total }, { id: "ASIN", label: "ASIN 聚合", count: byAsin.data?.total }, { id: "PERF", label: "店铺绩效", count: performance.data?.items.length }]} />

    {tab === "REVIEW" && <>
      <Kpis items={[
        { label: "评论总数", value: String(summary?.total ?? 0), hint: <TrendHint trend={reviews.data?.trend} field="total" /> },
        { label: "差评数", value: String(summary?.negative ?? 0), tone: (summary?.negative ?? 0) > 0 ? "warn" : undefined, hint: <><span>差评率 {bp(summary?.negativeRateBp ?? 0)}</span><TrendHint trend={reviews.data?.trend} field="negative" /></> },
        { label: "已回复", value: String(summary?.replied ?? 0), hint: `回复率 ${bp(summary?.replyRateBp ?? 0)}` },
        { label: "好评率", value: summary?.total ? bp(Math.round(((summary.positive / summary.total) * 10_000))) : "0.00%" },
      ]} />

      <Section title={editId ? "编辑评论" : "录入评论"} description="手工录入或导入的评论/差评；同一平台评论号重复导入会被唯一约束拦住，不会产生重复记录。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectField label="站点" value={form.marketplace} onChange={value => setForm(c => ({ ...c, marketplace: value }))} options={["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"].map(value => ({ value, label: value }))} />
          <Field label="ASIN" value={form.asin} onChange={value => setForm(c => ({ ...c, asin: value }))} />
          <Field label="SKU" value={form.sellerSku} onChange={value => setForm(c => ({ ...c, sellerSku: value }))} />
          <SelectField label="星级" value={form.rating} onChange={value => setForm(c => ({ ...c, rating: value }))} options={["1", "2", "3", "4", "5"].map(value => ({ value, label: `${value} 星` }))} />
          <Field label="评论日期" type="date" value={form.reviewedAt} onChange={value => setForm(c => ({ ...c, reviewedAt: value }))} />
          <SelectField label="来源" value={form.source} onChange={value => setForm(c => ({ ...c, source: value }))} options={[{ value: "MANUAL", label: "手工录入" }, { value: "SPAPI_REPORT", label: "SP-API 报告" }, { value: "IMPORT", label: "批量导入" }]} />
          <Field label="平台评论号" value={form.externalId} onChange={value => setForm(c => ({ ...c, externalId: value }))} hint="留空表示手工记录" />
          <Field label="标题" value={form.title} onChange={value => setForm(c => ({ ...c, title: value }))} />
          <Field label="评论人" value={form.reviewer} onChange={value => setForm(c => ({ ...c, reviewer: value }))} />
        </div>
        <AreaField label="评论内容" value={form.content} onChange={value => setForm(c => ({ ...c, content: value }))} />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run("save-review", { ...form, ...(editId ? { id: editId, revision: current?.revision } : {}) }, editId ? "评论已更新。" : "评论已录入。", async () => { setForm({ ...blankReview }); setEditId(""); await reviews.reload(); })}>
            {editId ? "保存修改" : "录入评论"}
          </Button>
          {editId && <Button size="sm" variant="ghost" onClick={() => { setEditId(""); setForm({ ...blankReview }); }}>取消</Button>}
        </div>
      </Section>

      <Section title="评论列表" description="差评优先处理；回复内容仅作为内部处置记录，本系统不会向 Amazon 发送消息。筛选同步作用于上方 KPI 与列表。"
        actions={<div className="flex flex-wrap gap-2">
          <select aria-label="评论站点" className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.site} onChange={event => patchFilter({ site: event.target.value })}>
            <option value="">全部站点</option>{["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="评论星级" className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.rating} onChange={event => patchFilter({ rating: event.target.value })}>
            <option value="">全部星级</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} 星</option>)}
          </select>
          <select aria-label="评论情绪" className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.sentiment} onChange={event => patchFilter({ sentiment: event.target.value })}>
            <option value="">全部情绪</option><option value="NEGATIVE">差评</option><option value="NEUTRAL">中评</option><option value="POSITIVE">好评</option>
          </select>
          <select aria-label="评论状态" className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.status} onChange={event => patchFilter({ status: event.target.value })}>
            <option value="">全部状态</option><option value="NEW">待处理</option><option value="REPLIED">已回复</option><option value="IGNORED">已忽略</option>
          </select>
          <input aria-label="评论开始日期" type="date" className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.from} onChange={event => patchFilter({ from: event.target.value })} />
          <input aria-label="评论结束日期" type="date" className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.to} onChange={event => patchFilter({ to: event.target.value })} />
          <input aria-label="评论关键词" className="h-8 w-36 rounded border border-border bg-background px-2 text-xs" placeholder="标题/正文/ASIN" value={keywordDraft} onChange={event => onKeywordChange(event.target.value)} />
        </div>}>
        <Table
          rows={reviews.data?.items ?? []}
          empty="还没有评论记录。可手工录入，或在 SP-API 评论报告接入后批量导入。"
          selectable
          selectedIds={selected}
          onToggle={toggleSelect}
          onToggleAll={toggleSelectAll}
          columns={[
            { key: "reviewedAt", label: "日期" },
            { key: "marketplace", label: "站点" },
            { key: "asin", label: "ASIN / SKU", render: row => <span className="font-mono">{row.asin || "—"}<br />{row.sellerSku || "—"}</span> },
            { key: "rating", label: "星级", render: row => <span className="tabular-nums">{row.rating} ★</span> },
            { key: "sentiment", label: "情绪", render: row => <Badge text={statusLabel(row.sentiment)} tone={row.sentiment === "NEGATIVE" ? "warn" : row.sentiment === "POSITIVE" ? "good" : "muted"} /> },
            { key: "title", label: "标题 / 内容", render: row => <span className="block max-w-[280px] truncate" title={row.content}>{row.title || row.content || "—"}</span> },
            { key: "status", label: "状态", render: row => {
              const pending = optimistic[row.id];
              if (pending) return <Badge text="处理中…" tone="info" />;
              const tone = row.status === "NEW" ? "info" : row.status === "REPLIED" ? "good" : row.status === "IGNORED" ? "muted" : undefined;
              return <Badge text={statusLabel(row.status)} tone={tone} />;
            } },
            { key: "ops", label: "操作", render: row => <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => {
                setEditId(row.id);
                setForm({
                  marketplace: row.marketplace, asin: row.asin, sellerSku: row.sellerSku, rating: String(row.rating),
                  title: row.title, content: row.content, reviewer: row.reviewer, reviewedAt: row.reviewedAt,
                  source: row.source, externalId: "",
                });
              }}>编辑</Button>
              <Button size="sm" variant="ghost" onClick={() => setReply({ id: row.id, text: row.replyText })}>处置</Button>
            </div> },
          ]}
        />
        {selected.size ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-border bg-surface-muted px-2 py-1.5 text-xs" role="toolbar" aria-label="批量操作">
            <span>已选 {selected.size} 条</span>
            <Button size="sm" disabled={busy} onClick={() => void bulkDecide("reply")}>批量标记已回复</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void bulkDecide("ignore")}>批量忽略</Button>
            <Button size="sm" variant="ghost" onClick={exportSelected}>导出选中</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>清空选择</Button>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="评论分页">
          <span>共 {pagination?.total ?? 0} 条 / {pagination?.pageCount ?? 1} 页</span>
          <Button size="sm" variant="ghost" disabled={reviews.loading || (pagination?.page ?? 1) <= 1} onClick={() => patchFilter({ page: String((pagination?.page ?? 1) - 1) })}>上一页</Button>
          <span>第 {pagination?.page ?? 1} 页</span>
          <Button size="sm" variant="ghost" disabled={reviews.loading || (pagination?.page ?? 1) >= (pagination?.pageCount ?? 1)} onClick={() => patchFilter({ page: String((pagination?.page ?? 1) + 1) })}>下一页</Button>
          <select aria-label="评论每页条数" className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.pageSize} onChange={event => patchFilter({ pageSize: event.target.value })}>
            {[20, 50, 100, 200].map(size => <option key={size} value={size}>{size} 条/页</option>)}
          </select>
        </div>
      </Section>

      {reply.id && <Section title="差评处置" description="回复内容进入内部处置记录，状态变为已回复；忽略后不再提醒。">
        <AreaField label="回复内容（内部记录）" value={reply.text} onChange={value => setReply(c => ({ ...c, text: value }))} />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !reply.text.trim()} onClick={() => void decideOptimistic(reply.id, "评论已标记为已回复。", { id: reply.id, action: "reply", replyText: reply.text, revision: reviews.data?.items.find(row => row.id === reply.id)?.revision }).then(() => setReply({ id: "", text: "" }))}>标记已回复</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decideOptimistic(reply.id, "评论已忽略。", { id: reply.id, action: "ignore", revision: reviews.data?.items.find(row => row.id === reply.id)?.revision }).then(() => setReply({ id: "", text: "" }))}>忽略</Button>
          <Button size="sm" variant="ghost" onClick={() => setReply({ id: "", text: "" })}>取消</Button>
        </div>
      </Section>}
    </>}

    {tab === "ASIN" && <>
      <Kpis items={[
        { label: "覆盖 ASIN 数", value: String(byAsin.data?.total ?? 0), hint: "按站点 + ASIN 去重" },
        { label: "评论总数", value: String(byAsin.data?.reviewTotal ?? 0), hint: "赛狐真实评论" },
        { label: "有差评 ASIN", value: String((byAsin.data?.items ?? []).filter(row => row.negative > 0).length), tone: (byAsin.data?.items ?? []).some(row => row.negative > 0) ? "warn" : undefined, hint: "存在中差评，建议优先处理" },
        { label: "平均星级", value: (() => {
          const rows = byAsin.data?.items ?? [];
          const weighted = rows.reduce((sum, row) => sum + (row.avgRating ?? 0) * row.total, 0);
          const count = rows.reduce((sum, row) => sum + row.total, 0);
          return count > 0 ? (weighted / count).toFixed(2) : "—";
        })() },
      ]} />

      <Section title="按 ASIN 聚合" description="数据来自赛狐已同步的真实评价明细（/api/review/pageDetailList.json）：按站点 + ASIN 归集，reviewId 去重，星级推导情绪（4-5 好评 / 3 中评 / 1-2 差评）。差评率高的排前面，点击 ASIN 展开该 ASIN 的评论明细。不补零、不造数据。">
        <Table
          rows={byAsin.data?.items ?? []}
          empty="赛狐评价明细暂无可聚合的数据。确认赛狐同步已拉回「商品·评价明细」后，再回到此页查看按 ASIN 聚合的口径。"
          rowKey={row => row.id}
          columns={[
            { key: "asin", label: "ASIN", render: row => <button type="button" className="text-left font-mono underline decoration-dotted hover:text-brand" onClick={() => setExpandedAsin(current => current === row.id ? "" : row.id)}>{row.asin || "(未填 ASIN)"}</button> },
            { key: "marketplace", label: "站点" },
            { key: "total", label: "评论数", align: "right" },
            { key: "avgRating", label: "平均星级", align: "right", render: row => row.avgRating === null ? "—" : `${row.avgRating.toFixed(2)} ★` },
            { key: "sentiment", label: "好评/中评/差评", render: row => <span className="tabular-nums">{row.positive} / {row.neutral} / <span className={row.negative > 0 ? "text-danger-ink" : ""}>{row.negative}</span></span> },
            { key: "negativeRateBp", label: "差评率", align: "right", render: row => <span className={row.negative > 0 ? "text-danger-ink" : ""}>{bp(row.negativeRateBp)}</span> },
            { key: "vp", label: "VP 数", align: "right", render: row => row.vp },
            { key: "latestReviewedAt", label: "最新评论日", render: row => row.latestReviewedAt || "—" },
          ]}
        />
      </Section>

      {expandedAsin && (() => {
        const group = (byAsin.data?.items ?? []).find(row => row.id === expandedAsin);
        if (!group) return null;
        return <Section title={`ASIN 明细 · ${group.asin || "(未填 ASIN)"}`} description={`${group.marketplace} 站点，共 ${group.total} 条评论（明细最多展示 50 条）。`}>
          <Table
            rows={group.details}
            empty="该 ASIN 暂无可展示的评论明细。"
            columns={[
              { key: "reviewedAt", label: "日期" },
              { key: "rating", label: "星级", align: "right", render: row => `${row.rating} ★` },
              { key: "sentiment", label: "情绪", render: row => <Badge text={statusLabel(row.sentiment)} tone={row.sentiment === "NEGATIVE" ? "warn" : row.sentiment === "POSITIVE" ? "good" : "muted"} /> },
              { key: "vp", label: "VP", render: row => row.vp ? <Badge text="VP" tone="good" /> : <span className="text-muted">—</span> },
              { key: "title", label: "标题 / 内容", render: row => <span className="block max-w-[320px] truncate" title={row.content}>{row.title || row.content || "—"}</span> },
            ]}
          />
        </Section>;
      })()}
    </>}

    {tab === "PERF" && <>
      <Section title="固化绩效快照" description="比率按万分比录入（120 = 1.20%）；同一站点同一天只允许一份快照，避免覆盖历史。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectField label="站点" value={perf.marketplace} onChange={value => setPerf(c => ({ ...c, marketplace: value }))} options={["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"].map(value => ({ value, label: value }))} />
          <Field label="开始日" type="date" value={perf.periodStart} onChange={value => setPerf(c => ({ ...c, periodStart: value }))} />
          <Field label="结束日" type="date" value={perf.periodEnd} onChange={value => setPerf(c => ({ ...c, periodEnd: value }))} />
          <Field label="订单量" value={perf.totalOrders} onChange={value => setPerf(c => ({ ...c, totalOrders: value }))} />
          <Field label="订单缺陷率 bp" value={perf.orderDefectRateBp} onChange={value => setPerf(c => ({ ...c, orderDefectRateBp: value }))} />
          <Field label="迟发率 bp" value={perf.lateShipmentRateBp} onChange={value => setPerf(c => ({ ...c, lateShipmentRateBp: value }))} />
          <Field label="取消率 bp" value={perf.cancellationRateBp} onChange={value => setPerf(c => ({ ...c, cancellationRateBp: value }))} />
          <Field label="有效追踪率 bp" value={perf.validTrackingRateBp} onChange={value => setPerf(c => ({ ...c, validTrackingRateBp: value }))} />
          <Field label="差评率 bp" value={perf.negativeFeedbackRateBp} onChange={value => setPerf(c => ({ ...c, negativeFeedbackRateBp: value }))} />
        </div>
        <Field label="口径依据" value={perf.policyReference} onChange={value => setPerf(c => ({ ...c, policyReference: value }))} />
        <Button size="sm" disabled={busy} onClick={() => void run("capture-performance", perf, "绩效快照已固化。", async () => { await performance.reload(); })}>生成快照</Button>
      </Section>

      <Section title="绩效看板" description="三卡对照客户服务 / 商品合规 / 配送：统计区间、当前值、目标阈值、分子拆解与达标色；历史快照收进卡片底部。判定阈值取自亚马逊公开卖家绩效标准，仅作预警，不代替卖家后台的账户健康页。">
        <PerformanceCards items={(performance.data?.items ?? []) as never} />
      </Section>
    </>}
  </div>} />;
}
