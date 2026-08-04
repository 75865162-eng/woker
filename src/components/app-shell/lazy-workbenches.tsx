"use client";

import dynamic from "next/dynamic";

function WorkbenchLoading() {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-white p-5 shadow-sm">
      <div className="h-4 w-36 animate-pulse rounded bg-surface-muted" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-md bg-surface-muted" />
        <div className="h-24 animate-pulse rounded-md bg-surface-muted" />
        <div className="h-24 animate-pulse rounded-md bg-surface-muted" />
      </div>
    </div>
  );
}

const loading = () => <WorkbenchLoading />;

export const CampaignGridHome = dynamic(
  () => import("@/components/workspace/campaign-grid-home").then((module) => module.CampaignGridHome),
  { loading, ssr: false },
);

export const WorkspacePanel = dynamic(
  () => import("@/components/workspace/workspace-panel").then((module) => module.WorkspacePanel),
  { loading, ssr: false },
);

export const RulesEditorShell = dynamic(
  () => import("@/components/rule-builder/rules-editor-shell").then((module) => module.RulesEditorShell),
  { loading, ssr: false },
);

export const ProductWorkbench = dynamic(
  () => import("@/components/products/product-workbench").then((module) => module.ProductWorkbench),
  { loading, ssr: false },
);

export const ListingAiWorkbench = dynamic(
  () => import("@/components/listing-ai/listing-ai-workbench").then((module) => module.ListingAiWorkbench),
  { loading, ssr: false },
);

export const LogisticsWorkbench = dynamic(
  () => import("@/components/logistics/logistics-workbench").then((module) => module.LogisticsWorkbench),
  { loading, ssr: false },
);

export const SettingsWorkbench = dynamic(
  () => import("@/components/settings/settings-workbench").then((module) => module.SettingsWorkbench),
  { loading, ssr: false },
);

export const AccountWorkbench = dynamic(
  () => import("@/components/accounts/account-workbench").then((module) => module.AccountWorkbench),
  { loading, ssr: false },
);

export const TaskCenterWorkbench = dynamic(
  () => import("@/components/tasks/task-center-workbench").then((module) => module.TaskCenterWorkbench),
  { loading, ssr: false },
);

export const VersionHistoryWorkbench = dynamic(
  () => import("@/components/versions/version-history-workbench").then((module) => module.VersionHistoryWorkbench),
  { loading, ssr: false },
);

export const ImageUpscaleWorkbench = dynamic(
  () => import("@/components/image-upscale/image-upscale-workbench").then((module) => module.ImageUpscaleWorkbench),
  { loading, ssr: false },
);

export const SaihuSearchMergeWorkbench = dynamic(
  () => import("@/components/saihu-search-merge/saihu-search-merge-workbench").then((module) => module.SaihuSearchMergeWorkbench),
  { loading, ssr: false },
);

export const SaihuSearchMergeHistory = dynamic(
  () => import("@/components/saihu-search-merge/saihu-search-merge-history").then((module) => module.SaihuSearchMergeHistory),
  { loading, ssr: false },
);
