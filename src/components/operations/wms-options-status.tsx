"use client";

import { Button } from "@/components/ui/button";

export function WmsOptionsStatus({ label, options }: { label: string; options: { nextCursor: string | null; loading: boolean; error: string; loadMore: () => void; retry: () => void } }) {
  return <div className="flex items-center gap-2 text-sm">
    {options.loading && <span role="status">正在读取{label}…</span>}
    {options.error && <><span role="alert" className="text-destructive">{options.error}</span><Button type="button" size="sm" variant="ghost" disabled={options.loading} onClick={options.retry}>重试{label}</Button></>}
    {options.nextCursor && !options.error && <Button type="button" size="sm" variant="ghost" disabled={options.loading} onClick={options.loadMore}>加载更多{label}</Button>}
  </div>;
}
