"use client";

import { useState } from "react";
import { createBrowserId } from "@/lib/browser/random-id";
import { createTitleGeneratorModeDraft, initialDescriptionGenerator, initialTitleGenerator, type DescriptionGeneratorDraft, type DescriptionGeneratorFieldKey, type DescriptionGeneratorHistoryRecord, type TitleGeneratorDraft, type TitleGeneratorField, type TitleGeneratorFieldKey, type TitleGeneratorMode, type TitleGeneratorHistoryRecord } from "@/lib/listing-ai/workspace-draft";
import { aiSettingsStorageKey } from "@/lib/ai-settings";
import { readLocalAiSettings, mergeTitleGeneratorFields, mergeDescriptionGeneratorFields, readListingAiGenerationResponse } from "./listing-ai-workspace-runtime";

export function useListingAiTextGeneration() {
const [titleGenerator, setTitleGenerator] = useState<TitleGeneratorDraft>(
    initialTitleGenerator,
  );

const [descriptionGenerator, setDescriptionGenerator] =
    useState<DescriptionGeneratorDraft>(initialDescriptionGenerator);

const [titlePromptOpen, setTitlePromptOpen] = useState(false);

const [descriptionPromptOpen, setDescriptionPromptOpen] = useState(false);

const [titleGenerating, setTitleGenerating] = useState(false);

const [descriptionGenerating, setDescriptionGenerating] = useState(false);

const [titleGeneratorError, setTitleGeneratorError] = useState("");

const [descriptionGeneratorError, setDescriptionGeneratorError] =
    useState("");

const activeTitleGeneratorModeDraft =
    titleGenerator.modes[titleGenerator.mode] ??
    createTitleGeneratorModeDraft();

const activeTitleGenerator: TitleGeneratorDraft = {
    ...titleGenerator,
    fields: activeTitleGeneratorModeDraft.fields,
    results: activeTitleGeneratorModeDraft.results,
    history: activeTitleGeneratorModeDraft.history,
  };

const descriptionSharedFields = activeTitleGenerator.fields.filter((field) =>
    ["productFeatures", "coreAdWords", "relatedKeywords", "adData"].includes(
      field.key,
    ),
  );

function updateTitleGeneratorField(
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) {
    setTitleGenerator((current) => ({
      ...current,
      fields: current.modes[current.mode].fields.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
      modes: {
        ...current.modes,
        [current.mode]: {
          ...current.modes[current.mode],
          fields: current.modes[current.mode].fields.map((field) =>
            field.key === key ? { ...field, ...patch } : field,
          ),
        },
      },
    }));
  }

function updateTitleGeneratorMode(mode: TitleGeneratorMode) {
    setTitleGenerator((current) => ({
      ...current,
      mode,
      fields: current.modes[mode].fields,
      results: current.modes[mode].results,
      history: current.modes[mode].history,
    }));
    setTitleGeneratorError("");
  }

function updateDescriptionGeneratorField(
    key: DescriptionGeneratorFieldKey,
    value: string,
  ) {
    setDescriptionGenerator((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.key === key ? { ...field, value } : field,
      ),
    }));
  }

function loadTitleGeneratorHistory(record: TitleGeneratorHistoryRecord) {
    const mode = record.mode === "new" ? "new" : "old";

    setTitleGenerator((current) => ({
      ...current,
      mode,
      fields: mergeTitleGeneratorFields(record.fields),
      prompt: record.prompt,
      results: record.results,
      history: current.modes[mode].history,
      modes: {
        ...current.modes,
        [mode]: {
          ...current.modes[mode],
          fields: mergeTitleGeneratorFields(record.fields),
          results: record.results,
        },
      },
    }));
    setTitleGeneratorError("");
  }

function loadDescriptionGeneratorHistory(
    record: DescriptionGeneratorHistoryRecord,
  ) {
    if (titleGenerator.mode !== record.mode) {
      updateTitleGeneratorMode(record.mode);
    }
    setDescriptionGenerator((current) => ({
      ...current,
      prompt: record.prompt,
      fields: mergeDescriptionGeneratorFields(record.fields),
      results: record.results,
      history: [
        {
          ...record,
          fields: mergeDescriptionGeneratorFields(record.fields),
        },
        ...current.history.filter((item) => item.id !== record.id),
      ].slice(0, 30),
    }));
    setDescriptionGeneratorError("");
  }

async function handleGenerateTitles() {
    const fields = activeTitleGenerator.fields;
    const productChineseName = fields
      .find((field) => field.key === "productChineseName")
      ?.value.trim();
    const asin = fields.find((field) => field.key === "asin")?.value.trim();
    const hasReference = fields.some(
      (field) =>
        field.key !== "productChineseName" &&
        field.key !== "asin" &&
        field.value.trim(),
    );

    if (!productChineseName) {
      setTitleGeneratorError("请先填写中文名称。");
      return;
    }
    if (titleGenerator.mode === "old" && !asin) {
      setTitleGeneratorError("老品优化模式必须填写 ASIN。");
      return;
    }
    if (!hasReference) {
      setTitleGeneratorError("请至少填写一项参考资料，例如产品特点、核心广告词或关键词。");
      return;
    }
    if (!activeTitleGenerator.prompt.trim()) {
      setTitleGeneratorError("标题提示词不能为空，请打开“提示词修改”检查。");
      return;
    }

    setTitleGenerating(true);
    setTitleGeneratorError("");

    try {
      const aiSettings = readLocalAiSettings(aiSettingsStorageKey);
      const response = await fetch("/api/listing-ai/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...activeTitleGenerator,
          aiSettings: aiSettings ?? undefined,
        }),
      });
      const data = await readListingAiGenerationResponse(response);

      if (!response.ok || !data.results?.length)
        throw new Error(data.error || "标题生成失败");

      const nextResults = data.results!.slice(0, 3);
      setTitleGenerator((current) => {
        const currentModeDraft = current.modes[current.mode];
        const record: TitleGeneratorHistoryRecord = {
          id: createBrowserId(),
          createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          mode: current.mode,
          fields: currentModeDraft.fields.map((field) => ({ ...field })),
          prompt: current.prompt,
          results: nextResults,
        };
        const nextModeDraft = {
          ...currentModeDraft,
          results: nextResults,
          history: [record, ...currentModeDraft.history].slice(0, 30),
        };

        return {
          ...current,
          fields: nextModeDraft.fields,
          results: nextResults,
          history: nextModeDraft.history,
          modes: {
            ...current.modes,
            [current.mode]: nextModeDraft,
          },
        };
      });
    } catch (err) {
      setTitleGeneratorError(
        err instanceof Error ? err.message : "标题生成失败",
      );
    } finally {
      setTitleGenerating(false);
    }
  }

async function handleGenerateDescriptions() {
    const hasSharedReference = activeTitleGenerator.fields.some(
      (field) =>
        ["productFeatures", "coreAdWords", "relatedKeywords", "adData"].includes(
          field.key,
        ) && field.value.trim(),
    );
    const hasCompetitorDescription = descriptionGenerator.fields.some((field) =>
      field.value.trim(),
    );

    if (!hasSharedReference) {
      setDescriptionGeneratorError("请先在上方填写至少一项产品特点、广告词、关键词或广告数据。");
      return;
    }
    if (!hasCompetitorDescription) {
      setDescriptionGeneratorError("请至少填写一条竞品描述参考。");
      return;
    }
    if (!descriptionGenerator.prompt.trim()) {
      setDescriptionGeneratorError("描述提示词不能为空，请打开“提示词修改”检查。");
      return;
    }

    setDescriptionGenerating(true);
    setDescriptionGeneratorError("");

    try {
      const aiSettings = readLocalAiSettings(aiSettingsStorageKey);
      const response = await fetch("/api/listing-ai/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: titleGenerator.mode,
          prompt: descriptionGenerator.prompt,
          titleFields: activeTitleGenerator.fields,
          descriptionFields: descriptionGenerator.fields,
          aiSettings: aiSettings ?? undefined,
        }),
      });
      const data = await readListingAiGenerationResponse(response);

      if (!response.ok || !data.results?.length)
        throw new Error(data.error || "五点描述生成失败");

      const nextResults = data.results!.slice(0, 5);
      setDescriptionGenerator((current) => {
        const record: DescriptionGeneratorHistoryRecord = {
          id: createBrowserId(),
          createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          mode: titleGenerator.mode,
          fields: current.fields.map((field) => ({ ...field })),
          prompt: current.prompt,
          results: nextResults,
        };

        return {
          ...current,
          results: nextResults,
          history: [record, ...current.history].slice(0, 30),
        };
      });
    } catch (err) {
      setDescriptionGeneratorError(
        err instanceof Error ? err.message : "五点描述生成失败",
      );
    } finally {
      setDescriptionGenerating(false);
    }
  }
return { titleGenerator, setTitleGenerator, descriptionGenerator, setDescriptionGenerator, titlePromptOpen, setTitlePromptOpen, descriptionPromptOpen, setDescriptionPromptOpen, titleGenerating, descriptionGenerating, titleGeneratorError, descriptionGeneratorError, activeTitleGenerator, descriptionSharedFields, updateTitleGeneratorField, updateTitleGeneratorMode, updateDescriptionGeneratorField, loadTitleGeneratorHistory, loadDescriptionGeneratorHistory, handleGenerateTitles, handleGenerateDescriptions };
}
