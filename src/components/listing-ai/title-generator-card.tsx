import { useState } from "react";
import { Loader2, Save, Search, Settings2, Wand2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fieldClass,
  labelClass,
  type TitleGeneratorDraft,
  type TitleGeneratorField,
  type TitleGeneratorFieldKey,
  type TitleGeneratorHistoryRecord,
} from "@/lib/listing-ai/workspace-draft";

export function TitleGeneratorCard({
  generator,
  loading,
  error,
  promptOpen,
  productFactsCount,
  onFieldChange,
  onGeneratorChange,
  onPromptOpenChange,
  onGenerate,
  onLoadHistory,
}: {
  generator: TitleGeneratorDraft;
  loading: boolean;
  error: string;
  promptOpen: boolean;
  productFactsCount: number;
  onFieldChange: (
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) => void;
  onGeneratorChange: React.Dispatch<React.SetStateAction<TitleGeneratorDraft>>;
  onPromptOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  onGenerate: () => void;
  onLoadHistory: (record: TitleGeneratorHistoryRecord) => void;
}) {
  const [historySearch, setHistorySearch] = useState("");
  const identityFieldKeys: TitleGeneratorFieldKey[] = [
    "productChineseName",
    "asin",
  ];
  const identityFields = identityFieldKeys
    .map((key) => generator.fields.find((field) => field.key === key))
    .filter((field): field is TitleGeneratorField => Boolean(field));
  const referenceFields = generator.fields.filter(
    (field) => !identityFieldKeys.includes(field.key),
  );
  const totalWeight = referenceFields.reduce(
    (total, field) => total + field.weight,
    0,
  );
  const hasRequiredIdentity = identityFields.every((field) =>
    field.value.trim(),
  );
  const canGenerate =
    hasRequiredIdentity &&
    referenceFields.some((field) => field.value.trim()) &&
    !loading;
  const history = generator.history ?? [];
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const visibleHistory = normalizedHistorySearch
    ? history.filter((record) =>
        [
          record.createdAt,
          record.prompt,
          ...record.results,
          ...record.fields.flatMap((field) => [
            field.label,
            field.value,
            String(field.weight),
          ]),
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedHistorySearch),
      )
    : history;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>标题生成器</CardTitle>
            <p className="mt-1 text-xs font-semibold text-muted">
              按参考资料与权重生成 3 条亚马逊标题。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={totalWeight === 100 ? "green" : "amber"}>
              权重 {totalWeight}%
            </Badge>
            <Badge tone={productFactsCount >= 50 ? "green" : "amber"}>
              Mine Facts {productFactsCount}/50
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onPromptOpenChange(true)}
            >
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
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className={labelClass}>产品信息</p>
              <Badge tone={hasRequiredIdentity ? "green" : "amber"}>必填</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {identityFields.map((field) => (
                <label key={field.key} className="space-y-1">
                  <span className="text-xs font-bold text-muted">
                    {field.label}
                  </span>
                  <input
                    className={fieldClass}
                    value={field.value}
                    onChange={(event) =>
                      onFieldChange(field.key, {
                        value:
                          field.key === "asin"
                            ? event.target.value.trim()
                            : event.target.value,
                      })
                    }
                    placeholder={`${field.label}：必填`}
                  />
                </label>
              ))}
            </div>
          </div>
          {referenceFields.map((field) => (
            <div
              key={field.key}
              className="rounded-md border border-border bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className={labelClass}>{field.label}</p>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`${field.label} 权重`}
                    className="h-8 w-16 rounded-md border border-border bg-white px-2 text-right text-sm font-bold text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                    max={100}
                    min={0}
                    type="number"
                    value={field.weight}
                    onChange={(event) =>
                      onFieldChange(field.key, {
                        weight: Math.max(
                          0,
                          Math.min(100, Number(event.target.value) || 0),
                        ),
                      })
                    }
                  />
                  <span className="text-xs font-bold text-muted">%</span>
                </div>
              </div>
              <textarea
                className={`${fieldClass} h-24 resize-none`}
                value={field.value}
                onChange={(event) =>
                  onFieldChange(field.key, { value: event.target.value })
                }
                placeholder={`${field.label}：输入框`}
              />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-surface-muted/50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className={labelClass}>生成的内容</p>
              <Badge tone={generator.results.length === 3 ? "green" : "gray"}>
                {generator.results.length}/3
              </Badge>
            </div>
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="min-h-24 rounded-md border border-border bg-white p-3"
                >
                  <p className="text-xs font-black text-brand">
                    生成结果{index + 1}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-foreground">
                    {generator.results[index] || "等待生成"}
                  </p>
                </div>
              ))}
            </div>
            {error ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </div>
            ) : null}
          </div>
          <div className="rounded-md border border-border bg-white p-3">
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
                placeholder="搜索历史名称、ASIN、单词、数据"
              />
            </div>
            {history.length ? (
              visibleHistory.length ? (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {visibleHistory.map((record) => {
                    const recordChineseName = record.fields
                      .find((field) => field.key === "productChineseName")
                      ?.value.trim();
                    const recordAsin = record.fields
                      .find((field) => field.key === "asin")
                      ?.value.trim();
                    const reviewMeta = [recordChineseName, recordAsin]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <div
                        key={record.id}
                        className="rounded-md border border-border bg-surface-muted/40 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-muted">
                            {record.createdAt}
                            {reviewMeta ? ` · ${reviewMeta}` : ""}
                          </p>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onLoadHistory(record)}
                          >
                            复用
                          </Button>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-foreground">
                          {record.results[0] || "无结果"}
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
              保存后会作为标题生成器的系统提示词使用。
            </p>
          </div>
          <button
            className="rounded-md p-2 text-muted hover:bg-surface-muted hover:text-foreground"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <textarea
            className={`${fieldClass} h-[420px] resize-none font-mono text-xs leading-5`}
            value={prompt}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onSave}>
            <Save className="h-4 w-4" />
            保存提示词
          </Button>
        </div>
      </div>
    </div>
  );
}
