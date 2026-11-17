"use client";

import { create } from "zustand";
import type { WorkspaceState } from "./workspace-state";
import { createCampaignSlice } from "./workspace-campaign-slice";
import { createRulesDraftsSlice } from "./workspace-rules-drafts-slice";
import { createBulkImportSlice } from "./workspace-bulk-import-slice";
import { createOverallAdDataSlice } from "./workspace-overall-ad-data-slice";
import { createPersistenceSlice } from "./workspace-persistence-slice";
import { initializeWorkspacePersistence } from "./workspace-store-persistence";
export const useWorkspaceStore = create<WorkspaceState>((set, get, api) => ({
...createCampaignSlice(set, get, api),
...createRulesDraftsSlice(set, get, api),
...createBulkImportSlice(set, get, api),
...createOverallAdDataSlice(set, get, api),
...createPersistenceSlice(set, get, api)
}));

export function initializeWorkspaceStorePersistence() { initializeWorkspacePersistence(useWorkspaceStore); }
