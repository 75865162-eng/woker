import { DataPageSkeleton } from "@/components/templates/data-page-skeleton";

export default function Loading() {
  return <DataPageSkeleton title="在线商品与库存" kpis={3} rows={7} />;
}
