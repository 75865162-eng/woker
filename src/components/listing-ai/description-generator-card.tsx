"use client";

import { useState } from "react";
import { Loader2, Search, Settings2, Wand2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fieldClass,
  labelClass,
  type DescriptionGeneratorDraft,
  type DescriptionGeneratorFieldKey,
  type DescriptionGeneratorHistoryRecord,
  type TitleGeneratorField,
  type TitleGeneratorMode,
} from "@/lib/listing-ai/workspace-draft";

const modeLabelMap: Record<TitleGeneratorMode, string> = {
  old: "老品优化",
  new: "新品编写",
};

export function DescriptionGeneratorCard({
  generator,
  sharedFields,
  mode,
  loading,
  error,
  promptOpen,
  onFieldChange,
  onGeneratorChange,
  onPromptOpenChange,
  onGenerate,
  onLoadHistory,
}: {
  generator: DescriptionGeneratorDraft;
  sharedFields: TitleGeneratorField[];
  mode: TitleGeneratorMode;
  loading: boolean;
  error: string;
  promptOpen: boolean;
  onFieldChange: (
    key: DescriptionGeneratorFieldKey,
    value: string,
  ) => void;
  onGeneratorChange: React.Dispatch<React.SetStateAction<DescriptionGeneratorDraft>>;
  onPromptOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  onGenerate: () => void;
  onLoadHistory: (record: DescriptionGeneratorHistoryRecord) => void;
}) {
  const [historySearch, setHistorySearch] = useState("");
  const modeText = modeLabelMap[mode];
  const weightedFields = sharedFields.filter(
    (field) => field.key === "productFeatures" || field.key === "coreAdWords" || field.key === "relatedKeywords" || field.key === "adData",
  );
  const visibleFields = generator.fields;
  const history = generator.history ?? [];
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const visibleHistory = normalizedHistorySearch
    ? history.filter((record) =>
        [
          record.createdAt,
          record.mode === "new" ? "新品编写" : record.mode === "old" ? "老品优化" : "",
          record.prompt,
          ...record.results,
          ...record.fields.flatMap((field) => [field.label, field.value]),
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedHistorySearch),
      )
    : history;

  const canGenerate =
    weightedFields.some((field) => field.value.trim()) &&
    visibleFields.some((field) => field.value.trim()) &&
    !loading;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>描述生成</CardTitle>
            <p className="mt-1 text-xs font-semibold text-muted">
              沿用上方权重，竞品描述默认按 10% 权重参考生成 5 条亚马逊五点描述。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={mode === "new" ? "blue" : "green"}>{modeText}</Badge>
            <Button size="sm" variant="secondary" onClick={() => onPromptOpenChange(true)}>
              <Settings2 className="h-4 w-4" />
              提示词修改
            </Button>
            <Button size="sm" disabled={!canGenerate} onClick={onGenerate}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              AI 生成
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-4">
          {weightedFields.map((field) => (
            <div key={field.key} className="rounded-md border border-border bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className={labelClass}>{field.label}</p>
                <span className="text-sm font-bold text-foreground">{field.weight}%</span>
              </div>
              <p className="min-h-16 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {field.value.trim() || "等待上方输入"}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.15fr)]">
          {visibleFields.map((field) => (
            <div key={field.key} className="rounded-md border border-border bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className={labelClass}>{field.label}</p>
                <span className="text-xs font-bold text-muted">{field.weight}% 权重</span>
              </div>
              <textarea
                className={`${fieldClass} h-[1000px] resize-none`}
                value={field.value}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
                placeholder={`${field.label}：输入竞品描述`}
              />
            </div>
          ))}

          <div className="rounded-md border border-border bg-surface-muted/40 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className={labelClass}>生成结果</p>
              <Badge tone={generator.results.length === 5 ? "green" : "gray"}>
                {generator.results.length}/5
              </Badge>
            </div>
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((index) => {
                const result = generator.results[index] || "";

                return (
                  <div key={index} className="rounded-md border border-border bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black text-brand">五点{index + 1}</p>
                      <Badge tone={result.length <= 220 ? "green" : "amber"}>
                        {result.length} 字符
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6 text-foreground">
                      {result || "等待生成"}
                    </p>
                  </div>
                );
              })}
            </div>

            {error ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className={labelClass}>生成历史</p>
                <Badge tone={visibleHistory.length ? "blue" : "gray"}>
                  {normalizedHistorySearch
                    ? `${visibleHistory.length}/${history.length}`
                    : history.length}
                </Badge>
              </div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  className={`${fieldClass} pl-9`}
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="搜索历史、模式、内容"
                />
              </div>
              {history.length ? (
                visibleHistory.length ? (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {visibleHistory.map((record) => {
                      const modeBadge =
                        record.mode === "new"
                          ? { label: "新品编写", tone: "blue" as const }
                          : { label: "老品优化", tone: "green" as const };

                      return (
                        <div
                          key={record.id}
                          className="rounded-md border border-border bg-white p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-muted">
                              {record.createdAt}
                            </p>
                            <div className="flex items-center gap-2">
                              <Badge tone={modeBadge.tone}>{modeBadge.label}</Badge>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => onLoadHistory(record)}
                              >
                                复用
                              </Button>
                            </div>
                          </div>
                          <p className="mt-2 line-clamp-3 text-xs font-semibold leading-5 text-foreground">
                            {record.results.join(" / ") || "无结果"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
                    没有匹配的历史记录
                  </div>
                )
              ) : (
                <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
                  暂无历史
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
      {promptOpen ? (
        <PromptEditorDialog
          prompt={generator.prompt}
          onChange={(prompt) =>
            onGeneratorChange((current) => ({ ...current, prompt }))
          }
          onClose={() => onPromptOpenChange(false)}
          onSave={() => onPromptOpenChange(false)}
        />
      ) : null}
    </Card>
  );
}

function PromptEditorDialog({
  prompt,
  onChange,
  onClose,
  onSave,
}: {
  prompt: string;
  onChange: (prompt: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-3xl rounded-lg border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-foreground">提示词修改</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              保存后会作为五点描述生成器的系统提示词使用。
            </p>
          </div>
          <button
            className="rounded-md p-2 text-muted hover:bg-surface-muted hover:text-foreground"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <textarea
            className={`${fieldClass} min-h-80 resize-y font-mono text-xs leading-6`}
            value={prompt}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button onClick={onSave}>保存</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
