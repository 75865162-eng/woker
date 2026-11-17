"use client";

import { Download, FileSpreadsheet, FileText, Package, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LogisticsTemplateOption, UploadedFileState } from "@/lib/logistics/types";

export function UploadCard({
  title,
  description,
  file,
  files,
  status,
  actionLabel,
  actionDisabled,
  downloadLabel,
  downloadDisabled,
  onSelect,
  onSelectMany,
  onAction,
  onDownload,
  multiple,
  hideActions,
  templateDownloadLabel,
  templateDownloadHref,
  isProcessing,
}: {
  title: string;
  description: string;
  file?: UploadedFileState | null;
  files?: UploadedFileState[];
  status?: [string, string];
  actionLabel?: string;
  actionDisabled?: boolean;
  downloadLabel?: string;
  onSelect?: (file: File) => void;
  onSelectMany?: (files: File[]) => void;
  onAction?: () => void;
  onDownload?: () => void;
  downloadDisabled?: boolean;
  multiple?: boolean;
  hideActions?: boolean;
  templateDownloadLabel?: string;
  templateDownloadHref?: string;
  isProcessing?: boolean;
}) {
  const defaultSupportLabel = title.includes("PDF") ? "支持一次选择多个 PDF" : "支持 Excel";
  const currentFileLabel = multiple
    ? (files?.length ? `${files.length} 个文件已上传` : "支持一次选择多个 PDF")
    : (file?.name ?? defaultSupportLabel);
  const uploadLabel = multiple ? (files?.length ? "重新上传多个文件" : "点击上传多个文件") : (file ? "重新上传文件" : "点击上传文件");
  const isStaticMode = Boolean(hideActions || templateDownloadLabel || templateDownloadHref);

  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <CardTitle className="text-section">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex h-[248px] flex-col">
        <p className="text-sm leading-6 text-muted line-clamp-2">{description}</p>
        {isStaticMode ? (
          <div className="mt-3 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted px-3 text-center">
            <FileSpreadsheet className="h-12 w-12 text-brand" />
            <span className="mt-2 text-sm font-semibold text-foreground" />
            {templateDownloadHref && templateDownloadLabel ? (
              <a
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-brand hover:text-brand"
                href={templateDownloadHref}
                download
              >
                <Download className="h-4 w-4" />
                {templateDownloadLabel}
              </a>
            ) : templateDownloadLabel ? (
              <span className="mt-3 inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-surface px-3 py-2 text-xs font-medium text-muted">
                {templateDownloadLabel}
              </span>
            ) : null}
          </div>
        ) : (
          <label className="mt-3 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted px-3 text-center transition-colors hover:border-brand hover:bg-surface">
            <UploadCloud className="h-7 w-7 text-brand" />
            <span className="mt-2 text-sm font-semibold text-foreground">{uploadLabel}</span>
            <span className="mt-1 line-clamp-2 max-w-full overflow-hidden text-ellipsis break-all text-xs leading-5 text-muted">{currentFileLabel}</span>
            <input
              type="file"
              className="hidden"
              accept={title.includes("PDF") ? ".pdf" : ".xlsx,.xls"}
              multiple={multiple}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                if (multiple) {
                  if (selected.length && onSelectMany) {
                    onSelectMany(selected);
                  }
                } else if (selected[0] && onSelect) {
                  onSelect(selected[0]);
                  event.currentTarget.value = "";
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
        )}
        <div className={`mt-3 flex min-h-[52px] items-start justify-between gap-2 ${hideActions ? "invisible" : ""}`}>
          <div className="min-w-0 flex-1 space-y-2">
            {status ? (
              <div className="space-y-1">
                <Badge tone="green">{status[0]}</Badge>
                <p className="line-clamp-2 break-all text-xs text-muted">{status[1]}</p>
              </div>
            ) : (
              <Badge>{isProcessing ? "处理中" : "待上传"}</Badge>
            )}
            {isProcessing ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/70">
                <div className="h-full w-2/5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-brand" />
              </div>
            ) : null}
          </div>
          <div className="flex w-[142px] shrink-0 flex-col gap-2">
            {onAction && actionLabel ? (
              <Button size="sm" variant="secondary" className="w-full justify-center whitespace-nowrap" onClick={onAction} disabled={actionDisabled}>
                <Package className="h-4 w-4" />
                {actionLabel}
              </Button>
            ) : null}
            {onDownload && downloadLabel ? (
              <Button size="sm" className="w-full justify-center whitespace-nowrap" onClick={onDownload} disabled={downloadDisabled}>
                <Download className="h-4 w-4" />
                {downloadLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TemplateLibraryCard({
  saihuFile,
  saihuSummary,
  onDownloadB,
  onSaihuSelect,
  onDownloadSaihu,
}: {
  saihuFile: UploadedFileState | null;
  saihuSummary: { defaultStore: string } | null;
  onDownloadB: () => void;
  onSaihuSelect: (file: File) => void;
  onDownloadSaihu: () => void;
}) {
  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <CardTitle className="text-section">发货模板 B</CardTitle>
      </CardHeader>
      <CardContent className="flex h-[248px] flex-col gap-3 pt-4">
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex h-[102px] shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted px-4 py-3 text-center">
            <span className="text-base font-semibold text-foreground">亚马逊官方模板</span>
            <a
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-medium text-foreground transition-colors hover:border-brand hover:text-brand"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                onDownloadB();
              }}
            >
              <Download className="h-4 w-4" />
              下载官方模板
            </a>
          </div>
          <div className="flex h-[102px] shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted px-4 py-3 text-center">
            <FileSpreadsheet className="h-7 w-7 text-brand" />
            <span className="mt-2 text-base font-semibold text-foreground">赛狐模板</span>
            <div className="mt-4 flex items-center gap-3">
              <label className="inline-flex h-11 min-w-[86px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:border-brand hover:text-brand">
                <UploadCloud className="h-4 w-4" />
                上传
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onSaihuSelect(file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <Button size="sm" className="h-11 min-w-[96px] rounded-xl px-4 text-sm font-medium" onClick={onDownloadSaihu} disabled={!saihuFile}>
                <Download className="h-4 w-4" />
                下载
              </Button>
            </div>
            <span className="sr-only">
              {saihuSummary?.defaultStore
                ? `默认店铺值：${saihuSummary.defaultStore}`
                : saihuFile?.name ?? "第一列填默认下拉值，第二列 MSKU 对应 A 表 SKU，申报数对应发货总数"}
            </span>
            <label className="sr-only">
              <UploadCloud className="h-4 w-4" />
              上传赛狐模板
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onSaihuSelect(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function LogisticsTemplateCard({
  selectedTemplate,
  options,
  status,
  downloadDisabled,
  onTemplateChange,
  onDownload,
}: {
  selectedTemplate: string;
  options: LogisticsTemplateOption[];
  status?: [string, string];
  downloadDisabled?: boolean;
  onTemplateChange: (value: string) => void;
  onDownload: () => void;
}) {
  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <CardTitle className="text-section">物流模板 D</CardTitle>
      </CardHeader>
      <CardContent className="flex h-[248px] flex-col">
        <div className="mt-1 flex flex-1 flex-col justify-start rounded-lg border border-dashed border-border bg-surface-muted p-4">
          <span className="text-sm font-semibold text-foreground">选择物流模板</span>
          <select
            className="mt-4 h-11 rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-brand"
            value={selectedTemplate}
            onChange={(event) => onTemplateChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id} disabled={!option.enabled}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted">当前已接入凯奇模板，选择后会按 PDF 数量批量生成并打包下载</p>
        </div>
        <div className="mt-3 flex min-h-[52px] items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            {status ? (
              <>
                <Badge tone="green">{status[0]}</Badge>
                <p className="line-clamp-2 break-all text-xs text-muted">{status[1]}</p>
              </>
            ) : (
              <Badge>待生成</Badge>
            )}
          </div>
          <div className="flex w-[142px] shrink-0 flex-col gap-2">
            <Button size="sm" className="w-full justify-center whitespace-nowrap" onClick={onDownload} disabled={downloadDisabled}>
              <Download className="h-4 w-4" />
              下载发票
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-[160px] min-w-[160px] rounded-lg border border-border bg-surface-muted p-4">
      <p className="text-xs font-semibold tracking-wide text-muted">{label}</p>
      <p className="mt-3 text-2xl font-black text-foreground metric-tabular">{value}</p>
    </div>
  );
}

export function ExportRow({
  label,
  ready,
  onDownload,
  description,
}: {
  label: string;
  ready: boolean;
  onDownload: () => void;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3">
      <div className="flex items-center gap-3">
        <FileText className="h-4 w-4 text-brand" />
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted">{description ?? (ready ? "文件已生成，可直接下载" : "尚未生成")}</p>
        </div>
      </div>
      <Button size="sm" onClick={onDownload} disabled={!ready}>
        <Download className="h-4 w-4" />
        下载
      </Button>
    </div>
  );
}
