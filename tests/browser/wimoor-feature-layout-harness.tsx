import { createRoot } from 'react-dom/client';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';
import { useReadOnlyListFeatureBridge } from '@/components/wimoor-migration/use-readonly-list-feature-bridge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useMemo, useState } from 'react';

type Row = Record<string, unknown> & { id: string };

/** 隔离 UI 验证 harness：真实功能面板 + 真实桥接 + 只读 fixture 表格，无真实业务连接。 */
function Harness() {
  const [rows] = useState<Row[]>(() => [
    { id: '1', sku: 'SKU-ALPHA', warehouse: '美国西部仓', status: '可用', name: '商品甲' },
    { id: '2', sku: 'SKU-BETA', warehouse: '美国东部仓', status: '停用', name: '商品乙' },
    { id: '3', sku: 'SKU-GAMMA', warehouse: '美国西部仓', status: '可用', name: '商品丙' },
  ]);
  const { bridge, applyFeatureFilters, featureFilters } = useReadOnlyListFeatureBridge(rows);
  const cell = (key: string) => {
    const Cell = (row: Row) => <span>{String(row[key] ?? '—')}</span>;
    Cell.displayName = `Cell_${key}`;
    return Cell;
  };
  const columns: DataTableColumn<Row>[] = [
    { key: 'sku', header: 'SKU', width: 160, render: cell('sku') },
    { key: 'warehouse', header: '仓库', width: 160, render: cell('warehouse') },
    { key: 'status', header: '状态', width: 120, render: cell('status') },
    { key: 'name', header: '名称', width: 160, render: cell('name') },
  ];
  const visible = useMemo(() => applyFeatureFilters(rows), [applyFeatureFilters, rows]);
  const accountPanel = new URLSearchParams(window.location.search).has('account');
  return (
    <main className="p-6" data-testid="harness-root">
      <p>隔离 UI 验证 · fixture 数据 · 无真实业务连接</p>
      {accountPanel ? (
        // 采购记账契约含 tabs + dropdowns + 搜索字段，用于验证原版分区与下拉展开
        <WimoorFeaturePanel route="/wimoor/account/account" bridge={bridge} title="原版完整功能（可交互）" />
      ) : (
        <WimoorFeaturePanel route="/wimoor/warehouse/inventory-report" bridge={bridge} title="原版完整功能（可交互）" />
      )}
      <div data-testid="active-filters" data-value={Object.values(featureFilters).filter(Boolean).join('|')} />
      <DataTable<Row> columns={columns} rows={visible} getRowKey={r => r.id} ariaLabel="库存报表验收表" />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
