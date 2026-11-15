"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { cn } from "@/lib/utils";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export type ErpImportDialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  templateUrl?: string;
  onUpload: (file: File) => Promise<void>;
  accept?: string;
  maxSizeMb?: number;
  hint?: string;
};

/** 对应 Wimoor「单据录入页 / 主数据列表页」的批量导入弹窗。 */
export function ErpImportDialog({
  open,
  onClose,
  title = "导入数据",
  templateUrl,
  onUpload,
  accept = ".xlsx,.xls,.csv",
  maxSizeMb = 10,
  hint,
}: ErpImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [validationError, setValidationError] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setStatus("idle");
    setValidationError("");
    setMessage("");
    setDragging(false);
  }, [open]);

  const acceptedExtensions = accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.startsWith("."));

  const validate = (picked: File): string => {
    const name = picked.name.toLowerCase();
    if (acceptedExtensions.length > 0 && !acceptedExtensions.some((extension) => name.endsWith(extension))) {
      return `文件格式不支持，仅允许 ${acceptedExtensions.join(" / ")}`;
    }
    if (picked.size > maxSizeMb * 1024 * 1024) {
      return `文件超过 ${maxSizeMb} MB 限制`;
    }
    return "";
  };

  const chooseFile = (picked: File | undefined) => {
    if (!picked) return;
    setFile(picked);
    setValidationError(validate(picked));
    setStatus("idle");
    setMessage("");
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0]);
    // 允许重复选择同一文件。
    event.target.value = "";
  };

  const submit = async () => {
    if (!file || validationError || status === "uploading") return;
    setStatus("uploading");
    setMessage("");
    try {
      await onUpload(file);
      setStatus("success");
      setMessage("导入成功，数据已提交处理。");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "导入失败，请稍后重试。");
    }
  };

  const busy = status === "uploading";

  return (
    <WorkbenchDialog open={open} title={title} onClose={onClose} busy={busy}>
      <div className="space-y-4 text-sm">
        {hint ? <p className="rounded-md bg-surface-muted px-3 py-2 text-xs leading-5 text-muted">{hint}</p> : null}

        {/* input 放在可点击区域之外，避免程序化 click 冒泡回区域造成递归。 */}
        <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" aria-label="选择导入文件" />
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
            dragging ? "border-brand bg-brand/5" : "border-border bg-white hover:border-brand/60 hover:bg-surface-muted/40",
          )}
        >
          <UploadCloud className="h-8 w-8 text-brand" aria-hidden="true" />
          <p className="font-semibold text-foreground">点击选择文件，或拖拽到此处</p>
          <p className="text-xs text-muted">支持 {accept}，单个文件不超过 {maxSizeMb} MB</p>
        </div>

        {file ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate text-xs font-medium text-foreground">{file.name}</span>
              <span className="shrink-0 text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</span>
            </div>
            <button
              type="button"
              disabled={busy}
              aria-label="移除文件"
              onClick={() => { setFile(null); setValidationError(""); setStatus("idle"); setMessage(""); }}
              className="rounded p-1 text-muted hover:bg-surface-muted hover:text-danger disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {validationError ? (
          <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{validationError}</span>
          </div>
        ) : message ? (
          <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-xs font-medium", status === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
            {status === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{message}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {templateUrl ? (
            <a href={templateUrl} download className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              下载导入模板
            </a>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>关闭</Button>
            <Button type="button" size="sm" variant="primary" disabled={!file || Boolean(validationError) || busy} onClick={submit}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              {busy ? "上传中…" : "开始导入"}
            </Button>
          </div>
        </div>
      </div>
    </WorkbenchDialog>
  );
}
