"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, PlugZap, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Provider = "amazon" | "sellfox";
type Credential = {
  id: string; name: string; status: string; revision: number; tokenPrefix: string;
  tools: string[]; expiresAt: string; lastUsedAt: string | null;
  storeIds?: string[]; scopes?: unknown;
};
type ToolEntry = { name: string; description: string; operationMode: string; version: string };
type Dataset = { key: string; label: string; description: string; table: string };
type HealthRow = { key: string; label: string; state: string; detail: string };
type AuditRow = { id: string; provider: Provider; action: string; label: string; outcome: string; createdAt: string };
type ScopeOption = { sellerAccountId: string; marketplaceId: string; displayName: string };
type Payload = {
  health: HealthRow[];
  audit: AuditRow[];
  amazon: {
    credentials: Credential[]; scopeOptions: ScopeOption[]; tools: ToolEntry[];
    readonlyConfigured: boolean; activeCount: number; lastUsedAt: string | null;
  };
  sellfox: {
    credentials: Credential[]; stores: Array<{ id: string; name: string; marketplace: string | null; country: string | null }>;
    tools: ToolEntry[]; datasets: Dataset[]; catalogSize: number; readonlyRoleConfigured: boolean;
    sharedTokenEnabled: boolean; activeCount: number; lastUsedAt: string | null;
  };
};

const providerMeta: Record<Provider, { label: string; accent: string; purpose: string; readScope: string }> = {
  amazon: {
    label: "Amazon MCP",
    accent: "border-l-sky-500",
    purpose: "读 ERP 里已发布的 Amazon 订单、广告、库存快照；写操作只能提交审批，不会直接改数。",
    readScope: "授权店铺 × 站点的已发布快照",
  },
  sellfox: {
    label: "赛狐 MCP",
    accent: "border-l-emerald-500",
    purpose: "读赛狐同步的店铺、Listing、FBA 库存、销量、广告与利润日报，并做补货和广告诊断。",
    readScope: "凭证店铺范围内的 9 个数据集",
  },
};

const field = "h-8 rounded-md border border-border bg-white px-2 text-xs text-foreground";
const card = "rounded-lg border border-border bg-white shadow-sm";

function relative(iso: string | null) {
  if (!iso) return "从未使用";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

function credentialState(credential: Credential): { label: string; tone: "green" | "amber" | "red" | "gray" } {
  if (credential.status === "REVOKED") return { label: "已撤销", tone: "red" };
  if (credential.status === "DISABLED") return { label: "已停用", tone: "gray" };
  if (new Date(credential.expiresAt).getTime() <= Date.now()) return { label: "已过期", tone: "amber" };
  return { label: "可用", tone: "green" };
}

function scopeSummary(provider: Provider, credential: Credential, stores: Payload["sellfox"]["stores"]) {
  if (provider === "sellfox") {
    const ids = credential.storeIds ?? [];
    if (!ids.length) return "全部店铺";
    if (ids.length <= 2) return ids.map(id => stores.find(store => store.id === id)?.name ?? "已删除店铺").join("、");
    return `${ids.length} 个店铺`;
  }
  const scopes = Array.isArray(credential.scopes) ? credential.scopes as Array<{ sellerAccountId?: string; marketplaceIds?: string[] }> : [];
  if (!scopes.length) return "未限定（按 ERP 授权）";
  const marketplaces = scopes.reduce((total, scope) => total + (scope.marketplaceIds?.length ?? 0), 0);
  return `${scopes.length} 个店铺 · ${marketplaces} 个站点`;
}

function CopyButton({ value, label = "复制" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : label}
    </Button>
  );
}

function HealthIcon({ state }: { state: string }) {
  if (state === "ok") return <Check className="h-4 w-4 shrink-0 text-emerald-600" />;
  if (state === "warn") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />;
  return <X className="h-4 w-4 shrink-0 text-red-600" />;
}

function scopedHeaders() {
  const headers = new Headers();
  try {
    headers.set("x-workspace-id", JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") || "{}").workspaceId || "default");
  } catch {
    headers.set("x-workspace-id", "default");
  }
  return headers;
}

export function McpSettingsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  const [provider, setProvider] = useState<Provider>("sellfox");
  const [name, setName] = useState("我的赛狐 MCP");
  const [days, setDays] = useState(30);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [amazonScopes, setAmazonScopes] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [token, setToken] = useState<{ provider: Provider; value: string } | null>(null);
  const [probe, setProbe] = useState<Partial<Record<Provider, { ok: boolean; detail: string }>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/mcp-isolation", { headers: scopedHeaders(), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "加载失败");
      setData(payload as Payload);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
    const reset = () => { setToken(null); setTools([]); setStoreIds([]); setAmazonScopes([]); void load(); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, [load]);

  useEffect(() => {
    setTools([]);
    setName(provider === "sellfox" ? "我的赛狐 MCP" : "我的 Amazon MCP");
  }, [provider]);

  const amazonScopeOptions = useMemo(() => {
    const seen = new Set<string>();
    return (data?.amazon.scopeOptions ?? []).filter(option => {
      const key = `${option.sellerAccountId}|${option.marketplaceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);

  const activeTools = provider === "sellfox" ? data?.sellfox.tools ?? [] : data?.amazon.tools ?? [];

  const send = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const headers = scopedHeaders();
      headers.set("content-type", "application/json");
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "操作失败");
      return payload as Record<string, unknown>;
    } finally {
      setBusy(false);
    }
  };

  const createCredential = async () => {
    if (!name.trim() || !tools.length) return;
    const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
    try {
      const payload = provider === "amazon"
        ? await send("/api/operations/amazon-mcp", {
            action: "create", name, tools, expiresAt,
            scopes: amazonScopes.map(key => {
              const [sellerAccountId, marketplaceId] = key.split("|");
              return { sellerAccountId, marketplaceIds: [marketplaceId] };
            }),
          })
        : await send("/api/operations/mcp-isolation", { action: "create", name, tools, storeIds, expiresAt });
      if (typeof payload.token === "string") setToken({ provider, value: payload.token });
      setTools([]);
      setStoreIds([]);
      setAmazonScopes([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const mutate = async (target: Provider, action: "rotate" | "disable" | "revoke", credential: Credential) => {
    try {
      const payload = target === "amazon"
        ? await send("/api/operations/amazon-mcp", { action, id: credential.id, revision: credential.revision })
        : await send("/api/operations/mcp-isolation", { action, id: credential.id, revision: credential.revision });
      if (typeof payload.token === "string") setToken({ provider: target, value: payload.token });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const runProbe = async (target: Provider) => {
    setProbe(current => ({ ...current, [target]: undefined }));
    try {
      const payload = await send("/api/operations/mcp-isolation", { action: "probe", provider: target });
      setProbe(current => ({ ...current, [target]: { ok: Boolean(payload.ok), detail: String(payload.detail ?? "") } }));
    } catch (cause) {
      setProbe(current => ({ ...current, [target]: { ok: false, detail: cause instanceof Error ? cause.message : "自检失败" } }));
    }
  };

  const credentials = data
    ? [
        ...data.amazon.credentials.map(credential => ({ provider: "amazon" as Provider, credential })),
        ...data.sellfox.credentials.map(credential => ({ provider: "sellfox" as Provider, credential })),
      ]
    : [];

  const warnings = (data?.health ?? []).filter(row => row.state !== "ok");
  const totalTools = (data?.amazon.tools.length ?? 0) + (data?.sellfox.tools.length ?? 0);
  const totalActive = (data?.amazon.activeCount ?? 0) + (data?.sellfox.activeCount ?? 0);

  return (
    <div className="space-y-4">
      <section className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-brand" />
              <h2 className="text-base font-bold">MCP 接入</h2>
              <Badge tone={warnings.length ? "amber" : "green"}>{warnings.length ? `${warnings.length} 项待处理` : "全部正常"}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              Amazon 与赛狐是两套独立服务：端点、令牌、凭证、数据表、审计全部不共用。给每个使用者单独发凭证，只勾他需要读的店铺和工具。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
            </Button>
            <Button size="sm" onClick={() => document.getElementById("mcp-credential-form")?.scrollIntoView({ block: "start" })}>
              <KeyRound className="h-3.5 w-3.5" /> 新建凭证
            </Button>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "在线服务", value: "2 个", hint: "Amazon · 赛狐" },
            { label: "可用凭证", value: `${totalActive} 个`, hint: "已排除过期与停用" },
            { label: "只读工具", value: `${totalTools} 个`, hint: "全部为只读或审批申请" },
            { label: "待处理", value: `${warnings.length} 项`, hint: warnings.length ? "见下方检查清单" : "无需处理" },
          ].map(item => (
            <div key={item.label} className="rounded-md border border-border bg-surface-muted/60 px-3 py-2">
              <dt className="text-xs text-muted">{item.label}</dt>
              <dd className="mt-0.5 text-lg font-bold text-foreground">{item.value}</dd>
              <p className="text-[11px] text-muted">{item.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      {loading && <p role="status" className="text-sm text-muted">加载中…</p>}
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <section className="grid gap-3 md:grid-cols-2">
            {(["amazon", "sellfox"] as Provider[]).map(item => {
              const meta = providerMeta[item];
              const bucket = item === "amazon" ? data.amazon : data.sellfox;
              const active = item === "amazon" ? data.amazon.activeCount : data.sellfox.activeCount;
              const probeResult = probe[item];
              return (
                <div key={item} className={`${card} border-l-4 ${meta.accent}`}>
                  <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold">{meta.label}</h3>
                        <Badge tone={active > 0 ? "green" : "amber"}>{active > 0 ? "可用" : "无可用凭证"}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">{meta.purpose}</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => void runProbe(item)} disabled={busy}>
                      <PlugZap className="h-3.5 w-3.5" /> 测试
                    </Button>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-xs">
                    <div className="col-span-2">
                      <dt className="text-muted">服务地址</dt>
                      <dd className="mt-0.5 flex items-center gap-2">
                        <code className="truncate font-mono text-foreground">{item === "amazon" ? "/api/mcp/amazon" : "/api/mcp/sellfox"}</code>
                        <CopyButton value={`${origin}${item === "amazon" ? "/api/mcp/amazon" : "/api/mcp/sellfox"}`} label="复制地址" />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">令牌前缀</dt>
                      <dd className="font-mono font-semibold">{item === "amazon" ? "amcp_" : "sfmcp_"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">凭证 / 工具</dt>
                      <dd className="font-semibold">{bucket.credentials.length} 个 / {bucket.tools.length} 个</dd>
                    </div>
                    <div>
                      <dt className="text-muted">可读范围</dt>
                      <dd className="font-semibold">{meta.readScope}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">最近调用</dt>
                      <dd className="font-semibold">{relative(bucket.lastUsedAt)}</dd>
                    </div>
                  </dl>

                  {item === "sellfox" && (
                    <div className="border-t border-border px-4 py-3">
                      <p className="text-xs font-semibold text-muted">可读数据集（{data.sellfox.datasets.length}）</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {data.sellfox.datasets.map(dataset => (
                          <span key={dataset.key} title={`${dataset.table} · ${dataset.description}`} className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[11px]">
                            {dataset.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <details className="border-t border-border px-4 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-brand">看工具能做什么（{bucket.tools.length}）</summary>
                    <ul className="mt-2 space-y-1.5">
                      {bucket.tools.map(tool => (
                        <li key={tool.name} className="text-xs leading-5">
                          <code className="font-mono text-foreground">{tool.name}</code>
                          <span className="ml-1 rounded bg-surface-muted px-1 text-[10px] text-muted">{tool.operationMode === "READ_ONLY" ? "只读" : "需审批"}</span>
                          <span className="block text-muted">{tool.description}</span>
                        </li>
                      ))}
                    </ul>
                  </details>

                  {probeResult && (
                    <p className={`border-t border-border px-4 py-2 text-xs ${probeResult.ok ? "text-emerald-700" : "text-amber-700"}`} role="status">
                      {probeResult.ok ? "✓ " : "! "}{probeResult.detail}
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          <section className={`${card} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">隔离检查</h3>
                <p className="mt-0.5 text-xs text-muted">越界请求在查询数据库之前就被拒绝，并写入各自命名空间的审计。</p>
              </div>
              <Badge tone={warnings.length ? "amber" : "green"}>{data.health.length - warnings.length}/{data.health.length} 通过</Badge>
            </div>
            <ul className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
              {data.health.map(row => (
                <li key={row.key} className="flex items-start gap-2 border-b border-border/60 pb-2 last:border-0">
                  <HealthIcon state={row.state} />
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold ${row.state === "ok" ? "" : "text-amber-800"}`}>{row.label}</p>
                    <p className="text-[11px] leading-4 text-muted">{row.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className={`${card} p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">凭证与权限</h3>
                <p className="mt-0.5 text-xs text-muted">一个凭证 = 一个人 + 一组店铺/站点 + 一组工具 + 一个到期时间。撤销立即失效，轮换会作废旧密钥。</p>
              </div>
              <Badge tone="gray">{credentials.length} 个</Badge>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    {["凭证", "服务", "状态", "可读范围", "工具", "到期", "最近使用", "操作"].map(label => <th key={label} className="py-2 pr-3 font-medium">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {credentials.map(({ provider: target, credential }) => {
                    const state = credentialState(credential);
                    return (
                      <tr key={`${target}-${credential.id}`} className="border-b border-border/70 align-middle">
                        <td className="py-2 pr-3">
                          <span className="font-semibold">{credential.name}</span>
                          <span className="block font-mono text-[11px] text-muted">{credential.tokenPrefix}…</span>
                        </td>
                        <td className="py-2 pr-3">{providerMeta[target].label}</td>
                        <td className="py-2 pr-3"><Badge tone={state.tone}>{state.label}</Badge></td>
                        <td className="py-2 pr-3">{scopeSummary(target, credential, data.sellfox.stores)}</td>
                        <td className="py-2 pr-3">{credential.tools.length} 个</td>
                        <td className="py-2 pr-3">{new Date(credential.expiresAt).toLocaleDateString()}</td>
                        <td className="py-2 pr-3">{relative(credential.lastUsedAt)}</td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <Button variant="secondary" size="sm" disabled={busy || credential.status !== "ACTIVE"} onClick={() => void mutate(target, "rotate", credential)}>轮换</Button>
                            <Button variant="secondary" size="sm" disabled={busy || credential.status !== "ACTIVE"} onClick={() => void mutate(target, "disable", credential)}>停用</Button>
                            <Button variant="ghost" size="sm" disabled={busy || credential.status === "REVOKED"} onClick={() => void mutate(target, "revoke", credential)}>撤销</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!credentials.length && (
                <p className="py-3 text-xs text-muted">还没有凭证。下面新建一个，密钥只显示一次。</p>
              )}
            </div>
          </section>

          <section id="mcp-credential-form" className={`${card} p-5`}>
            <h3 className="text-sm font-bold">新建凭证</h3>
            <p className="mt-0.5 text-xs text-muted">选服务 → 选范围 → 选工具 → 生成密钥。范围留空表示该服务下你可见的全部。</p>

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-semibold text-muted">1. 服务</span>
                  <div className="mt-1 flex gap-2">
                    {(["sellfox", "amazon"] as Provider[]).map(item => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setProvider(item)}
                        aria-pressed={provider === item}
                        className={`h-8 rounded-md border px-3 text-xs font-semibold ${provider === item ? "border-brand bg-brand text-white" : "border-border bg-white text-foreground hover:bg-surface-muted"}`}
                      >
                        {providerMeta[item].label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block text-xs font-semibold text-muted">
                  2. 名称
                  <input className={`${field} mt-1 w-full`} maxLength={100} value={name} onChange={event => setName(event.target.value)} />
                </label>

                <label className="block text-xs font-semibold text-muted">
                  3. 有效期
                  <select className={`${field} mt-1 w-full`} value={days} onChange={event => setDays(Number(event.target.value))}>
                    <option value={7}>7 天（临时试用）</option>
                    <option value={30}>30 天（默认）</option>
                    <option value={90}>90 天（长期）</option>
                  </select>
                </label>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted">
                      4. 可读范围{provider === "sellfox" ? `（${data.sellfox.stores.length} 个店铺，留空=全部）` : `（${amazonScopeOptions.length} 个店铺站点）`}
                    </span>
                    {provider === "sellfox" && data.sellfox.stores.length > 0 && (
                      <button type="button" className="text-[11px] text-brand" onClick={() => setStoreIds(storeIds.length ? [] : data.sellfox.stores.map(store => store.id))}>
                        {storeIds.length ? "清空" : "全选"}
                      </button>
                    )}
                  </div>
                  <div className="mt-1 max-h-32 overflow-auto rounded-md border border-border p-2">
                    {provider === "sellfox" ? (
                      data.sellfox.stores.length ? data.sellfox.stores.map(store => (
                        <label key={store.id} className="flex items-center gap-1.5 py-0.5 text-xs">
                          <input type="checkbox" checked={storeIds.includes(store.id)} onChange={event => setStoreIds(value => event.target.checked ? [...value, store.id] : value.filter(id => id !== store.id))} />
                          <span className="truncate">{store.name}</span>
                          <span className="text-muted">{store.marketplace ?? store.country ?? ""}</span>
                        </label>
                      )) : <p className="text-xs text-muted">当前工作区没有店铺数据。</p>
                    ) : (
                      amazonScopeOptions.length ? amazonScopeOptions.map(option => {
                        const key = `${option.sellerAccountId}|${option.marketplaceId}`;
                        return (
                          <label key={key} className="flex items-center gap-1.5 py-0.5 text-xs">
                            <input type="checkbox" checked={amazonScopes.includes(key)} onChange={event => setAmazonScopes(value => event.target.checked ? [...value, key] : value.filter(item => item !== key))} />
                            <span className="truncate">{option.displayName}</span>
                            <span className="text-muted">{option.marketplaceId}</span>
                          </label>
                        );
                      }) : <p className="text-xs text-muted">没有已授权的店铺站点，先去集成里完成授权。</p>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted">5. 允许工具（建议只勾要用的）</span>
                    <button type="button" className="text-[11px] text-brand" onClick={() => setTools(tools.length === activeTools.length ? [] : activeTools.map(tool => tool.name))}>
                      {tools.length === activeTools.length ? "清空" : "全选"}
                    </button>
                  </div>
                  <div className="mt-1 max-h-40 overflow-auto rounded-md border border-border p-2">
                    {activeTools.map(tool => (
                      <label key={tool.name} className="flex items-start gap-1.5 py-0.5 text-xs">
                        <input type="checkbox" className="mt-0.5" checked={tools.includes(tool.name)} onChange={event => setTools(value => event.target.checked ? [...value, tool.name] : value.filter(item => item !== tool.name))} />
                        <span className="min-w-0">
                          <span className="font-mono">{tool.name}</span>
                          <span className="block text-[11px] leading-4 text-muted">{tool.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                disabled={busy || !name.trim() || !tools.length || (provider === "amazon" && !amazonScopes.length)}
                onClick={() => void createCredential()}
              >
                <KeyRound className="h-3.5 w-3.5" /> 生成密钥
              </Button>
              <span className="text-xs text-muted">
                {provider === "amazon" ? "Amazon 凭证必须显式选择店铺和站点，避免越权读到其他账号。" : "不勾店铺 = 该工作区全部店铺；建议按人按店拆分。"}
              </span>
            </div>

            {token && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">新密钥只显示一次，关闭后无法再查看。请现在复制到客户端配置。</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input aria-label="新 MCP 密钥" readOnly className={`${field} min-w-[320px] flex-1 font-mono`} value={token.value} />
                  <CopyButton value={token.value} label="复制密钥" />
                  <Button variant="secondary" size="sm" onClick={() => setToken(null)}>已保存，关闭</Button>
                </div>
                <p className="mt-1 text-[11px] text-amber-800">服务：{providerMeta[token.provider].label} · 前缀 {token.provider === "amazon" ? "amcp_" : "sfmcp_"}，只能用于对应端点。</p>
              </div>
            )}
          </section>

          <section className={`${card} p-5`}>
            <h3 className="text-sm font-bold">客户端接入</h3>
            <p className="mt-0.5 text-xs text-muted">两个服务必须配两个 server，各用各自的密钥；拿一个密钥走两端会被拒绝并记审计。</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {([
                { provider: "amazon" as Provider, prefix: "amcp_", path: "/api/mcp/amazon", server: "erp-amazon" },
                { provider: "sellfox" as Provider, prefix: "sfmcp_", path: "/api/mcp/sellfox", server: "erp-sellfox" },
              ]).map(item => {
                const snippet = JSON.stringify({
                  mcpServers: {
                    [item.server]: {
                      url: `${origin}${item.path}`,
                      headers: { Authorization: `Bearer ${item.prefix}<你的密钥>` },
                    },
                  },
                }, null, 2);
                return (
                  <div key={item.provider} className="rounded-md border border-border">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                      <span className="text-xs font-semibold">{providerMeta[item.provider].label}</span>
                      <CopyButton value={snippet} />
                    </div>
                    <pre className="max-h-48 overflow-auto px-3 py-2 text-[11px] leading-5 text-foreground">{snippet}</pre>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`${card} p-5`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">最近事件</h3>
                <p className="mt-0.5 text-xs text-muted">凭证变更、越界拒绝和工具调用都会留痕，便于追责。</p>
              </div>
              <Badge tone="gray">{data.audit.length} 条</Badge>
            </div>
            <ul className="mt-2 divide-y divide-border/70">
              {data.audit.map(row => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                  <span className="w-36 shrink-0 text-muted">{new Date(row.createdAt).toLocaleString()}</span>
                  <span className="w-24 shrink-0 font-semibold">{providerMeta[row.provider].label}</span>
                  <span className="flex-1">{row.label}</span>
                  <Badge tone={row.outcome === "拒绝" ? "red" : row.outcome === "变更" ? "blue" : "gray"}>{row.outcome}</Badge>
                </li>
              ))}
              {!data.audit.length && <li className="py-2 text-xs text-muted">暂无 MCP 审计记录。</li>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
