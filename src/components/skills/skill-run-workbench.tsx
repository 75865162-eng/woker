"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, CircleDashed, Download, FileSpreadsheet, FileText, LoaderCircle, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormGrid, Input, Select } from "@/components/ui/form-controls";
import { Dialog } from "@/components/ui/overlays";
import { HelpProse } from "@/components/help/help-prose";
import { extHeaders } from "@/lib/workspace/ext-headers";
import type { SkillRunEvent, SkillRunStep, SkillView } from "@/lib/skill-engine/types";

type Props = { skill: SkillView };

type DownloadInfo = { downloadId: string; fileName: string; exportFormat: "xlsx" | "docx"; historyId: string | null };

export function SkillRunWorkbench({ skill }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const input of skill.inputs) initial[input.key] = input.defaultValue ?? "";
    return initial;
  });
  const [steps, setSteps] = useState<SkillRunStep[]>([]);
  const [report, setReport] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [download, setDownload] = useState<DownloadInfo | null>(null);
  const reportEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    reportEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [report]);

  const setValue = useCallback((key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  }, []);

  const upsertStep = useCallback((step: SkillRunStep) => {
    setSteps((current) => {
      const index = current.findIndex((item) => item.id === step.id);
      if (index < 0) return [...current, step];
      const next = [...current];
      next[index] = step;
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    for (const input of skill.inputs) {
      if (input.required && !values[input.key]?.trim()) {
        setError(`请填写「${input.label}」。`);
        return;
      }
    }
    setRunning(true);
    setError("");
    setSteps([]);
    setReport("");
    setDownload(null);

    try {
      const headers = extHeaders(true);
      const response = await fetch(`/api/skills/${encodeURIComponent(skill.slug)}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ inputs: values }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `运行请求失败（HTTP ${response.status}）。`);
      }
      if (!response.body) throw new Error("服务端未返回流式响应。");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      const handle = (line: string) => {
        if (!line.startsWith("data:")) return;
        const raw = line.slice(5).trim();
        if (!raw) return;
        let event: SkillRunEvent;
        try {
          event = JSON.parse(raw) as SkillRunEvent;
        } catch {
          return;
        }
        if (event.type === "step") upsertStep(event.step);
        else if (event.type === "delta") setReport((current) => current + event.text);
        else if (event.type === "done") {
          setReport(event.report);
          setDownload({ downloadId: event.downloadId, fileName: event.exportFileName, exportFormat: event.exportFormat, historyId: event.historyId });
        } else if (event.type === "error") {
          setError(`${event.code}: ${event.message}`);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handle(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) handle(buffer);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "运行失败。");
    } finally {
      setRunning(false);
    }
  }, [running, skill, values, upsertStep]);

  const downloadUrl = useMemo(() => {
    if (!download) return "";
    // 优先持久化历史文档（重启后仍可下载），失败回退到进程内临时下载。
    if (download.historyId) return `/api/skills/runs/${encodeURIComponent(download.historyId)}/document`;
    return `/api/skills/${encodeURIComponent(skill.slug)}/export/${encodeURIComponent(download.downloadId)}`;
  }, [download, skill.slug]);

  return (
    <div className="space-y-[var(--gap-section)]">
      <section className="rounded-lg border border-border bg-surface p-[var(--pad-card)]">
        <h2 className="mb-3 text-section font-semibold text-foreground">运行参数</h2>
        <FormGrid columns={2}>
          {skill.inputs.map((input) => (
            <Field
              key={input.key}
              label={input.label}
              required={input.required}
              hint={input.key === "asin" || input.key === "brief" ? "选填；未提供的数据不会编造，将标注 NEEDS_DATA" : undefined}
            >
              {input.options ? (
                <Select
                  value={values[input.key] ?? ""}
                  onChange={(event) => setValue(input.key, event.target.value)}
                  options={input.options}
                />
              ) : (
                <Input
                  value={values[input.key] ?? ""}
                  onChange={(event) => setValue(input.key, event.target.value)}
                  placeholder={input.placeholder}
                />
              )}
            </Field>
          ))}
        </FormGrid>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void run()} disabled={running}>
            {running ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Play aria-hidden className="h-4 w-4" />}
            {running ? "运行中…" : "开始运行"}
          </Button>
          <span className="text-meta text-muted">
            导出格式：{skill.exportFormatLabel}（系统按 Skill 分类派生）
          </span>
        </div>
        {error ? <div className="mt-3"><Alert tone="danger" title="运行未完成" description={error} /></div> : null}
      </section>

      {steps.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface p-[var(--pad-card)]">
          <h2 className="mb-3 text-section font-semibold text-foreground">执行过程</h2>
          <ol className="space-y-2">
            {steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2 text-body">
                {step.status === "running" ? <LoaderCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand" />
                  : step.status === "done" ? <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  : step.status === "failed" ? <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  : <CircleDashed aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                <span className="text-foreground">{step.label}</span>
                {step.detail ? <span className="text-meta text-muted">— {step.detail}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {report ? (
        <section className="rounded-lg border border-border bg-surface p-[var(--pad-card)]">
          <h2 className="mb-3 text-section font-semibold text-foreground">分析报告</h2>
          <div className="max-h-[70vh] overflow-auto">
            <HelpProse markdown={report} />
            <div ref={reportEndRef} />
          </div>
        </section>
      ) : null}

      <Dialog
        open={Boolean(download)}
        title="报告已生成"
        description={download?.historyId ? "报告已保存到运行历史，可在「开始使用」页随时回看与下载。" : "文件已在服务端临时生成，请在 15 分钟内下载。"}
        onClose={() => setDownload(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDownload(null)}>关闭</Button>
            <Link href="/lili/v2/start" className="inline-flex">
              <Button variant="secondary">查看运行历史</Button>
            </Link>
            <a href={downloadUrl} download={download?.fileName}>
              <Button>
                <Download aria-hidden className="h-4 w-4" /> 下载文件
              </Button>
            </a>
          </>
        }
      >
        {download ? (
          <div className="flex items-start gap-3">
            {download.exportFormat === "xlsx"
              ? <FileSpreadsheet aria-hidden className="h-6 w-6 shrink-0 text-brand" />
              : <FileText aria-hidden className="h-6 w-6 shrink-0 text-brand" />}
            <div className="min-w-0 space-y-1">
              <p className="break-all font-semibold text-foreground">{download.fileName}</p>
              <Badge tone="info">{download.exportFormat.toUpperCase()}</Badge>
              <p className="text-meta text-muted">报告仅基于已提供数据生成；缺失事实标注 NEEDS_DATA，未做补零或估算，且未执行任何店铺写入。</p>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
