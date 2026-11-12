"use client";

import { useEffect, useRef, useState } from 'react';

type Draft = { id: string; revision: number; status: string; reason: string; before: unknown; patch: unknown; createdAt: string; expiresAt: string; decisionReason: string | null; availableActions: string[] };
type Observation = { id: string; before: unknown; after: unknown; observedAt: string; sourceTaskId: string };
type Changes = { drafts: Draft[]; history: Observation[]; page: number; hasMore: boolean; editableFields: string[]; historyRecordingEnabled: boolean; historyCoverage: string; execution: { enabled: boolean } };
const endpoint = '/api/integrations/amazon/ads/changes';
const statuses: Record<string, string> = { DRAFT: '草稿', SUBMITTED: '待审核', APPROVED: '已审核通过', REJECTED: '已拒绝', CANCELLED: '已取消' };
const actions: Record<string, string> = { submit: '提交审核', approve: '审核通过', reject: '拒绝', cancel: '取消草稿' };
const fields: Record<string, string> = { name: '名称', state: '投放状态', bid: '竞价', dailyBudget: '每日预算', placements: '展示位置调整' };
function parse(value: unknown): Changes {
  const body = value as Changes;
  if (!body || !Array.isArray(body.drafts) || !Array.isArray(body.history) || !Array.isArray(body.editableFields) || body.drafts.length > 50 || body.history.length > 50 || body.execution?.enabled !== false || body.historyCoverage !== 'OBSERVED_SNAPSHOT_CHANGES' || body.drafts.some(row => !row || typeof row.id !== 'string' || !Number.isInteger(row.revision) || !Array.isArray(row.availableActions))) throw new Error('广告变更响应格式无效。');
  return body;
}

/** Mounted lazily per real entity; never changes a local snapshot to simulate execution. */
export function AdsBusinessChanges({ profileId, entityType, externalId }: { profileId: string; entityType: string; externalId: string }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: Changes; error?: string } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [field, setField] = useState('state'), [value, setValue] = useState(''), [reason, setReason] = useState(''), [reviewReason, setReviewReason] = useState('');
  const [placement, setPlacement] = useState('PLACEMENT_TOP');
  const requestKeys = useRef(new Map<string, string>());
  const params = new URLSearchParams({ profileRecordId: profileId, entityType, externalId, page: String(page) });
  const key = `${params.toString()}/${version}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { controller.abort(); setResult({ key, error: '广告变更读取超时，请重试。' }); }, 15000);
    void fetch(`${endpoint}?${key.split('/')[0]}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`无法读取广告变更（${response.status}）。`);
      const data = parse(await response.json());
      if (!controller.signal.aborted) setResult({ key, data });
    }).catch(error => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : '广告变更读取失败。' }); }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, key]);
  async function mutate(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setMessage('');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, profileRecordId: profileId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : `保存失败（${response.status}）。`);
      if (!result?.draft?.id || result.executionEnabled !== false) throw new Error('广告变更保存响应格式无效。请刷新核对后重试。');
      if (body.action === 'create') for (const [content, requestKey] of requestKeys.current) if (requestKey === body.requestKey) requestKeys.current.delete(content);
      setMessage('已保存至 ERP；尚未执行到 Amazon。'); setVersion(value => value + 1);
    } catch (error) { setMessage(controller.signal.aborted ? '请求超时，保存结果未知。请刷新核对；重试保留原申请键。' : error instanceof Error ? error.message : '广告变更保存失败。'); }
    finally { window.clearTimeout(timer); setBusy(false); }
  }
  const data = current?.data;
  const activeField = data?.editableFields.includes(field) ? field : data?.editableFields[0] ?? 'state';
  return <section aria-label="广告变更与历史">
    <button type="button" className="ads-link" aria-expanded={open} onClick={() => setOpen(value => !value)}>变更草稿与历史</button>
    {open && <div className="ads-synced-detail">
      <p>草稿可提交独立审核。Amazon 写入接口尚未完成核验，审核通过后仍未执行。</p>
      <button type="button" disabled={busy} onClick={() => setVersion(value => value + 1)}>刷新变更记录</button>
      {!current && <p role="status">正在读取变更记录…</p>}{current?.error && <p role="alert">{current.error}</p>}{message && <p role="status">{message}</p>}
      {data && <>
        {data.editableFields.length > 0 && <form className="ads-form" onSubmit={event => {
          event.preventDefault();
          const patch = activeField === 'placements' ? { placements: [{ placement, percentage: Number(value) }] } : { [activeField]: value };
          const content = JSON.stringify({ entityType, externalId, patch, reason });
          let requestKey = requestKeys.current.get(content);
          if (!requestKey) { requestKey = crypto.randomUUID(); requestKeys.current.set(content, requestKey); }
          void mutate({ action: 'create', entityType, externalId, patch, reason, requestKey });
        }}>
          <label>变更字段<select value={activeField} onChange={event => { setField(event.target.value); setValue(''); }}>{data.editableFields.map(name => <option key={name} value={name}>{fields[name] ?? name}</option>)}</select></label>
          {activeField === 'placements' && <label>展示位置<select value={placement} onChange={event => setPlacement(event.target.value)}><option value="PLACEMENT_TOP">搜索结果顶部</option><option value="PLACEMENT_PRODUCT_PAGE">商品页面</option><option value="PLACEMENT_REST_OF_SEARCH">其余搜索结果</option></select></label>}
          <label>{activeField === 'placements' ? '调整百分比' : fields[activeField]}{activeField === 'state' ? <select required value={value} onChange={event => setValue(event.target.value)}><option value="">请选择</option><option value="ENABLED">启用</option><option value="PAUSED">暂停</option><option value="ARCHIVED">归档</option></select> : <input required maxLength={200} inputMode={activeField === 'name' ? 'text' : 'decimal'} value={value} onChange={event => setValue(event.target.value)} />}</label>
          <label>变更原因<textarea required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <button type="submit" disabled={busy}>保存变更草稿</button>
        </form>}
        <h3>变更申请</h3>
        <label>审核意见（拒绝时必填）<input maxLength={2000} value={reviewReason} onChange={event => setReviewReason(event.target.value)} /></label>
        {!data.drafts.length && <p>暂无变更申请。</p>}
        {data.drafts.map(draft => <article key={draft.id}><h4>{statuses[draft.status] ?? draft.status} · 版本 {draft.revision}</h4><p>{draft.reason} · 有效至 {draft.expiresAt}</p><details><summary>原设置与申请变更</summary><pre>{JSON.stringify({ before: draft.before, patch: draft.patch }, null, 2)}</pre></details>{draft.decisionReason && <p>处理意见：{draft.decisionReason}</p>}{draft.availableActions.map(action => <button key={action} type="button" disabled={busy || action === 'reject' && !reviewReason.trim()} onClick={() => void mutate({ action, id: draft.id, revision: draft.revision, ...(reviewReason.trim() ? { reason: reviewReason.trim() } : {}) })}>{actions[action] ?? action}</button>)}</article>)}
        <h3>采集观察历史</h3><p>仅展示成功采集任务观察到的差异，无法覆盖两次采集之间的全部操作。{!data.historyRecordingEnabled && '当前未启用新增观察记录。'}</p>
        {!data.history.length && <p>暂无已保存的观察记录。</p>}
        {data.history.map(row => <details key={row.id}><summary>{row.observedAt} · 来源任务 {row.sourceTaskId}</summary><pre>{JSON.stringify({ before: row.before, after: row.after }, null, 2)}</pre></details>)}
        <button type="button" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>上一页变更</button><span>第 {page} 页</span><button type="button" disabled={busy || !data.hasMore} onClick={() => setPage(value => value + 1)}>下一页变更</button>
      </>}
    </div>}
  </section>;
}
