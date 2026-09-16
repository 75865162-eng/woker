"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/products/types";

export function ConclusionExcelField({
  file,
  uploading,
  onUpload,
}: {
  file?: Product["conclusionExcelFile"];
  uploading: boolean;
  onUpload: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  async function downloadFile() {
    if (!file?.downloadUrl || downloading) {
      return;
    }

    setDownloading(true);
    try {
      const response = await fetch(file.downloadUrl);
      if (!response.ok) {
        throw new Error("附件下载失败");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.name || "conclusion.xlsx";
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.alert("附件下载失败，请稍后重试。");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="text-xs font-semibold text-muted">
      <p>结论 Excel 表（必传）</p>
      <div className="mt-1 flex min-h-10 items-center justify-between gap-2 rounded-md border border-border bg-white px-3 py-2">
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${file ? "text-foreground" : "text-danger"}`}>
            {file?.name || "未上传"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {file ? `${formatFileSize(file.size)} · ${file.storageType}` : "已取消或确认上架前必须上传"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {file?.downloadUrl ? (
            <button type="button" className="text-xs font-bold text-brand hover:underline" onClick={() => void downloadFile()} disabled={downloading}>
              {downloading ? "正在下载" : "下载"}
            </button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onUpload} disabled={uploading}>
            <FileUp className="h-4 w-4" />
            {uploading ? "上传中" : file ? "替换" : "上传"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function ReadonlyField({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="text-xs font-semibold text-muted">
      {label}
      <div className="mt-1 flex h-10 w-full items-center rounded-md border border-border bg-surface-muted px-3 text-sm font-semibold text-foreground" title={title ?? value}>
        {value || "--"}
      </div>
    </div>
  );
}

export function MultiSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftValue, setDraftValue] = useState<string[]>(value);
  const [panelStyle, setPanelStyle] = useState<{
    position: "fixed";
    top: number;
    left: number;
    width: number;
    zIndex: number;
  }>({
    position: "fixed",
    top: 0,
    left: 0,
    width: 0,
    zIndex: 60,
  });

  const filteredOptions = useMemo(() => {
    const uniqueOptions = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return uniqueOptions;
    return uniqueOptions.filter((option) => option.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  const normalizedValue = useMemo(() => Array.from(new Set(value.map((item) => item.trim()).filter(Boolean))), [value]);
  const selectedCount = normalizedValue.length;
  const triggerText = selectedCount ? normalizedValue.join("、") : "请选择";
  const allVisibleSelected = filteredOptions.length > 0 && filteredOptions.every((option) => draftValue.includes(option));
  const visibleSelectedCount = filteredOptions.filter((option) => draftValue.includes(option)).length;

  useEffect(() => {
    if (open) {
      setDraftValue(normalizedValue);
      setQuery("");
    }
  }, [normalizedValue, open]);

  useEffect(() => {
    if (!open) return;

    function updatePanelPosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      setPanelStyle({
        position: "fixed",
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
        zIndex: 60,
      });
    }

    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggle(option: string) {
    setDraftValue((current) => (current.includes(option) ? current.filter((item) => item !== option) : [...current, option]));
  }

  function toggleAllVisible() {
    if (!filteredOptions.length) return;

    setDraftValue((current) =>
      allVisibleSelected ? current.filter((item) => !filteredOptions.includes(item)) : Array.from(new Set([...current, ...filteredOptions])),
    );
  }

  function commit() {
    onChange(Array.from(new Set(draftValue.map((item) => item.trim()).filter(Boolean))));
    setOpen(false);
  }

  function cancel() {
    setDraftValue(normalizedValue);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative text-xs font-semibold text-muted">
      <p>{label}</p>
      <button
        ref={triggerRef}
        type="button"
        className={`mt-1 flex h-10 w-full items-center justify-between gap-3 rounded-md border bg-white px-3 text-left text-sm outline-none transition-colors focus:border-brand ${
          open ? "border-brand ring-2 ring-brand/15" : "border-border"
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedCount ? "text-foreground" : "text-muted"}`}>{triggerText}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div style={panelStyle} className="rounded-lg border border-border bg-white shadow-2xl">
          <div className="border-b border-border px-3 py-3">
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm text-foreground focus-within:border-brand">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                className="w-full bg-transparent outline-none placeholder:text-muted"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索"
              />
              {query ? (
                <button
                  type="button"
                  className="shrink-0 text-muted hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="清空搜索"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
          </div>

          <div className="thin-scrollbar max-h-64 overflow-auto px-3 py-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-surface-muted"
              onClick={toggleAllVisible}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-sm border ${allVisibleSelected ? "border-brand bg-brand text-white" : "border-border bg-white"}`}>
                {allVisibleSelected ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
              </span>
              <span className="text-sm font-semibold text-foreground">全选</span>
              <span className="ml-auto text-xs font-medium text-muted">
                {filteredOptions.length ? `${visibleSelectedCount}/${filteredOptions.length}` : "无匹配"}
              </span>
            </button>

            <div className="mt-1 space-y-1">
              {filteredOptions.length ? (
                filteredOptions.map((option) => {
                  const checked = draftValue.includes(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-surface-muted"
                      onClick={() => toggle(option)}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-sm border ${checked ? "border-brand bg-brand text-white" : "border-border bg-white"}`}>
                        {checked ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-sm ${checked ? "font-bold text-foreground" : "font-medium text-foreground"}`}>{option}</span>
                    </button>
                  );
                })
              ) : (
                <p className="px-1 py-8 text-center text-xs font-medium text-muted">暂无匹配结果</p>
              )}
            </div>
          </div>

          <div className="border-t border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted">按住 Shift 可快速多选</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={cancel}>
                  取消
                </Button>
                <Button size="sm" onClick={commit}>
                  确定
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
