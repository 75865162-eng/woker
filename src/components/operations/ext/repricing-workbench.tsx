"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, extPost, money, statusLabel, useExt } from "./kit";

type Rule = { id: string; name: string; marketplace: string; strategy: string; floorPrice: string; ceilingPrice: string; stepAmount: string; minMarginBp: number; enabled: boolean; revision: number; notes: string };
type Offer = { id: string; asin: string; sellerSku: string; marketplace: string; myPrice: string; buyBoxPrice: string; lowestCompetitorPrice: string; competitorCount: number; buyBoxOwner: string; buyBoxStatus: string; revision: number; lastSeenAt: string };
type QueueItem = { id: string; asin: string; sellerSku: string; marketplace: string; currentPrice: string; suggestedPrice: string; reason: string; status: string; appliedPrice: string | null };

const blankRule = { name: "", marketplace: "US", strategy: "MATCH_LOWEST", floorPrice: "0", ceilingPrice: "9999", stepAmount: "0.01", minMarginBp: "0", notes: "" };
const blankOffer = { asin: "", sellerSku: "", marketplace: "US", myPrice: "0", buyBoxPrice: "0", lowestCompetitorPrice: "0", competitorCount: "0", buyBoxOwner: "" };
const strategies = [{ value: "MATCH_LOWEST", label: "对齐最低竞争价" }, { value: "BEAT_LOWEST", label: "低于最低价一个步长" }, { value: "HOLD", label: "保持现价" }];

export function RepricingWorkbench() {
  const [tab, setTab] = useState<"RULE" | "WATCH" | "QUEUE">("QUEUE");
  const [rule, setRule] = useState({ ...blankRule });
  const [editRuleId, setEditRuleId] = useState("");
  const [offer, setOffer] = useState({ ...blankOffer });
  const [editOfferId, setEditOfferId] = useState("");
  const [queueFilter, setQueueFilter] = useState("PENDING");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const rules = useExt<{ items: Rule[] }>("repricing-rules");
  const offers = useExt<{ items: Offer[]; summary: { total: number; losing: number; winning: number } }>("offers");
  const queue = useExt<{ items: QueueItem[]; pending: number }>("queue", { status: queueFilter });

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <Notice error={error || rules.error || offers.error || queue.error || ""} notice={notice} />
    <Kpis items={[
      { label: "监控 ASIN", value: String(offers.data?.summary.total ?? 0) },
      { label: "丢失购物车", value: String(offers.data?.summary.losing ?? 0), tone: (offers.data?.summary.losing ?? 0) > 0 ? "warn" : undefined },
      { label: "待处理建议", value: String(queue.data?.pending ?? 0), tone: (queue.data?.pending ?? 0) > 0 ? "warn" : "good" },
      { label: "启用规则", value: String((rules.data?.items ?? []).filter(row => row.enabled).length) },
    ]} />
    <Tabs value={tab} onChange={value => setTab(value as "RULE" | "WATCH" | "QUEUE")} tabs={[{ id: "QUEUE", label: "调价队列", count: queue.data?.pending }, { id: "WATCH", label: "跟卖监控", count: offers.data?.summary.total }, { id: "RULE", label: "调价规则", count: rules.data?.items.length }]} />

    {tab === "RULE" && <>
      <Section title={editRuleId ? "编辑调价规则" : "新建调价规则"} description="地板价/天花板价由人工设定，系统只在区间内给建议，永不越过毛利底线。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="规则名称" value={rule.name} onChange={value => setRule(c => ({ ...c, name: value }))} />
          <SelectField label="站点" value={rule.marketplace} onChange={value => setRule(c => ({ ...c, marketplace: value }))} options={["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"].map(value => ({ value, label: value }))} />
          <SelectField label="策略" value={rule.strategy} onChange={value => setRule(c => ({ ...c, strategy: value }))} options={strategies} />
          <Field label="地板价" value={rule.floorPrice} onChange={value => setRule(c => ({ ...c, floorPrice: value }))} />
          <Field label="天花板价" value={rule.ceilingPrice} onChange={value => setRule(c => ({ ...c, ceilingPrice: value }))} />
          <Field label="步长" value={rule.stepAmount} onChange={value => setRule(c => ({ ...c, stepAmount: value }))} />
          <Field label="最低毛利（bp）" value={rule.minMarginBp} onChange={value => setRule(c => ({ ...c, minMarginBp: value }))} hint="2000 = 20%" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run("save-repricing-rule", { ...rule, ...(editRuleId ? { id: editRuleId, revision: rules.data?.items.find(row => row.id === editRuleId)?.revision } : {}) }, editRuleId ? "规则已更新。" : "规则已创建。", async () => { setRule({ ...blankRule }); setEditRuleId(""); await rules.reload(); })}>{editRuleId ? "保存修改" : "新建规则"}</Button>
          {editRuleId && <Button size="sm" variant="ghost" onClick={() => { setEditRuleId(""); setRule({ ...blankRule }); }}>取消</Button>}
        </div>
      </Section>
      <Section title="规则清单">
        <Table
          rows={rules.data?.items ?? []}
          empty="还没有调价规则。建议先建一条「对齐最低竞争价」的规则，再生成调价建议。"
          columns={[
            { key: "name", label: "规则" },
            { key: "marketplace", label: "站点" },
            { key: "strategy", label: "策略", render: row => strategies.find(item => item.value === row.strategy)?.label ?? row.strategy },
            { key: "range", label: "价格区间", render: row => `${money(row.floorPrice)} ~ ${money(row.ceilingPrice)}`, align: "right" },
            { key: "minMarginBp", label: "最低毛利", align: "right", render: row => `${(row.minMarginBp / 100).toFixed(2)}%` },
            { key: "enabled", label: "状态", render: row => <Badge text={row.enabled ? "启用" : "停用"} tone={row.enabled ? "good" : "muted"} /> },
            { key: "ops", label: "操作", render: row => <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => {
                setEditRuleId(row.id);
                setRule({ name: row.name, marketplace: row.marketplace, strategy: row.strategy, floorPrice: String(Number(row.floorPrice)), ceilingPrice: String(Number(row.ceilingPrice)), stepAmount: String(Number(row.stepAmount)), minMarginBp: String(row.minMarginBp), notes: row.notes });
              }}>编辑</Button>
              <Button size="sm" variant="ghost" onClick={() => void run("save-repricing-rule", { id: row.id, revision: row.revision, name: row.name, marketplace: row.marketplace, strategy: row.strategy, floorPrice: Number(row.floorPrice), ceilingPrice: Number(row.ceilingPrice), stepAmount: Number(row.stepAmount), minMarginBp: row.minMarginBp, notes: row.notes, enabled: !row.enabled }, row.enabled ? "规则已停用。" : "规则已启用。", rules.reload)}>{row.enabled ? "停用" : "启用"}</Button>
            </div> },
          ]}
        />
      </Section>
    </>}

    {tab === "WATCH" && <>
      <Section title={editOfferId ? "更新跟卖观察" : "录入跟卖观察"} description="同一 ASIN + 站点只保留一条最新观察；购物车状态由我的价格与购物车价比较得出，不推断唯一赢家。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="ASIN" value={offer.asin} onChange={value => setOffer(c => ({ ...c, asin: value }))} />
          <Field label="SKU" value={offer.sellerSku} onChange={value => setOffer(c => ({ ...c, sellerSku: value }))} />
          <SelectField label="站点" value={offer.marketplace} onChange={value => setOffer(c => ({ ...c, marketplace: value }))} options={["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP"].map(value => ({ value, label: value }))} />
          <Field label="我的价格" value={offer.myPrice} onChange={value => setOffer(c => ({ ...c, myPrice: value }))} />
          <Field label="购物车价" value={offer.buyBoxPrice} onChange={value => setOffer(c => ({ ...c, buyBoxPrice: value }))} />
          <Field label="最低竞争价" value={offer.lowestCompetitorPrice} onChange={value => setOffer(c => ({ ...c, lowestCompetitorPrice: value }))} />
          <Field label="跟卖数量" value={offer.competitorCount} onChange={value => setOffer(c => ({ ...c, competitorCount: value }))} />
          <Field label="购物车持有方" value={offer.buyBoxOwner} onChange={value => setOffer(c => ({ ...c, buyBoxOwner: value }))} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run("save-offer", { ...offer, ...(editOfferId ? { id: editOfferId, revision: offers.data?.items.find(row => row.id === editOfferId)?.revision } : {}) }, editOfferId ? "观察记录已更新。" : "观察记录已写入。", async () => { setOffer({ ...blankOffer }); setEditOfferId(""); await offers.reload(); })}>{editOfferId ? "保存修改" : "写入观察"}</Button>
          {editOfferId && <Button size="sm" variant="ghost" onClick={() => { setEditOfferId(""); setOffer({ ...blankOffer }); }}>取消</Button>}
        </div>
      </Section>
      <Section title="监控清单" actions={<Button size="sm" variant="ghost" disabled={busy || !rules.data?.items.length} onClick={() => void run("generate-queue", {}, "调价建议已生成，进入队列等待人工采纳。", async () => { await queue.reload(); setTab("QUEUE"); })}>按规则生成调价建议</Button>}>
        <Table
          rows={offers.data?.items ?? []}
          empty="还没有跟卖观察数据。SP-API 竞品报价接入前，可先手工录入重点 ASIN。"
          columns={[
            { key: "asin", label: "ASIN", render: row => <span className="font-mono">{row.asin}</span> },
            { key: "marketplace", label: "站点" },
            { key: "myPrice", label: "我的价", align: "right", render: row => money(row.myPrice) },
            { key: "buyBoxPrice", label: "购物车价", align: "right", render: row => money(row.buyBoxPrice) },
            { key: "lowestCompetitorPrice", label: "最低竞争价", align: "right", render: row => money(row.lowestCompetitorPrice) },
            { key: "competitorCount", label: "跟卖数", align: "right" },
            { key: "buyBoxStatus", label: "购物车", render: row => <Badge text={statusLabel(row.buyBoxStatus)} tone={row.buyBoxStatus === "LOSING" ? "warn" : row.buyBoxStatus === "WINNING" ? "good" : "muted"} /> },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" onClick={() => {
              setEditOfferId(row.id);
              setOffer({ asin: row.asin, sellerSku: row.sellerSku, marketplace: row.marketplace, myPrice: String(Number(row.myPrice)), buyBoxPrice: String(Number(row.buyBoxPrice)), lowestCompetitorPrice: String(Number(row.lowestCompetitorPrice)), competitorCount: String(row.competitorCount), buyBoxOwner: row.buyBoxOwner });
            }}>更新</Button> },
          ]}
        />
      </Section>
    </>}

    {tab === "QUEUE" && <Section title="调价队列" description="系统只给建议价与理由，采纳才记录落地价；不改写任何线上报价。"
      actions={<select className="h-8 rounded border border-border bg-background px-2 text-xs" value={queueFilter} onChange={event => setQueueFilter(event.target.value)}>
        <option value="PENDING">待处理</option><option value="APPLIED">已采纳</option><option value="DISMISSED">已忽略</option><option value="ALL">全部</option>
      </select>}>
      <Table
        rows={queue.data?.items ?? []}
        empty={queueFilter === "PENDING" ? "没有待处理的调价建议。先维护跟卖观察与规则，再点「按规则生成调价建议」。" : "该状态下暂无记录。"}
        columns={[
          { key: "asin", label: "ASIN", render: row => <span className="font-mono">{row.asin}</span> },
          { key: "marketplace", label: "站点" },
          { key: "currentPrice", label: "现价", align: "right", render: row => money(row.currentPrice) },
          { key: "suggestedPrice", label: "建议价", align: "right", render: row => <span className="font-semibold">{money(row.suggestedPrice)}</span> },
          { key: "reason", label: "理由" },
          { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "PENDING" ? "info" : "muted"} /> },
          { key: "ops", label: "操作", render: row => row.status === "PENDING" ? <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("decide-queue", { id: row.id, decision: "apply", appliedPrice: Number(row.suggestedPrice) }, "已记录采纳，请到卖家后台实际改价。", queue.reload)}>采纳</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("decide-queue", { id: row.id, decision: "dismiss" }, "建议已忽略。", queue.reload)}>忽略</Button>
          </div> : <span className="text-muted">{row.appliedPrice ? money(row.appliedPrice) : "—"}</span> },
        ]}
      />
    </Section>}
  </div>;
}
