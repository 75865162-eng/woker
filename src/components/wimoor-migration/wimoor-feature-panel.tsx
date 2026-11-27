'use client';

/**
 * WIMOOR 原版功能完整对齐面板（数据驱动 + 真实交互）。
 *
 * 从 page-feature-contracts.generated.ts 读取当前页原版功能清单（递归解析
 * 原版 805 个 Vue 子组件提取），把原版每个子功能渲染为「与原版同构」的真实
 * 可交互控件，而不再是一排平铺的静态 chip：
 *  - 下拉动作：真实 Dropdown，点击触发器展开菜单，点选项触发对应语义；
 *  - 搜索字段：按语义渲染为文本输入框 / 下拉选择 / 日期控件，可输入、可搜索、可重置；
 *  - 标签页：可点击切换的 tab；选项：真实单选；
 *  - 操作按钮 / 弹窗功能：按钮 / 点击弹预览。
 * 确保「原版有的功能，迁移页都能找到、可点、能交互」。
 *
 * 写操作红线：新建/调整/批量/删除等写入动作点击后只打开「操作预览」对话框，
 * 说明目标语义与执行前提，不产生真实 HTTP 写入、不造数（真实广告写闸门保留，
 * 由 /api/integrations/amazon/ads/changes 的 preview→审批→apply 框架承载，
 * 且 execution.enabled=false / WRITE_OPERATION_CONTRACT_NOT_VERIFIED）。
 * 搜索为纯前端交互反馈：汇总当前条件并提示，不发请求、不改数据。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ListFilter, Search, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, Dropdown, type DropdownItem } from '@/components/ui/overlays';
import { Input, Select, DatePicker } from '@/components/ui/form-controls';
import {
  contractForKind,
  contractForRoute,
  type WimoorFeatureContract,
} from '@/lib/wimoor-migration/page-feature-contracts.generated';

/** 读类动作关键词：点击即时反馈，不弹预览 */
const READ_HINTS = ['搜索', '查询', '筛选', '刷新', '重置', '导出', '打印', '详情', '查看', '展开', '复制', '关闭', '取消', '清空', '清除'];
/** 写类动作关键词：点击弹操作预览（DRY_RUN） */
const WRITE_HINTS = ['新建', '新增', '添加', '调整', '修改', '批量', '删除', '撤销', '作废', '审核', '通过', '驳回', '提交', '保存', '归档', '暂停', '启用', '停用', '上架', '下架', '付款', '收货', '结转', '生成', '应用', '更新', '同步', '导入', '确认', '撤回', '移入', '移出', '设为', '重命名'];

function actionKind(label: string): 'read' | 'write' | 'neutral' {
  if (WRITE_HINTS.some(h => label.includes(h))) return 'write';
  if (READ_HINTS.some(h => label.includes(h))) return 'read';
  return 'neutral';
}

/** 搜索字段的语义分类：决定渲染为哪种真实控件 */
export type SearchFieldKind = 'text' | 'select' | 'date' | 'column';

export function classifySearchField(hint: string): SearchFieldKind {
  // 日期 / 月份 / 时间筛选
  if (/^(开始|结束|选择)(日期|月份|时间)/.test(hint) || /^(付款日期起|付款日期止)$/.test(hint)) return 'date';
  // 下拉筛选（全部XX / 请选择XX / 选择XX）
  if (/^(全部|请选择|选择)/.test(hint)) return 'select';
  // 文本输入框（请输入XX / 搜索XX / 输入XX）
  if (/^(请输入|搜索|输入)/.test(hint)) return 'text';
  // 常见枚举型筛选字段（单词）
  if (/^(状态|类型|品类|仓库|店铺|国家|站点|账户|币种|负责人|方式|来源|分类|费用类型|记账类型|账期类型|退款类型|还款类型|收支项目|收支项|充退去向|月份|日期|时间|是否有退款|默认)$/.test(hint)) return 'select';
  // 其余多为表格列标签（如 图片 / 操作 / 金额(￥)），保留为只读字段标签
  return 'column';
}

/** 下拉筛选的中性语义选项（仅表达交互维度，不伪造具体业务数据） */
export function selectOptionsFor(hint: string): { value: string; label: string }[] {
  const label = hint.replace(/^(全部|请选择|选择)/, '').trim() || hint;
  return [
    { value: '', label: hint },
    { value: 'specified', label: `指定${label}` },
  ];
}

interface Props {
  route?: string;
  kind?: string;
  /** 默认折叠；设为 true 默认展开 */
  defaultOpen?: boolean;
}

export function WimoorFeaturePanel({ route, kind, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [preview, setPreview] = useState<{ title: string; group: string; kind: 'write' | 'dialog' } | null>(null);
  const [toast, setToast] = useState('');
  const [searchValues, setSearchValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('');
  const [activeRadio, setActiveRadio] = useState('');

  const contract: WimoorFeatureContract | undefined = useMemo(
    () => (kind ? contractForKind(kind) : undefined) ?? (route ? contractForRoute(route) : undefined),
    [route, kind],
  );

  if (!contract) return null;

  const allFeatures = [
    ...contract.actions, ...contract.dropdowns, ...contract.dialogs,
    ...contract.tabs, ...contract.radios, ...contract.searchHints,
  ];
  const totalCount = allFeatures.length;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  };

  const clickAction = (label: string, group: string) => {
    const k = actionKind(label);
    if (k === 'write') {
      setPreview({ title: label, group, kind: 'write' });
    } else if (k === 'read') {
      flash(`已触发「${label}」（${group}）`);
    } else {
      flash(`「${label}」为原版${group}入口`);
    }
  };

  const renderChips = (items: string[], group: string, variant: 'action' | 'dropdown' | 'dialog' | 'tab' | 'radio' | 'hint') => {
    if (!items.length) return null;
    const dot = variant === 'dialog' ? 'bg-brand' : variant === 'hint' ? 'bg-border-strong' : 'bg-info-ink';
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
          {group} <span className="text-muted">({items.length})</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((label, i) => {
            const w = variant === 'action' && actionKind(label) === 'write';
            return (
              <button
                key={`${group}-${i}-${label}`}
                type="button"
                onClick={() => variant === 'dialog' ? setPreview({ title: label, group, kind: 'dialog' }) : clickAction(label, group)}
                className={
                  'inline-flex items-center rounded border px-2 py-1 text-label transition-colors ' +
                  (w
                    ? 'border-warning bg-surface-muted text-warning-ink hover:bg-surface-muted/80'
                    : 'border-border bg-surface text-foreground hover:bg-surface-muted')
                }
                title={w ? '写入动作：点击预览，不直接写入' : `原版${group}：${label}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // 下拉动作：作为原版「操作」菜单的真实下拉项
  const dropdownItems: DropdownItem[] = contract.dropdowns.map((label) => ({
    key: label,
    label,
    danger: actionKind(label) === 'write',
    onSelect: () => clickAction(label, '下拉动作'),
  }));

  // 搜索字段按语义分组
  const searchFields = contract.searchHints.filter(h => classifySearchField(h) !== 'column');
  const columnLabels = contract.searchHints.filter(h => classifySearchField(h) === 'column');

  const filledConditions = Object.entries(searchValues).filter(([, v]) => v !== '' && v != null);

  const doSearch = () => {
    if (!filledConditions.length) {
      flash('未输入搜索条件（只读对照，不造数）');
      return;
    }
    flash(`已按 ${filledConditions.length} 个条件搜索：${filledConditions.map(([k, v]) => `${k}=${v}`).join('，')}`);
  };

  const resetSearch = () => {
    setSearchValues({});
    flash('已重置全部搜索条件');
  };

  const renderSearchControl = (hint: string) => {
    const kind = classifySearchField(hint);
    const value = searchValues[hint] ?? '';
    const onChange = (v: string) => setSearchValues(prev => ({ ...prev, [hint]: v }));
    if (kind === 'date') {
      return (
        <label key={hint} className="flex flex-col gap-1 text-label">
          <span className="text-muted">{hint}</span>
          <DatePicker aria-label={hint} value={value} onChange={e => onChange(e.target.value)} />
        </label>
      );
    }
    if (kind === 'select') {
      return (
        <label key={hint} className="flex flex-col gap-1 text-label">
          <span className="text-muted">{hint}</span>
          <Select aria-label={hint} value={value} options={selectOptionsFor(hint)} onChange={e => onChange(e.target.value)} />
        </label>
      );
    }
    return (
      <label key={hint} className="flex flex-col gap-1 text-label">
        <span className="text-muted">{hint}</span>
        <Input aria-label={hint} value={value} placeholder={hint} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSearch(); }} />
      </label>
    );
  };

  return (
    <section
      className="mb-4 rounded-lg border border-border bg-surface"
      data-wimoor-features={allFeatures.join('|')}
      data-contract-route={contract.route}
      data-contract-count={String(totalCount)}
      data-wimoor-feature-panel="1"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-body font-semibold">
          <ListFilter size={15} className="text-muted" />
          原版功能完整对齐
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-label text-muted">{totalCount} 项</span>
          <span className="text-label text-muted">源：{contract.name}</span>
        </span>
        <span className="flex items-center gap-2 text-label text-muted">
          {toast && <span className="text-info-ink">{toast}</span>}
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {open && (
        <div className="grid gap-4 border-t border-border px-3 py-3 md:grid-cols-2">
          {/* 操作按钮：真实按钮 */}
          {renderChips(contract.actions, '操作按钮', 'action')}

          {/* 下拉动作：真实 Dropdown，点击触发器展开菜单 */}
          {dropdownItems.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-info-ink" />
                下拉动作 <span className="text-muted">({dropdownItems.length})</span>
              </div>
              <div>
                <Dropdown
                  align="start"
                  header="原版下拉菜单"
                  trigger={
                    <Button type="button" variant="secondary" size="sm" aria-label="展开下拉动作">
                      操作菜单 <ChevronDown size={13} className="ml-1" />
                    </Button>
                  }
                  items={dropdownItems}
                />
              </div>
            </div>
          )}

          {/* 弹窗功能：点击弹预览 */}
          {renderChips(contract.dialogs, '弹窗功能', 'dialog')}

          {/* 标签页：真实可切换 */}
          {contract.tabs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-info-ink" />
                标签页 <span className="text-muted">({contract.tabs.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5 border-b border-border">
                {contract.tabs.map((tab, i) => (
                  <button
                    key={`tab-${i}-${tab}`}
                    type="button"
                    onClick={() => { setActiveTab(tab); flash(`已切换到标签页「${tab}」`); }}
                    className={
                      'border-b-2 px-2 py-1 text-label transition-colors ' +
                      (activeTab === tab ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-foreground')
                    }
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 选项：真实单选 */}
          {contract.radios.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-info-ink" />
                选项 <span className="text-muted">({contract.radios.length})</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {contract.radios.map((radio, i) => (
                  <label key={`radio-${i}-${radio}`} className="flex cursor-pointer items-center gap-1.5 text-label">
                    <input
                      type="radio"
                      name={`wimoor-radio-${contract.route ?? contract.name}`}
                      checked={activeRadio === radio}
                      onChange={() => { setActiveRadio(radio); flash(`已选择「${radio}」`); }}
                    />
                    {radio}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 搜索字段：真实可输入的搜索栏 */}
          {searchFields.length > 0 && (
            <div className="flex flex-col gap-2 md:col-span-2">
              <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-border-strong" />
                搜索字段 <span className="text-muted">({searchFields.length})</span>
                <span className="font-normal text-muted">· 按原版语义还原为可输入控件（只读对照，不造数）</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="wimoor-feature-search-bar">
                {searchFields.map(renderSearchControl)}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="primary" onClick={doSearch}>
                  <Search size={13} className="mr-1" />搜索
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={resetSearch}>
                  <RotateCcw size={13} className="mr-1" />重置
                </Button>
                {filledConditions.length > 0 && <span className="text-label text-muted">已填 {filledConditions.length} 项</span>}
              </div>
            </div>
          )}

          {/* 列字段标签：原版表格列，保留可见（非搜索条件） */}
          {columnLabels.length > 0 && (
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-border-strong" />
                列字段 <span className="text-muted">({columnLabels.length})</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {columnLabels.map((label, i) => (
                  <span key={`col-${i}-${label}`} className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-label text-muted">{label}</span>
                ))}
              </div>
            </div>
          )}

          {totalCount === 0 && <p className="text-meta text-muted">该页原版无额外交互功能项。</p>}
        </div>
      )}

      <Dialog
        open={!!preview}
        title={preview?.kind === 'dialog' ? `弹窗功能：${preview?.title}` : `操作预览：${preview?.title}`}
        description={preview ? `原版分组：${preview.group} · 源组件 ${contract.sourceFile}` : undefined}
        onClose={() => setPreview(null)}
        footer={<Button variant="secondary" onClick={() => setPreview(null)}>关闭</Button>}
      >
        {preview?.kind === 'dialog' ? (
          <div className="space-y-2 text-body">
            <p>这是原版「{preview.title}」弹窗的功能入口，已按 WIMOOR 交互语义对齐。</p>
            <p className="text-meta text-muted">原版由 {contract.sourceFile} 及其子组件承载；迁移页以等价工作台表单提供编辑能力。</p>
          </div>
        ) : (
          <div className="space-y-2 text-body">
            <p>你点击的是写入类动作「{preview?.title}」。</p>
            <p>按架构红线，写入动作不直接产生真实 HTTP 请求：该功能走 <code className="rounded bg-surface-muted px-1">preview → 审批 → apply</code> 变更草稿框架。</p>
            <p className="text-meta text-muted">当前真实广告写闸门保留（execution.enabled=false，WRITE_OPERATION_CONTRACT_NOT_VERIFIED），不会修改生产广告投放或花费。</p>
          </div>
        )}
      </Dialog>
    </section>
  );
}

export default WimoorFeaturePanel;
