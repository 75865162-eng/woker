"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";

type LedgerRow = {
  id: string;
  kind: string;
  operationCode: string | null;
  delta: number;
  status: string;
  balanceAfter: number;
  note: string;
  createdAt: string;
};

const kindLabels: Record<string, string> = {
  GRANT: "发放",
  RESERVE: "预扣",
  SETTLE: "结算",
  RELEASE: "释放",
  OVERSHOOT: "超支补扣",
  EXPIRE: "到期作废",
  ADJUST: "手动调整",
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function PointsLedgerDrawer({ userId, userName, onClose }: { userId: string; userName: string; onClose: () => void }) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/points/ledger?userId=${encodeURIComponent(userId)}&take=50`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(body.error ?? "加载流水失败。");
      setRows(body.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载流水失败。");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ledgerColumns: DataTableColumn<LedgerRow>[] = [
    { key: "time", header: "时间", render: (row) => <span className="text-xs text-muted">{formatTime(row.createdAt)}</span> },
    { key: "type", header: "类型", render: (row) => (<><span className="text-xs font-bold text-foreground">{kindLabels[row.kind] ?? row.kind}</span><span className="line-clamp-2 text-xs text-muted">{row.note}</span></>) },
    { key: "delta", header: "变动", numeric: true, render: (row) => <span className={`font-bold ${row.delta > 0 ? "text-success-ink" : row.delta < 0 ? "text-danger-ink" : "text-muted"}`}>{row.delta > 0 ? `+${row.delta}` : row.delta}</span> },
    { key: "balance", header: "余额", numeric: true, render: (row) => <span className="text-foreground">{row.balanceAfter}</span> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={`${userName} 的积分流水`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-foreground">{userName} · 积分流水</h2>
            <p className="mt-0.5 text-xs text-muted">每笔变动都有余额快照，可逐笔还原</p>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-muted" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : error ? (
            <p className="px-5 py-10 text-sm text-danger-ink">{error}</p>
          ) : (
            <StandardDataTable
              ariaLabel="积分流水"
              rows={rows}
              getRowKey={(row) => row.id}
              columns={ledgerColumns}
              empty="暂无流水。"
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted">
          <span>共 {rows.length} 条（最近 50 条）</span>
          {rows.some((row) => row.status === "HELD") ? <Badge tone="amber">存在冻结中的预扣</Badge> : null}
        </div>
      </div>
    </div>
  );
}
