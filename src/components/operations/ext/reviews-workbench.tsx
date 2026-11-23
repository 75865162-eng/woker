"use client";

import { useState } from "react";
import { WorkbenchPageTemplate } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import { AreaField, Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, bp, extPost, today, useExt, statusLabel } from "./kit";

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
  const [filter, setFilter] = useState({ sentiment: "", status: "" });
  const [form, setForm] = useState({ ...blankReview });
  const [editId, setEditId] = useState("");
  const [reply, setReply] = useState({ id: "", text: "" });
  const [perf, setPerf] = useState({ ...blankPerf });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const reviews = useExt<{ items: Review[]; summary: Summary }>("reviews", filter);
  const byAsin = useExt<AsinResponse>("reviews-by-asin", {}, tab === "ASIN");
  const performance = useExt<{ items: Performance[] }>("performance");

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  const current = reviews.data?.items.find(row => row.id === editId);
  const summary = reviews.data?.summary;

  return <WorkbenchPageTemplate context={<Notice error={error || reviews.error || performance.error || ""} notice={notice} />} main={<div className="space-y-5">
    <Tabs value={tab} onChange={value => { setTab(value as "REVIEW" | "ASIN" | "PERF"); setExpandedAsin(""); }} tabs={[{ id: "REVIEW", label: "评论与差评", count: summary?.total }, { id: "ASIN", label: "ASIN 聚合", count: byAsin.data?.total }, { id: "PERF", label: "店铺绩效", count: performance.data?.items.length }]} />

    {tab === "REVIEW" && <>
      <Kpis items={[
        { label: "评论总数", value: String(summary?.total ?? 0) },
        { label: "差评数", value: String(summary?.negative ?? 0), tone: (summary?.negative ?? 0) > 0 ? "warn" : undefined, hint: `差评率 ${bp(summary?.negativeRateBp ?? 0)}` },
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

      <Section title="评论列表" description="差评优先处理；回复内容仅作为内部处置记录，本系统不会向 Amazon 发送消息。"
        actions={<div className="flex gap-2">
          <select className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.sentiment} onChange={event => setFilter(c => ({ ...c, sentiment: event.target.value }))}>
            <option value="">全部情绪</option><option value="NEGATIVE">差评</option><option value="NEUTRAL">中评</option><option value="POSITIVE">好评</option>
          </select>
          <select className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter.status} onChange={event => setFilter(c => ({ ...c, status: event.target.value }))}>
            <option value="">全部状态</option><option value="NEW">待处理</option><option value="REPLIED">已回复</option><option value="IGNORED">已忽略</option>
          </select>
        </div>}>
        <Table
          rows={reviews.data?.items ?? []}
          empty="还没有评论记录。可手工录入，或在 SP-API 评论报告接入后批量导入。"
          columns={[
            { key: "reviewedAt", label: "日期" },
            { key: "marketplace", label: "站点" },
            { key: "asin", label: "ASIN / SKU", render: row => <span className="font-mono">{row.asin || "—"}<br />{row.sellerSku || "—"}</span> },
            { key: "rating", label: "星级", render: row => <span className="tabular-nums">{row.rating} ★</span> },
            { key: "sentiment", label: "情绪", render: row => <Badge text={statusLabel(row.sentiment)} tone={row.sentiment === "NEGATIVE" ? "warn" : row.sentiment === "POSITIVE" ? "good" : "muted"} /> },
            { key: "title", label: "标题 / 内容", render: row => <span className="block max-w-[280px] truncate" title={row.content}>{row.title || row.content || "—"}</span> },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "NEW" ? "info" : "muted"} /> },
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
      </Section>

      {reply.id && <Section title="差评处置" description="回复内容进入内部处置记录，状态变为已回复；忽略后不再提醒。">
        <AreaField label="回复内容（内部记录）" value={reply.text} onChange={value => setReply(c => ({ ...c, text: value }))} />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !reply.text.trim()} onClick={() => void run("decide-review", { id: reply.id, action: "reply", replyText: reply.text, revision: reviews.data?.items.find(row => row.id === reply.id)?.revision }, "评论已标记为已回复。", async () => { setReply({ id: "", text: "" }); await reviews.reload(); })}>标记已回复</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("decide-review", { id: reply.id, action: "ignore", revision: reviews.data?.items.find(row => row.id === reply.id)?.revision }, "评论已忽略。", async () => { setReply({ id: "", text: "" }); await reviews.reload(); })}>忽略</Button>
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

      <Section title="绩效历史" description="判定阈值取自亚马逊公开卖家绩效标准，仅作预警，不代替卖家后台的账户健康页。">
        <Table
          rows={performance.data?.items ?? []}
          empty="还没有绩效快照。"
          columns={[
            { key: "period", label: "统计区间", render: row => `${row.periodStart} ~ ${row.periodEnd}` },
            { key: "marketplace", label: "站点" },
            { key: "totalOrders", label: "订单量", align: "right" },
            { key: "orderDefectRateBp", label: "ODR", align: "right", render: row => bp(row.orderDefectRateBp) },
            { key: "lateShipmentRateBp", label: "迟发率", align: "right", render: row => bp(row.lateShipmentRateBp) },
            { key: "validTrackingRateBp", label: "有效追踪", align: "right", render: row => bp(row.validTrackingRateBp) },
            { key: "verdict", label: "判定", render: row => row.verdict.ok
              ? <Badge text="全部达标" tone="good" />
              : <Badge text={`超标：${row.verdict.breached.join("、")}`} tone="warn" /> },
          ]}
        />
      </Section>
    </>}
  </div>} />;
}
