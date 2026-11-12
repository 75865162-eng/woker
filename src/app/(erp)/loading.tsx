// The business layout stays mounted while only the page body is loading.
export default function BusinessPageLoading() {
  return <div role="status" aria-label="正在切换页面" className="space-y-3">
    <div className="h-5 w-48 animate-pulse rounded bg-surface-muted" />
    <div className="h-48 animate-pulse rounded-lg border border-border bg-white" />
  </div>;
}
