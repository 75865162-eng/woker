import { Button } from "./button";

/** Pagination within an explicitly bounded, already loaded result set. */
export function WorkbenchPagination({ total, page, pageSize, onPage, note }: {
  total: number; page: number; pageSize: number; onPage: (page: number) => void; note?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 text-xs text-muted">
    <span>{note ? note + " · " : ""}筛选结果 {total} 条</span>
    <div className="flex items-center gap-2"><span>第 {page} / {pages} 页</span>
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
      <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</Button>
    </div>
  </div>;
}
