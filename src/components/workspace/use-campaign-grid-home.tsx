"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCampaignKeywordDetails } from "./use-campaign-keyword-details";
import { useCampaignFileTransfer } from "./use-campaign-file-transfer";
import { type DataTableColumn } from "@/components/ui/data-table";
import { defaultRules } from "@/data/default-rules";
import { useBulkUpload } from "@/lib/hooks/use-bulk-upload";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { workspacePanelAnchorId } from "@/lib/workspace-events";
import type { CampaignGroup, LifecycleGroupId, WorkspaceUnit } from "@/lib/types";
import { buildBlockedIdentityId, buildPageItems, containsScope, flattenConditionGroup, sameScope, summarizeAction, summarizeCondition, waitForPaint } from "./campaign-grid-home-utils";
import { pageSize, type CampaignSortKey, type CampaignSortDirection } from "./use-campaign-grid-home-model";
export function useCampaignGridHome() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [campaignSortKey, setCampaignSortKey] = useState<CampaignSortKey | null>(null);
  const [campaignSortDirection, setCampaignSortDirection] = useState<CampaignSortDirection>("asc");
  const [historyScopeIds, setHistoryScopeIds] = useState<string[] | null>(null);
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [rulesCenterOpen, setRulesCenterOpen] = useState(false);
  const [ruleModalLifecycleId, setRuleModalLifecycleId] = useState<LifecycleGroupId | null>(null);
  const [ruleRunProgress, setRuleRunProgress] = useState<{ label: string; progress: number } | null>(null);
  const { fileInputRef, handleFileSelected } = useBulkUpload();
  const {
    campaignGroups,
    rules,
    workspaceUnits,
    performanceRows,
    activeCampaignGroupId,
    activeLifecycleGroupId,
    parseStatus,
    parseProgress,
    overallAdDataUploads,
    exportHistoryRecords,
    ruleRunHistoryRecords,
    blockedCampaignIdentities,
    openCampaignGroup,
    mergeCampaignGroupsIntoWorkspaceUnit,
    removeCampaignGroupFromWorkspaceUnit,
    setActiveWorkspaceUnit,
    setActiveLifecycleGroup,
    assignLifecycleGroup,
    clearLifecycleGroup,
    blockCampaignGroup,
    unblockCampaignIdentity,
    activateOverallAdDataForScope,
    runRulesForActiveGroup,
    runRulesForActiveWorkspaceUnit,
    reuseExportHistory,
    reuseRuleRunHistory,
  } = useWorkspaceStore();
  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);
  const blockedIdentityIds = useMemo(
    () => new Set(blockedCampaignIdentities.map((identity) => identity.id)),
    [blockedCampaignIdentities],
  );
  const campaignGroupById = useMemo(
    () => new Map(campaignGroups.map((group) => [group.id, group] as const)),
    [campaignGroups],
  );
  const workspaceUnitByCampaignGroupId = useMemo(() => {
    const map = new Map<string, WorkspaceUnit>();

    for (const unit of workspaceUnits) {
      for (const campaignGroupId of unit.campaignGroupIds) {
        map.set(campaignGroupId, unit);
      }
    }

    return map;
  }, [workspaceUnits]);
  const exportHistoryCountByCampaignGroupId = useMemo(() => {
    const counts = new Map<string, number>();

    for (const record of exportHistoryRecords) {
      for (const campaignGroupId of record.campaignGroupIds) {
        counts.set(campaignGroupId, (counts.get(campaignGroupId) ?? 0) + 1);
      }
    }

    return counts;
  }, [exportHistoryRecords]);

  const orderedCampaigns = useMemo(() => {
    const emitted = new Set<string>();

    return campaignGroups.flatMap((campaign) => {
      if (emitted.has(campaign.id)) {
        return [];
      }

      const workspaceUnit = workspaceUnitByCampaignGroupId.get(campaign.id);
      const members = workspaceUnit
        ? workspaceUnit.campaignGroupIds
            .map((id) => campaignGroupById.get(id))
            .filter((group): group is CampaignGroup => Boolean(group))
        : [campaign];

      members.forEach((member) => emitted.add(member.id));
      return members;
    });
  }, [campaignGroupById, campaignGroups, workspaceUnitByCampaignGroupId]);

  const sortedCampaigns = useMemo(() => {
    if (!campaignSortKey) {
      return orderedCampaigns;
    }

    const emitted = new Set<string>();
    const blocks = orderedCampaigns.flatMap((campaign) => {
      if (emitted.has(campaign.id)) {
        return [];
      }

      const workspaceUnit = workspaceUnitByCampaignGroupId.get(campaign.id);
      const members = workspaceUnit
        ? workspaceUnit.campaignGroupIds.map((id) => campaignGroupById.get(id)).filter((group): group is CampaignGroup => Boolean(group))
        : [campaign];

      members.forEach((member) => emitted.add(member.id));
      if (campaignSortKey === "overallCsv") {
        return [members];
      }

      return [[...members].sort((left, right) => left[campaignSortKey].localeCompare(right[campaignSortKey], "zh-CN"))];
    });

    if (campaignSortKey === "overallCsv") {
      const hasOverallFile = (scopeIds: string[]) => {
        return overallAdDataUploads.some(
          (upload) => sameScope(upload.scopeCampaignGroupIds, scopeIds) || containsScope(upload.scopeCampaignGroupIds, scopeIds),
        );
      };

      return blocks
        .map((block, index) => {
          const workspaceUnit = block[0] ? workspaceUnitByCampaignGroupId.get(block[0].id) : undefined;
          const scopeIds = workspaceUnit?.campaignGroupIds ?? block.map((campaign) => campaign.id);

          return { block, index, uploaded: hasOverallFile(scopeIds) };
        })
        .sort((left, right) => Number(right.uploaded) - Number(left.uploaded) || left.index - right.index)
        .flatMap(({ block }) => block);
    }

    const direction = campaignSortDirection === "asc" ? 1 : -1;

    blocks.sort((left, right) =>
      (left[0]?.[campaignSortKey] ?? "").localeCompare(right[0]?.[campaignSortKey] ?? "", "zh-CN") * direction,
    );

    return blocks.flatMap((block) => campaignSortDirection === "asc" ? block : [...block].reverse());
  }, [campaignGroupById, campaignSortDirection, campaignSortKey, orderedCampaigns, overallAdDataUploads, workspaceUnitByCampaignGroupId]);

  const filteredCampaigns = useMemo(
    () =>
      sortedCampaigns.filter((campaign) => {
        const matchesQuery = `${campaign.sheetName ?? ""} ${campaign.campaignName} ${campaign.adGroupName}`
          .toLowerCase()
          .includes(normalizedQuery);
        const matchesLifecycle = activeLifecycleGroupId ? campaign.lifecycleGroupId === activeLifecycleGroupId : true;

        const blocked = blockedIdentityIds.has(buildBlockedIdentityId(campaign.campaignName, campaign.adGroupName));

        return matchesQuery && matchesLifecycle && !blocked;
      }),
    [activeLifecycleGroupId, blockedIdentityIds, normalizedQuery, sortedCampaigns],
  );

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / pageSize));
  const pagedCampaigns = filteredCampaigns.slice((page - 1) * pageSize, page * pageSize);
  const pageItems = buildPageItems(page, totalPages);

  const { detailCampaignGroupIds, closeDetailRows, openDetailRows, detailRows, sortedDetailRows, detailPage, detailTotalPages, detailQuery, setDetailQuery, detailSortDirection, setDetailSortDirection, detailPageItems, setDetailPage, detailRowsPreview, keywordDetailColumns } = useCampaignKeywordDetails(performanceRows);

  useEffect(() => {
    setPage(1);
  }, [query, activeLifecycleGroupId]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const { groupingInputRef, overallInputRef, overallUploadProgress, handleDownloadGroupingStatus, handleGroupingStatusSelected, handleOverallSelected, selectOverallFiles, selectOverallFilesForAllCampaigns } = useCampaignFileTransfer(campaignGroups, workspaceUnits);

  function toggleLifecycle(campaignGroupId: string, lifecycleGroupId: LifecycleGroupId) {
    const campaign = campaignGroups.find((group) => group.id === campaignGroupId);

    if (campaign?.lifecycleGroupId === lifecycleGroupId) {
      clearLifecycleGroup(campaignGroupId);
    } else {
      assignLifecycleGroup(campaignGroupId, lifecycleGroupId);
    }
  }

  function toggleCampaignSort(sortKey: CampaignSortKey) {
    setPage(1);

    if (sortKey === "overallCsv") {
      setCampaignSortKey((current) => current === "overallCsv" ? null : "overallCsv");
      setCampaignSortDirection("asc");
      return;
    }

    if (campaignSortKey !== sortKey) {
      setCampaignSortKey(sortKey);
      setCampaignSortDirection("asc");
      return;
    }

    if (campaignSortDirection === "asc") {
      setCampaignSortDirection("desc");
      return;
    }

    setCampaignSortKey(null);
    setCampaignSortDirection("asc");
  }

  function renderCampaignSortIcon(sortKey: CampaignSortKey) {
    if (campaignSortKey !== sortKey) {
      return <ArrowUpDown className="h-3.5 w-3.5" />;
    }

    return campaignSortDirection === "asc"
      ? <ArrowUp className="h-3.5 w-3.5" />
      : <ArrowDown className="h-3.5 w-3.5" />;
  }

  function getOverallFileName(campaignGroupIds: string[]) {
    return (
      overallAdDataUploads.find((upload) => sameScope(upload.scopeCampaignGroupIds, campaignGroupIds)) ??
      overallAdDataUploads.find((upload) => containsScope(upload.scopeCampaignGroupIds, campaignGroupIds))
    )?.fileName;
  }

  async function runScope(campaignGroupId: string, workspaceUnitId?: string) {
    if (workspaceUnitId) {
      const workspaceUnit = workspaceUnits.find((unit) => unit.id === workspaceUnitId);
      const lifecycleIds = (workspaceUnit?.campaignGroupIds ?? []).map(
        (id) => campaignGroups.find((group) => group.id === id)?.lifecycleGroupId,
      );
      const lifecycleIdSet = new Set(lifecycleIds.filter(Boolean));

      if (lifecycleIds.some((id) => !id) || lifecycleIdSet.size !== 1) {
        window.alert("组合内所有广告组必须选择相同的生命周期组，统一后才能运行规则。");
        return;
      }
    }

    activateOverallAdDataForScope(workspaceUnitId
      ? workspaceUnits.find((unit) => unit.id === workspaceUnitId)?.campaignGroupIds ?? [campaignGroupId]
      : [campaignGroupId]);
    const activeOverallState = useWorkspaceStore.getState();

    if (activeOverallState.overallAdDataStatus !== "matched" || activeOverallState.overallAdDataMatchSummary.matchedRows === 0) {
      window.alert("请先上传并匹配该广告组或组合对应的 Overall 文件，再运行规则。");
      return;
    }

    setRuleRunProgress({ label: "准备规则引擎", progress: 20 });
    await waitForPaint();
    let result;

    if (workspaceUnitId) {
      setRuleRunProgress({ label: "运行组合规则", progress: 65 });
      await waitForPaint();
      setActiveWorkspaceUnit(workspaceUnitId);
      result = runRulesForActiveWorkspaceUnit();
    } else {
      setRuleRunProgress({ label: "运行广告组规则", progress: 65 });
      await waitForPaint();
      openCampaignGroup(campaignGroupId);
      result = runRulesForActiveGroup();
    }

    setRuleRunProgress({ label: "规则草稿已生成", progress: 100 });
    window.setTimeout(() => setRuleRunProgress(null), 1200);

    if (result.message) {
      window.alert(result.message);
    }

    requestAnimationFrame(() => {
      document.getElementById(workspacePanelAnchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const historyRecords = historyScopeIds
    ? exportHistoryRecords.filter((record) => record.campaignGroupIds.some((id) => historyScopeIds.includes(id)))
    : [];
  const runHistoryRecords = historyScopeIds
    ? ruleRunHistoryRecords.filter((record) => record.campaignGroupIds.some((id) => historyScopeIds.includes(id)))
    : [];
  const effectiveRules = useMemo(() => {
    const defaultRuleIds = new Set(defaultRules.map((rule) => rule.id));
    const persistedRuleById = new Map(rules.map((rule) => [rule.id, rule]));

    return [
      ...defaultRules.map((rule) => {
        const persistedRule = persistedRuleById.get(rule.id);
        return persistedRule ? { ...rule, enabled: persistedRule.enabled } : rule;
      }),
      ...rules.filter((rule) => !defaultRuleIds.has(rule.id)),
    ];
  }, [rules]);
  const selectedLifecycleRules = ruleModalLifecycleId
    ? effectiveRules
        .filter((rule) => rule.enabled && rule.lifecycleGroupId === ruleModalLifecycleId)
        .sort((left, right) => left.priority - right.priority)
    : [];
  const lifecycleColumns: Array<{ id: LifecycleGroupId; label: string }> = [
    { id: "launch", label: "新品组" },
    { id: "mature", label: "成熟组" },
    { id: "decline", label: "衰退组" },
    { id: "clearance", label: "清库存组" },
  ];
  const lifecycleRuleColumns: DataTableColumn<(typeof selectedLifecycleRules)[number]>[] = [
    { key: "priority", header: "执行优先级", align: "center", render: (rule) => <span className="font-black metric-tabular">{rule.priority}</span> },
    {
      key: "type",
      header: "规则类型",
      align: "center",
      render: (rule) => (
        <span className={`inline-flex rounded px-2 py-1 text-xs font-bold ${rule.id.includes("bv-") ? "bg-warning-soft text-warning-ink" : "bg-info-soft text-brand"}`}>
          {rule.id.includes("bv-") ? "BV 安全校验" : "投放规则"}
        </span>
      ),
    },
    { key: "condition", header: "条件", render: (rule) => <span className="font-semibold text-foreground">{flattenConditionGroup(rule.conditionGroup).map(summarizeCondition).join("，")}</span> },
    { key: "adjustment", header: "调整", render: (rule) => <span className="font-black text-brand">{rule.actions.map(summarizeAction).join("，")}</span> },
  ];
return { fileInputRef, handleFileSelected, groupingInputRef, handleGroupingStatusSelected, overallInputRef, handleOverallSelected, handleDownloadGroupingStatus, query, setQuery, activeLifecycleGroupId, setActiveLifecycleGroup, setBlockedModalOpen, blockedCampaignIdentities, parseStatus, parseProgress, overallUploadProgress, ruleRunProgress, filteredCampaigns, page, totalPages, setRulesCenterOpen, selectOverallFilesForAllCampaigns, pageItems, setPage, toggleCampaignSort, campaignSortKey, renderCampaignSortIcon, lifecycleColumns, setRuleModalLifecycleId, pagedCampaigns, workspaceUnitByCampaignGroupId, campaignGroupById, getOverallFileName, exportHistoryCountByCampaignGroupId, activeCampaignGroupId, mergeCampaignGroupsIntoWorkspaceUnit, removeCampaignGroupFromWorkspaceUnit, openDetailRows, toggleLifecycle, selectOverallFiles, runScope, setHistoryScopeIds, blockCampaignGroup, rulesCenterOpen, ruleModalLifecycleId, selectedLifecycleRules, lifecycleRuleColumns, blockedModalOpen, unblockCampaignIdentity, historyScopeIds, runHistoryRecords, historyRecords, reuseRuleRunHistory, reuseExportHistory, detailCampaignGroupIds, closeDetailRows, detailRows, sortedDetailRows, detailPage, detailTotalPages, detailQuery, setDetailQuery, detailSortDirection, setDetailSortDirection, detailPageItems, setDetailPage, detailRowsPreview, keywordDetailColumns };
}
