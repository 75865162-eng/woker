"use client";

import { useSearchParams } from "next/navigation";
import { BarChart3, History, ImageIcon, ImageUp, Layers3, MessageSquarePlus, Search, Sparkles } from "lucide-react";
import { WorkbenchPageTemplate } from "@/components/templates/page-templates";
import { Card, CardContent } from "@/components/ui/card";
import { ImageUpscaleWorkbench } from "@/components/image-upscale/image-upscale-workbench";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { ListingAiChatPanel } from "@/components/listing-ai/listing-ai-chat-panel";
import { ListingAiInputPanel } from "@/components/listing-ai/listing-ai-input-panel";
import { AnalysisSection, ImagePlanSection, ListingSection } from "@/components/listing-ai/listing-ai-output-panels";
import { ReviewHistorySection } from "@/components/listing-ai/review-history-section";
import { type TabId } from "@/lib/listing-ai/workspace-draft";
import { useListingAiWorkbench } from "./use-listing-ai-workbench";
import { VisualAplusSection } from "./listing-ai-visual-section";
const tabs = [
  { id: "input", label: "标题描述", icon: Search },
  { id: "visual", label: "Images & A+", icon: ImageIcon },
  { id: "analysis", label: "AI Analysis", icon: BarChart3 },
  { id: "listing", label: "Listing", icon: Sparkles },
  { id: "imagePlan", label: "Image Plan", icon: Layers3 },
  { id: "chat", label: "对话", icon: MessageSquarePlus },
  { id: "review", label: "Review & History", icon: History },
  { id: "upscale", label: "图片放大", icon: ImageUp },
] as const;

function normalizeTabId(tab: string | null): TabId | null {
  if (!tab) return null;
  if (tab === "image-upscale") return "upscale";

  return tabs.some((item) => item.id === tab) ? (tab as TabId) : null;
}

export function ListingAiWorkbench() {
  const shellUser = useAppShellUser();
  const canGenerateListing = roleCanPerformAction(shellUser?.userRole, "listingAi", "create", shellUser?.rolePermissions);
  const searchParams = useSearchParams();
  const requestedTab = normalizeTabId(searchParams.get("tab"));
  const { activeTab, setActiveTab, activeTitleGenerator, descriptionGenerator, descriptionSharedFields, titleGenerating, descriptionGenerating, titleGeneratorError, descriptionGeneratorError, titlePromptOpen, descriptionPromptOpen, updateTitleGeneratorMode, updateTitleGeneratorField, updateDescriptionGeneratorField, setTitleGenerator, setDescriptionGenerator, setTitlePromptOpen, setDescriptionPromptOpen, handleGenerateTitles, handleGenerateDescriptions, loadTitleGeneratorHistory, loadDescriptionGeneratorHistory, competitors, ownImages, setCompetitors, setOwnImages, cellStyles, setCellStyles, input, update, error, canSubmit, loading, handleOptimize, result, handleImageUpload, copied, copyText, imageGenerator, imageGenerating, imageGeneratorError, setImageGenerator, handleRunImageGenerator, records, loadRecord } = useListingAiWorkbench(requestedTab, canGenerateListing);
return (
    <WorkbenchPageTemplate
      context={<Card>
        <CardContent className="overflow-x-auto p-2">
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`flex h-10 items-center gap-2 rounded-md px-4 text-sm font-bold transition ${
                    active
                      ? "bg-brand text-white"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>}

      main={<main>
        {activeTab === "input" ? (
          <ListingAiInputPanel
            titleGenerator={activeTitleGenerator}
            descriptionGenerator={descriptionGenerator}
            descriptionSharedFields={descriptionSharedFields}
            titleGenerating={titleGenerating}
            descriptionGenerating={descriptionGenerating}
            titleGeneratorError={titleGeneratorError}
            descriptionGeneratorError={descriptionGeneratorError}
            titlePromptOpen={titlePromptOpen}
            descriptionPromptOpen={descriptionPromptOpen}
            updateTitleGeneratorMode={updateTitleGeneratorMode}
            updateTitleGeneratorField={updateTitleGeneratorField}
            updateDescriptionGeneratorField={updateDescriptionGeneratorField}
            setTitleGenerator={setTitleGenerator}
            setDescriptionGenerator={setDescriptionGenerator}
            setTitlePromptOpen={setTitlePromptOpen}
            setDescriptionPromptOpen={setDescriptionPromptOpen}
            onGenerateTitles={handleGenerateTitles}
            onGenerateDescriptions={handleGenerateDescriptions}
            canGenerate={canGenerateListing}
            onLoadTitleGeneratorHistory={loadTitleGeneratorHistory}
            onLoadDescriptionGeneratorHistory={loadDescriptionGeneratorHistory}
          />
        ) : null}
        {activeTab === "visual" ? (
          <VisualAplusSection
            competitors={competitors}
            ownImages={ownImages}
            setCompetitors={setCompetitors}
            setOwnImages={setOwnImages}
            cellStyles={cellStyles}
            setCellStyles={setCellStyles}
            input={input}
            update={update}
            error={error}
            canSubmit={canSubmit}
            loading={loading}
            onGenerate={handleOptimize}
            result={result}
            handleImageUpload={handleImageUpload}
          />
        ) : null}
        {activeTab === "analysis" ? (
          <AnalysisSection
            result={result}
            loading={loading}
            error={error}
            canSubmit={canSubmit}
            onGenerate={handleOptimize}
          />
        ) : null}
        {activeTab === "listing" ? (
          <ListingSection result={result} copied={copied} copyText={copyText} />
        ) : null}
        {activeTab === "imagePlan" ? (
          <ImagePlanSection
            result={result}
            copied={copied}
            copyText={copyText}
            imageGenerator={imageGenerator}
            imageGenerating={imageGenerating}
            imageGeneratorError={imageGeneratorError}
            setImageGenerator={setImageGenerator}
            handleImageUpload={handleImageUpload}
            onRunImageGenerator={handleRunImageGenerator}
          />
        ) : null}
        {activeTab === "chat" ? <ListingAiChatPanel /> : null}
        {activeTab === "review" ? (
          <ReviewHistorySection
            result={result}
            records={records}
            onLoad={loadRecord}
          />
        ) : null}
        {activeTab === "upscale" ? <ImageUpscaleWorkbench /> : null}
      </main>}
    />
  );
}
