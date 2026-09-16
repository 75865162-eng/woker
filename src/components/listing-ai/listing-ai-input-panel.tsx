"use client";

import type { Dispatch, SetStateAction } from "react";
import { DescriptionGeneratorCard } from "@/components/listing-ai/description-generator-card";
import { TitleGeneratorCard } from "@/components/listing-ai/title-generator-card";
import type {
  DescriptionGeneratorDraft,
  DescriptionGeneratorFieldKey,
  DescriptionGeneratorHistoryRecord,
  TitleGeneratorDraft,
  TitleGeneratorField,
  TitleGeneratorFieldKey,
  TitleGeneratorMode,
  TitleGeneratorHistoryRecord,
} from "@/lib/listing-ai/workspace-draft";

export function ListingAiInputPanel({
  titleGenerator,
  descriptionGenerator,
  descriptionSharedFields,
  titleGenerating,
  descriptionGenerating,
  titleGeneratorError,
  descriptionGeneratorError,
  titlePromptOpen,
  descriptionPromptOpen,
  updateTitleGeneratorMode,
  updateTitleGeneratorField,
  updateDescriptionGeneratorField,
  setTitleGenerator,
  setDescriptionGenerator,
  setTitlePromptOpen,
  setDescriptionPromptOpen,
  onGenerateTitles,
  onGenerateDescriptions,
  onLoadTitleGeneratorHistory,
  onLoadDescriptionGeneratorHistory,
}: {
  titleGenerator: TitleGeneratorDraft;
  descriptionGenerator: DescriptionGeneratorDraft;
  descriptionSharedFields: TitleGeneratorField[];
  titleGenerating: boolean;
  descriptionGenerating: boolean;
  titleGeneratorError: string;
  descriptionGeneratorError: string;
  titlePromptOpen: boolean;
  descriptionPromptOpen: boolean;
  updateTitleGeneratorMode: (mode: TitleGeneratorMode) => void;
  updateTitleGeneratorField: (
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) => void;
  updateDescriptionGeneratorField: (
    key: DescriptionGeneratorFieldKey,
    value: string,
  ) => void;
  setTitleGenerator: Dispatch<SetStateAction<TitleGeneratorDraft>>;
  setDescriptionGenerator: Dispatch<SetStateAction<DescriptionGeneratorDraft>>;
  setTitlePromptOpen: Dispatch<SetStateAction<boolean>>;
  setDescriptionPromptOpen: Dispatch<SetStateAction<boolean>>;
  onGenerateTitles: () => void;
  onGenerateDescriptions: () => void;
  onLoadTitleGeneratorHistory: (record: TitleGeneratorHistoryRecord) => void;
  onLoadDescriptionGeneratorHistory: (
    record: DescriptionGeneratorHistoryRecord,
  ) => void;
}) {
  return (
    <div className="space-y-3">
      <TitleGeneratorCard
        generator={titleGenerator}
        loading={titleGenerating}
        error={titleGeneratorError}
        promptOpen={titlePromptOpen}
        onModeChange={updateTitleGeneratorMode}
        onFieldChange={updateTitleGeneratorField}
        onGeneratorChange={setTitleGenerator}
        onPromptOpenChange={setTitlePromptOpen}
        onGenerate={onGenerateTitles}
        onLoadHistory={onLoadTitleGeneratorHistory}
      />
      <DescriptionGeneratorCard
        generator={descriptionGenerator}
        sharedFields={descriptionSharedFields}
        mode={titleGenerator.mode}
        loading={descriptionGenerating}
        error={descriptionGeneratorError}
        promptOpen={descriptionPromptOpen}
        onFieldChange={updateDescriptionGeneratorField}
        onGeneratorChange={setDescriptionGenerator}
        onPromptOpenChange={setDescriptionPromptOpen}
        onGenerate={onGenerateDescriptions}
        onLoadHistory={onLoadDescriptionGeneratorHistory}
      />
    </div>
  );
}
