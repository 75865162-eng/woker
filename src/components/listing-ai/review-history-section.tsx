import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ListingOptimizationResult } from "@/lib/listing-ai/types";
import type { SavedRecord } from "@/lib/listing-ai/workspace-draft";
import {
  AnalysisCard,
  AnalysisList,
  EmptyOutput,
  ScoreTile,
} from "@/components/listing-ai/output-primitives";

function ReviewSection({
  result,
}: {
  result: ListingOptimizationResult | null;
}) {
  if (!result) return <EmptyOutput title="AI Review" />;

  const review = result.aiReview;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI Review</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <ScoreTile label="Listing" value={review.listingScore} />
          <ScoreTile label="Image" value={review.imageScore} />
          <ScoreTile label="A+" value={review.aplusScore} />
          <ScoreTile label="Keyword" value={review.keywordScore} />
          <ScoreTile label="Buyer Desire" value={review.buyerDesireScore} />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AnalysisCard title="Verdict" content={review.verdict} tone="blue" />
        <AnalysisList title="Must Fix" items={review.mustFix} tone="red" />
        <AnalysisList
          title="Regeneration Advice"
          items={review.regenerationAdvice}
          tone="amber"
        />
      </div>
    </div>
  );
}

function HistorySection({
  records,
  onLoad,
}: {
  records: SavedRecord[];
  onLoad: (record: SavedRecord) => void;
}) {
  const grouped = records.reduce<Record<string, SavedRecord[]>>(
    (acc, record) => {
      acc[record.productName] = acc[record.productName]
        ? [...acc[record.productName], record]
        : [record];
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-4">
      {Object.entries(grouped).length ? (
        Object.entries(grouped).map(([product, productRecords]) => (
          <Card key={product}>
            <CardHeader>
              <CardTitle>{product}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {productRecords.map((record) => (
                <button
                  key={record.id}
                  className="flex w-full items-center justify-between rounded-md border border-border px-4 py-3 text-left hover:bg-surface-muted"
                  onClick={() => onLoad(record)}
                >
                  <span>
                    <span className="block font-bold text-foreground">
                      Version {record.version}
                    </span>
                    <span className="text-xs text-muted">
                      {record.createdAt} · {record.submitter}
                    </span>
                  </span>
                  <Badge tone="gray">Load</Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        ))
      ) : (
        <EmptyOutput title="History" />
      )}
    </div>
  );
}

export function ReviewHistorySection({
  result,
  records,
  onLoad,
}: {
  result: ListingOptimizationResult | null;
  records: SavedRecord[];
  onLoad: (record: SavedRecord) => void;
}) {
  return (
    <div className="space-y-4">
      <ReviewSection result={result} />
      <HistorySection records={records} onLoad={onLoad} />
    </div>
  );
}
