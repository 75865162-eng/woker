"use client";
/**
 * Amazon 连接管理页（/settings/amazon-connections）。
 *
 * 强隔离：本页只管理 Amazon SP-API / Ads API 连接；赛狐连接仍在 /settings 的「集成」页，互不混放。
 * 写操作全部走现有服务端 API（SP 授权变更走审批流；Ads 断开／授权走已有路由），页面不臆造结果。
 * 删除连接仅停止调度任务与同步状态，保留已落库业务数据。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { getJson } from "@/lib/workspace/get-json";
import type { SyncAccess, SyncAuthorizationView, SyncSourceView } from "@/lib/amazon-sync/contracts";

const spBase = "/api/operations/sync-center";
const adsBase = "/api/integrations/amazon/ads";
const stamp = (s: string | null | undefined) => s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";

function scopeHeaders() {
  const h = new Headers();
  try { const s = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}"); h.set("x-workspace-id", s.workspaceId || "default"); } catch { h.set("x-workspace-id", "default"); }
  return h;
}

type AdsProfile = { id: string; authorizationId: string; region: string; profileId: string; countryCode: string; marketplaceId: string; currencyCode: string; authorization: { name: string; status: string; lastValidatedAt: string | null; refreshTokenExpiresAt: string | null }; syncPlans: Array<{ id: string; status: string; nextRunAt: string | null; lastSuccessAt: string | null; lastErrorCode: string | null }> };
type AdsProfilesPayload = { profiles: AdsProfile[]; oauthConfigured: boolean; autoSyncConfigured: boolean; error?: string };
type SpConnectionsPayload = { authorizations: SyncAuthorizationView[]; sources: SyncSourceView[]; access?: SyncAccess; error?: string };

function statusBadge(status: string) {
  if (["CONFIGURED", "ACTIVE", "CONNECTED"].includes(status)) return <Badge tone="green">已授权</Badge>;
  if (["ERROR", "AUTH_REJECTED", "EXPIRED", "DISCONNECTED"].includes(status)) return <Badge tone="red">授权失效</Badge>;
  return <Badge tone="amber">等待授权</Badge>;
}

type CardAction = { label: string; onClick: () => void; variant?: "secondary" | "ghost"; disabled?: boolean; title?: string };
function ConnectionCard({ kind, name, status, summary, actions, children }: { kind: string; name: string; status: string; summary: React.ReactNode; actions: CardAction[]; children?: React.ReactNode }) {
  return <article className="rounded-lg border border-border bg-surface p-4" data-testid="amazon-connection-card">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-label font-medium text-muted">{kind}</p><h3 className="mt-0.5 text-sm font-semibold">{name}</h3></div>{statusBadge(status)}</div>
    <div className="mt-3 space-y-1 text-xs text-muted">{summary}</div>
    {children}
    <div className="mt-4 flex flex-wrap gap-2">{actions.map(a => <Button key={a.label} size="sm" variant={a.variant ?? "secondary"} disabled={a.disabled} title={a.title} onClick={a.onClick}>{a.label}</Button>)}</div>
  </article>;
}

export function AmazonConnections() {
  const [spAuths, setSpAuths] = useState<SyncAuthorizationView[]>([]), [spSources, setSpSources] = useState<SyncSourceView[]>([]), [spAccess, setSpAccess] = useState<SyncAccess>({ canEdit: false, canCreate: false, canConfigure: false });
  const [adsProfiles, setAdsProfiles] = useState<AdsProfile[]>([]), [adsOauth, setAdsOauth] = useState(false), [adsAutoSync, setAdsAutoSync] = useState(false);
  const [spError, setSpError] = useState(""), [adsError, setAdsError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; description: string; run: () => void } | null>(null);
  const [adsRegion, setAdsRegion] = useState("us-east-1");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    const h = scopeHeaders();
    const [sp, ads] = await Promise.all([
      getJson<SpConnectionsPayload>(`${spBase}?section=connections`, { headers: h }),
      getJson<AdsProfilesPayload>(`${adsBase}/profiles`, { headers: h }),
    ]);
    if (!mounted.current) return;
    if (sp.ok) { setSpAuths(sp.data.authorizations ?? []); setSpSources(sp.data.sources ?? []); if (sp.data.access) setSpAccess(sp.data.access); setSpError(""); }
    else setSpError(sp.data.error ?? "SP-API 连接读取失败。");
    if (ads.ok) { setAdsProfiles(ads.data.profiles ?? []); setAdsOauth(ads.data.oauthConfigured); setAdsAutoSync(ads.data.autoSyncConfigured); setAdsError(""); }
    else setAdsError(ads.data.error ?? "Ads 连接读取失败。");
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (url: string, body: Record<string, unknown>, success: string) => {
    setBusy(true); setNotice("");
    try {
      const h = scopeHeaders(); h.set("content-type", "application/json");
      const res = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "操作失败。");
      setNotice(`${success}已生效，正在后台验证并同步。`);
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "操作失败。"); }
    finally { setBusy(false); }
  };

  const spGroups = spAuths.map(a => {
    const sources = spSources.filter(s => s.authorizationId === a.id);
    const markets = new Set(a.marketplaceParticipations.map(m => m.marketplaceId));
    const ready = new Set(sources.filter(s => s.authorization.status === "CONFIGURED").map(s => s.resource));
    const failed = sources.filter(s => ["FAILED", "BLOCKED"].includes(s.health));
    return { auth: a, sources, marketCount: markets.size, readyCount: ready.size, failedCount: failed.length };
  });
  const adsGroups = [...new Map(adsProfiles.map(p => [p.authorizationId, p.authorization])).entries()].map(([id, auth]) => {
    const profiles = adsProfiles.filter(p => p.authorizationId === id);
    const plans = profiles.flatMap(p => p.syncPlans);
    const failed = plans.filter(p => p.lastErrorCode);
    return { id, auth, profiles, planCount: plans.length, failedCount: failed.length };
  });

  return <div className="space-y-4" data-testid="amazon-connections">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-title font-semibold">Amazon 连接管理</h1><p className="mt-0.5 text-xs text-muted">仅管理 Amazon SP-API 与 Ads API 连接；赛狐连接请在系统设置的「集成」页维护。删除连接仅停止调度，保留已落库业务数据。</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>刷新</Button><a href="/operations?view=amazon-sync" className="inline-flex min-h-9 items-center rounded-md bg-brand px-3 text-sm font-semibold text-white">查看同步矩阵</a></div></header>
    {notice && <p role="status" className="text-sm text-brand">{notice}</p>}
    {spError && <p role="alert" className="rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger-ink">{spError}（需要组织所有者／数据库管理员权限读取连接配置）</p>}
    {adsError && <p role="alert" className="rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger-ink">{adsError}</p>}

    <section className="space-y-3"><h2 className="text-sm font-semibold">Amazon SP-API 连接</h2>
      {spGroups.length ? <div className="grid gap-3 lg:grid-cols-2">{spGroups.map(g => <ConnectionCard key={g.auth.id} kind="Amazon SP-API" name={g.auth.name} status={g.auth.status}
        summary={<><p>已发现 Marketplace：{g.marketCount} 个</p><p>权限就绪资源：{g.readyCount} · 失败资源：<span className={g.failedCount ? "text-danger-ink" : undefined}>{g.failedCount}</span></p><p>授权区域：{g.auth.awsRegion}</p><p>最近验证：{stamp(g.auth.lastValidatedAt)}</p></>}
        actions={[
          { label: "编辑凭据", variant: "secondary", disabled: !spAccess.canConfigure || busy || g.auth.status === "DISABLED", title: "在店铺与授权中编辑", onClick: () => window.location.assign("/operations?view=connections") },
          ...(g.auth.status === "DISABLED" ? [
            { label: "重新启用连接", variant: "secondary" as const, disabled: !spAccess.canConfigure || busy, onClick: () => setConfirm({ title: `重新启用 ${g.auth.name}`, description: "启用后立即生效，并自动验证参与站点、恢复全量同步。是否继续？", run: () => void post(spBase, { action: "enable-authorization", id: g.auth.id, revision: g.auth.revision }, "重新启用") }) },
          ] : [
            { label: "停用连接", variant: "ghost" as const, disabled: !spAccess.canConfigure || busy, onClick: () => setConfirm({ title: `停用 ${g.auth.name}`, description: "停用后立即生效，该授权不再生成同步任务；已落库业务数据保留。是否继续？", run: () => void post(spBase, { action: "disable-authorization", id: g.auth.id, revision: g.auth.revision }, "停用") }) },
          ]),
          { label: "查看同步矩阵", variant: "ghost", onClick: () => window.location.assign("/operations?view=amazon-sync") },
        ]} />)}</div> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">尚无 SP-API 连接。请在「店铺与授权」→「新增授权」中配置。</p>}
    </section>

    <section className="space-y-3"><h2 className="text-sm font-semibold">Amazon Ads API 连接</h2>
      {adsGroups.length ? <div className="grid gap-3 lg:grid-cols-2">{adsGroups.map(g => <ConnectionCard key={g.id} kind="Amazon Ads API" name={g.auth.name || g.id} status={g.auth.status}
        summary={<><p>已发现 Profile：{g.profiles.length} 个</p><p>同步计划：{g.planCount} · 失败计划：<span className={g.failedCount ? "text-danger-ink" : undefined}>{g.failedCount}</span></p><p>最近验证：{stamp(g.auth.lastValidatedAt)}</p><p>自动同步：{adsAutoSync ? "已配置" : "未配置"}</p></>}
        actions={[
          { label: "前往授权", disabled: !adsOauth || busy, title: adsOauth ? undefined : "服务端未配置 Ads OAuth 环境", onClick: () => setConfirm({ title: "开始 Amazon Ads 授权", description: "将跳转 Amazon 授权页面完成登录与授权。是否继续？", run: () => void post(`${adsBase}/oauth/start`, { region: adsRegion }, "授权") }) },
          { label: "查看同步矩阵", variant: "secondary", onClick: () => window.location.assign("/operations?view=amazon-sync") },
          { label: "删除连接", variant: "ghost", disabled: busy, onClick: () => setConfirm({ title: `删除 ${g.auth.name || g.id}`, description: "将停止该授权下的调度任务和同步状态，标记为已断开；已落库业务数据保留。是否继续？", run: () => void post(`${adsBase}/profiles`, { action: "disconnect", authorizationId: g.id }, "删除") }) },
        ]}>
          <label className="mt-3 block text-xs text-muted">授权区域<select aria-label="Ads 授权区域" className="ml-2 min-h-8 rounded border border-border bg-background px-2 text-sm" value={adsRegion} onChange={e => setAdsRegion(e.target.value)}><option value="us-east-1">北美 (us-east-1)</option><option value="eu-west-1">欧洲 (eu-west-1)</option><option value="us-west-2">北美西部 (us-west-2)</option><option value="far-east-1">远东 (far-east-1)</option></select></label>
        </ConnectionCard>)}</div> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">尚无 Ads 连接。{adsOauth ? "点击「前往授权」开始。" : "服务端尚未配置 Ads OAuth 环境。"}</p>}
    </section>

    <Dialog open={confirm !== null} title={confirm?.title ?? ""} busy={busy} onClose={() => { if (!busy) setConfirm(null); }} footer={<><Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>取消</Button><Button disabled={busy} onClick={() => { const run = confirm?.run; setConfirm(null); run?.(); }}>确认继续</Button></>}>
      <p className="text-sm text-muted">{confirm?.description}</p>
    </Dialog>
  </div>;
}
