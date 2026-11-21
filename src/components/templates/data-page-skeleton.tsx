/**
 * 数据页骨架屏：在数据工作台加载期间展示结构占位（筛选栏 + KPI + 表格行），
 * 避免冷加载时用户看到空白或一行"正在读取…"，降低等待焦虑。
 * 布局壳由 AppShell 保持挂载，仅页面主体替换为骨架。
 */
export function DataPageSkeleton({
  title,
  kpis = 4,
  rows = 6,
  filters = true,
}: {
  title?: string;
  kpis?: number;
  rows?: number;
  filters?: boolean;
}) {
  return (
    <div role="status" aria-label={title ? `${title}加载中` : "数据加载中"} className="flex flex-col gap-[var(--gap-section)]">
      <div className="space-y-2">
        <div className="h-6 w-52 max-w-full animate-pulse rounded bg-surface-muted" />
        <div className="h-3 w-72 max-w-full animate-pulse rounded bg-surface-muted" />
      </div>

      {filters ? (
        <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-surface p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-28 animate-pulse rounded-md bg-surface-muted" />
          ))}
        </div>
      ) : null}

      {kpis > 0 ? (
        <div className={`grid gap-3 ${kpis <= 3 ? "md:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"}`}>
          {Array.from({ length: kpis }).map((_, i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-lg border border-border bg-surface-muted" />
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="border-b border-border bg-surface-muted px-3 py-2">
          <div className="h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <div className="h-4 w-1/4 animate-pulse rounded bg-surface-muted" />
              <div className="h-4 w-1/5 animate-pulse rounded bg-surface-muted" />
              <div className="h-4 w-1/6 animate-pulse rounded bg-surface-muted" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-surface-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
