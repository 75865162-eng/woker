"use client";

import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LabeledInput } from "./product-workbench-fields";

export function NegativePointEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseNegativePointValue(value);
  const [draft, setDraft] = useState(parsed);

  useEffect(() => {
    if (!open) {
      setDraft(parseNegativePointValue(value));
    }
  }, [open, value]);

  function updateSummary(summary: string) {
    onChange(buildNegativePointValue({ ...parsed, summary }));
  }

  function updateCount(count: string) {
    onChange(buildNegativePointValue({ ...parsed, count }));
  }

  function updateDraftCount(count: string) {
    setDraft((current) => ({
      ...current,
      count,
      originals: normalizeOriginalsLength(current.originals, parseOriginalCount(count)),
    }));
  }

  function saveOriginals() {
    onChange(buildNegativePointValue({
      ...draft,
      count: String(draft.originals.filter((original) => original.trim()).length),
    }));
    setOpen(false);
  }

  const originalCount = parseOriginalCount(parsed.count);
  const draftOriginals = normalizeOriginalsLength(draft.originals, parseOriginalCount(draft.count));
  if (draftOriginals.at(-1)?.trim()) {
    draftOriginals.push("");
  }

  return (
    <>
      <div className={`h-[180px] w-full min-w-0 rounded-md border border-border p-1 ${disabled ? "bg-surface-muted" : "bg-surface"}`}>
        <div className="grid grid-cols-[minmax(0,1fr)_42px] gap-1">
          <input
            className="h-8 min-w-0 rounded border border-border px-1 text-xs outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
            value={parsed.summary}
            disabled={disabled}
            placeholder="差评总结"
            onChange={(event) => updateSummary(event.target.value)}
          />
          <input
            className="h-8 rounded border border-border px-1 text-xs outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
            value={parsed.count}
            disabled={disabled}
            placeholder="数"
            onChange={(event) => updateCount(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="mt-1 h-[134px] w-full overflow-hidden rounded border border-border bg-surface px-2 py-2 text-left text-xs text-foreground disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
          disabled={disabled}
          onClick={() => {
            setDraft(parsed);
            setOpen(true);
          }}
        >
          {parsed.originals.filter(Boolean).length ? (
            <span className="whitespace-pre-line">{parsed.originals.filter(Boolean).join("\n")}</span>
          ) : (
            <span className="text-muted">点击填写{originalCount}条差评原文</span>
          )}
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 p-6">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-lg bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">差评原文</h3>
                <p className="mt-1 text-xs font-semibold text-muted">已填写 {draft.originals.filter((original) => original.trim()).length} 条原文，填写后自动追加下一行，数量按非空原文自动统计。</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
            <div className="thin-scrollbar max-h-[560px] space-y-3 overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <LabeledInput label="差评总结" value={draft.summary} onChange={(summary) => setDraft((current) => ({ ...current, summary }))} />
                <LabeledInput label="数量" value={draft.count} onChange={updateDraftCount} />
              </div>
              {draftOriginals.map((original, index) => (
                <label key={index} className="block text-xs font-semibold text-muted">
                  差评原文 {index + 1}
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                    value={original}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) => {
                        const originals = normalizeOriginalsLength(current.originals, index + 1);
                        originals[index] = value;
                        return {
                          ...current,
                          originals,
                          count: String(originals.filter((original) => original.trim()).length),
                        };
                      });
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={saveOriginals}>
                <Save className="h-4 w-4" />
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function parseNegativePointValue(value: string) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? "";
  const match = firstLine.match(/^(.*?)[（(]([0-9]+)[）)]$/);
  const count = match ? match[2] : "";
  const originals = lines.slice(match || firstLine ? 1 : 0);

  return {
    summary: match ? match[1].trim() : firstLine,
    count,
    originals: normalizeOriginalsLength(originals, parseOriginalCount(count)),
  };
}

export function buildNegativePointValue(value: { summary: string; count: string; originals: string[] }) {
  const title = value.count.trim() ? `${value.summary.trim()}（${value.count.trim()}）` : value.summary.trim();
  return [title, ...value.originals.map((item) => item.trim()).filter(Boolean)].filter(Boolean).join("\n");
}

export function parseOriginalCount(count: string) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(Math.floor(value), 100);
}

export function normalizeOriginalsLength(originals: string[], count: number) {
  return Array.from({ length: Math.max(count, originals.length) }, (_, index) => originals[index] ?? "");
}
