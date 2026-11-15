"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, extPost, money, statusLabel, today, useExt } from "./kit";

type Account = { id: string; channel: string; name: string; sellerId: string; marketplace: string; credentialsRef: string; status: string; revision: number };
type Order = { id: string; accountId: string; channel: string; externalOrderNo: string; sellerSku: string; quantity: number; currency: string; amount: string; status: string; orderedAt: string; buyerCountry: string; trackingNo: string; revision: number };

const channels = [{ value: "EBAY", label: "eBay" }, { value: "WALMART", label: "Walmart" }, { value: "TEMU", label: "Temu" }, { value: "TIKTOK", label: "TikTok Shop" }, { value: "SHOPIFY", label: "Shopify" }, { value: "OTHER", label: "其它" }];
const blankAccount = { channel: "EBAY", name: "", sellerId: "", marketplace: "", credentialsRef: "", status: "ACTIVE" };
const blankOrder = { accountId: "", externalOrderNo: "", sellerSku: "", quantity: "1", currency: "USD", amount: "", status: "PENDING", orderedAt: today(), buyerCountry: "", trackingNo: "" };

export function MultiChannelWorkbench() {
  const [tab, setTab] = useState<"ACCOUNT" | "ORDER">("ACCOUNT");
  const [account, setAccount] = useState({ ...blankAccount });
  const [editAccountId, setEditAccountId] = useState("");
  const [order, setOrder] = useState({ ...blankOrder });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const accounts = useExt<{ items: Account[] }>("channel-accounts");
  const orders = useExt<{ items: Order[]; summary: Array<{ channel: string; orders: number; amount: number }> }>("channel-orders", { channel: filter });

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  const channelLabel = (value: string) => channels.find(item => item.value === value)?.label ?? value;
  const accountName = (id: string) => accounts.data?.items.find(row => row.id === id)?.name ?? id.slice(0, 8);

  return <div className="space-y-6">
    <Notice error={error || accounts.error || orders.error || ""} notice={notice} />
    <Kpis items={[
      { label: "渠道店铺", value: String(accounts.data?.items.filter(row => row.status === "ACTIVE").length ?? 0) },
      { label: "渠道订单", value: String(orders.data?.items.length ?? 0) },
      { label: "待发货", value: String(orders.data?.items.filter(row => row.status === "PENDING").length ?? 0), tone: "warn" },
      { label: "覆盖渠道", value: String(new Set((accounts.data?.items ?? []).map(row => row.channel)).size) },
    ]} />
    <Tabs value={tab} onChange={value => setTab(value as "ACCOUNT" | "ORDER")} tabs={[{ id: "ACCOUNT", label: "渠道店铺", count: accounts.data?.items.length }, { id: "ORDER", label: "渠道订单", count: orders.data?.items.length }]} />

    {tab === "ACCOUNT" && <>
      <Section title={editAccountId ? "编辑渠道店铺" : "新增渠道店铺"} description="Amazon 以外的自营渠道单独建档；凭据只存引用标识，不在此处保存明文密钥。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectField label="渠道" value={account.channel} onChange={value => setAccount(c => ({ ...c, channel: value }))} options={channels} />
          <Field label="店铺名称" value={account.name} onChange={value => setAccount(c => ({ ...c, name: value }))} />
          <Field label="平台卖家 ID" value={account.sellerId} onChange={value => setAccount(c => ({ ...c, sellerId: value }))} />
          <Field label="站点" value={account.marketplace} onChange={value => setAccount(c => ({ ...c, marketplace: value.toUpperCase() }))} hint="如 US / UK" />
          <Field label="凭据引用" value={account.credentialsRef} onChange={value => setAccount(c => ({ ...c, credentialsRef: value }))} hint="如 vault://ebay-main" />
          <SelectField label="状态" value={account.status} onChange={value => setAccount(c => ({ ...c, status: value }))} options={[{ value: "ACTIVE", label: "启用" }, { value: "SUSPENDED", label: "暂停" }, { value: "CLOSED", label: "关闭" }]} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run("save-channel-account", { ...account, ...(editAccountId ? { id: editAccountId, revision: accounts.data?.items.find(row => row.id === editAccountId)?.revision } : {}) }, editAccountId ? "渠道店铺已更新。" : "渠道店铺已创建。", async () => { setAccount({ ...blankAccount }); setEditAccountId(""); await accounts.reload(); })}>{editAccountId ? "保存修改" : "新增店铺"}</Button>
          {editAccountId && <Button size="sm" variant="ghost" onClick={() => { setEditAccountId(""); setAccount({ ...blankAccount }); }}>取消</Button>}
        </div>
      </Section>
      <Section title="渠道店铺清单">
        <Table
          rows={accounts.data?.items ?? []}
          empty="还没有非 Amazon 渠道店铺。"
          columns={[
            { key: "channel", label: "渠道", render: row => channelLabel(row.channel) },
            { key: "name", label: "店铺" },
            { key: "sellerId", label: "卖家 ID", render: row => <span className="font-mono">{row.sellerId}</span> },
            { key: "marketplace", label: "站点", render: row => row.marketplace || "—" },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "ACTIVE" ? "good" : row.status === "CLOSED" ? "muted" : "warn"} /> },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" onClick={() => {
              setEditAccountId(row.id);
              setAccount({ channel: row.channel, name: row.name, sellerId: row.sellerId, marketplace: row.marketplace, credentialsRef: row.credentialsRef, status: row.status });
            }}>编辑</Button> },
          ]}
        />
      </Section>
    </>}

    {tab === "ORDER" && <>
      <Section title="登记渠道订单" description="与 Amazon 订单分表存储，避免口径混算；同渠道同平台单号 + SKU 幂等，重复登记会被拦。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectField label="渠道店铺" value={order.accountId} onChange={value => setOrder(c => ({ ...c, accountId: value }))} placeholder="选择店铺" options={(accounts.data?.items ?? []).map(row => ({ value: row.id, label: `${channelLabel(row.channel)} · ${row.name}` }))} />
          <Field label="平台订单号" value={order.externalOrderNo} onChange={value => setOrder(c => ({ ...c, externalOrderNo: value }))} />
          <Field label="SKU" value={order.sellerSku} onChange={value => setOrder(c => ({ ...c, sellerSku: value }))} />
          <Field label="数量" value={order.quantity} onChange={value => setOrder(c => ({ ...c, quantity: value }))} />
          <Field label="金额" value={order.amount} onChange={value => setOrder(c => ({ ...c, amount: value }))} />
          <Field label="币种" value={order.currency} onChange={value => setOrder(c => ({ ...c, currency: value.toUpperCase() }))} />
          <Field label="下单日期" type="date" value={order.orderedAt} onChange={value => setOrder(c => ({ ...c, orderedAt: value }))} />
          <Field label="买家国家" value={order.buyerCountry} onChange={value => setOrder(c => ({ ...c, buyerCountry: value.toUpperCase() }))} />
        </div>
        <Button size="sm" disabled={busy || !order.accountId} onClick={() => void run("save-channel-order", order, "渠道订单已登记。", async () => { setOrder({ ...blankOrder }); await orders.reload(); })}>登记订单</Button>
      </Section>
      <Section title="渠道订单清单" actions={<select className="h-8 rounded border border-border bg-background px-2 text-xs" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="">全部渠道</option>{channels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>}>
        <Table
          rows={orders.data?.items ?? []}
          empty="还没有渠道订单。"
          columns={[
            { key: "orderedAt", label: "下单日" },
            { key: "channel", label: "渠道", render: row => channelLabel(row.channel) },
            { key: "accountId", label: "店铺", render: row => accountName(row.accountId) },
            { key: "externalOrderNo", label: "平台单号", render: row => <span className="font-mono">{row.externalOrderNo}</span> },
            { key: "sellerSku", label: "SKU" },
            { key: "quantity", label: "数量", align: "right" },
            { key: "amount", label: "金额", align: "right", render: row => `${money(row.amount)} ${row.currency}` },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "CANCELLED" ? "warn" : row.status === "DELIVERED" ? "good" : "info"} /> },
            { key: "ops", label: "流转", render: row => <div className="flex gap-1">
              {row.status === "PENDING" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-channel-order", { id: row.id, revision: row.revision, status: "SHIPPED" }, "订单已标记发货。", orders.reload)}>发货</Button>}
              {row.status === "SHIPPED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("transition-channel-order", { id: row.id, revision: row.revision, status: "DELIVERED" }, "订单已标记签收。", orders.reload)}>签收</Button>}
            </div> },
          ]}
        />
        {(orders.data?.summary ?? []).length > 0 && <div className="flex flex-wrap gap-3 text-xs text-muted">
          {(orders.data?.summary ?? []).map(item => <span key={item.channel}>{channelLabel(item.channel)}：{item.orders} 单 / {money(item.amount)}</span>)}
        </div>}
      </Section>
    </>}
  </div>;
}
