"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReplenishmentInputs, ReplenishmentResult } from "@/lib/operations/replenishment";

import { SellfoxLinks, sellfoxHref, tkShops } from "./sellfox-links";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";
type StoreOption = { id: string; externalId: string; name: string; marketplace: string };
type AccountOption = { id: string; displayName: string; accountKey: string; marketplaceCode: string; marketplaceId: string | null };
type PolicyRow = { id: string; sellerAccountId: string; marketplaceId: string; sellerSku: string; inputs: ReplenishmentInputs; enabled: boolean; updatedAt: string; plan: { policyUpdatedAt: string; nextCalculationAt: string; lastError: string | null; result: ReplenishmentResult & { inventorySource?: string | null }; inputSnapshot?: { inventorySource?: string | null }; generatedAt: string } | null };
const defaultInputs: ReplenishmentInputs = { lifecycle: "MATURE", productionDays: null, domesticDays: null, oceanDays: null, safetyDays: 14, reviewDays: 30, newProductDailyUnits: null, salesHistory: [], seasonality: null, receipts: [], unitProfit: null, currency: null, acos: null, advertisingWindow: null, sourceNote: "" };
export function ReplenishmentPanel({ headers }: { headers: () => Headers }) {
  const [rows, setRows] = useState<PolicyRow[]>([]); const [canEdit, setCanEdit] = useState(false); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [sellerAccountId, setStore] = useState(""); const [marketplaceId, setMarketplace] = useState(""); const [sellerSku, setSku] = useState(""); const [inputs, setInputs] = useState(defaultInputs);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [canReadSellfox, setCanReadSellfox] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [skus, setSkus] = useState<string[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [skuPage, setSkuPage] = useState(1); const [skuHasNext, setSkuHasNext] = useState(false);
  const [skuLoading, setSkuLoading] = useState(false);
  const [coverage, setCoverage] = useState<{ loading: boolean; missing: string[]; error: string }>({ loading: false, missing: [], error: "" });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const workspaceId = headers().get("x-workspace-id") || "default";
  const selectedStore = stores.find(row => row.id === inputs.historicalSource?.storeId);
  const load = useCallback(async () => { const response = await fetch("/api/operations/replenishment", { headers: headers(), cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!mounted.current) return; setRows(data.rows); setCanEdit(data.canEdit); setAccounts(data.sellerAccounts ?? []); setCanReadSellfox(data.canReadSellfox ?? false); }, [headers]);
  useEffect(() => { void load().catch((error) => setNotice(error.message)); }, [load]);
  useEffect(() => {
    if (!canReadSellfox) return;
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch("/api/sellfox/stores?pageSize=200", { headers: headers(), signal: controller.signal, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "店铺读取失败");
        if (!controller.signal.aborted) { setStores(data.rows ?? []); setOptionsError(data.pagination?.total > 200 ? "店铺超过200个，请先在赛狐入口缩小工作区。" : ""); }
      } catch (error) { if (!controller.signal.aborted) setOptionsError(error instanceof Error ? error.message : "店铺读取失败"); }
    }
    void read(); return () => controller.abort();
  }, [canReadSellfox, headers]);
  useEffect(() => {
    setSkus([]); setSkuHasNext(false);
    if (!selectedStore || !canReadSellfox) return;
    const controller = new AbortController(); setSkuLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ shopExternalId: selectedStore.externalId, pageSize: "50", page: String(skuPage), search: skuSearch });
        const response = await fetch(`/api/sellfox/listings?${params}`, { headers: headers(), signal: controller.signal, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "MSKU 读取失败");
        if (!controller.signal.aborted) { setSkus([...new Set<string>((data.rows ?? []).map((row: { msku: string | null }) => row.msku).filter((value: string | null) => value?.trim()))]); setSkuHasNext(skuPage * 50 < data.pagination.total); setOptionsError(""); }
      } catch (error) { if (!controller.signal.aborted) setOptionsError(error instanceof Error ? error.message : "MSKU 读取失败"); }
      finally { if (!controller.signal.aborted) setSkuLoading(false); }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selectedStore, canReadSellfox, headers, skuSearch, skuPage]);
  useEffect(() => {
    if (!selectedStore || !sellerSku) { setCoverage({ loading: false, missing: [], error: "" }); return; }
    const controller = new AbortController(); setCoverage({ loading: true, missing: [], error: "" });
    async function read() {
      const dates = Array.from({ length: 28 }, (_, i) => sellfoxDateAt(new Date(), -(i + 1)));
      try {
        const params = new URLSearchParams({ layout: "workbench", dimension: "msku", shopExternalId: selectedStore!.externalId, searchType: "msku", exactMatch: "1", search: sellerSku, from: dates[27], to: dates[0], pageSize: "50" });
        const response = await fetch(`/api/sellfox/sales?${params}`, { headers: headers(), signal: controller.signal, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "销量覆盖读取失败");
        const matching = (data.rows ?? []).filter((row: { msku: string; storeId: string }) => row.msku === sellerSku && row.storeId === selectedStore!.id);
        const missing = dates.filter(date => matching.length !== 1 || typeof matching[0].dailyQuantity?.[date] !== "number" || !Number.isInteger(matching[0].dailyQuantity[date]) || matching[0].dailyQuantity[date] < 0);
        if (!controller.signal.aborted) setCoverage({ loading: false, missing, error: "" });
      } catch (error) { if (!controller.signal.aborted) setCoverage({ loading: false, missing: [], error: error instanceof Error ? error.message : "销量覆盖读取失败" }); }
    }
    void read(); return () => controller.abort();
  }, [selectedStore, sellerSku, headers]);
  const [historyText, setHistoryText] = useState(""); const [receiptsText, setReceiptsText] = useState(""); const [seasonalityText, setSeasonalityText] = useState(""); const [seasonPeriod, setSeasonPeriod] = useState(""); const [seasonSource, setSeasonSource] = useState("");
  async function save(enabled: boolean) {
    setBusy(true); setNotice("");
    try {
      if (!sellerAccountId || !marketplaceId || !sellerSku.trim()) throw new Error("请选择策略归属店铺、站点和精确 MSKU。");
      if (historyText.trim() && !inputs.historicalSource && historyText.trim().split(/\n/).some(line => !line.split(/[,，\t]/)[1]?.trim())) throw new Error("销量件数缺失，不可按0保存。");
      if (receiptsText.trim() && receiptsText.trim().split(/\n/).some(line => !line.split(/[,，\t]/)[1]?.trim())) throw new Error("在途件数缺失，不可按0保存。");
      const response = await fetch("/api/operations/replenishment", { method: "PATCH", headers: new Headers([...headers(), ["Content-Type", "application/json"]]), body: JSON.stringify({ sellerAccountId, marketplaceId, sellerSku, inputs: { ...inputs, salesHistory: !inputs.historicalSource && historyText.trim() ? historyText.trim().split(/\n/).map((line) => { const [date, units] = line.trim().split(/[,，\t]/); return { date, units: Number(units) }; }) : [], receipts: receiptsText.trim() ? receiptsText.trim().split(/\n/).map((line) => { const [eta, quantity] = line.trim().split(/[,，\t]/); return { eta, quantity: Number(quantity) }; }) : [], seasonality: seasonalityText.trim() ? { multiplier: Number(seasonalityText), period: seasonPeriod, source: seasonSource } : null }, enabled }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!mounted.current) return; setNotice(data.message); await load(); }
    catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : "保存补货参数失败。"); } finally { if (mounted.current) setBusy(false); }
  }
  function select(row: PolicyRow) { setStore(row.sellerAccountId); setMarketplace(row.marketplaceId); setSku(row.sellerSku); setInputs(row.inputs); setHistoryText(row.inputs.salesHistory.map((day) => `${day.date},${day.units}`).join("\n")); setReceiptsText(row.inputs.receipts.map((receipt) => `${receipt.eta},${receipt.quantity}`).join("\n")); setSeasonalityText(row.inputs.seasonality ? String(row.inputs.seasonality.multiplier) : ""); setSeasonPeriod(row.inputs.seasonality?.period ?? ""); setSeasonSource(row.inputs.seasonality?.source ?? ""); }
  return <section className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-sm font-bold">补货计划 · 只读建议</h2><span className="text-xs text-muted">不创建采购单</span></div>
    <p className="text-xs text-muted">新品使用人工维护试销日需求；成熟品需要完整最近 28 天销量。生产、国内运输、海运周期及 ETA 在途须有来源。去年同期缺失时显示未应用季节性，不默认补值。利润与 ACOS 仅作有来源的参考，不等同净利润。</p>
    <SellfoxLinks workspaceId={workspaceId} shopExternalId={selectedStore?.externalId} msku={sellerSku} />
    {notice && <p role="status" className="text-sm text-amber-800">{notice}</p>}
    {rows.length ? <div className="overflow-x-auto border border-border"><table className="w-full min-w-[800px] text-left text-sm"><thead><tr className="bg-surface-muted"><th>SKU / 店铺 / 站点</th><th>状态 / 缺失资料</th><th>库存来源</th><th>可售天数</th><th>预计断货</th><th>建议量</th><th>建议下单</th><th>更新</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-2"><button className="text-left text-brand" onClick={() => select(row)}>{row.sellerSku}<span className="block text-xs text-muted">{accounts.find(account => account.id === row.sellerAccountId)?.displayName || row.sellerAccountId} · {tkShops.find(shop => shop.marketplaceId === row.marketplaceId)?.name.replace("TK店-", "") || row.marketplaceId}</span></button></td><td><span aria-hidden="true" className={`mr-1 inline-block h-2 w-2 rounded-full ${row.plan?.result.status !== "READY" ? "bg-gray-400" : row.plan.result.urgency === "URGENT" ? "bg-red-500" : row.plan.result.urgency === "SOON" ? "bg-amber-500" : "bg-green-500"}`} />{!row.enabled ? "已停用" : row.plan && (row.updatedAt > row.plan.policyUpdatedAt || Date.parse(row.plan.nextCalculationAt) <= Date.now()) ? "待重新计算" : row.plan?.result.status === "READY" ? `READY · ${row.plan.result.urgency}` : row.plan?.result.status ?? "待计算"}<span className="block text-xs text-muted">{row.plan?.result.missingInputs.join("、")}</span><details className="text-xs"><summary className="max-w-80 cursor-pointer truncate" title={row.plan?.result.reasons[0]}>补货理由与风险 · {row.plan?.result.reasons[0] ?? "待计算"}</summary>{row.plan?.result.reasons.map((reason, index) => <p key={index}>{reason}</p>)}{row.plan?.lastError && <p>{row.plan.lastError}</p>}</details></td><td className="text-xs">{row.plan?.result.inventorySource ?? row.plan?.inputSnapshot?.inventorySource ?? "未知（待重新计算）"}</td><td>{row.plan?.result.daysOfCover?.toFixed(1) ?? "—"}</td><td>{row.plan?.result.estimatedStockoutDate ?? "—"}</td><td>{row.plan?.result.suggestedQuantity ?? "—"}</td><td>{row.plan?.result.suggestedOrderDate ?? "—"}</td><td>{row.plan ? new Date(row.plan.generatedAt).toLocaleString("zh-CN") : "—"}</td></tr>)}</tbody></table></div> : <div className="border border-border px-4 py-6 text-sm text-muted"><p>尚无人工维护的补货策略。</p><a href={canEdit ? "#replenishment-editor" : sellfoxHref("sales", workspaceId)} className="mt-2 inline-block text-brand">{canEdit ? "从赛狐选 MSKU" : "打开赛狐销量"}</a><p className="mt-1 text-xs">先选店铺及 MSKU，再维护周期；缺日不填0。</p></div>}
    {canEdit && <fieldset id="replenishment-editor" className="space-y-3 border border-border p-4" disabled={busy}><legend className="px-2 text-sm font-semibold">维护需求与供应链参数</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-xs">赛狐数据店铺<select aria-label="赛狐数据店铺" value={inputs.historicalSource?.storeId ?? ""} disabled={!canReadSellfox} onChange={e => {
        const store = stores.find(row => row.id === e.target.value); const tk = tkShops.find(row => row.externalId === store?.externalId);
        setInputs({ ...inputs, historicalSource: store ? { storeId: store.id } : null }); setSku(""); setSkuSearch(""); setSkuPage(1);
        if (tk) setMarketplace(tk.marketplaceId);
      }} className="h-9 min-w-0 w-full border border-border bg-white px-2"><option value="">选择赛狐店铺（推荐；留空用人工历史）</option>{inputs.historicalSource && !selectedStore && <option value={inputs.historicalSource.storeId}>原绑定店铺（不可用）</option>}{tkShops.map(tk => {
        const store = stores.find(row => row.externalId === tk.externalId);
        return <option key={tk.externalId} value={store?.id ?? `unavailable-${tk.externalId}`} disabled={!store}>{tk.name}{store ? "" : "（本工作区未同步）"}</option>;
      })}{stores.filter(row => !tkShops.some(tk => tk.externalId === row.externalId)).map(row => <option key={row.id} value={row.id}>{row.name} · {row.marketplace}</option>)}</select></label>
      <label className="grid gap-1 text-xs">策略归属店铺<select aria-label="策略归属店铺" value={sellerAccountId} onChange={e => { setStore(e.target.value); const account = accounts.find(row => row.id === e.target.value); if (!inputs.historicalSource && account?.marketplaceId) setMarketplace(account.marketplaceId); }} className="h-9 min-w-0 w-full border border-border bg-white px-2"><option value="">选择工作区 active 店铺</option>{sellerAccountId && !accounts.some(row => row.id === sellerAccountId) && <option value={sellerAccountId}>原归属店铺（当前不可用）</option>}{accounts.map(row => <option key={row.id} value={row.id}>{row.displayName || row.accountKey} · {row.marketplaceCode}</option>)}</select></label>
      <label className="grid gap-1 text-xs">站点<select aria-label="补货站点" value={marketplaceId} onChange={e => setMarketplace(e.target.value)} className="h-9 min-w-0 w-full border border-border bg-white px-2"><option value="">选择站点</option>{[...new Map([...tkShops.map(row => [row.marketplaceId, row.name.replace("TK店-", "")] as const), ...accounts.filter(row => row.marketplaceId).map(row => [row.marketplaceId!, row.marketplaceCode || row.marketplaceId!] as const), ...(marketplaceId ? [[marketplaceId, tkShops.find(row => row.marketplaceId === marketplaceId)?.name.replace("TK店-", "") || accounts.find(row => row.marketplaceId === marketplaceId)?.marketplaceCode || marketplaceId] as const] : [])]).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-xs">MSKU{inputs.historicalSource ? <select aria-label="补货 MSKU" value={sellerSku} disabled={skuLoading || !selectedStore} onChange={e => setSku(e.target.value)} className="h-9 min-w-0 w-full border border-border bg-white px-2"><option value="">{skuLoading ? "读取 MSKU 中…" : "选择精确 MSKU"}</option>{sellerSku && !skus.includes(sellerSku) && <option value={sellerSku}>{sellerSku}（已选）</option>}{skus.map(sku => <option key={sku} value={sku}>{sku}</option>)}</select> : <input aria-label="补货 MSKU" value={sellerSku} onChange={e => setSku(e.target.value)} className="h-9 border border-border px-2" />}</label>
      <label className="grid gap-1 text-xs">产品阶段<select value={inputs.lifecycle} onChange={(e) => setInputs({ ...inputs, lifecycle: e.target.value as ReplenishmentInputs["lifecycle"] })} className="h-9 border border-border px-2"><option value="NEW">新品</option><option value="MATURE">成熟品</option></select></label>
      {([["productionDays", "生产天数"], ["domesticDays", "国内运输天数"], ["oceanDays", "海运天数"], ["safetyDays", "安全库存天数"], ["reviewDays", "复核周期天数"], ["newProductDailyUnits", "新品日需求"]] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-xs">{label}<input type="number" min="0" value={inputs[key] ?? ""} onChange={(e) => setInputs({ ...inputs, [key]: e.target.value === "" ? null : Number(e.target.value) })} className="h-9 border border-border px-2" /></label>)}
    </div>
    {!canReadSellfox && <p className="text-xs text-amber-800">读取赛狐店铺与 MSKU 需要 sellfox:view 权限。</p>}
    {!accounts.length && <p className="text-xs text-amber-800">当前工作区无可选策略归属店铺，请管理员维护 active 店铺；不以赛狐 ID 冒充。</p>}
    {optionsError && <p role="alert" className="text-xs text-red-700">{optionsError}</p>}
    {selectedStore && <div className="flex flex-wrap items-center gap-2 text-xs"><label>搜索 MSKU<input aria-label="搜索补货 MSKU" value={skuSearch} onChange={e => { setSkuSearch(e.target.value); setSkuPage(1); }} className="ml-2 h-8 border border-border px-2" /></label><Button size="sm" variant="secondary" disabled={skuPage <= 1 || skuLoading} onClick={() => setSkuPage(p => p - 1)}>上一页 MSKU</Button><span>第 {skuPage} 页 · 每页50条</span><Button size="sm" variant="secondary" disabled={!skuHasNext || skuLoading} onClick={() => setSkuPage(p => p + 1)}>下一页 MSKU</Button></div>}
    {selectedStore && sellerSku && <div role="status" className="border border-border bg-surface-muted p-3 text-xs">{coverage.loading ? "正在读取最近28日销量覆盖…" : coverage.error ? `NEEDS_DATA · ${coverage.error}` : coverage.missing.length ? `NEEDS_DATA · 最近28日缺失或无效 ${coverage.missing.length} 天（不补0）` : "最近28日销量完整 · 仍须库存新鲜与周期齐全，最终以 worker 计算结果为准"}{coverage.missing.length > 0 && <details><summary>查看缺失日期</summary><p>{coverage.missing.join("、")}</p></details>}<p className="mt-1 text-muted">来源 sellfox_sales_daily · 精确 MSKU · complete=true；历史由 worker 读取，选中不触发第三方同步。</p></div>}
    <details><summary className="cursor-pointer text-xs text-muted">高级兜底：手工每日销量</summary><label className="mt-2 grid gap-1 text-xs">成熟品每日销量（每行：日期,件数；最多366天）<textarea aria-label="手工每日销量" disabled={!!inputs.historicalSource} rows={4} value={historyText} onChange={e => setHistoryText(e.target.value)} className="border border-border p-2 font-mono" /></label><p className="text-xs text-muted">绑定赛狐时忽略手工历史；切换人工来源后使用，空件数拒绝保存，缺日不补0。</p></details>
    <label className="grid gap-1 text-xs">在途批次（每行：预计到货日期,件数）<textarea rows={2} value={receiptsText} onChange={(e) => setReceiptsText(e.target.value)} className="border border-border p-2 font-mono" /></label><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-xs">去年同期季节性系数（选填）<input type="number" step="0.01" min="0" value={seasonalityText} onChange={(e) => setSeasonalityText(e.target.value)} className="h-9 border border-border px-2" /></label><label className="grid gap-1 text-xs">同期对比窗口<input value={seasonPeriod} onChange={(e) => setSeasonPeriod(e.target.value)} className="h-9 border border-border px-2" /></label><label className="grid gap-1 text-xs">季节性系数来源<input value={seasonSource} onChange={(e) => setSeasonSource(e.target.value)} className="h-9 border border-border px-2" /></label></div><div className="grid gap-3 sm:grid-cols-4"><label className="grid gap-1 text-xs">单位利润参考（选填）<input type="number" value={inputs.unitProfit ?? ""} onChange={(e) => setInputs({ ...inputs, unitProfit: e.target.value === "" ? null : Number(e.target.value) })} className="h-9 border border-border px-2" /></label><label className="grid gap-1 text-xs">利润币种<input value={inputs.currency ?? ""} maxLength={3} onChange={(e) => setInputs({ ...inputs, currency: e.target.value.toUpperCase() || null })} className="h-9 border border-border px-2" /></label><label className="grid gap-1 text-xs">ACOS %（选填）<input type="number" min="0" value={inputs.acos ?? ""} onChange={(e) => setInputs({ ...inputs, acos: e.target.value === "" ? null : Number(e.target.value) })} className="h-9 border border-border px-2" /></label><label className="grid gap-1 text-xs">广告归因/日期窗口<input value={inputs.advertisingWindow ?? ""} onChange={(e) => setInputs({ ...inputs, advertisingWindow: e.target.value || null })} className="h-9 border border-border px-2" /></label></div><label className="grid gap-1 text-xs">来源说明<input required value={inputs.sourceNote} onChange={(e) => setInputs({ ...inputs, sourceNote: e.target.value })} className="h-9 border border-border px-2" placeholder="ERP销量、人工周期维护等" /></label><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void save(true)}>保存并启用</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(false)}>仅保存停用</Button></div></fieldset>}
    {!canEdit && <p className="text-xs text-muted">仅 operations:edit 用户可维护策略。</p>}
  </section>;
}
