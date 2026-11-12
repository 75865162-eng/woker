"use client";

import { useRef, useState } from "react";
import { History, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { fieldClass } from "@/lib/listing-ai/workspace-draft";
import { gallerySaveName, normalizeGallerySnapshot, type GallerySaveSummary, type GallerySnapshot } from "@/lib/listing-ai/gallery-snapshot";

function GalleryHistoryThumbnail({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex h-[75px] w-[75px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${name}缩略图`} width={75} height={75} loading="lazy" decoding="async" fetchPriority="low" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : <span className="text-xs text-muted">暂无图片</span>}
    </span>
  );
}

type HistoryPage = { records: GallerySaveSummary[]; hasMore: boolean };
async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败，请重试。");
  return data as T;
}

export function GallerySaveControls({ snapshot, onRestore, disabled }: {
  snapshot: GallerySnapshot;
  onRestore: (snapshot: GallerySnapshot) => void;
  disabled: boolean;
}) {
  const user = useAppShellUser();
  const canEdit = Boolean(user?.userRole && roleCanPerformAction(user.userRole, "listingAi", "edit", user.rolePermissions));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<HistoryPage>({ records: [], hasMore: false });
  const [loaded, setLoaded] = useState(false);
  const dialogCloseRef = useRef<HTMLSpanElement>(null);
  const historyButtonRef = useRef<HTMLSpanElement>(null);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "操作失败，请重试。"); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    await run(async () => {
      const normalizedName = gallerySaveName(name);
      const persisted = normalizeGallerySnapshot(snapshot);
      const { record } = await readResponse<{ record: GallerySaveSummary }>(await fetch("/api/listing-ai/gallery-saves", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedName, snapshot: persisted }),
      }));
      setName(record.name);
      setMessage("已保存到数据库，同名记录已更新。");
    });
  }
  async function loadHistory(nextPage: number) {
    setLoaded(false);
    await run(async () => {
      const result = await readResponse<HistoryPage>(await fetch(`/api/listing-ai/gallery-saves?page=${nextPage}`, { cache: "no-store" }));
      setHistory(result); setPage(nextPage); setLoaded(true);
    });
  }
  function closeHistory() {
    setOpen(false);
    historyButtonRef.current?.querySelector("button")?.focus();
  }
  async function restore(record: GallerySaveSummary) {
    if (!window.confirm(`恢复“${record.name}”将替换当前图片工作区的图片、文字和格式。未保存的内容将丢失，是否继续？`)) return;
    await run(async () => {
      const result = await readResponse<{ snapshot: GallerySnapshot }>(await fetch(`/api/listing-ai/gallery-saves?id=${encodeURIComponent(record.id)}`, { cache: "no-store" }));
      onRestore(normalizeGallerySnapshot(result.snapshot));
      setName(record.name); closeHistory(); setMessage(`已恢复“${record.name}”。`);
    });
  }
  return (
    <div className="min-w-0 max-w-full space-y-2">
      <div className="flex items-center gap-2">
        <input className={`${fieldClass} !w-44 min-w-0 flex-1`} aria-label="图片工作区名称" placeholder="输入工作区名称" maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy || disabled} />
        <Button size="sm" className="shrink-0" disabled={!canEdit || busy || disabled || !name.trim()} onClick={() => void save()}>
          {busy && !open ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存
        </Button>
        <span ref={historyButtonRef} className="shrink-0"><Button size="sm" variant="secondary" disabled={busy || disabled} onClick={() => {
          setOpen(true); setPage(0); void loadHistory(0);
          requestAnimationFrame(() => dialogCloseRef.current?.querySelector("button")?.focus());
        }}><History className="h-4 w-4" />历史</Button></span>
      </div>
      {message ? <p role="status" className="text-xs text-brand">{message}</p> : null}
      {error && !open ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!busy) closeHistory(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="gallery-history-title" className="w-full max-w-2xl rounded-lg border border-border bg-white p-5 shadow-xl" onClick={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === "Escape" && !busy) closeHistory();
            if (event.key === "Tab") {
              const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]'));
              const first = elements[0]; const last = elements[elements.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 id="gallery-history-title" className="font-bold">图片工作区历史</h3>
              <span ref={dialogCloseRef}><Button variant="ghost" size="icon" aria-label="关闭历史" onClick={closeHistory} disabled={busy}><X className="h-4 w-4" /></Button></span>
            </div>
            <p className="mb-3 text-xs text-muted">当前账号保存的记录；名称唯一；同名保存覆盖原记录并更新保存时间，点击记录可恢复。</p>
            {error ? <p role="alert" className="mb-3 text-sm text-red-600">{error}<Button variant="ghost" size="sm" disabled={busy} onClick={() => void loadHistory(page)}>重试</Button></p> : null}
            {busy ? <p role="status" className="py-6 text-center text-sm text-muted">正在处理…</p> : null}
            {loaded && !busy ? (
              <div className="max-h-[55vh] overflow-auto">
                <div className="grid grid-cols-[75px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)] gap-3 border-b border-border px-3 py-2 text-xs text-muted"><span>图片</span><span>名称</span><span>账号名</span><span>保存时间</span></div>
                {history.records.map(record => <button key={record.id} type="button" disabled={!canEdit} onClick={() => void restore(record)} className="grid w-full grid-cols-[75px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-3 border-b border-border px-3 py-3 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed">
                  <GalleryHistoryThumbnail key={record.thumbnailUrl} src={record.thumbnailUrl} name={record.name} />
                  <span className="break-words font-medium">{record.name}</span><span className="break-words">{record.savedBy}</span><span>{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</span>
                </button>)}
                {!history.records.length ? <p className="py-8 text-center text-sm text-muted">暂无保存记录。</p> : null}
              </div>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <Button variant="secondary" size="sm" disabled={busy || page === 0} onClick={() => void loadHistory(page - 1)}>上一页</Button>
              <span>第 {page + 1} 页</span>
              <Button variant="secondary" size="sm" disabled={busy || !loaded || !history.hasMore} onClick={() => void loadHistory(page + 1)}>下一页</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
