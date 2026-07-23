import { Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function EmptyOutput({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <Layers3 className="h-10 w-10 text-muted" />
        <h2 className="mt-4 text-xl font-black text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted">请先生成 AI Analysis。</p>
      </CardContent>
    </Card>
  );
}

export function AnalysisCard({
  title,
  content,
  tone,
}: {
  title: string;
  content: string;
  tone: "blue" | "green" | "amber" | "red";
}) {
  return (
    <Card>
      <CardHeader>
        <Badge tone={tone}>{title}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-semibold leading-6 text-foreground">
          {content || "暂无"}
        </p>
      </CardContent>
    </Card>
  );
}

export function AnalysisList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "blue" | "green" | "amber" | "red";
}) {
  return (
    <Card>
      <CardHeader>
        <Badge tone={tone}>{title}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {items?.length ? (
          items.map((item, index) => (
            <p
              key={`${item}-${index}`}
              className="text-sm leading-6 text-foreground"
            >
              {index + 1}. {item}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted">暂无</p>
        )}
      </CardContent>
    </Card>
  );
}

export function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-2 text-3xl font-black text-foreground">
        {value || "--"}
      </p>
    </div>
  );
}
