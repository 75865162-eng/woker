'use client';

/**
 * WIMOOR 原版功能完整对齐面板（数据驱动 + 真实交互 + 原版分区布局）。
 *
 * 从 page-feature-contracts.generated.ts 读取当前页原版功能清单（递归解析
 * 原版 805 个 Vue 子组件提取），按「被移植页的真实布局范式」分区渲染，而
 * 不是把功能平铺成一大片 chip：
 *   - 顶部标签页：原版 el-tabs，点击切换真实 statusTab；
 *   - 工具栏：操作按钮 + 下拉动作（点击即展开的真实 Dropdown）+ 弹窗入口；
 *   - 筛选区：原版 el-form :inline 范式——每个字段「label + 控件」横向排列，
 *     下拉字段的选项来自工作台真实数据去重（bridge.optionsFor），不再伪造「指定XX」；
 *   - 列字段：折叠为摘要，不抢主视觉（原版这些是表格列头，不是交互控件）。
 *
 * 有工作台桥接（bridge）时默认展开，让原版功能真实可用；无桥接的对照页
 * 默认折叠，仅作功能清单参考。所有功能项都可通过 bridge 驱动真实筛选/
 * 查询/操作状态；无 bridge 时退回只读交互演示。
 *
 * 写操作红线：新建/调整/批量/删除等写入动作点击后只打开「操作预览」对话框，
 * 说明目标语义与执行前提，不产生真实 HTTP 写入、不造数。搜索为前端筛选反馈。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ListFilter, Search, RotateCcw, Table2 } from 'lucide-react';
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

/**
 * 桥接接口：有真实工作台（MasterDataWorkbench）传入时，面板里的原版功能项
 * 直接驱动工作台的真实能力，而不是只弹 toast。所有回调均可选，缺省时面板
 * 退回为只读交互演示（报表对照页 / 无工作台场景）。
 */
export interface WimoorFeatureBridge {
  /** 搜索字段：把原版字段名+值交给工作台映射到真实筛选/查询 */
  onSearch?: (field: string, value: string) => void;
  /** 点击「搜索」：提交当前所有已填条件 */
  onSubmitSearch?: (values: Record<string, string>) => void;
  /** 点击「重置」 */
  onResetSearch?: () => void;
  /** 下拉筛选字段的真实选项（由工作台按字段从当前数据去重生成） */
  optionsFor?: (field: string) => { value: string; label: string }[];
  /** 下拉动作项：label 交给工作台 runMenuAction 分发真实操作 */
  onDropdown?: (label: string) => void;
  /** 标签页：切到工作台真实 statusTab */
  onTab?: (label: string) => void;
  /** 选项（radio）：命中工作台真实筛选则写入 */
  onOption?: (label: string) => void;
  /** 操作按钮：交给工作台真实动作分发 */
  onAction?: (label: string) => void;
  /** 弹窗功能：交给工作台真实入口 */
  onDialog?: (label: string) => void;
}

interface Props {
  route?: string;
  kind?: string;
  /** 默认折叠；设为 true 默认展开。有 bridge 时自动展开 */
  defaultOpen?: boolean;
  /** 真实工作台桥接；传入后面板功能项驱动真实能力 */
  bridge?: WimoorFeatureBridge;
  /** 桥接模式下按钮文案（如「原版完整功能」），默认「原版功能完整对齐」 */
  title?: string;
}

export function WimoorFeaturePanel({ route, kind, defaultOpen = false, bridge, title }: Props) {
  // 有真实工作台桥接时默认展开，让原版功能可见可用；对照页保持折叠。
  const [open, setOpen] = useState(defaultOpen || !!bridge);
  const [preview, setPreview] = useState<{ title: string; group: string; kind: 'write' | 'dialog' } | null>(null);
  const [toast, setToast] = useState('');
  const [searchValues, setSearchValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('');
  const [activeRadio, setActiveRadio] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);

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
    // 桥接模式：操作按钮交给工作台真实分发（写入类仍由工作台侧保留红线）
    if (bridge?.onAction && group === '操作按钮') { bridge.onAction(label); return; }
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
                onClick={() => {
                  if (variant === 'dialog') {
                    if (bridge?.onDialog) { bridge.onDialog(label); return; }
                    setPreview({ title: label, group, kind: 'dialog' });
                    return;
                  }
                  clickAction(label, group);
                }}
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

  // 下拉动作：桥接模式下交给工作台 runMenuAction 真实分发
  const dropdownItems: DropdownItem[] = contract.dropdowns.map((label) => ({
    key: label,
    label,
    danger: actionKind(label) === 'write',
    onSelect: () => {
      if (bridge?.onDropdown) { bridge.onDropdown(label); return; }
      clickAction(label, '下拉动作');
    },
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
    if (bridge?.onSubmitSearch) { bridge.onSubmitSearch({ ...searchValues }); return; }
    flash(`已按 ${filledConditions.length} 个条件搜索：${filledConditions.map(([k, v]) => `${k}=${v}`).join('，')}`);
  };

  const resetSearch = () => {
    setSearchValues({});
    if (bridge?.onResetSearch) { bridge.onResetSearch(); return; }
    flash('已重置全部搜索条件');
  };

  /** 下拉字段的真实选项：优先取工作台按当前数据去重的选项，回退到中性选项 */
  const optionsFor = (hint: string): { value: string; label: string }[] => {
    const real = bridge?.optionsFor?.(hint) ?? [];
    if (real.length) return [{ value: '', label: hint }, ...real];
    return selectOptionsFor(hint);
  };

  const renderSearchControl = (hint: string) => {
    const kind = classifySearchField(hint);
    const value = searchValues[hint] ?? '';
    const onChange = (v: string) => {
      setSearchValues(prev => ({ ...prev, [hint]: v }));
      if (bridge?.onSearch) bridge.onSearch(hint, v);
    };
    if (kind === 'date') {
      return (
        <label key={hint} className="flex min-w-[180px] flex-col gap-1 text-label">
          <span className="text-muted">{hint}</span>
          <DatePicker aria-label={hint} value={value} onChange={e => onChange(e.target.value)} />
        </label>
      );
    }
    if (kind === 'select') {
      return (
        <label key={hint} className="flex min-w-[160px] flex-col gap-1 text-label">
          <span className="text-muted">{hint}</span>
          <Select aria-label={hint} value={value} options={optionsFor(hint)} onChange={e => onChange(e.target.value)} />
        </label>
      );
    }
    return (
      <label key={hint} className="flex min-w-[180px] flex-col gap-1 text-label">
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
      data-wimoor-layout="original"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-body font-semibold">
          <ListFilter size={15} className="text-muted" />
          {title ?? '原版功能完整对齐'}
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-label text-muted">{totalCount} 项</span>
          <span className="text-label text-muted">源：{contract.name}</span>
          {bridge ? <span className="rounded bg-success-soft px-1.5 py-0.5 text-label text-success-ink">原版布局 · 可交互</span> : null}
        </span>
        <span className="flex items-center gap-2 text-label text-muted">
          {toast && <span className="text-info-ink">{toast}</span>}
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          {/* ① 顶部标签页：原版 el-tabs 位于页面顶部，点击切真实 statusTab */}
          {contract.tabs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-info-ink" />
                页面标签 <span className="text-muted">({contract.tabs.length})</span>
              </div>
              <div className="flex flex-wrap gap-1 border-b border-border">
                {contract.tabs.map((tab, i) => (
                  <button
                    key={`tab-${i}-${tab}`}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab);
                      if (bridge?.onTab) { bridge.onTab(tab); return; }
                      flash(`已切换到标签页「${tab}」`);
                    }}
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

          {/* ② 工具栏：操作按钮 + 下拉动作（点击即展开）+ 弹窗入口 */}
          <div className="flex flex-wrap items-start gap-4 rounded border border-border bg-surface-muted/40 p-2">
            {contract.actions.length > 0 ? renderChips(contract.actions, '操作按钮', 'action') : null}
            {dropdownItems.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-info-ink" />
                  下拉动作 <span className="text-muted">({dropdownItems.length})</span>
                </div>
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
            )}
            {contract.dialogs.length > 0 ? renderChips(contract.dialogs, '弹窗功能', 'dialog') : null}
          </div>

          {/* ③ 筛选区：原版 el-form :inline 范式——字段 label + 控件横向排列 */}
          {searchFields.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-label font-semibold text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-border-strong" />
                筛选字段 <span className="text-muted">({searchFields.length})</span>
                <span className="font-normal text-muted">· 按原版语义还原（选项来自本页真实数据，只读不造数）</span>
              </div>
              <div className="flex flex-wrap items-end gap-2" data-testid="wimoor-feature-search-bar">
                {searchFields.map(renderSearchControl)}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="primary" onClick={doSearch}>
                  <Search size={13} className="mr-1" />搜索
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={resetSearch}>
                  <RotateCcw size={13} className="mr-1" />重置
                </Button>
                {filledConditions.length > 0 && <span className="text-label text-muted">已填 {filledConditions.length} 项 · 搜索后即时筛选当前结果</span>}
              </div>
            </div>
          )}

          {/* ④ 选项：原版单选筛选 */}
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
                      onChange={() => {
                        setActiveRadio(radio);
                        if (bridge?.onOption) { bridge.onOption(radio); return; }
                        flash(`已选择「${radio}」`);
                      }}
                    />
                    {radio}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ⑤ 列字段：原版这些是表格列头，折叠为摘要不抢主视觉 */}
          {columnLabels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setColumnsOpen(o => !o)}
                className="flex items-center gap-1.5 text-label font-semibold text-muted hover:text-foreground">
                <Table2 size={13} />
                表格列字段 <span className="text-muted">({columnLabels.length})</span>
                {columnsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {columnsOpen ? (
                <div className="flex flex-wrap gap-1">
                  {columnLabels.map((label, i) => (
                    <span key={`col-${i}-${label}`} className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-label text-muted">{label}</span>
                  ))}
                </div>
              ) : null}
            </div>
          )}
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
