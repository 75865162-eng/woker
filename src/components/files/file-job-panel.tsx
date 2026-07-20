"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FileObject = {
  id: string;
  originalName: string;
  size: number | null;
};

type ImportJob = {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  error: string | null;
  file: FileObject;
};

function formatFileSize(size?: number | null) {
  if (!size) {
    return "-";
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function FileJobPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") {
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { job: ImportJob };
      setJob(data.job);
    }, 1500);

    return () => window.clearInterval(timer);
  }, [job]);

  async function handleUpload(file?: File) {
    if (!file) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("type", "bulk_upload");

      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { job?: ImportJob; error?: string };

      if (!response.ok || !data.job) {
        throw new Error(data.error ?? "Upload failed.");
      }

      setJob(data.job);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>File jobs</CardTitle>
          <p className="mt-1 text-xs font-medium text-muted">Local uploads now, S3/R2 and worker queue later.</p>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={isUploading}>
            <UploadCloud className="h-4 w-4" />
            {isUploading ? "Uploading" : "Upload file"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!job ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-6 text-sm font-medium text-muted">
            Upload an Amazon bulk file to create a tracked local job.
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-foreground">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand" />
                <span className="truncate">{job.file.originalName}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-muted">
                <span>{formatFileSize(job.file.size)}</span>
                <span>Status: {job.status}</span>
                <span>Progress: {job.progress}%</span>
              </div>
              {job.error && <p className="mt-2 text-xs font-semibold text-danger">{job.error}</p>}
            </div>
            <div className="flex items-center gap-2">
              {job.status === "done" && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Ready
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={job.status !== "done"}
                onClick={() => {
                  window.location.href = `/api/files/${job.id}/download`;
                }}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
