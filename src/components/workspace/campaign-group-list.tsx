"use client";

import { ChevronDown, GripVertical, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const dragMimeType = "application/x-campaign-group-id";

export function CampaignGroupList() {
  const [query, setQuery] = useState("");
  const { campaignSheetGroups, activeCampaignGroupId, setActiveCampaignGroup, openCampaignGroup } = useWorkspaceStore();
  const filteredSheetGroups = useMemo(
    () =>
      campaignSheetGroups
        .map((sheetGroup) => ({
          ...sheetGroup,
          groups: sheetGroup.groups.filter((group) =>
            `${sheetGroup.sheetName} ${group.campaignName} ${group.adGroupName}`.toLowerCase().includes(query.toLowerCase()),
          ),
        }))
        .filter((sheetGroup) => sheetGroup.groups.length > 0),
    [campaignSheetGroups, query],
  );

  return (
    <aside className="flex h-[calc(100vh-112px)] w-[300px] shrink-0 flex-col rounded-lg border border-border bg-white">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-bold text-foreground">Campaign Groups</h2>
        <p className="mt-1 text-xs font-medium text-muted">Sheet 一级标签 / 广告组子标签</p>
        <div className="mt-3 flex h-9 items-center gap-2 rounded-md border border-border px-3">
          <Search className="h-4 w-4 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Sheet、Campaign 或广告组"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>
      <div className="thin-scrollbar flex-1 space-y-2 overflow-auto p-3">
        {filteredSheetGroups.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm font-medium leading-6 text-muted">
            上传 Amazon Bulk Operations 文件后，系统会按 Sheet 和广告组名称生成标签。
          </div>
        ) : (
          filteredSheetGroups.map((sheetGroup) => (
            <div key={sheetGroup.sheetName} className="rounded-md border border-border bg-surface-muted/70 p-2">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <div className="flex min-w-0 items-center gap-2">
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                  <p className="truncate text-sm font-bold text-foreground">{sheetGroup.sheetName}</p>
                </div>
                <Badge tone="blue">{sheetGroup.groups.length}</Badge>
              </div>
              <div className="mt-2 space-y-2">
                {sheetGroup.groups.map((group) => (
                  <button
                    key={group.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(dragMimeType, group.id);
                      event.dataTransfer.effectAllowed = "move";
                      setActiveCampaignGroup(group.id);
                    }}
                    onClick={() => setActiveCampaignGroup(group.id)}
                    onDoubleClick={() => openCampaignGroup(group.id)}
                    className={`w-full rounded-md border bg-white p-3 text-left transition-colors ${
                      group.id === activeCampaignGroupId ? "border-brand bg-blue-50" : "border-border hover:bg-white/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                        <p className="max-h-10 overflow-hidden text-sm font-bold leading-5 text-foreground">{group.adGroupName}</p>
                      </div>
                      <Badge>{group.keywordCount.toLocaleString("zh-CN")}</Badge>
                    </div>
                    <p className="mt-1 truncate pl-6 text-xs font-medium text-muted">{group.campaignName}</p>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
