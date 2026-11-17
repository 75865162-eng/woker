"use client";

import { writeWorkspaceSnapshot } from "@/lib/repositories/workspace-repository";
import { takeWorkspaceSnapshot } from "@/lib/workspace/workspace-snapshot";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { StoreApi } from "zustand";
import type { WorkspaceState } from "./workspace-state";

const initializedStores = new WeakMap<StoreApi<WorkspaceState>, () => void>();

export function initializeWorkspacePersistence(store: StoreApi<WorkspaceState>) {
  if (typeof window === "undefined") return;
  const existingCleanup = initializedStores.get(store);
  if (existingCleanup) return existingCleanup;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let hydrated = false;
  let revision = 0;
  let disposed = false;
  let hydrationController: AbortController | undefined;
  const eventTarget = window;

  function hydrate(reset: boolean) {
    hydrationController?.abort();
    hydrationController = new AbortController();
    const currentRevision = ++revision;
    hydrated = false;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = undefined;
    if (reset) store.setState({ ...store.getInitialState(), persistenceStatus: "loading" }, true);
    void store.getState().hydratePersistedWorkspace(hydrationController.signal).finally(() => {
      if (!disposed && currentRevision === revision && store.getState().persistenceStatus !== "failed") hydrated = true;
    });
  }

  const unsubscribe = store.subscribe((state, previousState) => {
    if (!hydrated || state.persistenceStatus === "loading") return;
    const shouldSave =
      state.campaignGroups !== previousState.campaignGroups ||
      state.rules !== previousState.rules ||
      state.workspaceUnits !== previousState.workspaceUnits ||
      state.performanceRows !== previousState.performanceRows ||
      state.activeCampaignGroupId !== previousState.activeCampaignGroupId ||
      state.activeLifecycleGroupId !== previousState.activeLifecycleGroupId ||
      state.workspaceMode !== previousState.workspaceMode ||
      state.openTabIds !== previousState.openTabIds ||
      state.selectedDraftIds !== previousState.selectedDraftIds ||
      state.parseStatus !== previousState.parseStatus ||
      state.parseProgress !== previousState.parseProgress ||
      state.uploadedFileName !== previousState.uploadedFileName ||
      state.originalWorkbookFileId !== previousState.originalWorkbookFileId ||
      state.originalWorkbookFileName !== previousState.originalWorkbookFileName ||
      state.originalWorkbookBuffer !== previousState.originalWorkbookBuffer ||
      state.activeBatchId !== previousState.activeBatchId ||
      state.parsedRowCount !== previousState.parsedRowCount ||
      state.parsedSheets !== previousState.parsedSheets ||
      state.parseError !== previousState.parseError ||
      state.parseDiagnostics !== previousState.parseDiagnostics ||
      state.overallAdDataFileName !== previousState.overallAdDataFileName ||
      state.overallAdDataRows !== previousState.overallAdDataRows ||
      state.overallAdDataStatus !== previousState.overallAdDataStatus ||
      state.overallAdDataError !== previousState.overallAdDataError ||
      state.overallAdDataMatchSummary !== previousState.overallAdDataMatchSummary ||
      state.overallAdDataUploads !== previousState.overallAdDataUploads ||
      state.adjustmentDrafts !== previousState.adjustmentDrafts ||
      state.pendingAdjustmentDrafts !== previousState.pendingAdjustmentDrafts ||
      state.exportHistoryRecords !== previousState.exportHistoryRecords ||
      state.ruleRunHistoryRecords !== previousState.ruleRunHistoryRecords ||
      state.blockedCampaignIdentities !== previousState.blockedCampaignIdentities;

    if (!shouldSave) {
      return;
    }


    if (saveTimer !== undefined) clearTimeout(saveTimer);
    const currentRevision = revision;
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      if (!hydrated || currentRevision !== revision) return;
      store.setState({ persistenceStatus: "saving", persistenceError: undefined });
      void writeWorkspaceSnapshot(takeWorkspaceSnapshot(store.getState()))
        .then(() => {
          if (currentRevision === revision) store.setState({ persistenceStatus: "saved", persistenceError: undefined });
        })
        .catch((error: unknown) => {
          if (currentRevision !== revision) return;
          store.setState({ persistenceStatus: "failed", persistenceError: error instanceof Error ? error.message : "自动保存失败。" });
        });
    }, 500);
  });
  const onScopeChanged = () => hydrate(true);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    hydrationController?.abort();
    hydrated = false;
    ++revision;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = undefined;
    unsubscribe();
    eventTarget.removeEventListener(workspaceScopeChangedEventName, onScopeChanged);
    initializedStores.delete(store);
  };
  initializedStores.set(store, cleanup);
  eventTarget.addEventListener(workspaceScopeChangedEventName, onScopeChanged);
  hydrate(false);
  return cleanup;
}
