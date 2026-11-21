import { DataPageSkeleton } from "@/components/templates/data-page-skeleton";

export default function Loading() {
  return <DataPageSkeleton title="销售利润" kpis={4} rows={7} />;
}
