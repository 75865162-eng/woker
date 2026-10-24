"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Binding = { sellerAccountId: string; marketplaceId: string; amazonSellerId: string; authorizedResources: ("inventory" | "catalog")[] };
type SellerAccount = { id: string; displayName: string; accountKey: string; marketplaceCode: string; marketplaceId: string | null };
type Payload = {
  scope: { organizationId: string; workspaceId: string };
  runtimeConfiguration: { configured: boolean; missingEnvironmentVariables: string[]; configurationError?: string; hasEncryptionKey?: boolean; hasDatabaseCredentials?: boolean; region?: string; endpoint?: string };
  connection: { status: string; statusMessage: string | null; lastValidatedAt: string | null } | null;
  usingEnvironmentFallback: boolean;
  bindings: Binding[];
  sellerAccounts: SellerAccount[];
};

const inputClass = "h-9 w-full min-w-32 border border-border bg-white px-2 text-sm text-foreground";
const blankBinding = (): Binding => ({ sellerAccountId: "", marketplaceId: "", amazonSellerId: "", authorizedResources: ["inventory", "catalog"] });

export function AmazonSpApiSettingsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<Binding[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
  const [credentialForm, setCredentialForm] = useState({ lwaClientId: "", lwaClientSecret: "", refreshToken: "", awsAccessKeyId: "", awsSecretAccessKey: "", awsSessionToken: "", region: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com" });
  const [json, setJson] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, credentialResponse] = await Promise.all([
        fetch("/api/integrations/amazon/sp-api/bindings", { cache: "no-store" }),
        fetch("/api/integrations/amazon/sp-api/credentials", { cache: "no-store" }),
      ]);
      const result = await response.json() as Payload & { error?: string };
      const credentialStatus = await credentialResponse.json() as { error?: string; hasSavedCredentials?: boolean; region?: string; endpoint?: string };
      if (!response.ok) throw new Error(result.error || "Amazon 配置读取失败。");
      if (!credentialResponse.ok) throw new Error(credentialStatus.error || "Amazon API 凭证状态读取失败。");
      setData(result);
      setRows(result.bindings);
      setHasSavedCredentials(Boolean(credentialStatus.hasSavedCredentials));
      setCredentialForm((current) => ({ ...current, region: credentialStatus.region || current.region, endpoint: credentialStatus.endpoint || current.endpoint }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Amazon 配置读取失败。");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function update(index: number, patch: Partial<Binding>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function importJson() {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error("JSON 顶层必须是数组。");
      const imported = parsed.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        const row = item as Record<string, unknown>;
        return (row.organizationId === undefined || row.organizationId === data?.scope.organizationId)
          && (row.workspaceId === undefined || row.workspaceId === data?.scope.workspaceId);
      }).map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("绑定行格式无效。");
        const row = item as Record<string, unknown>;
        if (typeof row.sellerAccountId !== "string" || typeof row.marketplaceId !== "string" || typeof row.amazonSellerId !== "string" || !Array.isArray(row.authorizedResources)) throw new Error("JSON 缺少 sellerAccountId、marketplaceId、amazonSellerId 或 authorizedResources。");
        return { sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId, amazonSellerId: row.amazonSellerId, authorizedResources: row.authorizedResources.filter((value): value is "inventory" | "catalog" => value === "inventory" || value === "catalog") };
      });
      setRows(imported);
      setMessage(`已导入 ${imported.length} 条绑定；请核对后保存。旧环境变量格式可直接导入。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "JSON 导入失败。"); }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/amazon/sp-api/bindings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bindings: rows }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "绑定保存失败。");
      setMessage("店铺绑定已保存。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "绑定保存失败。"); }
    finally { setSaving(false); }
  }

  async function saveCredentials() {
    setSavingCredentials(true);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/amazon/sp-api/credentials", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentialForm) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Amazon API 配置保存失败。");
      setMessage("Amazon API 凭证已加密保存。可继续验证连接。");
      setCredentialForm((current) => ({ ...current, lwaClientId: "", lwaClientSecret: "", refreshToken: "", awsAccessKeyId: "", awsSecretAccessKey: "", awsSessionToken: "" }));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Amazon API 配置保存失败。"); }
    finally { setSavingCredentials(false); }
  }

  async function validate() {
    setValidating(true);
    setMessage("");
    try {
      const response = await fetch("/api/operations/connection/validate", { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Amazon 连接验证失败。");
      setMessage("Amazon 连接验证完成。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Amazon 连接验证失败。"); }
    finally { setValidating(false); }
  }

  return (
    <section id="amazon-sp-api" className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div><h2 className="text-base font-bold text-foreground">Amazon SP-API</h2><p className="mt-1 text-sm text-muted">凭证在此加密保存，店铺与站点绑定也可在此维护。</p></div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />刷新</Button>
      </div>

      <div className="space-y-2 border-b border-border pb-4">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold">连接状态</h3><Badge tone={data?.runtimeConfiguration.configured ? data.connection?.status === "CONFIGURED" ? "green" : "amber" : "gray"}>{loading ? "读取中" : data?.runtimeConfiguration.configured ? data.connection?.status === "CONFIGURED" ? "已验证" : "待验证" : "缺少密钥配置"}</Badge></div>
        {!data?.runtimeConfiguration.configured ? <div className="space-y-2 text-sm text-muted"><p>{data?.runtimeConfiguration.configurationError || (data?.runtimeConfiguration.missingEnvironmentVariables.includes("AMAZON_SP_API_ENCRYPTION_KEY") ? "数据库中的凭证无法解密，请检查服务器加密主密钥。" : "请在下方录入 SP-API 凭证；密钥仅加密保存在服务端数据库，不会回显。")}</p>{data?.runtimeConfiguration.missingEnvironmentVariables.length ? <div className="flex flex-wrap gap-2">{data.runtimeConfiguration.missingEnvironmentVariables.map((name) => <code key={name} className="border border-border bg-surface-muted px-2 py-1 text-xs">{name}</code>)}</div> : null}</div> : <div className="text-sm text-muted">{data.connection?.statusMessage || (data.runtimeConfiguration.hasDatabaseCredentials ? "SP-API 凭证已加密保存，尚未验证连接。" : "正在使用服务器环境变量中的兼容配置。")}{data.connection?.lastValidatedAt ? ` 最近验证：${new Date(data.connection.lastValidatedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</div>}
        {data?.runtimeConfiguration.configured ? <Button size="sm" onClick={() => void validate()} disabled={validating}><ShieldCheck className="h-4 w-4" />{validating ? "验证中..." : "验证 Amazon 连接"}</Button> : null}
      </div>

      <div className="space-y-3 border-b border-border pb-4">
        <div><h3 className="text-sm font-bold">API 凭证</h3><p className="mt-1 text-xs text-muted">{hasSavedCredentials ? "已保存值不会显示；留空保留原值，填写新值则替换。" : data?.runtimeConfiguration.configured && !data.runtimeConfiguration.hasDatabaseCredentials ? "当前兼容读取服务器环境变量；填写完整凭证并保存后，后续使用数据库中的加密配置。" : "填写 LWA Client ID、Client Secret 和卖家授权的 Refresh Token；无需 AWS 密钥。保存后服务端加密，浏览器不会读取已保存值。"}</p></div>
        <p className="text-xs text-muted">保存配置不会自动同步。完成店铺绑定和连接验证后，到经营中台手动同步或开启同步计划。</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-muted">LWA Client ID<input className={inputClass} value={credentialForm.lwaClientId} onChange={(event) => setCredentialForm((current) => ({ ...current, lwaClientId: event.target.value }))} placeholder={hasSavedCredentials ? "已保存，留空保留" : "输入 Client ID"} autoComplete="off" /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">LWA Client Secret<input className={inputClass} type="password" value={credentialForm.lwaClientSecret} onChange={(event) => setCredentialForm((current) => ({ ...current, lwaClientSecret: event.target.value }))} placeholder={hasSavedCredentials ? "已保存，留空保留" : "输入 Client Secret"} autoComplete="new-password" /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">Refresh Token<input className={inputClass} type="password" value={credentialForm.refreshToken} onChange={(event) => setCredentialForm((current) => ({ ...current, refreshToken: event.target.value }))} placeholder={hasSavedCredentials ? "已保存，留空保留" : "输入 Refresh Token"} autoComplete="new-password" /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">API 区域<select className={inputClass} value={credentialForm.region} onChange={(event) => { const region = event.target.value; const endpoint = region === "eu-west-1" ? "https://sellingpartnerapi-eu.amazon.com" : region === "us-west-2" ? "https://sellingpartnerapi-fe.amazon.com" : "https://sellingpartnerapi-na.amazon.com"; setCredentialForm((current) => ({ ...current, region, endpoint })); }}><option value="us-east-1">us-east-1（北美）</option><option value="eu-west-1">eu-west-1（欧洲）</option><option value="us-west-2">us-west-2（远东）</option></select></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">SP-API Endpoint<input className={inputClass} value={credentialForm.endpoint} onChange={(event) => setCredentialForm((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://sellingpartnerapi-na.amazon.com" autoComplete="url" /></label>
        </div>
        <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs font-semibold">旧版 AWS 凭证（可选）</summary><div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-muted">AWS Access Key ID<input className={inputClass} value={credentialForm.awsAccessKeyId} onChange={(event) => setCredentialForm((current) => ({ ...current, awsAccessKeyId: event.target.value }))} placeholder={hasSavedCredentials ? "已保存，留空保留" : "输入 Access Key ID"} autoComplete="off" /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">AWS Secret Access Key<input className={inputClass} type="password" value={credentialForm.awsSecretAccessKey} onChange={(event) => setCredentialForm((current) => ({ ...current, awsSecretAccessKey: event.target.value }))} placeholder={hasSavedCredentials ? "已保存，留空保留" : "输入 Secret Access Key"} autoComplete="new-password" /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">AWS Session Token（可选）<input className={inputClass} type="password" value={credentialForm.awsSessionToken} onChange={(event) => setCredentialForm((current) => ({ ...current, awsSessionToken: event.target.value }))} placeholder="仅临时凭证需要" autoComplete="new-password" /></label>
        </div></details>
        {!data?.runtimeConfiguration.hasEncryptionKey && !hasSavedCredentials ? <p className="text-xs text-amber-800">首次保存前需由管理员在服务器设置 `AMAZON_SP_API_ENCRYPTION_KEY`（32 字节 Base64 主密钥）。Amazon API 密钥本身无需放进服务器 `.env`。</p> : null}
        <Button size="sm" onClick={() => void saveCredentials()} disabled={savingCredentials || loading || !data?.runtimeConfiguration.hasEncryptionKey}><Save className="h-4 w-4" />{savingCredentials ? "加密保存中..." : "保存 API 凭证"}</Button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold">店铺绑定</h3><p className="mt-1 text-xs text-muted">同一组凭证只支持一个 Seller ID；Seller ID 与站点不能重复绑定。</p></div>{data?.usingEnvironmentFallback ? <Badge tone="amber">来源：服务器旧 JSON 配置</Badge> : <Badge tone="blue">来源：数据库</Badge>}</div>
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-surface-muted text-xs font-semibold text-muted"><tr><th className="px-2 py-2">ERP 店铺</th><th className="px-2 py-2">Marketplace ID</th><th className="px-2 py-2">Amazon Seller ID</th><th className="px-2 py-2">授权同步域</th><th className="w-12 px-2 py-2"></th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${index}-${row.sellerAccountId}`} className="border-t border-border align-top">
              <td className="px-2 py-2"><select className={inputClass} value={row.sellerAccountId} onChange={(event) => update(index, { sellerAccountId: event.target.value })}><option value="">选择 active 店铺</option>{data?.sellerAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName || account.accountKey} · {account.marketplaceCode || "未标站点"}</option>)}</select></td>
              <td className="px-2 py-2"><input className={inputClass} value={row.marketplaceId} onChange={(event) => update(index, { marketplaceId: event.target.value })} placeholder="Amazon Marketplace ID" /></td>
              <td className="px-2 py-2"><input className={inputClass} value={row.amazonSellerId} onChange={(event) => update(index, { amazonSellerId: event.target.value })} placeholder="真实 Seller ID" /></td>
              <td className="px-2 py-2"><div className="flex h-9 items-center gap-3">{(["inventory", "catalog"] as const).map((resource) => <label key={resource} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={row.authorizedResources.includes(resource)} onChange={(event) => update(index, { authorizedResources: event.target.checked ? [...row.authorizedResources, resource] : row.authorizedResources.filter((value) => value !== resource) })} />{resource === "inventory" ? "库存" : "在线产品"}</label>)}</div></td>
              <td className="px-2 py-2"><Button variant="ghost" size="icon" title="删除绑定" aria-label="删除绑定" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button></td>
            </tr>)}{!rows.length ? <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">{loading ? "正在读取绑定..." : "当前工作区没有店铺绑定"}</td></tr> : null}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => setRows((current) => [...current, blankBinding()])} disabled={rows.length >= 10}><Plus className="h-4 w-4" />添加绑定</Button><Button size="sm" onClick={() => void save()} disabled={saving || loading}><Save className="h-4 w-4" />{saving ? "保存中..." : "保存绑定"}</Button></div>
        <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-semibold">从 JSON 导入</summary><div className="mt-2 space-y-2"><textarea className="min-h-28 w-full border border-border bg-white p-2 font-mono text-xs" value={json} onChange={(event) => setJson(event.target.value)} placeholder='[{"organizationId":"...","workspaceId":"...","sellerAccountId":"...","marketplaceId":"...","amazonSellerId":"...","authorizedResources":["inventory","catalog"]}]' /><Button variant="secondary" size="sm" onClick={importJson}>导入到表格</Button></div></details>
      </div>
      {message ? <p className="border border-border bg-surface-muted px-3 py-2 text-sm" role="status">{message}</p> : null}
    </section>
  );
}
