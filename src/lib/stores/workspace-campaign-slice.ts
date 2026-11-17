"use client";

import { buildBlockedCampaignIdentityId, buildSheetGroups, buildWorkspaceUnitName, buildWorkspaceUnitsFromGroupingRows, createWorkspaceUnitId, detachCampaignGroupFromWorkspaceUnits, findWorkspaceUnitByCampaignGroupId, parseCsv, rebuildWorkspaceUnits, upsertWorkspaceUnitForCampaign } from "@/lib/workspace/workspace-import";
import { initialCampaignGroups, initialPerformanceRows, initialActiveId } from "./workspace-store-defaults";
import type { WorkspaceSlice } from "./workspace-state";
export const createCampaignSlice: WorkspaceSlice<"campaignGroups" | "campaignSheetGroups" | "workspaceUnits" | "performanceRows" | "activeCampaignGroupId" | "activeWorkspaceUnitId" | "activeLifecycleGroupId" | "workspaceMode" | "openTabIds" | "blockedCampaignIdentities" | "setActiveCampaignGroup" | "openCampaignGroup" | "mergeCampaignGroupsIntoWorkspaceUnit" | "removeCampaignGroupFromWorkspaceUnit" | "setActiveWorkspaceUnit" | "setActiveLifecycleGroup" | "assignLifecycleGroup" | "clearLifecycleGroup" | "blockCampaignGroup" | "unblockCampaignIdentity" | "importGroupingStatusCsv"> = (set, get) => ({
campaignGroups: initialCampaignGroups,
campaignSheetGroups: buildSheetGroups(initialCampaignGroups),
workspaceUnits: [],
performanceRows: initialPerformanceRows,
activeCampaignGroupId: initialActiveId,
activeWorkspaceUnitId: undefined,
activeLifecycleGroupId: undefined,
workspaceMode: "campaign",
openTabIds: initialCampaignGroups.slice(0, 4).map((group) => group.id),
blockedCampaignIdentities: [],
setActiveCampaignGroup: (campaignGroupId) =>
    set((state) => ({
      activeCampaignGroupId: campaignGroupId,
      activeWorkspaceUnitId: undefined,
      workspaceMode: "campaign",
      openTabIds: state.openTabIds.includes(campaignGroupId)
        ? state.openTabIds
        : [...state.openTabIds, campaignGroupId],
    })),
openCampaignGroup: (campaignGroupId) =>
    set((state) => ({
      activeCampaignGroupId: campaignGroupId,
      activeWorkspaceUnitId: undefined,
      activeLifecycleGroupId: undefined,
      workspaceMode: "campaign",
      openTabIds: state.openTabIds.includes(campaignGroupId)
        ? state.openTabIds
        : [campaignGroupId, ...state.openTabIds].slice(0, 12),
      adjustmentDrafts: [],
      selectedDraftIds: [],
    })),
mergeCampaignGroupsIntoWorkspaceUnit: (sourceCampaignGroupId, targetCampaignGroupId) =>
    set((state) => {
      if (sourceCampaignGroupId === targetCampaignGroupId) {
        return state;
      }

      const sourceGroup = state.campaignGroups.find((group) => group.id === sourceCampaignGroupId);
      const targetGroup = state.campaignGroups.find((group) => group.id === targetCampaignGroupId);

      if (!sourceGroup || !targetGroup) {
        return state;
      }

      const targetUnit = findWorkspaceUnitByCampaignGroupId(state.workspaceUnits, targetCampaignGroupId);
      const sourceUnit = findWorkspaceUnitByCampaignGroupId(state.workspaceUnits, sourceCampaignGroupId);
      let workspaceUnits = detachCampaignGroupFromWorkspaceUnits(state.workspaceUnits, sourceCampaignGroupId);

      if (targetUnit) {
        workspaceUnits = upsertWorkspaceUnitForCampaign(workspaceUnits, state.campaignGroups, sourceCampaignGroupId, targetUnit.id);
      } else {
        const id = sourceUnit?.id ?? createWorkspaceUnitId();
        const campaignGroupIds = Array.from(new Set([targetCampaignGroupId, sourceCampaignGroupId]));
        const groups = state.campaignGroups.filter((group) => campaignGroupIds.includes(group.id));

        workspaceUnits.push({
          id,
          name: buildWorkspaceUnitName(groups),
          campaignGroupIds,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const activeWorkspaceUnit =
        findWorkspaceUnitByCampaignGroupId(workspaceUnits, targetCampaignGroupId) ??
        findWorkspaceUnitByCampaignGroupId(workspaceUnits, sourceCampaignGroupId);

      return {
        workspaceUnits,
        activeWorkspaceUnitId: activeWorkspaceUnit?.id ?? state.activeWorkspaceUnitId,
        activeCampaignGroupId: targetCampaignGroupId,
        activeLifecycleGroupId: undefined,
        workspaceMode: activeWorkspaceUnit ? "workspace-unit" : state.workspaceMode,
        openTabIds: Array.from(new Set([targetCampaignGroupId, sourceCampaignGroupId, ...state.openTabIds])).slice(0, 12),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
removeCampaignGroupFromWorkspaceUnit: (campaignGroupId) =>
    set((state) => {
      const existingUnit = findWorkspaceUnitByCampaignGroupId(state.workspaceUnits, campaignGroupId);

      if (!existingUnit) {
        return state;
      }

      const workspaceUnits = rebuildWorkspaceUnits(
        detachCampaignGroupFromWorkspaceUnits(state.workspaceUnits, campaignGroupId),
        state.campaignGroups,
      );
      const nextActiveWorkspaceUnit =
        state.activeWorkspaceUnitId && existingUnit.id === state.activeWorkspaceUnitId
          ? workspaceUnits.find((unit) => unit.id === existingUnit.id)
          : undefined;
      const nextActiveCampaignGroupId =
        nextActiveWorkspaceUnit?.campaignGroupIds[0] ??
        (state.activeCampaignGroupId === campaignGroupId ? existingUnit.campaignGroupIds.find((id) => id !== campaignGroupId) : undefined) ??
        state.activeCampaignGroupId;

      return {
        workspaceUnits,
        activeWorkspaceUnitId: nextActiveWorkspaceUnit?.id,
        activeCampaignGroupId: nextActiveCampaignGroupId,
        workspaceMode: nextActiveWorkspaceUnit ? "workspace-unit" : "campaign",
        openTabIds: state.openTabIds.filter((id) => id !== campaignGroupId),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
setActiveWorkspaceUnit: (workspaceUnitId) =>
    set((state) => {
      const workspaceUnit = state.workspaceUnits.find((unit) => unit.id === workspaceUnitId);
      const activeCampaignGroupId = workspaceUnit?.campaignGroupIds[0] ?? state.activeCampaignGroupId;

      return workspaceUnit
        ? {
            activeWorkspaceUnitId: workspaceUnitId,
            activeCampaignGroupId,
            activeLifecycleGroupId: undefined,
            workspaceMode: "workspace-unit" as const,
            openTabIds: Array.from(new Set([...workspaceUnit.campaignGroupIds, ...state.openTabIds])).slice(0, 12),
            adjustmentDrafts: [],
            selectedDraftIds: [],
          }
        : state;
    }),
setActiveLifecycleGroup: (lifecycleGroupId) =>
    set((state) => {
      if (!lifecycleGroupId) {
        return {
          activeLifecycleGroupId: undefined,
          activeWorkspaceUnitId: undefined,
          workspaceMode: "campaign" as const,
          adjustmentDrafts: [],
          selectedDraftIds: [],
        };
      }

      const assignedGroups = state.campaignGroups.filter((group) => group.lifecycleGroupId === lifecycleGroupId);
      const activeCampaignGroupId = assignedGroups.some((group) => group.id === state.activeCampaignGroupId)
        ? state.activeCampaignGroupId
        : assignedGroups[0]?.id ?? "";

      return {
        activeLifecycleGroupId: lifecycleGroupId,
        activeCampaignGroupId,
        activeWorkspaceUnitId: undefined,
        workspaceMode: "lifecycle",
        openTabIds: assignedGroups.map((group) => group.id),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
assignLifecycleGroup: (campaignGroupId, lifecycleGroupId) =>
    set((state) => {
      const campaignGroups = state.campaignGroups.map((group) =>
        group.id === campaignGroupId ? { ...group, lifecycleGroupId } : group,
      );
      const assignedGroups = campaignGroups.filter((group) => group.lifecycleGroupId === lifecycleGroupId);

      return {
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        activeLifecycleGroupId: state.workspaceMode === "lifecycle" ? lifecycleGroupId : state.activeLifecycleGroupId,
        openTabIds:
          state.workspaceMode === "lifecycle"
            ? assignedGroups.map((group) => group.id)
            : state.openTabIds.includes(campaignGroupId)
              ? state.openTabIds
              : [...state.openTabIds, campaignGroupId],
        activeCampaignGroupId: campaignGroupId,
      };
    }),
clearLifecycleGroup: (campaignGroupId) =>
    set((state) => {
      const campaignGroups = state.campaignGroups.map((group) =>
        group.id === campaignGroupId ? { ...group, lifecycleGroupId: undefined } : group,
      );

      return {
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        activeLifecycleGroupId:
          state.workspaceMode === "lifecycle" ? undefined : state.activeLifecycleGroupId,
        workspaceMode: state.workspaceMode === "lifecycle" ? "campaign" : state.workspaceMode,
        activeCampaignGroupId: campaignGroupId,
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
blockCampaignGroup: (campaignGroupId) =>
    set((state) => {
      const campaignGroup = state.campaignGroups.find((group) => group.id === campaignGroupId);

      if (!campaignGroup) {
        return {};
      }

      const id = buildBlockedCampaignIdentityId(campaignGroup.campaignName, campaignGroup.adGroupName);
      const blockedCampaignIdentities = state.blockedCampaignIdentities.some((identity) => identity.id === id)
        ? state.blockedCampaignIdentities
        : [
            ...state.blockedCampaignIdentities,
            {
              id,
              campaignName: campaignGroup.campaignName,
              adGroupName: campaignGroup.adGroupName,
              blockedAt: new Date().toISOString(),
            },
          ];
      const workspaceUnits = rebuildWorkspaceUnits(
        detachCampaignGroupFromWorkspaceUnits(state.workspaceUnits, campaignGroupId),
        state.campaignGroups,
      );

      return {
        blockedCampaignIdentities,
        workspaceUnits,
        activeWorkspaceUnitId: undefined,
        workspaceMode: state.workspaceMode === "workspace-unit" ? "campaign" : state.workspaceMode,
        openTabIds: state.openTabIds.filter((id) => id !== campaignGroupId),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
unblockCampaignIdentity: (identityId) =>
    set((state) => ({
      blockedCampaignIdentities: state.blockedCampaignIdentities.filter((identity) => identity.id !== identityId),
    })),
importGroupingStatusCsv: (_fileName, text) => {
    const rows = parseCsv(text);
    const result = buildWorkspaceUnitsFromGroupingRows(rows, get().campaignGroups);

    set((state) => {
      const campaignGroups = state.campaignGroups.map((group) =>
        result.lifecycleByCampaignGroupId.has(group.id)
          ? { ...group, lifecycleGroupId: result.lifecycleByCampaignGroupId.get(group.id) }
          : group,
      );
      const activeWorkspaceUnit = result.workspaceUnits.find((unit) => unit.campaignGroupIds.includes(state.activeCampaignGroupId));

      return {
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        workspaceUnits: result.workspaceUnits,
        activeWorkspaceUnitId: activeWorkspaceUnit?.id,
        workspaceMode: activeWorkspaceUnit ? "workspace-unit" : "campaign",
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    });

    return {
      importedRows: result.importedRows,
      workspaceUnitCount: result.workspaceUnits.length,
    };
  }
});
