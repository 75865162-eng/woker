import { DataPageSkeleton } from "@/components/templates/data-page-skeleton";

export default function Loading() {
  return <DataPageSkeleton title="在线产品" kpis={3} rows={7} />;
}
