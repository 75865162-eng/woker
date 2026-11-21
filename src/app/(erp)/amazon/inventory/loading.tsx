import { DataPageSkeleton } from "@/components/templates/data-page-skeleton";

export default function Loading() {
  return <DataPageSkeleton title="FBA库存" kpis={3} rows={7} />;
}
