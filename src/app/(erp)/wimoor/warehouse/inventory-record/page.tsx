'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';

/**
 * WIMOOR「仓库 → 报表 → 出入库明细」功能迁移（只读对照入口）。
 * 源组件：erp/warehouse/record/index.vue
 * 本项目已有等价页：/wms 出入库流水与 /amazon/inventory；本页只做轻量对照。
 * 还原交互：单据类型下拉 / item.name-SKU-单据编码 搜索维度 / 导出、导出耗材语义；
 *          列：单据编码、单据类型、产品/SKU、数量、仓库、操作时间（只读）。
 */
type Row = Record<string, unknown> & { id: string };
const text = (key: string) => function Cell(row: Row) { return <span>{row[key] == null || row[key] === '' ? '—' : String(row[key])}</span>; };
const searchFields = [
  { value: 'item.name', label: 'item.name' },
  { value: 'SKU', label: 'SKU' },
  { value: 'formNo', label: '单据编码' },
];
function headersForScope(): Headers {
  const h = new Headers();
  try {
    const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string };
    h.set('x-workspace-id', v.workspaceId || 'default');
  } catch { h.set('x-workspace-id', 'default'); }
  return h;
}
export default function WimoorWarehouseInventoryRecordPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [docType, setDocType] = useState('');
  const [field, setField] = useState('SKU');
  const [keyword, setKeyword] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'warehouse.inventory-record', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);
  useEffect(() => { void load(); }, [load]);
  const docTypes = useMemo(() => Array.from(new Set(rows.map(r => String(r.formname ?? '')).filter(Boolean))).map(v => ({ value: v, label: v })), [rows]);
  const visibleRows = useMemo(() => rows.filter((r) => {
    if (docType && String(r.formname ?? '') !== docType) return false;
    if (!keyword) return true;
    const key = field === 'item.name' ? 'name' : field === 'SKU' ? 'sku' : 'docNo';
    return String(r[key] ?? '').toLowerCase().includes(keyword.toLowerCase());
  }), [rows, docType, field, keyword]);
  const columns: DataTableColumn<Row>[] = [
    { key: 'docNo', header: '单据编码', width: 160, render: text('docNo') },
    { key: 'formname', header: '单据类型', width: 140, render: text('formname') },
    { key: 'name', header: '产品名称', width: 220, render: text('name') },
    { key: 'sku', header: 'SKU', width: 180, render: text('sku') },
    { key: 'quantity', header: '数量', width: 110, numeric: true, render: text('quantity') },
    { key: 'warehouse', header: '仓库', width: 150, render: text('warehouse') },
    { key: 'opttime', header: '操作时间', width: 170, render: text('opttime') },
  ];
  return (
    <div className="p-4">
      <WimoorFeaturePanel route="/wimoor/warehouse/inventory-record" />
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">出入库明细</h1><p className="text-xs text-muted">WIMOOR 出入库明细迁移（只读对照）：单据类型与 SKU/名称/单据编码 维度筛选，流水视图见 /wms 出入库工作台。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">单据类型
            <Select aria-label="请选择单据类型" value={docType} onChange={(e) => setDocType(e.target.value)} options={docTypes} placeholder="请选择单据类型" />
          </label>
          <Select aria-label="搜索字段" value={field} onChange={(e) => setField(e.target.value)} options={searchFields} />
          <Input aria-label="请输入" value={keyword} placeholder="请输入" onChange={(e) => setKeyword(e.target.value)} />
        </div>
        <DataTable<Row> columns={columns} rows={visibleRows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无出入库明细。本页只读，不预置伪造流水。"
          ariaLabel="出入库明细" />
      </section>
    </div>
  );
}
