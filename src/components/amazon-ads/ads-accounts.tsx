"use client";
import { useEffect, useState } from "react";
import { Link2, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { AdsButton } from "./ads-controls";

type Profile = {
  id: string; authorizationId: string; region: string; profileId: string; countryCode: string;
  marketplaceId: string | null; currencyCode: string | null; timezone: string | null; sellerAccountId: string | null;
  lastDiscoveredAt: string; accountInfo: { name?: string; type?: string; id?: string };
  authorization: { name: string; status: string; lastValidatedAt: string | null };
  syncPlans?: Array<{ id: string; status: string; nextRunAt: string; lastSuccessAt: string | null; lastErrorCode: string | null; tasks: Array<{ status: string; stage: string; processedCount: number; errorCode: string | null }> }>;
};
type Seller = { id: string; displayName: string; marketplaceCode: string };
type Payload = { profiles: Profile[]; sellers: Seller[]; oauthConfigured: boolean; autoSyncConfigured: boolean };

export function AdsAccounts() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [region, setRegion] = useState("NA");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/profiles", { cache: "no-store" });
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法加载 Amazon Ads 账户。");
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载 Amazon Ads 账户。"); }
  }
  useEffect(() => { void load(); }, []);
  async function authorize() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ region }) });
      const payload = await response.json() as { consentUrl?: string; error?: string };
      if (!response.ok || !payload.consentUrl) throw new Error(payload.error ?? "无法开始 Amazon Ads 授权。");
      window.location.assign(payload.consentUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法开始 Amazon Ads 授权。"); setBusy(false); }
  }
  async function bind(profileId: string, sellerAccountId: string) {
    setMessage(""); setError("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId, sellerAccountId: sellerAccountId || null }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "店铺绑定失败。");
      setMessage(`Profile ${profileId} 的店铺绑定已保存。`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "店铺绑定失败。"); }
  }
  async function control(planId: string, action: "pause" | "resume") {
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, action }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "同步计划更新失败。");
      setMessage(action === "pause" ? "自动同步计划已暂停。" : "同步计划已恢复；满足配置与接口条件后会自动排队。");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "同步计划更新失败。"); }
  }
  async function runNow(planId: string) {
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, action: "run" }) });
      const payload = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法开始同步任务。");
      setMessage(payload.status === "QUEUED" ? "同步任务已进入队列。" : "同步任务已保存，将由 worker 恢复投递。");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法开始同步任务。"); }
  }
  return <section className="ads-simple-panel ads-account-panel">
    <div className="ads-account-heading"><div><h2>广告账户与授权</h2><p>Amazon Ads 使用独立授权。Profile 自动识别后，可关联现有 ERP 店铺。</p></div><div><select aria-label="Amazon Ads 登录区域" value={region} onChange={event => setRegion(event.target.value)}><option value="NA">北美（NA）</option><option value="EU">欧洲（EU）</option><option value="FE">远东（FE）</option></select><AdsButton onClick={() => void load()} disabled={!data}><RefreshCw size={14} />刷新</AdsButton><AdsButton primary onClick={() => void authorize()} disabled={busy || !data?.oauthConfigured}><Link2 size={14} />{busy ? "正在打开授权..." : "连接 Amazon Ads"}</AdsButton></div></div>
    {data && !data.oauthConfigured && <div className="ads-account-config"><ShieldCheck size={16} /><span>OAuth 尚未配置。需要服务端 Amazon Ads LwA Client、回调地址及独立 32 字节加密密钥；当前不会发起外部请求。</span></div>}
    {data?.oauthConfigured && !data.autoSyncConfigured && <div className="ads-account-config"><ShieldCheck size={16} /><span>同步计划框架已就绪；真实 Campaign、Ad Group、Target 与报表读取 adapter 尚未通过官方契约核验，自动任务保持阻断，不会因填入凭证而误发请求。</span></div>}
    {error && <p role="alert" className="ads-account-error">{error}</p>}{message && <p role="status" className="ads-account-message">{message}</p>}
    {data && <div className="ads-table-scroll"><table className="ads-simple-table"><thead><tr><th>广告账户</th><th>Profile ID</th><th>Marketplace</th><th>地区</th><th>币种</th><th>授权状态</th><th>ERP 店铺绑定</th><th>同步状态</th><th>计划操作</th><th>最近发现</th></tr></thead><tbody>{data.profiles.map(profile => { const plan = profile.syncPlans?.[0]; const syncLabel = !profile.sellerAccountId ? "待绑定店铺" : plan?.lastErrorCode === "ADS_PROFILE_NOT_DISCOVERED" ? "Profile 未再发现" : plan?.status === "ACTIVE" ? "自动同步已启用" : plan?.status === "WAITING_FOR_ADAPTER" ? "等待 API 适配器" : plan?.status === "WAITING_FOR_CONFIG" ? "等待同步配置" : plan?.status === "BLOCKED" ? "同步已阻断" : plan?.status ?? "待创建计划"; const planCanBeControlled = plan?.status === "ACTIVE" || plan?.status === "PAUSED"; return <tr key={`${profile.authorizationId}-${profile.region}-${profile.profileId}`}><td><strong>{profile.accountInfo.name ?? profile.authorization.name}</strong><small className="ads-account-sub">{profile.accountInfo.type ?? "广告账户"}</small></td><td>{profile.profileId}</td><td>{profile.marketplaceId ?? profile.countryCode}</td><td>{profile.region}</td><td>{profile.currencyCode ?? "—"}</td><td><span className={`ads-account-state ${profile.authorization.status === "CONNECTED" ? "ok" : "pending"}`}>{profile.authorization.status === "CONNECTED" ? "已连接" : profile.authorization.status === "NO_PROFILES" ? "无可用 Profile" : profile.authorization.status}</span></td><td><select aria-label={`${profile.profileId} ERP 店铺绑定`} value={profile.sellerAccountId ?? ""} onChange={event => void bind(profile.profileId, event.target.value)}><option value="">未绑定</option>{data.sellers.map(seller => <option key={seller.id} value={seller.id}>{seller.displayName} · {seller.marketplaceCode}</option>)}</select></td><td><span className={`ads-account-state ${plan?.status === "ACTIVE" ? "ok" : "pending"}`}>{syncLabel}</span>{plan?.lastSuccessAt && <small className="ads-account-sub">最近成功 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(plan.lastSuccessAt))}</small>}</td><td>{plan && <div className="ads-account-actions">{<button className="ads-icon-button" type="button" title="立即同步" aria-label={`${profile.profileId} 立即同步`} disabled={!data.autoSyncConfigured || plan.status !== "ACTIVE"} onClick={() => void runNow(plan.id)}><RefreshCw size={14} /></button>}{planCanBeControlled && <button className="ads-icon-button" type="button" title={plan.status === "PAUSED" ? "恢复自动同步" : "暂停自动同步"} aria-label={plan.status === "PAUSED" ? `${profile.profileId} 恢复自动同步` : `${profile.profileId} 暂停自动同步`} onClick={() => void control(plan.id, plan.status === "PAUSED" ? "resume" : "pause")}>{plan.status === "PAUSED" ? <Play size={14} /> : <Pause size={14} />}</button>}</div>}</td><td>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(profile.lastDiscoveredAt))}</td></tr>; })}</tbody></table>{data.profiles.length === 0 && <div className="ads-empty">尚未连接 Amazon Ads 广告账户。</div>}</div>}
  </section>;
}
