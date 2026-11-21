import { DataPageSkeleton } from "@/components/templates/data-page-skeleton";

export default function Loading() {
  return <DataPageSkeleton title="销量统计" kpis={4} rows={7} />;
}
