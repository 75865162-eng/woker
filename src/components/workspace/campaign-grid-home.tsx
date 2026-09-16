"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check, Download, EyeOff, History, ListChecks, Play, RotateCcw, Search, SlidersHorizontal, UploadCloud, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { RulesEditorShell } from "@/components/app-shell/lazy-workbenches";
import { Button } from "@/components/ui/button";
import { OperationProgress } from "@/components/ui/operation-progress";
import { defaultRules, lifecycleGroups } from "@/data/default-rules";
import { useBulkUpload } from "@/lib/hooks/use-bulk-upload";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { workspacePanelAnchorId } from "@/lib/workspace-events";
import type { CampaignGroup, ExportHistoryRecord, LifecycleGroupId, PerformanceRow, RuleRunHistoryRecord, WorkspaceUnit } from "@/lib/types";

import {
  buildBlockedIdentityId,
  buildPageItems,
  containsScope,
  countMatchedOverallKeywords,
  downloadGroupingStatusWorkbook,
  flattenConditionGroup,
  formatExportTime,
  lifecycleGroupLabel,
  readGroupingStatusFile,
  readOverallImportFile,
  sameScope,
  summarizeAction,
  summarizeCondition,
  waitForPaint,
} from "./campaign-grid-home-utils";
const pageSize = 10;
const detailPageSize = 25;
const dragMimeType = "application/x-campaign-group-id";
type CampaignSortKey = "campaignName" | "adGroupName" | "overallCsv";
type CampaignSortDirection = "asc" | "desc";
type DetailSortKey =
  | "keyword"
  | "adGroupName"
  | "sheetName"
  | "matchType"
  | "currentBid"
  | "impressions"
  | "clicks"
  | "orders"
  | "sales"
  | "spend";

export function CampaignGridHome() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [campaignSortKey, setCampaignSortKey] = useState<CampaignSortKey | null>(null);
  const [campaignSortDirection, setCampaignSortDirection] = useState<CampaignSortDirection>("asc");
  const [detailCampaignGroupIds, setDetailCampaignGroupIds] = useState<string[] | null>(null);
  const [detailQuery, setDetailQuery] = useState("");
  const deferredDetailQuery = useDeferredValue(detailQuery);
  const [detailPage, setDetailPage] = useState(1);
  const [detailSortKey, setDetailSortKey] = useState<DetailSortKey>("keyword");
  const [detailSortDirection, setDetailSortDirection] = useState<"asc" | "desc">("asc");
  const groupingInputRef = useRef<HTMLInputElement>(null);
  const overallInputRef = useRef<HTMLInputElement>(null);
  const overallScopeRef = useRef<string[]>([]);
  const [historyScopeIds, setHistoryScopeIds] = useState<string[] | null>(null);
  const [blockedModalOpen, setBlockedModalOpen] = useState(false);
  const [rulesCenterOpen, setRulesCenterOpen] = useState(false);
  const [ruleModalLifecycleId, setRuleModalLifecycleId] = useState<LifecycleGroupId | null>(null);
  const [overallUploadProgress, setOverallUploadProgress] = useState<{ label: string; progress: number } | null>(null);
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
    ingestOverallAdDataCsvFiles,
    activateOverallAdDataForScope,
    runRulesForActiveGroup,
    runRulesForActiveWorkspaceUnit,
    reuseExportHistory,
    reuseRuleRunHistory,
    importGroupingStatusCsv,
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

  const detailRows = useMemo(
    () =>
      detailCampaignGroupIds
        ? performanceRows.filter((row) => detailCampaignGroupIds.includes(row.campaignGroupId))
        : [],
    [detailCampaignGroupIds, performanceRows],
  );

  const filteredDetailRows = useMemo(() => {
    const normalizedQuery = deferredDetailQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return detailRows;
    }

    return detailRows.filter((row) =>
      [row.sheetName ?? "", row.adGroupName, row.keyword, row.matchType, row.target, row.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [deferredDetailQuery, detailRows]);

  const sortedDetailRows = useMemo(() => {
    const rows = [...filteredDetailRows];

    rows.sort((left, right) => {
      const leftRaw = left[detailSortKey];
      const rightRaw = right[detailSortKey];
      const comparison =
        typeof leftRaw === "number" && typeof rightRaw === "number"
          ? leftRaw - rightRaw
          : (leftRaw ?? "")
              .toString()
              .toLowerCase()
              .localeCompare((rightRaw ?? "").toString().toLowerCase(), "zh-CN");

      return detailSortDirection === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [detailSortDirection, detailSortKey, filteredDetailRows]);

  const detailTotalPages = Math.max(1, Math.ceil(sortedDetailRows.length / detailPageSize));
  const detailPageItems = buildPageItems(detailPage, detailTotalPages);
  const detailRowsPreview = sortedDetailRows.slice((detailPage - 1) * detailPageSize, detailPage * detailPageSize);

  useEffect(() => {
    setPage(1);
  }, [query, activeLifecycleGroupId]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setDetailPage(1);
  }, [deferredDetailQuery, detailSortDirection, detailSortKey, detailCampaignGroupIds]);

  useEffect(() => {
    if (detailPage > detailTotalPages) {
      setDetailPage(detailTotalPages);
    }
  }, [detailPage, detailTotalPages]);

  function openDetailRows(event: React.MouseEvent | React.KeyboardEvent, campaignGroupIds: string[]) {
    event.stopPropagation();
    setDetailCampaignGroupIds(campaignGroupIds);
    setDetailQuery("");
    setDetailSortKey("keyword");
    setDetailSortDirection("asc");
    setDetailPage(1);
  }

  function closeDetailRows() {
    setDetailCampaignGroupIds(null);
  }

  function toggleDetailSort(sortKey: DetailSortKey) {
    if (detailSortKey === sortKey) {
      setDetailSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setDetailSortKey(sortKey);
    setDetailSortDirection(
      sortKey === "keyword" || sortKey === "adGroupName" || sortKey === "sheetName" || sortKey === "matchType"
        ? "asc"
        : "desc",
    );
  }

  async function handleDownloadGroupingStatus() {
    const workspaceUnitByCampaignGroupId = new Map<string, string>();

    workspaceUnits.forEach((unit) => {
      unit.campaignGroupIds.forEach((campaignGroupId) => {
        workspaceUnitByCampaignGroupId.set(campaignGroupId, unit.name);
      });
    });

    await downloadGroupingStatusWorkbook([
      ["campaignGroupId", "sheetName", "campaignName", "adGroupName", "lifecycleGroup", "workspaceUnit"],
      ...campaignGroups.map((group) => [
        group.id,
        group.sheetName ?? "",
        group.campaignName,
        group.adGroupName,
        group.lifecycleGroupId ?? "",
        workspaceUnitByCampaignGroupId.get(group.id) ?? "",
      ]),
    ]);
  }

  async function handleGroupingStatusSelected(file: File | undefined) {
    if (!file) {
      return;
    }

    const text = await readGroupingStatusFile(file);
    const result = importGroupingStatusCsv(file.name, text);

    window.alert(`已导入 ${result.importedRows} 个广告组，生成 ${result.workspaceUnitCount} 个工作区分组。`);

    if (groupingInputRef.current) {
      groupingInputRef.current.value = "";
    }
  }

  async function handleOverallSelected(fileList?: FileList | null) {
    const files = Array.from(fileList ?? []);

    if (files.length === 0 || overallScopeRef.current.length === 0) {
      return;
    }

    const unsupportedFiles = files.filter((file) => !/\.(csv|xlsx|xls)$/i.test(file.name));

    if (unsupportedFiles.length > 0) {
      window.alert(`Overall 数据仅支持 CSV / Excel：${unsupportedFiles.map((file) => file.name).join("、")}`);
      return;
    }

    try {
      const scopeCampaignGroupIds = [...overallScopeRef.current];
      setOverallUploadProgress({ label: "读取 Overall 文件", progress: 20 });
      const overallFiles = await Promise.all(files.map(readOverallImportFile));
      setOverallUploadProgress({ label: "匹配广告组数据", progress: 65 });
      ingestOverallAdDataCsvFiles(overallFiles, scopeCampaignGroupIds);
      setOverallUploadProgress({ label: "更新 Overall 卡片", progress: 85 });
      activateOverallAdDataForScope(scopeCampaignGroupIds);
      const overallState = useWorkspaceStore.getState();
      const matchedKeywordCount = countMatchedOverallKeywords(overallState.overallAdDataRows);

      if (scopeCampaignGroupIds.length === 1) {
        openCampaignGroup(scopeCampaignGroupIds[0]);
      } else {
        const workspaceUnit = workspaceUnits.find((unit) => sameScope(unit.campaignGroupIds, scopeCampaignGroupIds));

        if (workspaceUnit) {
          setActiveWorkspaceUnit(workspaceUnit.id);
        }
      }

      setOverallUploadProgress({ label: "Overall 上传完成", progress: 100 });
      window.setTimeout(() => setOverallUploadProgress(null), 1200);
      window.alert(
        `Overall 文件匹配完成：命中 ${overallState.overallAdDataMatchSummary.matchedCampaignGroups} 个广告组，${matchedKeywordCount} 个关键词/投放。`,
      );
    } catch (error) {
      setOverallUploadProgress(null);
      window.alert(error instanceof Error ? error.message : "Overall 数据解析失败。");
    }

    if (overallInputRef.current) {
      overallInputRef.current.value = "";
    }
  }

  function selectOverallFiles(campaignGroupIds: string[]) {
    overallScopeRef.current = campaignGroupIds;
    overallInputRef.current?.click();
  }

  function selectOverallFilesForAllCampaigns() {
    const campaignGroupIds = campaignGroups.map((group) => group.id);

    if (campaignGroupIds.length === 0) {
      window.alert("请先上传 Bulk 文件并解析出广告组，再上传匹配所有广告组的 Overall 文件。");
      return;
    }

    selectOverallFiles(campaignGroupIds);
  }

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

  function renderMetricCell(value: string | number, align: "left" | "right" = "left") {
    return <td className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>{value}</td>;
  }

  function renderSortableHeader(label: string, sortKey: DetailSortKey, align: "left" | "right" = "left") {
    const active = detailSortKey === sortKey;
    const arrow = active ? (detailSortDirection === "asc" ? "↑" : "↓") : "";

    return (
      <th className={`px-3 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
        <button
          type="button"
          onClick={() => toggleDetailSort(sortKey)}
          className={`inline-flex items-center gap-1 transition-colors ${active ? "text-brand" : "hover:text-foreground"}`}
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          <span className="min-w-3 text-[11px]">{arrow}</span>
        </button>
      </th>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="hidden"
          aria-hidden
          onChange={(event) => void handleFileSelected(event.target.files?.[0])}
        />
        <input
          ref={groupingInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          aria-hidden
          onChange={(event) => void handleGroupingStatusSelected(event.target.files?.[0])}
        />
        <input
          ref={overallInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          multiple
          className="hidden"
          aria-hidden
          onChange={(event) => void handleOverallSelected(event.target.files)}
        />
        <Button onClick={() => fileInputRef.current?.click()}>
          <UploadCloud className="h-4 w-4" />
          Upload Bulk
        </Button>
        <Button variant="secondary" onClick={() => groupingInputRef.current?.click()}>
          <UploadCloud className="h-4 w-4" />
          上传分组
        </Button>
        <Button variant="secondary" onClick={handleDownloadGroupingStatus}>
          <Download className="h-4 w-4" />
          下载分组状态
        </Button>
        <div className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-border px-3">
          <Search className="h-4 w-4 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campaign, ad group, or sheet"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
          <SlidersHorizontal className="h-4 w-4 text-brand" />
          <span>Product Cycle Filter</span>
          <select
            value={activeLifecycleGroupId ?? ""}
            onChange={(event) => setActiveLifecycleGroup((event.target.value || undefined) as LifecycleGroupId | undefined)}
            className="bg-transparent font-bold text-foreground outline-none"
          >
            <option value="">All</option>
            <option value="launch">新品组</option>
            <option value="mature">成熟组</option>
            <option value="decline">衰退组</option>
            <option value="clearance">清库存组</option>
          </select>
        </label>
        <Button variant="secondary" onClick={() => setBlockedModalOpen(true)}>
          <EyeOff className="h-4 w-4" />
          屏蔽（{blockedCampaignIdentities.length}）
        </Button>
        {parseStatus === "parsing" ? <OperationProgress label="解析 Bulk 文件" progress={parseProgress} /> : null}
        {overallUploadProgress ? <OperationProgress label={overallUploadProgress.label} progress={overallUploadProgress.progress} /> : null}
        {ruleRunProgress ? <OperationProgress label={ruleRunProgress.label} progress={ruleRunProgress.progress} /> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-muted">
          {filteredCampaigns.length} campaigns · Page {page} / {totalPages}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setRulesCenterOpen(true)}
            title="打开规则中心"
          >
            <ListChecks className="h-4 w-4" />
            规则中心
          </Button>
          <Button variant="secondary" onClick={selectOverallFilesForAllCampaigns}>
            <UploadCloud className="h-4 w-4" />
            上传匹配所有广告组
          </Button>
          {pageItems.map((item, index) =>
            item === "..." ? (
              <span key={`ellipsis-${index}`} className="px-1 text-sm font-semibold text-muted">
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if (typeof item === "number") {
                    setPage(item);
                  }
                }}
                className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold transition-colors ${
                  page === item ? "bg-brand text-white" : "border border-border bg-white text-muted hover:text-foreground"
                }`}
              >
                {item}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead className="bg-surface-muted text-xs font-bold text-muted">
            <tr>
              <th className="w-32 border-b border-r border-border px-3 py-3 text-left">匹配 Sheet</th>
              <th className="w-44 border-b border-r border-border px-3 py-3 text-left">
                <button
                  type="button"
                  onClick={() => toggleCampaignSort("campaignName")}
                  className={`inline-flex items-center gap-1.5 hover:text-foreground ${campaignSortKey === "campaignName" ? "text-brand" : ""}`}
                  title="按广告活动名称排序"
                >
                  广告活动名称
                  {renderCampaignSortIcon("campaignName")}
                </button>
              </th>
              <th className="w-48 border-b border-r border-border px-3 py-3 text-left">
                <button
                  type="button"
                  onClick={() => toggleCampaignSort("adGroupName")}
                  className={`inline-flex items-center gap-1.5 hover:text-foreground ${campaignSortKey === "adGroupName" ? "text-brand" : ""}`}
                  title="按广告组名称排序"
                >
                  广告组名称
                  {renderCampaignSortIcon("adGroupName")}
                </button>
              </th>
              <th className="w-24 border-b border-r border-border px-3 py-3 text-right">Keyword</th>
              {lifecycleColumns.map((group) => (
                <th key={group.id} className="w-20 border-b border-r border-border px-2 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setRuleModalLifecycleId(group.id)}
                    className="font-bold hover:text-brand"
                    title={`查看${group.label}运行规则`}
                  >
                    {group.label}
                  </button>
                </th>
              ))}
              <th className="w-32 border-b border-r border-border px-3 py-3 text-center">
                <button
                  type="button"
                  onClick={() => toggleCampaignSort("overallCsv")}
                  className={`inline-flex items-center gap-1.5 hover:text-foreground ${campaignSortKey === "overallCsv" ? "text-brand" : ""}`}
                  title="已上传优先；再次点击恢复默认顺序"
                >
                  Overall
                  {campaignSortKey === "overallCsv" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5" />}
                </button>
              </th>
              <th className="w-20 border-b border-r border-border px-3 py-3 text-center">运行</th>
              <th className="w-20 border-b border-r border-border px-3 py-3 text-center">历史</th>
              <th className="w-20 border-b border-border px-3 py-3 text-center">屏蔽</th>
            </tr>
          </thead>
          <tbody>
            {pagedCampaigns.map((campaign) => {
              const workspaceUnit = workspaceUnitByCampaignGroupId.get(campaign.id);
              const pageUnitMembers = workspaceUnit
                ? workspaceUnit.campaignGroupIds.map((id) => campaignGroupById.get(id)).filter((group): group is CampaignGroup => Boolean(group))
                : [campaign];
              const firstPageMember = pageUnitMembers[0]?.id === campaign.id;
              const scopeIds = workspaceUnit ? workspaceUnit.campaignGroupIds : [campaign.id];
              const rowOverallScopeIds = [campaign.id];
              const overallFileName = getOverallFileName(rowOverallScopeIds);
              const exportedCount = exportHistoryCountByCampaignGroupId.get(campaign.id) ?? 0;
              const scopeLifecycleIds = scopeIds.map((id) => campaignGroupById.get(id)?.lifecycleGroupId);
              const workspaceLifecycleReady =
                !workspaceUnit ||
                (scopeLifecycleIds.every(Boolean) && new Set(scopeLifecycleIds).size === 1);
              const active = activeCampaignGroupId === campaign.id;

              return (
                <tr
                  key={campaign.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(dragMimeType, campaign.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceCampaignGroupId = event.dataTransfer.getData(dragMimeType);
                    if (sourceCampaignGroupId && sourceCampaignGroupId !== campaign.id) {
                      mergeCampaignGroupsIntoWorkspaceUnit(sourceCampaignGroupId, campaign.id);
                    }
                  }}
                  className={`${workspaceUnit ? "bg-slate-100" : "bg-white"} ${active ? "outline outline-2 -outline-offset-2 outline-brand" : ""} hover:bg-blue-50/60`}
                >
                  <td className="border-b border-r border-border px-3 py-2.5 font-semibold text-muted">{campaign.sheetName ?? "Bulk"}</td>
                  <td className="border-b border-r border-border px-3 py-2.5 font-semibold text-foreground">{campaign.campaignName}</td>
                  <td className="border-b border-r border-border px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{campaign.adGroupName}</span>
                      {workspaceUnit ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeCampaignGroupFromWorkspaceUnit(campaign.id);
                          }}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded border border-border bg-white text-muted hover:border-brand hover:text-brand"
                          title="移出组合"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="border-b border-r border-border px-3 py-2.5 text-right font-bold tabular-nums">
                    <button
                      type="button"
                      onClick={(event) => openDetailRows(event, scopeIds)}
                      className="text-brand hover:underline"
                      title="查看关键词明细"
                    >
                      {campaign.keywordCount.toLocaleString("zh-CN")}
                    </button>
                  </td>
                  {lifecycleColumns.map((column) => {
                    const checked = campaign.lifecycleGroupId === column.id;
                    return (
                      <td key={column.id} className="border-b border-r border-border p-1.5 text-center">
                        <button
                          type="button"
                          aria-label={`${campaign.adGroupName} ${column.label}`}
                          aria-pressed={checked}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLifecycle(campaign.id, column.id);
                          }}
                          className={`mx-auto grid h-8 w-8 place-items-center rounded border transition-colors ${
                            checked ? "border-brand bg-brand text-white" : "border-border bg-white text-transparent hover:border-brand"
                          }`}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-r border-border bg-inherit px-2 py-2 text-center align-middle">
                    <div className="flex flex-col items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectOverallFiles(rowOverallScopeIds);
                        }}
                        className="h-8 px-2"
                      >
                        <UploadCloud className="h-4 w-4" />
                        上传
                      </Button>
                      {overallFileName ? (
                        <span className="max-w-28 truncate text-[10px] font-semibold text-success" title={overallFileName}>
                          {overallFileName}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {firstPageMember ? (
                    <>
                      <td rowSpan={pageUnitMembers.length} className="border-b border-r border-border bg-inherit px-2 py-2 text-center align-middle">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            runScope(campaign.id, workspaceUnit?.id);
                          }}
                          className={`mx-auto grid h-9 w-9 place-items-center rounded border bg-white ${
                            workspaceLifecycleReady
                              ? "border-border text-brand hover:border-brand hover:bg-blue-50"
                              : "border-amber-300 text-amber-600 hover:bg-amber-50"
                          }`}
                          title={workspaceLifecycleReady ? "运行规则" : "组合内生命周期必须一致后才能运行"}
                        >
                          <Play className="h-4 w-4 fill-current" />
                        </button>
                      </td>
                    </>
                  ) : null}
                  <td className="border-b border-r border-border bg-inherit px-2 py-2 text-center align-middle">
                    <div className="flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setHistoryScopeIds([campaign.id]);
                        }}
                        className="mx-auto inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"
                      >
                        <History className="h-4 w-4" />
                        历史
                      </button>
                      <span className="text-[10px] font-bold tabular-nums text-muted">已导出 {exportedCount}</span>
                    </div>
                  </td>
                  <td className="border-b border-border p-1.5 text-center">
                    <button
                      type="button"
                      aria-label={`屏蔽 ${campaign.campaignName} ${campaign.adGroupName}`}
                      onClick={() => blockCampaignGroup(campaign.id)}
                      className="mx-auto grid h-8 w-8 place-items-center rounded border border-border bg-white text-transparent transition-colors hover:border-danger hover:text-danger"
                      title="加入屏蔽名单"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {pagedCampaigns.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-sm font-semibold text-muted">没有符合当前筛选条件的广告组。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {rulesCenterOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={() => setRulesCenterOpen(false)}>
          <section
            className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-base font-black text-foreground">规则中心</h2>
                <p className="mt-0.5 text-xs font-semibold text-muted">产品生命周期规则与 IF / THEN 编辑器。</p>
              </div>
              <button
                type="button"
                onClick={() => setRulesCenterOpen(false)}
                className="grid h-9 w-9 place-items-center rounded border border-border text-muted hover:text-foreground"
                title="关闭规则中心"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="thin-scrollbar flex-1 space-y-3 overflow-auto p-4">
              <RulesEditorShell lifecycleGroups={lifecycleGroups} initialLifecycleId={activeLifecycleGroupId ?? lifecycleGroups[0].id} />
            </div>
          </section>
        </div>
      ) : null}

      {ruleModalLifecycleId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8" onClick={() => setRuleModalLifecycleId(null)}>
          <section
            className="max-h-[82vh] w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-black text-foreground">{lifecycleGroupLabel(ruleModalLifecycleId)}运行规则</h2>
                <p className="mt-1 text-xs font-semibold text-muted">当前系统中对该生命周期生效的全部启用规则，共 {selectedLifecycleRules.length} 条，已按实际执行优先级排序。</p>
              </div>
              <button
                type="button"
                onClick={() => setRuleModalLifecycleId(null)}
                className="grid h-9 w-9 place-items-center rounded border border-border text-muted hover:text-foreground"
                title="关闭运行规则"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[68vh] overflow-auto p-5">
              <div className="mb-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-xs font-semibold leading-5 text-muted">
                优先级数字越小越先执行。BV 安全校验会按顺序连续校正竞价；随后执行常规投放规则，每条广告数据命中第一条常规规则后停止继续匹配。
              </div>
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead className="bg-surface-muted text-xs font-black text-muted">
                  <tr>
                    <th className="w-24 border border-border px-3 py-3 text-center">执行优先级</th>
                    <th className="w-28 border border-border px-3 py-3 text-center">规则类型</th>
                    <th className="border border-border px-4 py-3 text-left">条件</th>
                    <th className="border border-border px-4 py-3 text-left">调整</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedLifecycleRules.map((rule) => (
                    <tr key={rule.id}>
                      <td className="border border-border px-3 py-3 text-center font-black tabular-nums text-foreground">
                        {rule.priority}
                      </td>
                      <td className="border border-border px-3 py-3 text-center text-xs font-bold">
                        <span className={`inline-flex rounded px-2 py-1 ${rule.id.includes("bv-") ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-brand"}`}>
                          {rule.id.includes("bv-") ? "BV 安全校验" : "投放规则"}
                        </span>
                      </td>
                      <td className="border border-border px-4 py-3 font-semibold text-foreground">
                        {flattenConditionGroup(rule.conditionGroup).map(summarizeCondition).join("，")}
                      </td>
                      <td className="border border-border px-4 py-3 font-black text-brand">
                        {rule.actions.map(summarizeAction).join("，")}
                      </td>
                    </tr>
                  ))}
                  {selectedLifecycleRules.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="border border-border px-4 py-10 text-center font-semibold text-muted">
                        当前生命周期没有启用的运行规则。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {blockedModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8" onClick={() => setBlockedModalOpen(false)}>
          <section
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-black text-foreground">屏蔽名单</h2>
                <p className="mt-1 text-xs font-semibold text-muted">同时匹配广告活动名称和广告组名称的新数据会继续保持屏蔽。</p>
              </div>
              <button
                type="button"
                onClick={() => setBlockedModalOpen(false)}
                className="grid h-9 w-9 place-items-center rounded border border-border text-muted hover:text-foreground"
                title="关闭屏蔽名单"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[65vh] space-y-2 overflow-y-auto p-5">
              {blockedCampaignIdentities.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm font-semibold text-muted">
                  当前没有屏蔽的广告组。
                </div>
              ) : (
                blockedCampaignIdentities.map((identity) => (
                  <article key={identity.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted/50 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-foreground">{identity.adGroupName}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-muted">广告活动：{identity.campaignName}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => unblockCampaignIdentity(identity.id)}
                      className="shrink-0"
                    >
                      <RotateCcw className="h-4 w-4" />
                      移出屏蔽
                    </Button>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {historyScopeIds ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8" onClick={() => setHistoryScopeIds(null)}>
          <section
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-black text-foreground">历史记录</h2>
                <p className="mt-1 text-xs font-semibold text-muted">查看该广告组或组合的导出文件、日期与运行数据，并可一键复用。</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryScopeIds(null)}
                className="grid h-9 w-9 place-items-center rounded border border-border text-muted hover:text-foreground"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5">
              {runHistoryRecords.length === 0 && historyRecords.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm font-semibold text-muted">
                  该广告组还没有运行或导出历史。
                </div>
              ) : (
                <>
                  {runHistoryRecords.map((record: RuleRunHistoryRecord) => (
                    <article key={record.id} className="rounded-lg border border-border bg-surface-muted/50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-black text-foreground">规则运行</p>
                            <span className={`rounded px-2 py-1 text-[10px] font-black ${record.exportedAt ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                              {record.exportedAt ? "已导出" : "待导出"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-muted">{formatExportTime(record.ranAt)} · {record.adjustmentDrafts.length} 行修改</p>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            reuseRuleRunHistory(record.id);
                            setHistoryScopeIds(null);
                          }}
                        >
                          <RotateCcw className="h-4 w-4" />
                          复用
                        </Button>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs font-semibold text-muted sm:grid-cols-2">
                        <p className="truncate">Overall：{record.overallFileName ?? "-"}</p>
                        <p className="truncate">原 Bulk：{record.bulkFileName ?? "-"}</p>
                        <p className="truncate sm:col-span-2">广告组：{record.campaignGroupNames.join("，") || "-"}</p>
                        {record.exportFileName ? <p className="truncate sm:col-span-2">导出文件：{record.exportFileName}</p> : null}
                      </div>
                    </article>
                  ))}
                  {historyRecords.length > 0 ? (
                    <div className="border-t border-border pt-3">
                      <p className="mb-2 text-xs font-black text-muted">旧版导出记录</p>
                      <div className="space-y-3">
                        {historyRecords.map((record: ExportHistoryRecord) => (
                          <article key={record.id} className="rounded-lg border border-border p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-foreground">{record.fileName}</p>
                                <p className="mt-1 text-xs font-semibold text-muted">{formatExportTime(record.exportedAt)}</p>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  reuseExportHistory(record.id);
                                  setHistoryScopeIds(null);
                                }}
                              >
                                <RotateCcw className="h-4 w-4" />
                                复用
                              </Button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {detailCampaignGroupIds ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-8"
          onClick={closeDetailRows}
        >
          <div
            className="max-h-[85vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Parsed Keyword Details</h3>
                <p className="mt-1 text-sm text-muted">
                  Total {detailRows.length.toLocaleString("zh-CN")} rows, filtered to {sortedDetailRows.length.toLocaleString("zh-CN")} rows, page {detailPage} / {detailTotalPages}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="flex h-10 min-w-[240px] items-center gap-2 rounded-lg border border-border px-3">
                  <Search className="h-4 w-4 text-muted" />
                  <input
                    value={detailQuery}
                    onChange={(event) => setDetailQuery(event.target.value)}
                    placeholder="Search keyword, ad group, sheet, or match type"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                <select
                  value={detailSortDirection}
                  onChange={(event) => setDetailSortDirection(event.target.value as "asc" | "desc")}
                  className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground outline-none"
                >
                  <option value="asc">A-Z</option>
                  <option value="desc">Z-A</option>
                </select>
                <Button variant="secondary" onClick={closeDetailRows}>
                  Close
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {detailPageItems.map((item, index) =>
                    item === "..." ? (
                      <span key={`detail-header-ellipsis-${index}`} className="px-1 text-sm font-semibold text-muted">
                        ...
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          if (typeof item === "number") {
                            setDetailPage(item);
                          }
                        }}
                        className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold transition-colors ${
                          detailPage === item ? "bg-brand text-white" : "border border-border bg-white text-muted hover:text-foreground"
                        }`}
                      >
                        {item}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="thin-scrollbar max-h-[calc(85vh-88px)] overflow-auto">
              {detailRows.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm font-medium text-muted">
                  No parsed keyword rows are available for this card yet.
                </div>
              ) : (
                <>
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-xs font-bold text-muted">
                      <tr>
                        {renderSortableHeader("Sheet", "sheetName")}
                        {renderSortableHeader("Ad Group", "adGroupName")}
                        {renderSortableHeader("Keyword", "keyword")}
                        {renderSortableHeader("Match Type", "matchType")}
                        {renderSortableHeader("Bid", "currentBid", "right")}
                        {renderSortableHeader("Impr.", "impressions", "right")}
                        {renderSortableHeader("Clicks", "clicks", "right")}
                        {renderSortableHeader("Orders", "orders", "right")}
                        {renderSortableHeader("Sales", "sales", "right")}
                        {renderSortableHeader("Spend", "spend", "right")}
                        <th className="px-3 py-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detailRowsPreview.map((row: PerformanceRow) => (
                        <tr key={row.id} className="bg-white">
                          {renderMetricCell(row.sheetName ?? "Mock Sheet")}
                          {renderMetricCell(row.adGroupName)}
                          {renderMetricCell(row.keyword)}
                          {renderMetricCell(row.matchType)}
                          {renderMetricCell(row.currentBid.toFixed(2), "right")}
                          {renderMetricCell(row.impressions.toLocaleString("zh-CN"), "right")}
                          {renderMetricCell(row.clicks.toLocaleString("zh-CN"), "right")}
                          {renderMetricCell(row.orders.toLocaleString("zh-CN"), "right")}
                          {renderMetricCell(row.sales.toFixed(2), "right")}
                          {renderMetricCell(row.spend.toFixed(2), "right")}
                          {renderMetricCell(row.status === "paused" ? "Paused" : "Enabled")}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
                    <p className="text-sm font-medium text-muted">
                      Showing {detailRowsPreview.length.toLocaleString("zh-CN")} rows on this page
                    </p>
                    <p className="text-sm font-medium text-muted">Pagination is pinned to the top-right of the modal</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pagedCampaigns.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-white px-5 py-10 text-center text-sm font-medium text-muted">
          No campaign groups match the current filters.
        </div>
      )}
    </section>
  );
}
