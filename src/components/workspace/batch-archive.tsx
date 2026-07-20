"use client";

import { CheckSquare, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dataBatches } from "@/data/mock-data";

export function BatchArchive({ campaignGroupId }: { campaignGroupId: string }) {
  const batches = dataBatches.filter((batch) => batch.campaignGroupId === campaignGroupId).slice(-4);

  return (
    <div className="rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-foreground">历史存档批次</h2>
          <p className="text-xs font-medium text-muted">永久追加、不覆盖历史，支持多批次勾选对比</p>
        </div>
        <Badge tone="blue">无限批次</Badge>
      </div>
      <div className="divide-y divide-border">
        {batches.length === 0 ? (
          <div className="px-5 py-8 text-sm font-medium leading-6 text-muted">
            当前广告组暂无历史批次。上传文件后会作为新批次进入归档。
          </div>
        ) : (
          batches.map((batch, index) => (
            <label key={batch.id} className="flex items-center gap-3 px-5 py-3">
              <input type="checkbox" defaultChecked={index > 0} className="h-4 w-4 accent-brand" />
              <FileSpreadsheet className="h-5 w-5 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{batch.fileName}</p>
                <p className="text-xs font-medium text-muted">
                  {batch.dateRange} · {batch.rowCount.toLocaleString("zh-CN")} 行
                </p>
              </div>
              <CheckSquare className="h-4 w-4 text-success" />
            </label>
          ))
        )}
      </div>
    </div>
  );
}
