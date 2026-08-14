import { History, ImagePlus, RotateCcw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { productStatusLabels, productStatusOptions, productStatusTones } from "@/data/products";
import { getProductListImage } from "@/lib/products/image-assets";
import type { Product } from "@/lib/products/types";
import {
  formatAssigneeList,
  formatWorkflowDate,
  getCurrentWorkflowAssignee,
  isProductWorkflowOverdue,
  normalizeAssigneeList,
} from "@/lib/products/workflow";
import { type ProductFilters } from "./product-workbench-model";
import { LabeledInput } from "./product-workbench-fields";

export function ProductFiltersBar({
  filters,
  opsAssigneeOptions,
  selectionOwnerOptions,
  designerAssigneeOptions,
  onChange,
  onReset,
}: {
  filters: ProductFilters;
  opsAssigneeOptions: string[];
  selectionOwnerOptions: string[];
  designerAssigneeOptions: string[];
  onChange: (filters: ProductFilters) => void;
  onReset: () => void;
}) {
  const statusOptions = [
    { value: "all", label: "全部状态" },
    ...productStatusOptions,
    { value: "operations_progress", label: "运营进程" },
    { value: "overdue", label: "超期处理" },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr_0.7fr_0.9fr_0.8fr_0.9fr_auto]">
        <LabeledInput
          label="品名 / SKU / 关键词"
          value={filters.keyword}
          placeholder="搜索品名、SKU、关键词"
          onChange={(value) => onChange({ ...filters, keyword: value })}
        />
        <LabeledInput label="ASIN" value={filters.asin} placeholder="主 ASIN 或竞品 ASIN" onChange={(value) => onChange({ ...filters, asin: value })} />
        <FilterCheckboxMenu label="运营" value={filters.opsAssignees} options={opsAssigneeOptions} placeholder="全部运营" onChange={(value) => onChange({ ...filters, opsAssignees: value })} />
        <FilterCheckboxMenu label="选品" value={filters.selectionOwners} options={selectionOwnerOptions} placeholder="全部选品" onChange={(value) => onChange({ ...filters, selectionOwners: value })} />
        <FilterCheckboxMenu label="美工" value={filters.designerAssignees} options={designerAssigneeOptions} placeholder="全部美工" onChange={(value) => onChange({ ...filters, designerAssignees: value })} />
        <LabeledInput label="供应商名称" value={filters.supplierName} placeholder="供应商" onChange={(value) => onChange({ ...filters, supplierName: value })} />
        <label className="text-xs font-semibold text-muted">
          状态
          <select
            className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
            value={filters.status}
            onChange={(event) => onChange({ ...filters, status: event.target.value as ProductFilters["status"] })}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <LabeledInput label="采购价格从" type="number" value={filters.minPrice} placeholder="5" onChange={(value) => onChange({ ...filters, minPrice: value })} />
          <LabeledInput label="到" type="number" value={filters.maxPrice} placeholder="10" onChange={(value) => onChange({ ...filters, maxPrice: value })} />
        </div>
        <div className="flex items-end gap-2">
          <Button className="h-10" size="icon" title="搜索" onClick={() => onChange({ ...filters })}>
            <Search className="h-4 w-4" />
          </Button>
          <Button className="h-10" size="icon" title="重置" variant="secondary" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterCheckboxMenu({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string[];
  options: string[];
  placeholder: string;
  onChange: (value: string[]) => void;
}) {
  const normalizedOptions = Array.from(new Set([...value, ...options].filter(Boolean)));
  const summary = value.length === 0 ? placeholder : value.length === 1 ? value[0] : `已选 ${value.length} 人`;

  function toggleOption(option: string) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  }

  return (
    <div className="relative text-xs font-semibold text-muted">
      <span>{label}</span>
      <details className="group mt-1">
        <summary className="flex h-10 cursor-pointer list-none items-center justify-between rounded-md border border-border bg-white px-3 text-sm font-medium text-foreground outline-none focus:border-brand [&::-webkit-details-marker]:hidden">
          <span className="truncate">{summary}</span>
          <span className="ml-2 text-xs text-muted">▾</span>
        </summary>
        <div className="absolute z-20 mt-1 max-h-64 w-full min-w-[160px] overflow-auto rounded-md border border-border bg-white p-2 shadow-lg">
          {normalizedOptions.length ? (
            normalizedOptions.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={value.includes(option)}
                  onChange={() => toggleOption(option)}
                />
                <span className="truncate">{option}</span>
              </label>
            ))
          ) : (
            <div className="px-2 py-2 text-sm font-medium text-muted">暂无可选人员</div>
          )}
          {value.length ? (
            <button type="button" className="mt-1 w-full rounded px-2 py-1.5 text-left text-sm font-semibold text-brand hover:bg-surface-muted" onClick={() => onChange([])}>
              清空选择
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}

export function ProductTable({
  products,
  totalCount,
  onOpenProduct,
  onOpenHistory,
}: {
  products: Product[];
  totalCount: number;
  onOpenProduct: (productId: string) => void;
  onOpenHistory: (product: Product) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-bold text-foreground">筛选结果</p>
        <span className="text-xs font-semibold text-muted">共 {totalCount.toLocaleString("zh-CN")} 个商品</span>
      </div>
      <div className="thin-scrollbar overflow-auto">
        <table className="w-[1856px] table-fixed text-left text-sm [&_td]:overflow-hidden [&_th]:overflow-hidden">
          <colgroup>
            <col className="w-[64px]" />
            <col className="w-[96px]" />
            <col className="w-[160px]" />
            <col className="w-[112px]" />
            <col className="w-[92px]" />
            <col className="w-[104px]" />
            <col className="w-[96px]" />
            <col className="w-[84px]" />
            <col className="w-[84px]" />
            <col className="w-[112px]" />
            <col className="w-[140px]" />
            <col className="w-[130px]" />
            <col className="w-[84px]" />
            <col className="w-[106px]" />
            <col className="w-[180px]" />
            <col className="w-[140px]" />
            <col className="w-[72px]" />
          </colgroup>
          <thead className="bg-surface-muted text-xs text-muted">
            <tr>
              <th className="px-3 py-3">图片</th>
              <th className="px-3 py-3">SKU</th>
              <th className="px-3 py-3">品名</th>
              <th className="px-3 py-3">ASIN</th>
              <th className="px-3 py-3">采购价格</th>
              <th className="px-3 py-3">状态</th>
              <th className="px-3 py-3">当前负责人</th>
              <th className="px-3 py-3">运营</th>
              <th className="px-3 py-3">美工</th>
              <th className="px-3 py-3">流程截止</th>
              <th className="px-3 py-3">供应商名称</th>
              <th className="px-3 py-3">规格</th>
              <th className="px-3 py-3">采购周期</th>
              <th className="px-3 py-3">创建日期</th>
              <th className="px-3 py-3">选品关键词</th>
              <th className="px-3 py-3">备注</th>
              <th className="px-3 py-3 text-right">版本</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const listImage = getProductListImage(product);

              return (
                <tr key={product.id} className="border-t border-border/70 align-top hover:bg-surface-muted/60">
                  <td className="px-3 py-3">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
                      {listImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={listImage} alt={product.chineseName} className="h-full w-full object-contain p-1" />
                      ) : (
                        <ImagePlus className="h-5 w-5 text-muted" />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <button className="block max-w-full truncate font-bold text-brand hover:text-brand-dark" title={product.sku} onClick={() => onOpenProduct(product.id)}>
                      {product.sku}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <p className="line-clamp-2 font-semibold text-foreground">{product.chineseName || "--"}</p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted">{product.englishName || "--"}</p>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">
                    <p className="truncate" title={product.asin || "--"}>{product.asin || "--"}</p>
                  </td>
                  <td className="px-3 py-3 font-semibold metric-tabular">CNY {product.purchasePrice.toFixed(2)}</td>
                  <td className="px-3 py-3">
                    <Badge tone={productStatusTones[product.status]}>{productStatusLabels[product.status]}</Badge>
                    {isProductWorkflowOverdue(product) ? <p className="mt-1 text-xs font-semibold text-danger">已超时</p> : null}
                  </td>
                  <td className="px-3 py-3">
                    <p className="truncate" title={getCurrentWorkflowAssignee(product) || "--"}>{getCurrentWorkflowAssignee(product) || "--"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="truncate" title={formatAssigneeList(normalizeAssigneeList(product.opsAssignee, product.opsAssignees)) || "--"}>{formatAssigneeList(normalizeAssigneeList(product.opsAssignee, product.opsAssignees)) || "--"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="truncate" title={formatAssigneeList(normalizeAssigneeList(product.designerAssignee, product.designerAssignees)) || "--"}>{formatAssigneeList(normalizeAssigneeList(product.designerAssignee, product.designerAssignees)) || "--"}</p>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <p className="truncate" title={formatWorkflowDate(product.workflowDueAt)}>{formatWorkflowDate(product.workflowDueAt)}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="line-clamp-2 break-all" title={product.supplierName || "--"}>{product.supplierName || "--"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="line-clamp-2 break-all text-xs" title={product.specs || "--"}>{product.specs || "--"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="truncate" title={product.purchaseLeadTime || "--"}>{product.purchaseLeadTime || "--"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="truncate" title={product.createdAt}>{product.createdAt}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="line-clamp-2 break-all text-xs" title={product.keywords || "--"}>{product.keywords || "--"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="line-clamp-2 break-all text-xs" title={product.note || "--"}>{product.note || "--"}</p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button size="icon" variant="ghost" title="版本历史" onClick={() => onOpenHistory(product)}>
                      <History className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!products.length ? (
              <tr>
                <td colSpan={17} className="px-3 py-14 text-center text-sm text-muted">
                  没有匹配的商品，调整筛选条件后再试。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ActivityLogModal({
  entries,
  onClose,
}: {
  entries: string[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-6 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">处理记录</h3>
            <p className="mt-1 text-xs font-semibold text-muted">查看最近的商品处理和系统操作。</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>
        <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-5">
          {entries.map((entry, index) => (
            <div key={`${entry}-${index}`} className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-medium text-foreground">
              {entry}
            </div>
          ))}
          {!entries.length ? <div className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm text-muted">暂无处理记录</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button size="sm" onClick={onClose}>
            确定
          </Button>
        </div>
      </div>
    </div>
  );
}
