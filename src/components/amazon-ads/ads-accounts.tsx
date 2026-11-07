"use client";
import { useEffect, useState } from "react";
import { Link2, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { AdsButton } from "./ads-controls";
import { amazonAdsTokenExpiryNotice } from "@/lib/amazon-ads/token-expiry";

type Profile = {
  id: string; authorizationId: string; region: string; profileId: string; advertiserAccountId: string | null; advertiserAccountRevision: number; countryCode: string;
  marketplaceId: string | null; currencyCode: string | null; timezone: string | null; sellerAccountId: string | null;
  lastDiscoveredAt: string; accountInfo: { name?: string; type?: string; id?: string };
  authorization: { name: string; status: string; lastValidatedAt: string | null; refreshTokenExpiresAt: string | null };
  syncPlans?: Array<{ id: string; status: string; nextRunAt: string; lastSuccessAt: string | null; lastErrorCode: string | null; tasks: Array<{ status: string; stage: string; processedCount: number; errorCode: string | null }> }>;
};
type Seller = { id: string; displayName: string; marketplaceCode: string };
type Payload = { profiles: Profile[]; sellers: Seller[]; oauthConfigured: boolean; autoSyncConfigured: boolean };
type SyncAttempt = { id?: string; attemptNumber: number; stage: string; status: string; startedAt: string; finishedAt: string | null; retryAt: string | null; errorCode: string | null; safeErrorSummary: string | null; apiRequests: number; processedCount: number };
type SyncTask = { id: string; status: string; stage: string; trigger: string; attempts: number; maxAttempts: number; processedCount: number; apiRequests: number; errorCode: string | null; requestedFrom: string | null; requestedTo: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string; attemptRuns: SyncAttempt[] };
type TaskHistory = SyncTask & { planId: string; profileId: string; profile: { profileId: string; region: string; countryCode: string; marketplaceId: string | null; sellerAccountId: string | null } };
type SyncPlan = { id: string; profileId: string; status: string; nextRunAt: string; lastSuccessAt: string | null; lastErrorCode: string | null; tasks: SyncTask[]; profile: { profileId: string; region: string; countryCode: string; marketplaceId: string | null; sellerAccountId: string | null; authorization: { name: string; status: string } } };
type Freshness = { profileId: string; dataDomain: string; reportType: string; status: string; coveredFrom: string | null; coveredTo: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null; lastTaskId: string | null; warningCodes: string[] };
type SyncPayload = { plans: SyncPlan[]; freshness: Freshness[]; taskHistory: TaskHistory[]; taskPagination: { page: number; pageSize: number; total: number; pageCount: number; hasMore: boolean }; dataDomain: string; reportSyncEnabled: boolean };
type TaskDetail = { id: string; planId: string; profileId: string; status: string; stage: string; trigger: string; attempts: number; maxAttempts: number; processedCount: number; insertedCount: number; updatedCount: number; failedCount: number; apiRequests: number; throttles: number; errorCode: string | null; requestedFrom: string | null; requestedTo: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string; profile: { profileId: string; region: string; countryCode: string; marketplaceId: string | null; sellerAccountId: string | null; currencyCode: string | null; timezone: string | null; authorization: { name: string; status: string } }; plan: { id: string; status: string; intervalMinutes: number; reportLookbackDays: number; attributionLagDays: number }; attemptRuns: SyncAttempt[]; attemptPagination: { page: number; pageSize: number; total: number; pageCount: number; hasMore: boolean }; reportRequests: Array<{ id: string; versionId: string | null; reportType: string; adProduct: string; apiVersion: string; requestedFrom: string; requestedTo: string; status: string; warningCodes: string[]; errorCode: string | null; requestedAt: string; lastPolledAt: string | null; completedAt: string | null; documents: Array<{ id: string; partIndex: number; format: string | null; compression: string | null; status: string; byteSize: string | null; rowCount: number | null; downloadedAt: string | null }>; documentsTotal: number; documentsTruncated: boolean }>; reportRequestTotal: number; reportRequestsTruncated: boolean; reportVersions: Array<{ id: string; status: string; requestedFrom: string | null; requestedTo: string | null; rowCount: number; publishedAt: string | null; createdAt: string; updatedAt: string }>; reportVersionTotal: number; reportVersionsTruncated: boolean; freshness: Freshness[] };
const formatSyncDate = (value: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

export function AdsAccounts() {
  const [data, setData] = useState<Payload | null>(null);
  const [syncData, setSyncData] = useState<SyncPayload | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [attemptPage, setAttemptPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncLoading, setSyncLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [region, setRegion] = useState("NA");
  const [taskPage, setTaskPage] = useState(1);
  const [taskStatus, setTaskStatus] = useState("");
  const [taskProfile, setTaskProfile] = useState("");
  const [advertiserAccountDrafts, setAdvertiserAccountDrafts] = useState<Record<string, string>>({});
  const expiryNotices = data ? [...new Map(data.profiles.map(profile => [profile.authorizationId, profile])).values()].flatMap(profile => {
    const notice = amazonAdsTokenExpiryNotice(profile.authorization.refreshTokenExpiresAt);
    return notice ? [{ id: profile.authorizationId, expiresAt: profile.authorization.refreshTokenExpiresAt, ...notice }] : [];
  }) : [];
  async function load() {
    setError(""); setLoading(true);
    try {
      const [response, syncResponse] = await Promise.all([
        fetch("/api/integrations/amazon/ads/profiles", { cache: "no-store" }),
        fetch(syncUrl(taskPage, taskStatus, taskProfile), { cache: "no-store" }),
      ]);
      const [payload, syncPayload] = await Promise.all([
        response.json() as Promise<Payload & { error?: string }>,
        syncResponse.json() as Promise<SyncPayload & { error?: string }>,
      ]);
      if (!response.ok) throw new Error(payload.error ?? "无法加载 Amazon Ads 账户。");
      if (!syncResponse.ok) throw new Error(syncPayload.error ?? "无法读取 Amazon Ads 同步状态。");
      setData(payload); setSyncData(syncPayload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载 Amazon Ads 账户。"); }
    finally { setLoading(false); }
  }
  function syncUrl(page: number, status: string, profileId: string) {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) params.set("status", status);
    if (profileId) params.set("profileId", profileId);
    return `/api/integrations/amazon/ads/sync?${params.toString()}`;
  }
  async function loadTaskHistory(page: number, status = taskStatus, profileId = taskProfile) {
    setSyncLoading(true); setError("");
    try {
      const response = await fetch(syncUrl(page, status, profileId), { cache: "no-store" });
      const payload = await response.json() as SyncPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法加载同步任务历史。");
      setSyncData(payload); setTaskPage(page); setTaskStatus(status); setTaskProfile(profileId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载同步任务历史。"); }
    finally { setSyncLoading(false); }
  }
  // The initial load intentionally runs once; subsequent refreshes are explicit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  async function bind(profile: Profile, sellerAccountId: string | null | undefined, advertiserAccountId?: string | null) {
    setMessage(""); setError("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileRecordId: profile.id, profileId: profile.profileId, ...(sellerAccountId !== undefined ? { sellerAccountId: sellerAccountId || null } : {}), ...(advertiserAccountId !== undefined ? { advertiserAccountId, expectedAdvertiserAccountId: profile.advertiserAccountId ?? null, expectedAdvertiserAccountRevision: profile.advertiserAccountRevision ?? 0 } : {}) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "店铺绑定失败。");
      setMessage(advertiserAccountId !== undefined ? `Profile ${profile.profileId} 的账户绑定已保存（尚未验证）。` : `Profile ${profile.profileId} 的店铺绑定已保存。`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "店铺绑定失败。"); }
  }
  async function control(planId: string, action: "pause" | "resume" | "retry") {
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, action }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "同步计划更新失败。");
      setMessage(action === "pause" ? "自动同步计划已暂停。" : action === "resume" ? "同步计划已恢复；满足配置与接口条件后会自动排队。" : "失败任务已排队重试。");
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
  async function viewTask(taskId: string, page = 1) {
    setTaskDetailLoading(true); setError("");
    if (page === 1) setTaskDetail(null);
    try {
      const params = new URLSearchParams({ taskId, attemptPage: String(page), attemptPageSize: "10" });
      const response = await fetch(`/api/integrations/amazon/ads/sync?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { taskDetail?: TaskDetail; error?: string };
      if (!response.ok || !payload.taskDetail) throw new Error(payload.error ?? "无法加载同步任务详情。");
      setTaskDetail(payload.taskDetail);
      setAttemptPage(page);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载同步任务详情。"); }
    finally { setTaskDetailLoading(false); }
  }
  async function cancelTask(taskId: string) {
    if (!window.confirm("确认取消这条 Amazon Ads 同步任务？已提交的页面和历史数据会保留。")) return;
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", taskId }) });
      const payload = await response.json() as { error?: string; status?: string; alreadyFinished?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "无法取消同步任务。");
      setMessage(payload.alreadyFinished ? `任务 ${taskId.slice(0, 8)} 已结束，无需取消。` : `任务 ${taskId.slice(0, 8)} 已取消。`);
      await loadTaskHistory(taskPage, taskStatus, taskProfile);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法取消同步任务。"); }
  }
  return <section className="ads-simple-panel ads-account-panel">
    <div className="ads-account-heading"><div><h2>广告账户与授权</h2><p>Amazon Ads 使用独立授权。Profile 自动识别后，可关联现有 ERP 店铺。</p></div><div><select aria-label="Amazon Ads 登录区域" value={region} onChange={event => setRegion(event.target.value)}><option value="NA">北美（NA）</option><option value="EU">欧洲（EU）</option><option value="FE">远东（FE）</option></select><AdsButton onClick={() => void load()} disabled={!data}><RefreshCw size={14} />刷新</AdsButton><AdsButton primary onClick={() => void authorize()} disabled={busy || !data?.oauthConfigured}><Link2 size={14} />{busy ? "正在打开授权..." : "连接 Amazon Ads"}</AdsButton></div></div>
    {data && !data.oauthConfigured && <div className="ads-account-config"><ShieldCheck size={16} /><span>OAuth 尚未配置。需要服务端 Amazon Ads LwA Client、回调地址及独立 32 字节加密密钥；当前不会发起外部请求。</span></div>}
    {data?.oauthConfigured && !data.autoSyncConfigured && <div className="ads-account-config"><ShieldCheck size={16} /><span>同步计划框架已就绪；真实 Campaign、Ad Group、Target 与报表读取 adapter 尚未通过官方契约核验，自动任务保持阻断，不会因填入凭证而误发请求。</span></div>}
    {loading && !data && <p role="status">正在读取账户、同步任务与数据 freshness…</p>}
    {expiryNotices.map(notice => <div key={notice.id} role="status" aria-live="polite" className={`ads-account-config ads-account-expiry ${notice.level.toLowerCase()}`}><ShieldCheck size={16} /><span>{notice.level === "UNKNOWN" ? "未记录 Amazon Ads refresh token 到期日，到期状态未知；请管理员核对授权记录。" : notice.level === "EXPIRED" ? "Amazon Ads refresh token 已达到记录的估算到期日，请重新授权。同步任务会保持阻断。" : `Amazon Ads refresh token 将于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(notice.expiresAt!))} 达到记录的估算到期日（约 ${notice.daysRemaining} 天）。请提前重新授权。`}</span></div>)}
    {error && <p role="alert" className="ads-account-error">{error}</p>}{message && <p role="status" className="ads-account-message">{message}</p>}
    {data && <div className="ads-table-scroll"><table className="ads-simple-table"><thead><tr><th>广告账户</th><th>Profile ID</th><th>Marketplace</th><th>地区</th><th>币种</th><th>授权状态</th><th>ERP 店铺绑定</th><th>V1 Advertiser Account ID</th><th>同步状态</th><th>计划操作</th><th>最近发现</th></tr></thead><tbody>{data.profiles.map(profile => { const plan = profile.syncPlans?.[0]; const syncLabel = !profile.sellerAccountId ? "待绑定店铺" : plan?.lastErrorCode === "ADS_PROFILE_NOT_DISCOVERED" ? "Profile 未再发现" : plan?.status === "ACTIVE" ? "自动同步已启用" : plan?.status === "WAITING_FOR_ADAPTER" ? "等待 API 适配器" : plan?.status === "WAITING_FOR_CONFIG" ? "等待同步配置" : plan?.status === "BLOCKED" ? "同步已阻断" : plan?.status ?? "待创建计划"; const planCanBeControlled = plan?.status === "ACTIVE" || plan?.status === "PAUSED"; const accountDraft = advertiserAccountDrafts[profile.id] ?? profile.advertiserAccountId ?? ""; return <tr key={`${profile.authorizationId}-${profile.region}-${profile.profileId}`}><td><strong>{profile.accountInfo.name ?? profile.authorization.name}</strong><small className="ads-account-sub">{profile.accountInfo.type ?? "广告账户"}</small></td><td>{profile.profileId}</td><td>{profile.marketplaceId ?? profile.countryCode}</td><td>{profile.region}</td><td>{profile.currencyCode ?? "—"}</td><td><span className={`ads-account-state ${profile.authorization.status === "CONNECTED" ? "ok" : "pending"}`}>{profile.authorization.status === "CONNECTED" ? "已连接" : profile.authorization.status === "NO_PROFILES" ? "无可用 Profile" : profile.authorization.status}</span></td><td><select aria-label={`${profile.profileId} ERP 店铺绑定`} value={profile.sellerAccountId ?? ""} onChange={event => void bind(profile, event.target.value)}><option value="">未绑定</option>{data.sellers.map(seller => <option key={seller.id} value={seller.id}>{seller.displayName} · {seller.marketplaceCode}</option>)}</select></td><td><input aria-label={`${profile.profileId} V1 Advertiser Account ID`} value={accountDraft} maxLength={512} onChange={event => setAdvertiserAccountDrafts(current => ({ ...current, [profile.id]: event.target.value }))} /><small className="ads-account-sub">管理员核实填写；未验证，不启用报告同步</small><AdsButton disabled={accountDraft === (profile.advertiserAccountId ?? "")} onClick={() => void bind(profile, profile.sellerAccountId ?? undefined, accountDraft.trim() || null)}>保存绑定</AdsButton></td><td><span className={`ads-account-state ${plan?.status === "ACTIVE" ? "ok" : "pending"}`}>{syncLabel}</span>{plan?.lastSuccessAt && <small className="ads-account-sub">最近成功 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(plan.lastSuccessAt))}</small>}</td><td>{plan && <div className="ads-account-actions">{<button className="ads-icon-button" type="button" title="立即同步" aria-label={`${profile.profileId} 立即同步`} disabled={!data.autoSyncConfigured || plan.status !== "ACTIVE"} onClick={() => void runNow(plan.id)}><RefreshCw size={14} /></button>}{planCanBeControlled && <button className="ads-icon-button" type="button" title={plan.status === "PAUSED" ? "恢复自动同步" : "暂停自动同步"} aria-label={plan.status === "PAUSED" ? `${profile.profileId} 恢复自动同步` : `${profile.profileId} 暂停自动同步`} onClick={() => void control(plan.id, plan.status === "PAUSED" ? "resume" : "pause")}>{plan.status === "PAUSED" ? <Play size={14} /> : <Pause size={14} />}</button>}</div>}</td><td>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(profile.lastDiscoveredAt))}</td></tr>; })}</tbody></table>{data.profiles.length === 0 && <div className="ads-empty">尚未连接 Amazon Ads 广告账户。</div>}</div>}
    {syncData && <section className="ads-simple-panel ads-sync-history-panel"><div className="ads-account-heading"><div><h2>任务历史</h2><p>仅显示当前组织、工作区和 Seller 授权范围内的任务。</p></div><div className="ads-sync-filters"><label>Profile<select aria-label="同步任务 Profile 筛选" value={taskProfile} onChange={event => void loadTaskHistory(1, taskStatus, event.target.value)}><option value="">全部 Profile</option>{data?.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.profileId} · {profile.marketplaceId ?? profile.countryCode}</option>)}</select></label><label>状态<select aria-label="同步任务状态筛选" value={taskStatus} onChange={event => void loadTaskHistory(1, event.target.value, taskProfile)}><option value="">全部状态</option><option value="WAITING">等待中</option><option value="QUEUED">队列中</option><option value="RUNNING">运行中</option><option value="RETRY_WAIT">等待重试</option><option value="SUCCEEDED">成功</option><option value="FAILED">失败</option><option value="BLOCKED">阻断</option><option value="CANCELLED">已取消</option><option value="WAITING_FOR_ADAPTER">等待 API 适配器</option><option value="WAITING_FOR_CONFIG">等待同步配置</option></select></label></div></div><div className="ads-table-scroll"><table className="ads-simple-table"><thead><tr><th>创建时间</th><th>Profile / Marketplace</th><th>任务 / 来源</th><th>状态 / 数据域</th><th>最近 Attempt</th><th>处理 / 请求</th><th>错误</th><th>操作</th></tr></thead><tbody>{syncData.taskHistory.map(task => { const attempt = task.attemptRuns[0]; const cancellable = ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"].includes(task.status); const canRetry = ["FAILED", "BLOCKED"].includes(task.status); return <tr key={task.id}><td>{formatSyncDate(task.createdAt)}</td><td>{task.profile.profileId}<small className="ads-account-sub">{task.profile.marketplaceId ?? task.profile.countryCode} · {task.profile.region}</small></td><td>{task.id.slice(0, 12)}<small className="ads-account-sub">{task.trigger} · {task.requestedFrom ?? "结构同步"}{task.requestedTo ? ` → ${task.requestedTo}` : ""}</small></td><td><span className={`ads-account-state ${task.status === "SUCCEEDED" ? "ok" : "pending"}`}>{task.status} · {task.stage}</span></td><td>{attempt ? `#${attempt.attemptNumber} ${attempt.status}` : "尚未运行"}{attempt?.retryAt && <small className="ads-account-sub">下次重试 {formatSyncDate(attempt.retryAt)}</small>}</td><td>{attempt ? `${attempt.processedCount} / ${attempt.apiRequests}` : `${task.processedCount} / ${task.apiRequests}`}</td><td>{attempt?.errorCode ?? task.errorCode ?? "—"}{attempt?.safeErrorSummary && <small className="ads-account-sub">{attempt.safeErrorSummary}</small>}</td><td><AdsButton disabled={taskDetailLoading} onClick={() => void viewTask(task.id)}>详情</AdsButton>{cancellable && <AdsButton onClick={() => void cancelTask(task.id)}>取消</AdsButton>}{canRetry && <AdsButton disabled={!data?.autoSyncConfigured} onClick={() => void control(task.planId, "retry")}>重试</AdsButton>}</td></tr>; })}</tbody></table>{syncData.taskHistory.length === 0 && <div className="ads-empty">当前筛选条件下没有同步任务。</div>}</div><div className="ads-pagination"><span>共 {syncData.taskPagination.total} 项 · 第 {syncData.taskPagination.page} / {Math.max(1, syncData.taskPagination.pageCount)} 页</span><div><AdsButton disabled={syncLoading || taskPage <= 1} onClick={() => void loadTaskHistory(taskPage - 1)}>上一页</AdsButton><AdsButton disabled={syncLoading || !syncData.taskPagination.hasMore} onClick={() => void loadTaskHistory(taskPage + 1)}>下一页</AdsButton></div></div>{syncLoading && <p role="status">正在加载任务…</p>}</section>}
    {taskDetailLoading && !taskDetail && <p role="status">正在读取同步任务详情…</p>}
    {taskDetail && <section className="ads-simple-panel ads-sync-history-panel" aria-label="同步任务详情"><div className="ads-account-heading"><div><h2>同步任务详情</h2><p>{taskDetail.id} · {taskDetail.profile.profileId} · {taskDetail.profile.marketplaceId ?? taskDetail.profile.countryCode}</p></div><AdsButton onClick={() => setTaskDetail(null)}>关闭</AdsButton></div><div className="ads-task-detail-grid"><span>状态：<strong>{taskDetail.status} / {taskDetail.stage}</strong></span><span>触发：{taskDetail.trigger}</span><span>处理：{taskDetail.processedCount}（新增 {taskDetail.insertedCount} / 更新 {taskDetail.updatedCount} / 失败 {taskDetail.failedCount}）</span><span>请求 / 限流：{taskDetail.apiRequests} / {taskDetail.throttles}</span><span>日期：{taskDetail.requestedFrom ?? "结构同步"}{taskDetail.requestedTo ? ` → ${taskDetail.requestedTo}` : ""}</span><span>错误：{taskDetail.errorCode ?? "—"}</span></div><h3>Attempt 明细</h3><div className="ads-table-scroll"><table className="ads-simple-table"><thead><tr><th>Attempt</th><th>阶段 / 状态</th><th>开始 / 结束</th><th>请求 / 处理</th><th>错误</th></tr></thead><tbody>{taskDetail.attemptRuns.map(attempt => <tr key={attempt.id ?? attempt.attemptNumber}><td>#{attempt.attemptNumber}</td><td>{attempt.stage} / {attempt.status}</td><td>{formatSyncDate(attempt.startedAt)} → {formatSyncDate(attempt.finishedAt)}</td><td>{attempt.apiRequests} / {attempt.processedCount}</td><td>{attempt.errorCode ?? "—"}{attempt.safeErrorSummary ? <small className="ads-account-sub">{attempt.safeErrorSummary}</small> : null}</td></tr>)}</tbody></table>{!taskDetail.attemptRuns.length && <div className="ads-empty">尚未产生 Attempt。</div>}</div>{taskDetail.attemptPagination.total > 0 && <div className="ads-pagination ads-task-detail-pagination"><span>共 {taskDetail.attemptPagination.total} 次 · 第 {taskDetail.attemptPagination.page} / {Math.max(1, taskDetail.attemptPagination.pageCount)} 页</span><div><AdsButton disabled={taskDetailLoading || attemptPage <= 1} onClick={() => void viewTask(taskDetail.id, attemptPage - 1)}>上一页</AdsButton><AdsButton disabled={taskDetailLoading || !taskDetail.attemptPagination.hasMore} onClick={() => void viewTask(taskDetail.id, attemptPage + 1)}>下一页</AdsButton></div></div>}{taskDetailLoading && <p role="status">正在加载 Attempt…</p>}<h3>报告请求与发布版本</h3><div className="ads-table-scroll"><table className="ads-simple-table"><thead><tr><th>报告合同</th><th>状态</th><th>日期</th><th>文档 / 行数</th><th>版本</th></tr></thead><tbody>{taskDetail.reportRequests.map(request => <tr key={request.id}><td>{request.reportType} · {request.adProduct}<small className="ads-account-sub">{request.apiVersion}</small></td><td>{request.status}{request.errorCode ? <small className="ads-account-sub">{request.errorCode}</small> : null}</td><td>{request.requestedFrom} → {request.requestedTo}</td><td>{request.documents.length} 个文档{request.documents.map(document => <small className="ads-account-sub" key={document.id}>#{document.partIndex} {document.status} · {document.rowCount ?? "—"} 行</small>)}</td><td>{request.versionId ?? "—"}</td></tr>)}</tbody></table>{!taskDetail.reportRequests.length && <div className="ads-empty">此任务没有报告请求记录。</div>}</div>{taskDetail.reportRequestsTruncated && <p role="status">报告请求较多，仅显示前 20 条。</p>}{taskDetail.reportVersionsTruncated && <p role="status">发布版本较多，仅显示前 20 条。</p>}{taskDetail.reportVersions.length > 0 && <p>发布版本：{taskDetail.reportVersions.map(version => `${version.id} / ${version.status} / ${version.rowCount} 行`).join("；")}</p>}<h3>数据域 freshness</h3><p>{taskDetail.freshness.map(state => `${state.dataDomain}${state.reportType ? `(${state.reportType})` : ""}: ${state.status}`).join(" · ") || "暂无域状态记录"}</p></section>}
  </section>;
}
