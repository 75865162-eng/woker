"use client";

import type { Dispatch, SetStateAction } from "react";
import { TitleGeneratorCard } from "@/components/listing-ai/title-generator-card";
import type {
  TitleGeneratorDraft,
  TitleGeneratorField,
  TitleGeneratorFieldKey,
  TitleGeneratorHistoryRecord,
} from "@/lib/listing-ai/workspace-draft";

export function ListingAiInputPanel({
  productFactsCount,
  titleGenerator,
  titleGenerating,
  titleGeneratorError,
  titlePromptOpen,
  updateTitleGeneratorField,
  setTitleGenerator,
  setTitlePromptOpen,
  onGenerateTitles,
  onLoadTitleGeneratorHistory,
}: {
  productFactsCount: number;
  titleGenerator: TitleGeneratorDraft;
  titleGenerating: boolean;
  titleGeneratorError: string;
  titlePromptOpen: boolean;
  updateTitleGeneratorField: (
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) => void;
  setTitleGenerator: Dispatch<SetStateAction<TitleGeneratorDraft>>;
  setTitlePromptOpen: Dispatch<SetStateAction<boolean>>;
  onGenerateTitles: () => void;
  onLoadTitleGeneratorHistory: (record: TitleGeneratorHistoryRecord) => void;
}) {
  return (
    <div className="space-y-3">
      <TitleGeneratorCard
        generator={titleGenerator}
        loading={titleGenerating}
        error={titleGeneratorError}
        promptOpen={titlePromptOpen}
        productFactsCount={productFactsCount}
        onFieldChange={updateTitleGeneratorField}
        onGeneratorChange={setTitleGenerator}
        onPromptOpenChange={setTitlePromptOpen}
        onGenerate={onGenerateTitles}
        onLoadHistory={onLoadTitleGeneratorHistory}
      />
    </div>
  );
}
