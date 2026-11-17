"use client";

import { useEffect, useState } from "react";
import type { ListingOptimizationRequest } from "@/lib/listing-ai/types";
import { type TitleGeneratorDraft, type DescriptionGeneratorDraft, createPersistableDraft, defaultImageGeneratorPrompt, initialCompetitors, initialImageGenerator, initialInput, type CompetitorDraft, type GalleryCellStyle, type ImageGeneratorDraft, type OwnImageDraft, type SavedRecord, type TabId, type WorkspaceDraft } from "@/lib/listing-ai/workspace-draft";
import { aiImageSettingsStorageKey, aiSettingsStorageKey, type AiModelSettings } from "@/lib/ai-settings";
import { hydrateCompetitorDraft, hydrateOwnImageDraft, hydrateImageGeneratorDraft, stripCompetitorImages, stripOwnImageDraftImages, stripImageGeneratorDraftImages, normalizeTitleGeneratorDraft, normalizeDescriptionGeneratorDraft, saveListingAiWorkspace } from "./listing-ai-workspace-runtime";

export function useListingAiWorkspacePersistence({ requestedTab, activeTab, setActiveTab, input, setInput, competitors, setCompetitors, ownImages, setOwnImages, titleGenerator, setTitleGenerator, descriptionGenerator, setDescriptionGenerator, imageGenerator, setImageGenerator, cellStyles, setCellStyles, records, setRecords }: { requestedTab: TabId | null; activeTab: TabId; setActiveTab: React.Dispatch<React.SetStateAction<TabId>>; input: ListingOptimizationRequest; setInput: React.Dispatch<React.SetStateAction<ListingOptimizationRequest>>; competitors: CompetitorDraft[]; setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>; ownImages: OwnImageDraft; setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>; titleGenerator: TitleGeneratorDraft; setTitleGenerator: React.Dispatch<React.SetStateAction<TitleGeneratorDraft>>; descriptionGenerator: DescriptionGeneratorDraft; setDescriptionGenerator: React.Dispatch<React.SetStateAction<DescriptionGeneratorDraft>>; imageGenerator: ImageGeneratorDraft; setImageGenerator: React.Dispatch<React.SetStateAction<ImageGeneratorDraft>>; cellStyles: Record<string, GalleryCellStyle>; setCellStyles: React.Dispatch<React.SetStateAction<Record<string, GalleryCellStyle>>>; records: SavedRecord[]; setRecords: React.Dispatch<React.SetStateAction<SavedRecord[]>> }) {
const [draftReady, setDraftReady] = useState(false);

useEffect(() => {
    let cancelled = false;

    async function syncAiSettingsCache() {
      try {
        const response = await fetch("/api/ai-settings", { cache: "no-store" });

        if (!response.ok) return;

        const data = (await response.json()) as {
          settings?: Partial<AiModelSettings> | null;
          imageSettings?: Partial<AiModelSettings> | null;
        };

        if (cancelled) return;
        if (data.settings) {
          window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify(data.settings));
        }
        if (data.imageSettings) {
          window.localStorage.setItem(aiImageSettingsStorageKey, JSON.stringify(data.imageSettings));
        }
      } catch (error) {
        console.warn("Failed to sync Listing AI settings cache.", error);
      }
    }

    async function applyWorkspaceDraft(draft: Partial<WorkspaceDraft>) {
      if (draft.input && !cancelled) setInput({ ...initialInput, ...draft.input });
      if (draft.titleGenerator && !cancelled) {
        setTitleGenerator(normalizeTitleGeneratorDraft(draft.titleGenerator));
      }
      if (draft.descriptionGenerator && !cancelled) {
        setDescriptionGenerator(
          normalizeDescriptionGeneratorDraft(draft.descriptionGenerator),
        );
      }
      if (draft.galleryCellStyles && !cancelled) {
        setCellStyles(draft.galleryCellStyles);
      }
      if (draft.activeTab && !cancelled && !requestedTab) {
        setActiveTab(draft.activeTab);
      }

      if (draft.competitors && !cancelled) {
        setCompetitors(
          initialCompetitors.map((emptyCompetitor, index) =>
            stripCompetitorImages({
              ...emptyCompetitor,
              ...draft.competitors?.[index],
            }),
          ),
        );
      }

      if (draft.ownImages && !cancelled) {
        const emptyOwnImages: OwnImageDraft = {
          structureNotes: "",
          mainImage: [],
          images: [],
          imageNotes: [],
          sales: "",
          price: "",
          rating: "",
          reviewCount: "",
        };
        setOwnImages(
          stripOwnImageDraftImages({
            ...emptyOwnImages,
            ...draft.ownImages,
          }),
        );
      }

      if (draft.imageGenerator && !cancelled) {
        setImageGenerator(
          stripImageGeneratorDraftImages({
            ...initialImageGenerator,
            ...draft.imageGenerator,
            ownViews: {
              ...initialImageGenerator.ownViews,
              ...draft.imageGenerator.ownViews,
            },
            competitorImages: Array.isArray(
              draft.imageGenerator.competitorImages,
            )
              ? draft.imageGenerator.competitorImages
              : [],
            generatedImages: Array.isArray(draft.imageGenerator.generatedImages)
              ? draft.imageGenerator.generatedImages
              : [],
            history: Array.isArray(draft.imageGenerator.history)
              ? draft.imageGenerator.history
              : [],
            prompt: draft.imageGenerator.prompt?.trim()
              ? draft.imageGenerator.prompt
              : defaultImageGeneratorPrompt,
          }),
        );
      }

      const restoreImages = async () => {
        if (cancelled) return;

        if (draft.competitors) {
          const restoredCompetitors = await Promise.all(
            initialCompetitors.map((emptyCompetitor, index) =>
              hydrateCompetitorDraft({
                ...emptyCompetitor,
                ...draft.competitors?.[index],
              }),
            ),
          );
          if (!cancelled) setCompetitors(restoredCompetitors);
        }

        if (draft.ownImages) {
          const emptyOwnImages: OwnImageDraft = {
            structureNotes: "",
            mainImage: [],
            images: [],
            imageNotes: [],
            sales: "",
            price: "",
            rating: "",
            reviewCount: "",
          };
          const restoredOwnImages = await hydrateOwnImageDraft({
            ...emptyOwnImages,
            ...draft.ownImages,
          });
          if (!cancelled) setOwnImages(restoredOwnImages);
        }

        if (draft.imageGenerator) {
          const restoredImageGenerator = await hydrateImageGeneratorDraft({
            ...initialImageGenerator,
            ...draft.imageGenerator,
            ownViews: {
              ...initialImageGenerator.ownViews,
              ...draft.imageGenerator.ownViews,
            },
            competitorImages: Array.isArray(
              draft.imageGenerator.competitorImages,
            )
              ? draft.imageGenerator.competitorImages
              : [],
            generatedImages: Array.isArray(draft.imageGenerator.generatedImages)
              ? draft.imageGenerator.generatedImages
              : [],
            history: Array.isArray(draft.imageGenerator.history)
              ? draft.imageGenerator.history
              : [],
            prompt: draft.imageGenerator.prompt?.trim()
              ? draft.imageGenerator.prompt
              : defaultImageGeneratorPrompt,
          });
          if (!cancelled) setImageGenerator(restoredImageGenerator);
        }
      };

      const waitForIdle = () =>
        new Promise<void>((resolve) => {
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => resolve());
            return;
          }

          window.setTimeout(resolve, 0);
        });

      await waitForIdle();
      await restoreImages();
    }

    async function restoreDraft() {
      try {
        const response = await fetch("/api/listing-ai/workspace");

        if (!response.ok) {
          throw new Error("无法从数据库读取 Listing AI 工作区。");
        }

        const data = (await response.json()) as {
          draft?: Partial<WorkspaceDraft> | null;
          records?: SavedRecord[];
        };

        if (data.records?.length && !cancelled) {
          setRecords(data.records);
        }

        if (data.draft) {
          await applyWorkspaceDraft(data.draft);
          return;
        }
      } catch (storageError) {
        console.warn("Failed to restore Listing AI draft.", storageError);
      } finally {
        if (!cancelled) setDraftReady(true);
      }
    }

    if (requestedTab) {
      setActiveTab(requestedTab);
    }

    void syncAiSettingsCache();
    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, [requestedTab, setActiveTab, setCellStyles, setCompetitors, setDescriptionGenerator, setImageGenerator, setInput, setOwnImages, setRecords, setTitleGenerator]);

useEffect(() => {
    if (!draftReady) return;
    const draft: WorkspaceDraft = {
      input,
      competitors,
      ownImages,
      titleGenerator,
      descriptionGenerator,
      imageGenerator,
      galleryCellStyles: cellStyles,
      activeTab,
    };
    try {
      const persistableDraft = createPersistableDraft(draft);
      const timeout = window.setTimeout(() => {
        void saveListingAiWorkspace(persistableDraft, records).then(
          undefined,
          (saveError: unknown) => {
            console.warn("Failed to sync Listing AI workspace.", saveError);
          },
        );
      }, 700);

      return () => window.clearTimeout(timeout);
    } catch (storageError) {
      console.warn("Failed to persist Listing AI draft.", storageError);
    }
  }, [activeTab, cellStyles, competitors, draftReady, imageGenerator, input, ownImages, records, descriptionGenerator, titleGenerator]);

}
