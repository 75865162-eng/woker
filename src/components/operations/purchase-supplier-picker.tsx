"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";

export type PurchaseSupplier = { id: string; name: string; contactName: string; phone: string; email: string; address: string; notes: string };

export function PurchaseSupplierPicker({ workspaceId, onSelect }: { workspaceId: string; onSelect: (supplier: PurchaseSupplier) => void }) {
  // Wimoor baseinfo/supplier/supplier_dialog.vue: search → select row → confirm.
  // MIT copyright and license retained in public/licenses/wimoor-MIT.txt.
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", page: 1, attempt: 0 });
  const [suppliers, setSuppliers] = useState<PurchaseSupplier[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setSuppliers([]); setSelectedId(null);
    const params = new URLSearchParams({ view: "suppliers", search: query.search, page: String(query.page) });
    void fetch("/api/operations/procurement?" + params, { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "供应商读取失败。");
      if (controller.signal.aborted) return;
      setSuppliers(data.suppliers); setPagination(data.pagination);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "供应商读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, query, open]);
  function submitSearch() { setQuery(current => ({ search: search.trim(), page: 1, attempt: current.attempt + 1 })); }
  const selected = suppliers.find(supplier => supplier.id === selectedId);
  return <><Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>打开供应商选择</Button><WorkbenchDialog open={open} title="选择供应商" onClose={() => setOpen(false)}><fieldset aria-label="选择供应商档案" className="space-y-2 rounded border border-border p-3">
    <legend className="px-1 text-sm font-medium">选择现有供应商</legend>
    <div className="flex flex-wrap gap-2"><input aria-label="查询供应商档案" placeholder="名称 / 联系人 / 电话 / 邮箱" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submitSearch(); } }} className="h-9 min-w-0 rounded border border-border bg-background px-2 text-sm" /><Button type="button" size="sm" variant="secondary" onClick={submitSearch}>查询供应商</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p role="status" className="text-sm text-muted">正在读取供应商…</p> : !error && <>
      <div className="max-h-60 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>选中</th><th>供应商</th><th>联系人 / 电话</th><th>操作</th></tr></thead><tbody>{suppliers.map(supplier => <tr key={supplier.id} className="border-t border-border"><td><input type="radio" name="supplier-choice" aria-label={"选中供应商 " + supplier.name} checked={selectedId === supplier.id} onChange={() => setSelectedId(supplier.id)} /></td><td className="py-2">{supplier.name}</td><td>{supplier.contactName || "—"} / {supplier.phone || "—"}</td><td><Button type="button" size="sm" variant="secondary" aria-label={"选择供应商 " + supplier.name} onClick={() => { onSelect(supplier); setOpen(false); }}>选择</Button></td></tr>)}</tbody></table>{!suppliers.length && <p className="py-3 text-sm text-muted">未找到供应商，请调整关键词或先建立档案。</p>}</div>
      <div className="flex items-center gap-2 text-xs text-muted"><span>共 {pagination.total} 条 · 第 {pagination.page} / {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} 页</span><Button type="button" size="sm" variant="ghost" disabled={pagination.page <= 1} onClick={() => setQuery(current => ({ ...current, page: pagination.page - 1 }))}>上一页供应商</Button><Button type="button" size="sm" variant="ghost" disabled={pagination.page * pagination.pageSize >= pagination.total} onClick={() => setQuery(current => ({ ...current, page: pagination.page + 1 }))}>下一页供应商</Button></div>
    </>}
    <div className="flex justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>取消选择</Button><Button type="button" disabled={!selected || loading || !!error} onClick={() => { if (selected) { onSelect(selected); setOpen(false); } }}>确认供应商</Button></div>
  </fieldset></WorkbenchDialog></>;
}
