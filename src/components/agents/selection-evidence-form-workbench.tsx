"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { LocalSelection } from "@/lib/agent-platform/selection-local";
import type { Review, Supplier } from "../../../scripts/selection-pipeline/src/types";
import { chainFetch, chainHeaders } from "./chain-handoff";

type Environment = { organization: boolean; actor: boolean; erpUrl: boolean; cookie: boolean; database: boolean; actorMatches: boolean };
type Data = LocalSelection & { environment: Environment; receipt?: { sku: string; queuePending: boolean } };
type Slug = { slug: string; status: string; blockWrite: boolean; error?: string };
const field = "w-full rounded-md border border-border bg-white px-3 py-2 text-sm disabled:bg-surface-muted";
const blankSupplier = (): Supplier => ({ title: "", price: "", moq: "", shopName: "", url: "" });
const blankReview = (asin = ""): Review => ({ asin, star: 1, date: "", text: "" });
async function requestData<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await chainFetch(url, { headers: chainHeaders(), cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "选品证据请求失败。");
  return data as T;
}

export function SelectionEvidenceFormWorkbench() {
  const user = useAppShellUser();
  const canEdit = roleCanPerformAction(user?.userRole, "agents", "create", user?.rolePermissions);
  const canUpload = roleCanPerformAction(user?.userRole, "products", "edit", user?.rolePermissions);
  const canCreate = roleCanPerformAction(user?.userRole, "products", "create", user?.rolePermissions);
  const privileged = ["owner", "database_admin"].includes(user?.userRole || "");
  const [slugs, setSlugs] = useState<Slug[]>([]);
  const [slug, setSlug] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState<"" | "reviews" | "suppliers">("");
  const cookie = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const accept = useCallback((next: Data) => {
    setData(next); setEnvironment(next.environment); setReviews(next.reviews.length ? next.reviews : [blankReview(next.asins[0])]);
    setSuppliers([...next.suppliers, ...Array.from({ length: Math.max(0, 3 - next.suppliers.length) }, blankSupplier)]); setDirty("");
    if (cookie.current) cookie.current.value = "";
  }, []);
  const reloadSlugs = useCallback(async () => {
    const version = ++generation.current;
    setBusy(true); setData(null); setSlug(""); setError(""); setMessage(""); setDirty(""); setEnvironment(null); setReviews([]); setSuppliers([]);
    if (cookie.current) cookie.current.value = "";
    try {
      const next = await requestData<{ slugs: Slug[]; environment: Environment }>("/api/agents/market/selection-slugs");
      if (generation.current !== version) return;
      setSlugs(next.slugs); setEnvironment(next.environment);
      setSlug(next.slugs.find(s => s.slug === "kayak-cockpit-cover")?.slug || next.slugs[0]?.slug || "");
    } catch (e) { if (generation.current === version) setError(e instanceof Error ? e.message : "读取 Slug 失败。"); }
    finally { if (generation.current === version) setBusy(false); }
  }, []);
  useEffect(() => {
    const invalidate = () => { generation.current += 1; };
    void reloadSlugs();
    const changed = () => { void reloadSlugs(); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => { invalidate(); window.removeEventListener(workspaceScopeChangedEventName, changed); };
  }, [reloadSlugs, user?.organizationId, user?.userId]);
  useEffect(() => {
    if (!slug) return;
    const version = ++generation.current;
    setBusy(true); setData(null); setError(""); setMessage("");
    requestData<Data>(`/api/agents/market/selection-local?slug=${encodeURIComponent(slug)}`).then(next => { if (generation.current === version) accept(next); }).catch(e => { if (generation.current === version) setError(e instanceof Error ? e.message : "读取选品失败。"); }).finally(() => { if (generation.current === version) setBusy(false); });
  }, [slug, accept]);
  async function save(kind: "reviews" | "suppliers" | "upload" | "create") {
    const version = generation.current;
    setBusy(true); setError(""); setMessage("");
    const onceCookie = kind === "upload" ? cookie.current?.value : undefined;
    if (cookie.current) cookie.current.value = "";
    try {
      const next = await requestData<Data>(`/api/agents/market/selection-${kind === "upload" || kind === "create" ? "local" : kind}`, {
        method: "POST", headers: { ...chainHeaders(), "Content-Type": "application/octet-stream" },
        body: JSON.stringify({ slug, rows: kind === "reviews" ? reviews : kind === "suppliers" ? suppliers : undefined, action: kind, cookie: onceCookie }),
      });
      if (generation.current !== version) return;
      accept(next);
      setMessage(next.receipt ? `SKU ${next.receipt.sku} 已创建；${next.receipt.queuePending ? "派生更新仍待完成，请稍后" : "请"}到同组织工作区 /dashboard 按 SKU 核对。` : "已保存并重建工作簿与 quality。空标签是 NEEDS_DATA（待补数据），不是没有差评。");
    } catch (e) {
      if (generation.current !== version) return;
      setError(e instanceof Error ? e.message : "保存失败。");
      // Partial upload checkpoints can change the gate even when the request fails.
      try {
        const latest = await requestData<Data>(`/api/agents/market/selection-local?slug=${encodeURIComponent(slug)}`);
        if (generation.current === version) setData(latest);
      } catch { /* Keep user input for retry. */ }
    } finally { if (generation.current === version) setBusy(false); }
  }
  const blocked = !data || data.quality.blockWrite || data.quality.fixture;
  const reason = blocked ? "证据未齐全或属于测试资料，禁止上传/写库。" : !canEdit || !privileged || !environment?.actorMatches ? "需要当前组织有效的所有者/数据库管理员，且操作者须与登录用户一致。" : dirty ? "请先保存当前表单，核对重建后的门禁。" : "";
  const uploadReason = reason || (!canUpload ? "没有商品编辑权限。" : !environment?.erpUrl ? "ERP 地址未配置。" : "");
  const createReason = reason || (!canCreate ? "没有商品创建权限。" : !environment?.database || !environment.organization || !environment.actor ? "数据库或写库身份未就绪。" : "");
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>本机选品证据</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="flex flex-wrap items-center gap-3"><label>Slug <select aria-label="Slug" className={field} value={slug} disabled={busy || Boolean(dirty)} onChange={e => setSlug(e.target.value)}><option value="">请选择</option>{slugs.map(s => <option key={s.slug} value={s.slug}>{s.slug} · {s.status}</option>)}</select></label><Button variant="secondary" disabled={busy || Boolean(dirty)} onClick={() => void reloadSlugs()}>刷新目录</Button><Link className="text-sm text-brand underline" href="/agents/market">打开 Market 上传 draft</Link></div>
      <p className="text-xs text-muted">目录来自当前运行 aecob 的主机。编辑内容只在保存后落盘；有未保存修改时请先保存，再编辑另一区块或切换目录。</p>
      {environment && <div className="flex flex-wrap gap-2">{([["organization", "组织 ID"], ["actor", "Actor"], ["erpUrl", "ERP URL"], ["cookie", "Cookie"], ["database", "数据库"]] as const).map(([key, label]) => <Badge key={key} tone={environment[key] ? "green" : "gray"}>{label}：{environment[key] ? "已配置" : "未配置"}</Badge>)}</div>}
      {busy && <p role="status">处理中，请稍候…</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}{message && <p role="status" className="text-sm text-brand">{message} <Link href="/dashboard" className="underline">查看商品工作区</Link></p>}
      {!busy && !slugs.length && !error && <p className="text-sm text-muted">本机没有可用 Slug，请先完成本地选品采集。</p>}
      {data && <><p className="text-sm">关键词：{data.keyword} · 竞品 ASIN：{data.asins.join("、") || "无"}</p><div className="flex flex-wrap gap-2"><Badge tone={blocked ? "amber" : "green"}>{data.quality.status}</Badge><Badge tone={blocked ? "red" : "green"}>blockWrite：{String(data.quality.blockWrite)}</Badge>{(["validReviews", "taggedQuotes", "suppliers", "images", "uploadedImages"] as const).map((key, i) => <Badge tone="gray" key={key}>{["有效评论", "标签引用", "供应商", "本地图片", "已上传图片"][i]}：{data.quality[key]}</Badge>)}</div><ul className="list-disc pl-5 text-xs text-muted">{data.quality.reasons.map(r => <li key={r.code}>{r.code}：{r.code === "REVIEWS_NEEDS_DATA" ? "请在下方补低星评论。" : r.code === "SUPPLIERS_NEEDS_DATA" ? "请在下方补至少 3 个不同的真实 1688 商品链接。" : r.code === "TAGS_NEEDS_DATA" ? "评论尚未命中标签，需核对真实原文或由管理员补充词典。" : r.fallback}</li>)}</ul></>}
    </CardContent></Card>
    {data && <>
      <Card><CardHeader><CardTitle>A · 低星评论</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-muted">粘贴真实 1–3 星原文，最多 240 字；日期可空。保存替换当前竞品评论（包含删除），并打标签、重建工作簿。</p>
        <fieldset disabled={busy || !canEdit || dirty === "suppliers"} className="space-y-3">{reviews.map((row, index) => <div key={index} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-4">
          <label>ASIN<select aria-label={`评论 ${index + 1} ASIN`} className={field} value={row.asin} onChange={e => { setReviews(reviews.map((r,i) => i === index ? { ...r, asin: e.target.value } : r)); setDirty("reviews"); }}>{data.asins.map(asin => <option key={asin}>{asin}</option>)}</select></label>
          <label>星级<select aria-label={`评论 ${index + 1} 星级`} className={field} value={row.star} onChange={e => { setReviews(reviews.map((r,i) => i === index ? { ...r, star: Number(e.target.value) } : r)); setDirty("reviews"); }}>{[1,2,3].map(n => <option key={n} value={n}>{n} 星</option>)}</select></label>
          <label>原页面日期<input aria-label={`评论 ${index + 1} 日期`} className={field} maxLength={100} value={row.date} onChange={e => { setReviews(reviews.map((r,i) => i === index ? { ...r, date: e.target.value } : r)); setDirty("reviews"); }} /></label>
          <Button variant="ghost" onClick={() => { setReviews(reviews.filter((_,i) => i !== index)); setDirty("reviews"); }}>删除评论 {index + 1}</Button>
          <label className="md:col-span-4">原文<textarea aria-label={`评论 ${index + 1} 原文`} required maxLength={240} className={field} value={row.text} onChange={e => { setReviews(reviews.map((r,i) => i === index ? { ...r, text: e.target.value } : r)); setDirty("reviews"); }} /></label>
        </div>)}<Button variant="secondary" onClick={() => { setReviews([...reviews, blankReview(data.asins[0])]); setDirty("reviews"); }}>添加评论</Button> <Button disabled={!reviews.length || !data.asins.length} onClick={() => void save("reviews")}>保存评论并打标签</Button></fieldset>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>B · 1688 供应商</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted">至少 3 条不同的真实商品链接：https://detail.1688.com/offer/数字.html；去除查询参数后去重。未知价格、MOQ 和店铺名可留空。</p>
        <fieldset disabled={busy || !canEdit || dirty === "reviews"} className="space-y-3">{suppliers.map((row,index) => <div key={index} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-2">{([["title", "标题"], ["price", "价格"], ["moq", "MOQ"], ["shopName", "店铺名"], ["url", "链接"]] as const).map(([key,label]) => <label key={key}>{label}<input aria-label={`供应商 ${index + 1} ${label}`} className={field} maxLength={key === "url" ? 2000 : key === "title" ? 500 : 300} required={key === "title" || key === "url"} value={row[key]} onChange={e => { setSuppliers(suppliers.map((r,i) => i === index ? { ...r, [key]: e.target.value } : r)); setDirty("suppliers"); }} /></label>)}<Button variant="ghost" onClick={() => { setSuppliers(suppliers.filter((_,i) => i !== index)); setDirty("suppliers"); }}>删除供应商 {index + 1}</Button></div>)}<Button variant="secondary" disabled={suppliers.length >= 20} onClick={() => { setSuppliers([...suppliers, blankSupplier()]); setDirty("suppliers"); }}>添加供应商</Button> <Button disabled={suppliers.length < 3} onClick={() => void save("suppliers")}>保存供应商并重建工作簿</Button></fieldset>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>C · 门禁与写操作</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">{data.quality.blockWrite ? "NEEDS_DATA：证据未齐全，写操作禁用。" : "READY_FOR_REVIEW：请先核对来源真实性、图片与未知指标。"}</p>
        <details><summary className="cursor-pointer text-sm font-semibold">高级：上传/写库</summary><div className="mt-3 space-y-3">
          {!uploadReason && <label className="block text-sm">一次性 Cookie（已配置时可留空）<input aria-label="一次性 Cookie" ref={cookie} disabled={busy} type="password" autoComplete="off" className={field} maxLength={16000} /><span className="text-xs text-muted">仅在点击上传时使用，提交后清空，不持久化。</span></label>}
          <Button variant="secondary" disabled={busy || Boolean(uploadReason)} title={uploadReason} onClick={() => void save("upload")}>上传竞品图</Button><p className="text-xs text-muted">{uploadReason || "仅上传已有本地图片；需要有效的当前用户会话。"}</p>
          <Button disabled={busy || Boolean(createReason)} title={createReason} onClick={() => { if (window.confirm("确认将已审阅证据创建为当前组织/工作区的正式 SKU？")) void save("create"); }}>创建 SKU（--write）</Button><p className="text-xs text-muted">{createReason || "仅在明确点击确认后写库，成功后到同组织工作区 /dashboard 按 SKU 核对。"}</p>
        </div></details>
      </CardContent></Card>
    </>}
  </div>;
}
