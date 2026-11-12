"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductListItem } from "@/lib/products/types";
import { Button } from "@/components/ui/button";

export type ProductOption = Pick<ProductListItem, "id" | "sku" | "chineseName" | "englishName">;

export function WmsProductPicker({ workspaceId, selectedId, onSelect }: { workspaceId: string; selectedId: string; onSelect: (id: string, product: ProductOption) => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", page: 1, attempt: 0 });
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<ProductOption | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!query.search) { setProducts([]); setError(""); setLoading(false); setPageCount(1); return; }
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLoading(true); setError(""); setProducts([]);
    const params = new URLSearchParams({ source: "all", includeSummary: "false", pageSize: "20", page: String(query.page), search: query.search });
    void fetch(`/api/products?${params}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 403 ? "当前账号没有商品读取权限，请联系管理员。" : data.error || "商品读取失败。");
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setProducts(data.products ?? []); setPageCount(data.pagination?.pageCount ?? 1);
    }).catch(cause => {
      if (!controller.signal.aborted && sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : "商品读取失败。");
    }).finally(() => { if (!controller.signal.aborted && sequence === requestSequence.current) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, query]);

  function submitSearch() { setQuery(current => ({ search: search.trim(), page: 1, attempt: current.attempt + 1 })); }

  return <fieldset className="basis-full space-y-2 rounded border border-border p-3" aria-label="选择商品主档">
    <legend className="px-1 text-sm font-medium">选择现有商品</legend>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">SKU／商品名称<input value={search} maxLength={200} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submitSearch(); } }} className="h-9 w-64 rounded border border-input bg-background px-3" /></label>
      <Button type="button" size="sm" variant="secondary" onClick={submitSearch}>搜索商品</Button>
      {selection?.id === selectedId && <span className="text-sm" role="status">已选择：{selection.sku} · {selection.chineseName || selection.englishName || selection.id}</span>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取商品…</p> : !error && <>
      <div className="max-h-60 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">SKU</th><th>商品名称</th><th>操作</th></tr></thead><tbody>{products.map(product => <tr key={product.id} className="border-b"><td className="py-2">{product.sku}</td><td>{product.chineseName || product.englishName || "—"}</td><td><Button type="button" size="sm" variant="secondary" aria-label={`选择商品 ${product.sku}`} onClick={() => { setSelection(product); onSelect(product.id, product); }}>{product.id === selectedId ? "已选择" : "选择"}</Button></td></tr>)}</tbody></table>{!products.length && <p className="py-3 text-sm text-muted-foreground">{query.search ? "未找到商品，请调整关键词或先到商品中心创建。" : "输入 SKU 或商品名称后搜索。"}</p>}</div>
      <div className="flex items-center gap-2 text-sm"><Button type="button" size="sm" variant="ghost" disabled={query.page <= 1} onClick={() => setQuery(current => ({ ...current, page: current.page - 1 }))}>上一页商品</Button><span>第 {query.page} / {pageCount} 页</span><Button type="button" size="sm" variant="ghost" disabled={query.page >= pageCount} onClick={() => setQuery(current => ({ ...current, page: current.page + 1 }))}>下一页商品</Button></div>
    </>}
  </fieldset>;
}
