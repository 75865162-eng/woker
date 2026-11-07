import type { BrandProductLink } from "@/lib/amazon-sync/brand-product-links";
import { Button } from "@/components/ui/button";

export function BrandProductCard({ product, onTask, onAsin }: { product?: BrandProductLink; onTask: (id: string) => void; onAsin?: (asin: string) => void }) {
  if (!product) return <span className="text-muted">暂无关联商品资料</span>;
  return <div className="flex max-w-md gap-2 text-xs">
    {/* Authenticated local thumbnail endpoint; avoid the shared image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {product.thumbnailUrl && <img src={product.thumbnailUrl} width={56} height={56} alt={product.title ?? "商品主图"} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 object-contain" />}
    <div className="min-w-0 space-y-1 break-words"><p>{product.title ?? "标题未知"}</p><p>品牌：{product.brand ?? "未知"}</p><p>关联 SKU：{product.skus.length ? product.skus.join(" / ") : "未知"}</p>
      {onAsin && <Button size="sm" variant="secondary" onClick={() => onAsin(product.asin)}>查看 ASIN 分析</Button>}
      {product.catalogRunId && <Button size="sm" variant="secondary" onClick={() => onTask(product.catalogRunId!)}>商品快照来源</Button>}
      {product.detailRunIds.map(id => <Button key={id} size="sm" variant="secondary" onClick={() => onTask(id)}>商品详情来源</Button>)}
    </div>
  </div>;
}
