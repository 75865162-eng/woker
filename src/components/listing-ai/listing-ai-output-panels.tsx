"use client";

import type { Dispatch, SetStateAction } from "react";
import { Check, Clipboard, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageGeneratorBoard } from "@/components/listing-ai/image-generator-board";
import {
  AnalysisCard,
  AnalysisList,
  EmptyOutput,
} from "@/components/listing-ai/output-primitives";
import type { ListingOptimizationResult } from "@/lib/listing-ai/types";
import {
  formatCopywriting,
  formatImages,
  type ImageGeneratorDraft,
  type ImagePreview,
} from "@/lib/listing-ai/workspace-draft";

export function AnalysisSection({
  result,
  loading,
  error,
  canSubmit,
  onGenerate,
}: {
  result: ListingOptimizationResult | null;
  loading: boolean;
  error: string;
  canSubmit: boolean;
  onGenerate: () => void;
}) {
  if (!result) {
    return (
      <EmptyAiState
        title="AI Analysis"
        loading={loading}
        error={error}
        canSubmit={canSubmit}
        onGenerate={onGenerate}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <AnalysisCard
        title="Position"
        content={result.aiAnalysis.position || result.positioning.oneSentence}
        tone="blue"
      />
      <AnalysisList
        title="Strength"
        items={result.aiAnalysis.strength}
        tone="green"
      />
      <AnalysisList
        title="Weakness"
        items={result.aiAnalysis.weakness}
        tone="amber"
      />
      <AnalysisList
        title="Opportunity"
        items={result.aiAnalysis.opportunity}
        tone="blue"
      />
      <AnalysisList title="Risk" items={result.aiAnalysis.risk} tone="red" />
    </div>
  );
}

export function ListingSection({
  result,
  copied,
  copyText,
}: {
  result: ListingOptimizationResult | null;
  copied: string;
  copyText: (key: string, value: string) => void;
}) {
  if (!result) return <EmptyOutput title="Final Listing" />;

  return (
    <div className="space-y-4">
      <OutputHeader
        title="Final Listing"
        onCopy={() => copyText("listing", formatCopywriting(result))}
        copied={copied === "listing"}
      />
      <Card>
        <CardHeader>
          <CardTitle>Title Generation</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {result.titleOptions.map((option) => (
            <div
              key={option.type}
              className="rounded-md border border-border p-4"
            >
              <Badge tone={option.type === "balanced" ? "green" : "blue"}>
                {option.type}
              </Badge>
              <p className="mt-3 text-sm font-bold leading-6 text-foreground">
                {option.title}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                {option.selfCheck}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bullet Generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.bullets.map((bullet, index) => (
            <div
              key={`${bullet.bullet}-${index}`}
              className="rounded-md border border-border p-4"
            >
              <p className="font-bold leading-6 text-foreground">
                {index + 1}. {bullet.bullet}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted">
                {bullet.chineseExplanation}
              </p>
              <p className="mt-1 text-xs font-semibold text-brand">
                Image: {bullet.imageExpression}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function ImagePlanSection({
  result,
  copied,
  copyText,
  imageGenerator,
  imageGenerating,
  imageGeneratorError,
  setImageGenerator,
  handleImageUpload,
  onRunImageGenerator,
}: {
  result: ListingOptimizationResult | null;
  copied: string;
  copyText: (key: string, value: string) => void;
  imageGenerator: ImageGeneratorDraft;
  imageGenerating: boolean;
  imageGeneratorError: string;
  setImageGenerator: Dispatch<SetStateAction<ImageGeneratorDraft>>;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
  onRunImageGenerator: () => void;
}) {
  return (
    <div className="space-y-4">
      {result ? (
        <>
          <OutputHeader
            title="Image Execution Board"
            onCopy={() => copyText("images", formatImages(result))}
            copied={copied === "images"}
          />
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="bg-surface-muted text-xs font-bold text-muted">
                  <tr>
                    <th className="px-4 py-3">No</th>
                    <th className="px-4 py-3">主题</th>
                    <th className="px-4 py-3">卖点</th>
                    <th className="px-4 py-3">文案</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">Prompt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.imagePlan.map((item) => (
                    <tr key={`${item.imageNo}-${item.slot}`} className="align-top">
                      <td className="px-4 py-3 font-black text-foreground">
                        {item.imageNo}
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {item.theme}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {item.amplifiedSellingPoint}
                      </td>
                      <td className="px-4 py-3 text-muted">{item.englishCopy}</td>
                      <td className="px-4 py-3">
                        <Badge tone="amber">Planned</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <details>
                          <summary className="cursor-pointer font-bold text-brand">
                            展开
                          </summary>
                          <p className="mt-2 text-xs leading-5 text-muted">
                            {item.enPrompt}
                          </p>
                          <p className="mt-2 text-xs leading-5 text-muted">
                            {item.negativePrompt}
                          </p>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyOutput title="Image Execution Board" />
      )}
      <ImageGeneratorBoard
        draft={imageGenerator}
        error={imageGeneratorError}
        loading={imageGenerating}
        setDraft={setImageGenerator}
        handleImageUpload={handleImageUpload}
        onRun={onRunImageGenerator}
      />
    </div>
  );
}

function EmptyAiState({
  title,
  loading,
  error,
  canSubmit,
  onGenerate,
}: {
  title: string;
  loading: boolean;
  error: string;
  canSubmit: boolean;
  onGenerate: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-[420px] flex-col items-center justify-center text-center">
        <Sparkles className="h-10 w-10 text-brand" />
        <h2 className="mt-4 text-xl font-black text-foreground">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted">
          录入 Information、Competitors、Images 后，生成 AI
          分析、Listing、图片执行表、A+ 和自检结果。
        </p>
        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}
        <Button className="mt-5" disabled={!canSubmit} onClick={onGenerate}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate AI Analysis
        </Button>
      </CardContent>
    </Card>
  );
}

function OutputHeader({
  title,
  onCopy,
  copied,
}: {
  title: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-white px-5 py-4 shadow-sm">
      <h2 className="text-lg font-black text-foreground">{title}</h2>
      <Button variant="secondary" size="sm" onClick={onCopy}>
        {copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Clipboard className="h-4 w-4" />
        )}
        {copied ? "已复制" : "复制"}
      </Button>
    </div>
  );
}
