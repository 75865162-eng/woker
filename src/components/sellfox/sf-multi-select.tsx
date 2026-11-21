"use client";

import { useEffect, useRef, useState } from "react";

export type SfMultiOption = { value: string; label: string };

/**
 * 赛狐筛选项下拉：收起时显示「全部{label}」，展开后逐项勾选，点「确认」才回写选择。
 * 勾选仅在面板内暂存，取消/点击外部/按 Esc 均不改动外部 value，贴合赛狐「勾选→确认」的操作习惯。
 */
export function SfMultiSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  searchable = false,
}: {
  label: string;
  options: SfMultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (disabled) return;
    setDraft(value);
    setSearch("");
    setOpen((current) => !current);
  }

  function confirm() {
    onChange(draft);
    setOpen(false);
  }

  const visible = searchable
    ? options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()) || option.value.toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const selectedKnown = value.filter((v) => options.some((option) => option.value === v));
  const summary = selectedKnown.length === 0
    ? `全部${label}`
    : selectedKnown.length === 1
      ? (options.find((option) => option.value === selectedKnown[0])?.label ?? selectedKnown[0])
      : `${label}（${selectedKnown.length}）`;

  return (
    <div ref={rootRef} className="sf-ms" data-testid={`sf-multi-${label}`}>
      <button
        type="button"
        className={`sf-ms-trigger${selectedKnown.length ? " sf-ms-trigger-active" : ""}`}
        aria-label={`${label}筛选`}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={toggle}
      >
        <span className="sf-ms-summary">{summary}</span>
        <span aria-hidden="true" className="sf-ms-caret">⌄</span>
      </button>
      {open ? (
        <div className="sf-ms-panel" aria-label={`${label}选项`}>
          {searchable ? <input className="sf-ms-search" aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={search} onChange={(event) => setSearch(event.target.value)} /> : null}
          <div className="sf-ms-list">
            {visible.length ? visible.map((option) => (
              <label key={option.value} className="sf-ms-option">
                <input
                  type="checkbox"
                  checked={draft.includes(option.value)}
                  onChange={(event) => setDraft((current) => event.target.checked ? [...current, option.value] : current.filter((v) => v !== option.value))}
                />
                <span>{option.label}</span>
              </label>
            )) : <p className="sf-ms-empty">无匹配{label}</p>}
          </div>
          <div className="sf-ms-actions">
            <button type="button" className="sf-btn" onClick={() => setDraft([])}>清空</button>
            <button type="button" className="sf-btn sf-btn-primary" onClick={confirm}>确认</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
