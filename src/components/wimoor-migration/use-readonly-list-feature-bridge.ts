'use client';

/**
 * 只读列表页「原版功能面板 → 真实表格」通用桥接。
 *
 * 用于 warehouse / shipment / ads 等自建只读页：这些页有自己的筛选状态与
 * 前端 visibleRows，但顶部 WimoorFeaturePanel 此前只是只读演示（填了只弹
 * toast）。本 hook 把面板里的原版搜索字段写入 featureFilters，并对当前页
 * 数据叠加一层真实的「全部条件同时满足」过滤，让每个搜索字段真正生效。
 *
 * 下拉选项从本页已加载的真实数据按字段去重生成，不再伪造「指定XX」。
 * 只读：不发起任何写请求、不造数（架构红线）。
 */
import { useMemo, useState } from 'react';
import type { WimoorFeatureBridge } from './wimoor-feature-panel';

/** 原版中文字段名 → 数据行字段 key 的常见别名，用于从真实数据生成下拉选项 */
const FIELD_ALIASES: Record<string, string[]> = {
  '仓库': ['warehouse', 'warehousename', 'warehousename', 'wh', 'fba仓库'],
  '店铺': ['shop', 'shopname', 'group', 'groupname', 'seller', 'marketplace'],
  '国家': ['country', 'countrycode', 'marketplace'],
  '站点': ['marketplace', 'site', 'country'],
  '状态': ['status', 'snapshotstatus', 'shipmentstatus', 'state'],
  '类型': ['type', 'doctype', 'formname', 'formtype'],
  '负责人': ['owner', 'operator', 'handler', 'responsible'],
  '供应商': ['supplier', 'suppliername'],
  '品类': ['category', 'categoryname'],
  '分类': ['category', 'class', 'type'],
  'sku': ['sku', 'platformsku', 'localsku', 'msku'],
  '产品': ['name', 'productname', 'title'],
  '账户': ['account', 'acct', 'acctname'],
  '币种': ['currency'],
};

function normalize(label: string): string {
  return String(label ?? '')
    .replace(/^(全部|请选择|选择|请输入|搜索|输入)/, '')
    .replace(/[（(].*?[)）]/g, '')
    .trim()
    .toLowerCase();
}

/** 找与 hint 语义相关的数据字段 key 集合 */
function candidateKeys(hint: string): string[] {
  const target = normalize(hint);
  const keys = new Set<string>();
  for (const [alias, fields] of Object.entries(FIELD_ALIASES)) {
    if (target.includes(alias) || alias.includes(target)) fields.forEach(f => keys.add(f));
  }
  if (target) keys.add(target);
  return Array.from(keys);
}

export function useReadOnlyListFeatureBridge<T extends Record<string, unknown>>(rows: T[]) {
  const [featureFilters, setFeatureFilters] = useState<Record<string, string>>({});

  /** 面板下拉字段的真实候选值：从本页数据按语义字段去重 */
  const optionsFor = useMemo(() => (hint: string): { value: string; label: string }[] => {
    const keys = candidateKeys(hint);
    const seen = new Map<string, string>();
    for (const row of rows) {
      for (const key of keys) {
        const v = row[key];
        if (v === null || v === undefined || v === '' || typeof v === 'object') continue;
        seen.set(String(v), String(v));
      }
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const bridge = useMemo<WimoorFeatureBridge>(() => ({
    onSearch: (field: string, value: string) => setFeatureFilters(prev => ({ ...prev, [field]: value })),
    onSubmitSearch: (values: Record<string, string>) => setFeatureFilters({ ...values }),
    onResetSearch: () => setFeatureFilters({}),
    optionsFor,
  }), [optionsFor]);

  /** 对页面已有 visibleRows 叠加面板条件：所有非空条件同时命中（全文包含） */
  const applyFeatureFilters = useMemo(() => (data: T[]): T[] => {
    const active = Object.values(featureFilters).filter(v => v && v !== '');
    if (!active.length) return data;
    return data.filter(row => {
      const hay = JSON.stringify(row).toLowerCase();
      return active.every(v => hay.includes(v.toLowerCase()));
    });
  }, [featureFilters]);

  return { bridge, applyFeatureFilters, featureFilters };
}

export default useReadOnlyListFeatureBridge;
