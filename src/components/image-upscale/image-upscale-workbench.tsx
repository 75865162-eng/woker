"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { Archive, Download, ImagePlus, Loader2, RefreshCw, RotateCcw, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { imageUpscaleModels } from "@/lib/image-upscale/models";
import { cn } from "@/lib/utils";

type ImageKind = "illustration" | "photo";
type NoiseLevel = "none" | "low" | "medium" | "high";
type JobStatus = "queued" | "running" | "completed" | "failed";
type Job = {
  id: string; batchId: string; originalName: string; status: JobStatus; progress: number; scale: number; model: string;
  inputWidth: number | null; inputHeight: number | null; outputWidth: number | null; outputHeight: number | null;
  inputSize: number; outputSize: number | null; processingMs: number | null; error: string | null; createdAt: string;
};

const scaleOptions = [2, 4] as const;
const imageKindLabels: Record<ImageKind, string> = { illustration: "插画 / 线稿", photo: "商品 / 照片" };
const statusLabels: Record<JobStatus, string> = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败" };

export function ImageUpscaleWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceUrlRef = useRef("");
  const resultUrlsRef = useRef<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [history, setHistory] = useState<Job[]>([]);
  const [batchId, setBatchId] = useState("");
  const [scale, setScale] = useState<(typeof scaleOptions)[number]>(2);
  const [imageKind, setImageKind] = useState<ImageKind>("photo");
  const [noiseLevel, setNoiseLevel] = useState<NoiseLevel>("low");
  const [model, setModel] = useState("realesrgan-x4plus");
  const [selectedId, setSelectedId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [resultUrls, setResultUrls] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  const selectedJob = jobs.find((job) => job.id === selectedId) ?? jobs[0];
  const selectedResultUrl = selectedJob ? resultUrls[selectedJob.id] ?? "" : "";
  const completedCount = jobs.filter((job) => job.status === "completed").length;

  useEffect(() => () => {
    Object.values(resultUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
  }, []);

  useEffect(() => {
    if (!batchId || !jobs.length || jobs.every((job) => job.status === "completed" || job.status === "failed")) return;
    const timer = window.setInterval(() => {
      void refreshJobs(jobs.map((job) => job.id), false).then((nextJobs) => {
        if (nextJobs.length && nextJobs.every((job) => job.status === "completed" || job.status === "failed")) void loadHistory();
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [batchId, jobs]);

  useEffect(() => {
    if (selectedJob?.status === "completed" && !resultUrls[selectedJob.id]) void loadResult(selectedJob);
  }, [selectedJob, resultUrls]);

  const refreshJobs = async (ids: string[], showError = true) => {
    try {
      const response = await fetch(`/api/image-upscale?ids=${encodeURIComponent(ids.join(","))}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json() as { jobs?: Job[]; error?: string };
      if (!response.ok || !payload.jobs) throw new Error(payload.error ?? "任务状态读取失败。");
      setJobs((current) => current.map((job) => payload.jobs?.find((next) => next.id === job.id) ?? job));
      return payload.jobs;
    } catch (refreshError) {
      if (showError) setError(refreshError instanceof Error ? refreshError.message : "任务状态读取失败。");
      return [];
    }
  };

  const loadResult = async (job: Job) => {
    const response = await fetch(`/api/image-upscale/jobs/${job.id}/download`, { credentials: "include" });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    resultUrlsRef.current = { ...resultUrlsRef.current, [job.id]: url };
    setResultUrls((current) => ({ ...current, [job.id]: url }));
  };

  const loadHistory = async () => {
    const response = await fetch("/api/image-upscale?limit=30", { credentials: "include", cache: "no-store" });
    const payload = await response.json() as { jobs?: Job[] };
    if (response.ok && payload.jobs) setHistory(payload.jobs);
  };

  useEffect(() => { void loadHistory(); }, []);

  const loadFiles = (incoming: File[]) => {
    const valid = incoming.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (!valid.length) { setError("请上传 JPG、PNG 或 WebP 图片。"); return; }
    setError(""); setFiles(valid.slice(0, 20)); setJobs([]); setBatchId(""); setSelectedId(""); setResultUrls({});
    setSourceUrl((current) => { if (current) URL.revokeObjectURL(current); const url = URL.createObjectURL(valid[0]); sourceUrlRef.current = url; return url; });
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => loadFiles(Array.from(event.target.files ?? []));
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setIsDragging(false); loadFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const handleUpscale = async () => {
    if (!files.length) { setError("请先上传图片。"); return; }
    setIsProcessing(true); setError("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("scale", String(scale)); formData.append("imageKind", imageKind); formData.append("noiseLevel", noiseLevel); formData.append("model", model);
      const response = await fetch("/api/image-upscale", { method: "POST", credentials: "include", body: formData });
      const payload = await response.json() as { batchId?: string; jobs?: Job[]; error?: string };
      if (!response.ok || !payload.jobs || !payload.batchId) throw new Error(payload.error ?? "图片任务创建失败。");
      setBatchId(payload.batchId); setJobs(payload.jobs); setSelectedId(payload.jobs[0]?.id ?? ""); void loadHistory();
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : "图片任务创建失败。");
    } finally { setIsProcessing(false); }
  };

  const retryJob = async (job: Job) => {
    const response = await fetch(`/api/image-upscale/jobs/${job.id}`, { method: "POST", credentials: "include" });
    const payload = await response.json() as { job?: Job; error?: string };
    if (!response.ok || !payload.job) { setError(payload.error ?? "重试失败。"); return; }
    setJobs((current) => current.map((item) => item.id === job.id ? payload.job! : item)); setError("");
  };

  const downloadJob = async (job: Job) => {
    const response = await fetch(`/api/image-upscale/jobs/${job.id}/download`, { credentials: "include" });
    if (!response.ok) { setError("下载结果失败。"); return; }
    const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(await response.blob());
    anchor.download = `${job.originalName.replace(/\.[^.]+$/, "")}-${job.scale}x-upscaled.png`; anchor.click(); URL.revokeObjectURL(anchor.href);
  };

  const reset = () => {
    setFiles([]); setJobs([]); setBatchId(""); setSelectedId(""); setError("");
    Object.values(resultUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    resultUrlsRef.current = {};
    setResultUrls({});
    setSourceUrl((current) => { if (current) URL.revokeObjectURL(current); sourceUrlRef.current = ""; return ""; });
    if (inputRef.current) inputRef.current.value = "";
  };

  return <div className="space-y-6">
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card><CardHeader><CardTitle>批量处理参数</CardTitle></CardHeader><CardContent className="space-y-5">
        <div onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} className={cn("flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted px-5 py-6 text-center", isDragging && "border-brand bg-white")}>
          <ImagePlus className="h-9 w-9 text-brand" /><p className="mt-3 text-sm font-bold text-foreground">拖入多张图片或选择文件</p><p className="mt-1 text-xs leading-5 text-muted">支持 JPG / PNG / WebP，单批最多 20 张。</p>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFileInput} />
          <Button type="button" variant="secondary" className="mt-4" onClick={() => inputRef.current?.click()}>选择图片</Button>
        </div>
        {files.length ? <p className="text-xs font-semibold text-muted">已选择 {files.length} 张：{files.slice(0, 3).map((file) => file.name).join("、")}{files.length > 3 ? " 等" : ""}</p> : null}
        <div><label className="text-xs font-bold text-muted">图片类型</label><div className="mt-2 grid grid-cols-2 gap-2">{Object.entries(imageKindLabels).map(([value, label]) => <button key={value} type="button" onClick={() => setImageKind(value as ImageKind)} className={cn("h-10 rounded-md border border-border bg-white text-sm font-semibold text-muted", imageKind === value && "border-brand bg-brand text-white")}>{label}</button>)}</div></div>
        <div><label className="text-xs font-bold text-muted">统一放大倍数</label><div className="mt-2 grid grid-cols-2 gap-2">{scaleOptions.map((option) => <button key={option} type="button" onClick={() => setScale(option)} className={cn("h-10 rounded-md border border-border bg-white text-sm font-semibold text-muted", scale === option && "border-brand bg-brand text-white")}>{option}x</button>)}</div></div>
        <div><label htmlFor="noise-level" className="text-xs font-bold text-muted">降噪强度</label><select id="noise-level" value={noiseLevel} onChange={(event) => setNoiseLevel(event.target.value as NoiseLevel)} className="mt-2 h-10 w-full rounded-md border border-border bg-white px-3 text-sm font-semibold text-foreground outline-none focus:border-brand"><option value="none">不降噪</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
        <div><label htmlFor="upscale-model" className="text-xs font-bold text-muted">统一模型</label><select id="upscale-model" value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-border bg-white px-3 text-sm font-semibold text-foreground outline-none focus:border-brand">{imageUpscaleModels.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        {error ? <p className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</p> : null}
        <div className="flex gap-2"><Button type="button" className="flex-1" disabled={!files.length || isProcessing} onClick={handleUpscale}>{isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}提交后台处理</Button><Button type="button" variant="secondary" size="icon" title="重置" onClick={reset}><RotateCcw className="h-4 w-4" /></Button></div>
      </CardContent></Card>
      <section className="grid gap-4 lg:grid-cols-2"><PreviewCard title="原图" imageUrl={sourceUrl} emptyText="上传图片后显示原图" /><PreviewCard title="放大结果" imageUrl={selectedResultUrl} emptyText="选择已完成任务后显示结果" downloadName={selectedJob?.originalName} onDownload={selectedJob ? () => void downloadJob(selectedJob) : undefined} /></section>
    </div>
    {jobs.length ? <JobTable jobs={jobs} completedCount={completedCount} batchId={batchId} selectedId={selectedJob?.id ?? ""} onSelect={setSelectedId} onRetry={(job) => void retryJob(job)} onDownload={(job) => void downloadJob(job)} /> : null}
    <HistoryTable history={history} onRefresh={() => void loadHistory()} onDownload={(job) => void downloadJob(job)} />
  </div>;
}

function PreviewCard({ title, imageUrl, emptyText, downloadName, onDownload }: { title: string; imageUrl: string; emptyText: string; downloadName?: string; onDownload?: () => void }) {
  return <Card className="min-h-[420px] overflow-hidden"><CardHeader className="flex flex-row items-center justify-between"><CardTitle>{title}</CardTitle>{imageUrl && onDownload && downloadName ? <Button type="button" variant="secondary" size="sm" onClick={onDownload}><Download className="h-4 w-4" />下载</Button> : null}</CardHeader><CardContent className="flex min-h-[340px] items-center justify-center bg-surface-muted p-3">{imageUrl ? <img src={imageUrl} alt={title} className="max-h-[60vh] max-w-full rounded-md object-contain shadow-sm" /> : <div className="flex min-h-[280px] w-full items-center justify-center rounded-md border border-dashed border-border bg-white text-sm font-semibold text-muted">{emptyText}</div>}</CardContent></Card>;
}

function JobTable({ jobs, completedCount, batchId, selectedId, onSelect, onRetry, onDownload }: { jobs: Job[]; completedCount: number; batchId: string; selectedId: string; onSelect: (id: string) => void; onRetry: (job: Job) => void; onDownload: (job: Job) => void }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>当前批次</CardTitle><p className="mt-1 text-xs font-semibold text-muted">{completedCount}/{jobs.length} 张完成</p></div>{batchId && completedCount ? <a href={`/api/image-upscale/batches/${batchId}/zip`}><Button type="button" variant="secondary" size="sm"><Archive className="h-4 w-4" />下载 ZIP</Button></a> : null}</CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-border text-xs text-muted"><tr><th className="px-2 py-2">图片</th><th className="px-2 py-2">状态</th><th className="px-2 py-2">尺寸</th><th className="px-2 py-2">耗时</th><th className="px-2 py-2">模型</th><th className="px-2 py-2">操作</th></tr></thead><tbody>{jobs.map((job) => <JobRow key={job.id} job={job} selected={job.id === selectedId} onSelect={() => onSelect(job.id)} onRetry={() => onRetry(job)} onDownload={() => onDownload(job)} />)}</tbody></table></div></CardContent></Card>;
}

function JobRow({ job, selected, onSelect, onRetry, onDownload }: { job: Job; selected: boolean; onSelect: () => void; onRetry: () => void; onDownload: () => void }) {
  return <tr className={cn("border-b border-border/70", selected && "bg-brand/5")}><td className="max-w-[240px] px-2 py-3"><button type="button" className="truncate text-left font-semibold text-foreground hover:text-brand" onClick={onSelect}>{job.originalName}</button></td><td className="px-2 py-3"><span className={cn("rounded-md px-2 py-1 text-xs font-bold", job.status === "completed" && "bg-green-100 text-green-700", job.status === "failed" && "bg-red-100 text-red-700", job.status === "running" && "bg-blue-100 text-blue-700", job.status === "queued" && "bg-slate-100 text-slate-600")}>{statusLabels[job.status]}{job.status === "running" ? ` ${job.progress}%` : ""}</span>{job.error ? <p className="mt-1 max-w-[220px] text-xs text-danger">{job.error}</p> : null}</td><td className="px-2 py-3 text-xs text-muted">{formatDimensions(job.inputWidth, job.inputHeight)} → {formatDimensions(job.outputWidth, job.outputHeight)}</td><td className="px-2 py-3 text-xs text-muted">{job.processingMs ? formatDuration(job.processingMs) : "-"}</td><td className="px-2 py-3 text-xs text-muted">{job.model || "-"}</td><td className="px-2 py-3"><div className="flex gap-1">{job.status === "completed" ? <Button type="button" variant="secondary" size="icon" title="下载" onClick={onDownload}><Download className="h-4 w-4" /></Button> : null}{job.status === "failed" ? <Button type="button" variant="secondary" size="icon" title="重试" onClick={onRetry}><RefreshCw className="h-4 w-4" /></Button> : null}</div></td></tr>;
}

function HistoryTable({ history, onRefresh, onDownload }: { history: Job[]; onRefresh: () => void; onDownload: (job: Job) => void }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>处理历史</CardTitle><p className="mt-1 text-xs font-semibold text-muted">最近 30 条图片处理记录</p></div><Button type="button" variant="secondary" size="icon" title="刷新历史" onClick={onRefresh}><RefreshCw className="h-4 w-4" /></Button></CardHeader><CardContent>{history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="border-b border-border text-xs text-muted"><tr><th className="px-2 py-2">图片</th><th className="px-2 py-2">状态</th><th className="px-2 py-2">尺寸</th><th className="px-2 py-2">耗时</th><th className="px-2 py-2">模型</th><th className="px-2 py-2">时间</th><th /></tr></thead><tbody>{history.map((job) => <tr key={job.id} className="border-b border-border/70"><td className="max-w-[220px] truncate px-2 py-3 font-semibold">{job.originalName}</td><td className="px-2 py-3 text-xs">{statusLabels[job.status]}</td><td className="px-2 py-3 text-xs text-muted">{formatDimensions(job.inputWidth, job.inputHeight)} → {formatDimensions(job.outputWidth, job.outputHeight)}</td><td className="px-2 py-3 text-xs text-muted">{job.processingMs ? formatDuration(job.processingMs) : "-"}</td><td className="px-2 py-3 text-xs text-muted">{job.model || "-"}</td><td className="px-2 py-3 text-xs text-muted">{new Date(job.createdAt).toLocaleString()}</td><td className="px-2 py-3">{job.status === "completed" ? <Button type="button" variant="secondary" size="icon" title="下载" onClick={() => onDownload(job)}><Download className="h-4 w-4" /></Button> : null}</td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm font-semibold text-muted">暂无处理历史。</p>}</CardContent></Card>;
}

function formatDimensions(width: number | null, height: number | null) { return width && height ? `${width} × ${height}px` : "-"; }
function formatDuration(milliseconds: number) { return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`; }
