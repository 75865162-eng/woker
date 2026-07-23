"use client";

type OperationProgressProps = {
  label: string;
  progress: number;
};

export function OperationProgress({ label, progress }: OperationProgressProps) {
  const boundedProgress = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div className="min-w-[220px] rounded-lg border border-border bg-surface-muted px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold">
        <span className="truncate text-foreground">{label}</span>
        <span className="tabular-nums text-muted">{boundedProgress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${boundedProgress}%` }} />
      </div>
    </div>
  );
}
