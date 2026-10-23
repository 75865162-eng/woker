"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, NotebookPen, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type MeetingNote = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  authorName: string;
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function ProductMeetingNotes({ sku, workspaceId, disabled = false }: { sku: string; workspaceId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const loaded = useRef(false);
  const endpoint = `/api/products/${encodeURIComponent(sku)}/meeting-notes`;
  const requestHeaders = useMemo(() => ({ "Content-Type": "application/json", "x-workspace-id": workspaceId }), [workspaceId]);

  const updateNote = useCallback(async (id: string, content: string) => {
    setSavingIds((current) => new Set(current).add(id));
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: requestHeaders, body: JSON.stringify({ id, content }) });
      const data = (await response.json().catch(() => ({}))) as { note?: MeetingNote; error?: string };
      if (!response.ok || !data.note) throw new Error(data.error || "保存会议记录失败。");
      setNotes((current) => current.map((note) => note.id === id && note.content === content ? { ...note, updatedAt: data.note!.updatedAt } : note));
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存会议记录失败。");
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [endpoint, requestHeaders]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store", headers: { "x-workspace-id": workspaceId } });
      const data = (await response.json().catch(() => ({}))) as { notes?: MeetingNote[]; error?: string };
      if (!response.ok) throw new Error(data.error || "读取会议记录失败。");
      setNotes(Array.isArray(data.notes) ? data.notes : []);
      setError(null);
      loaded.current = true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取会议记录失败。");
    } finally {
      setLoading(false);
    }
  }, [endpoint, workspaceId]);

  useEffect(() => {
    loaded.current = false;
    setNotes([]);
    setOpen(false);
  }, [sku, workspaceId]);

  useEffect(() => {
    if (open && !loaded.current) void loadNotes();
  }, [loadNotes, open]);

  useEffect(() => () => {
    saveTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function queueSave(id: string, content: string) {
    const existing = saveTimers.current.get(id);
    if (existing) window.clearTimeout(existing);
    saveTimers.current.set(id, window.setTimeout(() => {
      saveTimers.current.delete(id);
      void updateNote(id, content);
    }, 700));
  }

  function changeContent(id: string, content: string) {
    setNotes((current) => current.map((note) => note.id === id ? { ...note, content } : note));
    queueSave(id, content);
  }

  async function addNote() {
    setSavingIds((current) => new Set(current).add("new"));
    try {
      const response = await fetch(endpoint, { method: "POST", headers: requestHeaders, body: JSON.stringify({ content: "" }) });
      const data = (await response.json().catch(() => ({}))) as { note?: MeetingNote; error?: string };
      if (!response.ok || !data.note) throw new Error(data.error || "新建会议记录失败。");
      setNotes((current) => [...current, data.note!]);
      setError(null);
      window.setTimeout(() => document.getElementById(`product-meeting-note-${data.note!.id}`)?.focus(), 0);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建会议记录失败。");
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete("new");
        return next;
      });
    }
  }

  async function deleteNote(id: string) {
    const timer = saveTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    saveTimers.current.delete(id);
    const previous = notes;
    setNotes((current) => current.filter((note) => note.id !== id));
    const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-workspace-id": workspaceId } }).catch(() => undefined);
    if (!response?.ok) {
      const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setNotes(previous);
      setError(data?.error || "删除会议记录失败。");
    }
  }

  function saveAll() {
    notes.forEach((note) => {
      const timer = saveTimers.current.get(note.id);
      if (timer) {
        window.clearTimeout(timer);
        saveTimers.current.delete(note.id);
        void updateNote(note.id, note.content);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" size="icon" title="会议记录" aria-label="会议记录" onClick={() => setOpen(true)} disabled={disabled}>
        <NotebookPen className="h-4 w-4" />
      </Button>
      {open ? (
        <section aria-label="会议记录" className="fixed left-4 top-4 z-[80] flex h-[200px] w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border border-border bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-bold text-foreground">会议记录</h2>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" title="新增记录" aria-label="新增记录" onClick={() => void addNote()} disabled={savingIds.has("new")}>
                {savingIds.has("new") ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
              <Button type="button" size="icon" variant="ghost" title="立即保存" aria-label="立即保存" onClick={saveAll}><Save className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" title="关闭" aria-label="关闭" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
          </header>
          {error ? <p role="alert" className="border-b border-danger/30 bg-red-50 px-4 py-2 text-xs text-danger">{error}</p> : null}
          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
            {loading ? <div className="flex h-full items-center justify-center text-sm text-muted"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />加载中</div> : null}
            {!loading && notes.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted">暂无会议记录，点击右上角新增。</div> : null}
            {!loading && notes.length > 0 ? <div className="divide-y divide-border border-b border-border">{notes.map((note, index) => (
              <article key={note.id} className="grid h-7 grid-cols-[28px_minmax(0,1fr)_150px_28px] items-center">
                <span className="flex h-full items-center justify-center border-r border-border text-sm text-foreground">{index + 1}</span>
                <input id={`product-meeting-note-${note.id}`} value={note.content} maxLength={10_000} onChange={(event) => changeContent(note.id, event.target.value)} onBlur={() => { const timer = saveTimers.current.get(note.id); if (timer) { window.clearTimeout(timer); saveTimers.current.delete(note.id); void updateNote(note.id, note.content); } }} placeholder="（输入内容）" className="h-full min-w-0 border-r border-border px-2 text-sm text-foreground outline-none placeholder:text-muted focus:bg-surface-muted/40" />
                <time className="truncate px-2 text-xs text-muted" dateTime={note.createdAt}>{formatTime(note.createdAt)}</time>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 rounded-none" title="删除记录" aria-label={`删除第 ${index + 1} 条会议记录`} onClick={() => void deleteNote(note.id)}>{savingIds.has(note.id) ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted" /> : <Trash2 className="h-3.5 w-3.5 text-danger" />}</Button>
              </article>
            ))}</div> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
