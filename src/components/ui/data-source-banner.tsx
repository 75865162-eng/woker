import { Database, HardDrive, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DataSourceTone = "database" | "local" | "mixed";

const toneConfig: Record<DataSourceTone, { icon: typeof Database; badge: "blue" | "amber" | "green"; label: string }> = {
  database: { icon: Database, badge: "green", label: "数据库数据" },
  local: { icon: HardDrive, badge: "amber", label: "本地数据" },
  mixed: { icon: Info, badge: "blue", label: "混合状态" },
};

export function DataSourceBanner({
  title,
  description,
  tone = "mixed",
  className,
}: {
  title: string;
  description: string;
  tone?: DataSourceTone;
  className?: string;
}) {
  const config = toneConfig[tone];
  const Icon = config.icon;

  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3 text-sm shadow-sm", className)}>
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-foreground">{title}</p>
          <p className="mt-1 text-xs font-medium leading-5 text-muted">{description}</p>
        </div>
      </div>
      <Badge tone={config.badge}>{config.label}</Badge>
    </div>
  );
}
