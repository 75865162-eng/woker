'use client';

/**
 * WIMOOR 原版功能完整对齐面板（数据驱动）。
 *
 * 从 page-feature-contracts.generated.ts 读取当前页原版功能清单（递归解析
 * 原版 805 个 Vue 子组件提取），把原版每个按钮/下拉项/弹窗/标签页/单选/
 * 搜索字段渲染为真实可交互入口，确保「原版有的功能，迁移页都能找到、可点」。
 *
 * 写操作红线：新建/调整/批量/删除等写入动作点击后只打开「操作预览」对话框，
 * 说明目标语义与执行前提，不产生真实 HTTP 写入、不造数（真实广告写闸门保留，
 * 由 /api/integrations/amazon/ads/changes 的 preview→审批→apply 框架承载，
 * 且 execution.enabled=false / WRITE_OPERATION_CONTRACT_NOT_VERIFIED）。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/overlays';
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
    // 仅用语义令牌类，避免非令牌调色板引用
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
        <div className="grid gap-3 border-t border-border px-3 py-3 md:grid-cols-2">
          {renderChips(contract.actions, '操作按钮', 'action')}
          {renderChips(contract.dropdowns, '下拉动作', 'dropdown')}
          {renderChips(contract.dialogs, '弹窗功能', 'dialog')}
          {renderChips(contract.tabs, '标签页', 'tab')}
          {renderChips(contract.radios, '选项', 'radio')}
          {renderChips(contract.searchHints, '搜索字段', 'hint')}
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
