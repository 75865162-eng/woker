"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type MatrixRow = { provider: string; label: string; endpoint: string; tokenPrefix: string; credentialModel: string; tablePrefix: string; dbRole: string; dbRoleConfigured: boolean; auditPrefix: string; crossProviderPolicy: string };
type SellfoxCredential = { id: string; name: string; status: string; revision: number; tokenPrefix: string; tools: string[]; storeIds: string[]; expiresAt: string; lastUsedAt: string | null };
type Store = { id: string; externalId: string | null; name: string; marketplace: string | null; country: string | null };
type ToolEntry = { name: string; description: string; operationMode: string; version: string };
type Payload = {
  matrix: MatrixRow[];
  endpoints: { amazon: { path: string; tokenPrefix: string; credentialCount: number; isolation: string }; sellfox: { path: string; tokenPrefix: string; credentialCount: number; legacyPath: string; isolation: string } };
  sellfox: { credentials: SellfoxCredential[]; stores: Store[]; tools: ToolEntry[]; datasets: string[]; catalogSize: number; readonlyRoleConfigured: boolean; sharedTokenEnabled: boolean };
};
const input = "rounded border border-border bg-background px-2 py-1.5 text-sm";

function scopedHeaders() {
  const headers = new Headers();
  try { headers.set("x-workspace-id", JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") || "{}").workspaceId || "default"); }
  catch { headers.set("x-workspace-id", "default"); }
  return headers;
}

export function McpIsolationPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [name, setName] = useState("我的赛狐 MCP");
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/operations/mcp-isolation", { headers: scopedHeaders(), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "加载失败");
      setData(payload as Payload);
    } catch (cause) {
      setData(null); setError(cause instanceof Error ? cause.message : "加载失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const reset = () => { setToken(""); void load(); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, [load]);

  const execute = async (body: Record<string, unknown>) => {
    setBusy(true); setError(""); setToken("");
    try {
      const headers = scopedHeaders(); headers.set("content-type", "application/json");
      const response = await fetch("/api/operations/mcp-isolation", { method: "POST", headers, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "操作失败");
      if (typeof payload.token === "string") setToken(payload.token);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setBusy(false); }
  };

  return <section className="rounded-lg border border-border bg-surface p-4 text-sm">
    <h2 className="font-semibold">MCP 权限与数据隔离</h2>
    <p className="my-2 text-xs text-muted">Amazon 与赛狐是两个物理隔离的 MCP 服务：凭证表不同、令牌前缀不同、端点互不通用、数据表前缀不同、审计命名空间不同。任一凭证出现在另一提供方端点时，在查询数据库前即拒绝并记审计。</p>
    {loading && <p role="status">加载中…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!loading && data && <>
      <div className="my-3 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-xs">
          <thead><tr className="border-b border-border text-muted">{["服务", "端点", "令牌前缀", "凭证表", "可读表域", "只读角色", "跨提供方", "审计前缀"].map(label => <th key={label} className="py-2 pr-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{data.matrix.map(row => <tr key={row.provider} className="border-b border-border/70 align-top">
            <td className="py-2 pr-3 font-semibold">{row.label}</td>
            <td className="py-2 pr-3 font-mono">{row.endpoint}</td>
            <td className="py-2 pr-3 font-mono">{row.tokenPrefix}</td>
            <td className="py-2 pr-3 font-mono">{row.credentialModel}</td>
            <td className="py-2 pr-3 font-mono">{row.tablePrefix}</td>
            <td className="py-2 pr-3">{row.dbRole}<span className="block text-muted">{row.dbRoleConfigured ? "连接已配置" : "未配置独立只读连接"}</span></td>
            <td className="py-2 pr-3">{row.crossProviderPolicy}</td>
            <td className="py-2 font-mono">{row.auditPrefix}.*</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="grid gap-2 text-xs md:grid-cols-2">
        <p>Amazon：{data.endpoints.amazon.isolation} · 当前用户凭证 {data.endpoints.amazon.credentialCount} 个</p>
        <p>赛狐：{data.endpoints.sellfox.isolation} · 当前用户凭证 {data.endpoints.sellfox.credentialCount} 个（兼容旧路径 {data.endpoints.sellfox.legacyPath}）</p>
      </div>
      {(!data.sellfox.readonlyRoleConfigured || data.sellfox.sharedTokenEnabled) && <ul className="my-2 space-y-1 text-xs text-amber-700">
        {!data.sellfox.readonlyRoleConfigured && <li>赛狐 MCP 未配置独立只读连接（MCP_PG_READONLY_URL）。当前无法执行查询，也不会回退到可写连接。</li>}
        {data.sellfox.sharedTokenEnabled && <li>检测到兼容共享令牌 MCP_HTTP_TOKEN 仍启用。它只能在赛狐端点的单一组织内只读；建议迁移到个人凭证后设置 MCP_DISABLE_SHARED_TOKEN=true。</li>}
      </ul>}
      <h3 className="mt-4 text-sm font-semibold">赛狐 MCP 凭证</h3>
      <p className="mt-1 text-xs text-muted">凭证店铺范围决定可读数据；留空表示该组织/工作区全部店铺。工具名统一带 sellfox. 前缀，与 Amazon 工具无交集。</p>
      {token && <div className="my-3 rounded border border-amber-400 p-3"><p>新密钥仅显示一次，请立即保存。</p><input aria-label="新赛狐 MCP 密钥" readOnly className={`${input} mt-2 w-full font-mono`} value={token} /><Button variant="secondary" size="sm" onClick={() => setToken("")}>已保存，关闭展示</Button></div>}
      <div className="my-3 space-y-2">
        <label className="flex gap-2">凭证名称<input className={input} maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
        <fieldset><legend className="text-xs">店铺范围（{data.sellfox.stores.length} 个可选）</legend>
          <div className="mt-1 grid gap-1 md:grid-cols-3">{data.sellfox.stores.map(store => <label key={store.id} className="inline-flex gap-1 text-xs"><input type="checkbox" checked={selectedStores.includes(store.id)} onChange={event => setSelectedStores(value => event.target.checked ? [...value, store.id] : value.filter(id => id !== store.id))} />{store.name} · {store.marketplace ?? store.country ?? "-"}</label>)}</div>
        </fieldset>
        <fieldset><legend className="text-xs">允许工具</legend>
          <div className="mt-1 space-y-1">{data.sellfox.tools.map(tool => <label key={tool.name} className="flex gap-1 text-xs"><input type="checkbox" checked={selectedTools.includes(tool.name)} onChange={event => setSelectedTools(value => event.target.checked ? [...value, tool.name] : value.filter(item => item !== tool.name))} /><span className="font-mono">{tool.name}</span><span className="text-muted">{tool.description}</span></label>)}</div>
        </fieldset>
        <Button size="sm" disabled={busy || !name.trim() || !selectedTools.length} onClick={() => void execute({ action: "create", name, tools: selectedTools, storeIds: selectedStores, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() })}>创建赛狐凭证</Button>
      </div>
      <div className="space-y-3">{data.sellfox.credentials.map(credential => <div key={credential.id} className="border-t border-border pt-3">
        <p>{credential.name} · {credential.tokenPrefix}… · {credential.status} · 到期 {new Date(credential.expiresAt).toLocaleString()}</p>
        <p className="text-xs text-muted">店铺 {credential.storeIds.length || "全部"} · 工具 {credential.tools.length} 个 · 最近使用 {credential.lastUsedAt ? new Date(credential.lastUsedAt).toLocaleString() : "尚未使用"}</p>
        <details><summary className="cursor-pointer text-xs text-brand">查看工具与店铺</summary><pre className="mt-1 overflow-auto text-xs">{JSON.stringify({ tools: credential.tools, storeIds: credential.storeIds }, null, 2)}</pre></details>
        <div className="mt-2 flex gap-2">{([["rotate", "轮换"], ["disable", "禁用"], ["revoke", "撤销"]] as const).map(([action, label]) => <Button key={action} variant="secondary" size="sm" disabled={busy || (action === "revoke" ? credential.status === "REVOKED" : credential.status !== "ACTIVE")} onClick={() => void execute({ action, id: credential.id, revision: credential.revision })}>{label}</Button>)}</div>
      </div>)}{!data.sellfox.credentials.length && <p className="text-muted">尚未创建赛狐凭证。</p>}</div>
    </>}
  </section>;
}
