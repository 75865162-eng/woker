"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ListingOptimizationRequest,
  ListingOptimizationResult,
} from "@/lib/listing-ai/types";
import { fieldClass } from "@/lib/listing-ai/workspace-draft";

export function ListingAiAplusPanel({
  result,
  input,
  update,
  error,
  canSubmit,
  loading,
  onGenerate,
}: {
  result: ListingOptimizationResult | null;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  error: string;
  canSubmit: boolean;
  loading: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>A+ Requirements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className={`${fieldClass} min-h-32 resize-y`}
            value={input.aplusRequirements}
            onChange={(event) =>
              update("aplusRequirements", event.target.value)
            }
          />
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </div>
          ) : null}
          <Button disabled={!canSubmit} onClick={onGenerate}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Generate / Regenerate
          </Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>A+ Execution Board</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {result.aplusPlan.map((module) => (
              <div
                key={module.moduleNo}
                className="rounded-md border border-border p-4"
              >
                <Badge tone="blue">{module.moduleNo}</Badge>
                <p className="mt-3 font-bold text-foreground">
                  {module.coreMessage}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  布局：{module.layout}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  文案：{module.copy}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  视觉：{module.visualElements}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
