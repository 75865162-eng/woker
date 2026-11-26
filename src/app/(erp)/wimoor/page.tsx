'use client';

/**
 * WIMOOR 全功能门户：按 12 个一级模块分组展示全部 128 个已迁移页面入口。
 * 支持按名称/模块搜索。每个入口标注 WIMOOR 原始 href 与源 Vue 组件，便于对照。
 */
import { useMemo, useState } from 'react';
import { Search, ExternalLink, Boxes } from 'lucide-react';
import { Input } from '@/components/ui/form-controls';
import { WIMOOR_PAGE_ENTRIES } from '@/lib/wimoor-migration/page-registry';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';

const MODULE_ICONS: Record<string, string> = {
  '产品': '📦', '销售': '📈', '采购': '🛒', '仓库': '🏭', '发货': '🚚',
  '广告': '🎯', '账目': '🧾', '财务': '💰', '设置': '⚙️', '系统': '🔧',
};

export default function WimoorPortalPage() {
  const [query, setQuery] = useState('');
  const [activeModule, setActiveModule] = useState<string>('全部');

  const modules = useMemo(() => ['全部', ...new Set(WIMOOR_PAGE_ENTRIES.map(e => e.l1))], []);
  const filtered = useMemo(() => WIMOOR_PAGE_ENTRIES.filter(e => {
    const matchModule = activeModule === '全部' || e.l1 === activeModule;
    const q = query.trim().toLowerCase();
    const matchQuery = !q || `${e.name} ${e.l2} ${e.comp}`.toLowerCase().includes(q);
    return matchModule && matchQuery;
  }), [query, activeModule]);

  const grouped = useMemo(() => {
    const m = new Map<string, Map<string, typeof filtered>>();
    for (const e of filtered) {
      if (!m.has(e.l1)) m.set(e.l1, new Map());
      const l2 = m.get(e.l1)!;
      if (!l2.has(e.l2)) l2.set(e.l2, []);
      l2.get(e.l2)!.push(e);
    }
    return m;
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <WimoorFeaturePanel route="/wimoor/page.tsx" />
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">WIMOOR 全功能门户</h1>
        <p className="text-xs text-muted">WIMOOR 菜单完整迁移：{WIMOOR_PAGE_ENTRIES.length} 个页面入口，按一级模块分组；含交互/下拉框/跳转逻辑</p>
      </header>
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <Input aria-label="搜索页面" value={query} placeholder="搜索页面名称 / 模块 / 组件" onChange={e => setQuery(e.target.value)} className="pl-7" />
          </div>
          <span className="text-xs text-muted">共 {filtered.length} / {WIMOOR_PAGE_ENTRIES.length} 个页面</span>
        </div>

        <nav className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="模块筛选">
          {modules.map(mod => (
            <button key={mod} onClick={() => setActiveModule(mod)} aria-pressed={activeModule === mod}
              className={`border px-3 py-1 text-xs ${activeModule === mod ? 'border-brand bg-brand/5 text-brand' : 'border-border text-muted hover:text-foreground'}`}>
              {mod === '全部' ? '全部' : `${MODULE_ICONS[mod] ?? '▫️'} ${mod}`}
              <span className="ml-1 text-muted/70">{mod === '全部' ? WIMOOR_PAGE_ENTRIES.length : WIMOOR_PAGE_ENTRIES.filter(e => e.l1 === mod).length}</span>
            </button>
          ))}
        </nav>

        {[...grouped.entries()].map(([l1, groups]) => (
          <section key={l1} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Boxes size={16} />{MODULE_ICONS[l1] ?? '▫️'} {l1}<span className="text-xs font-normal text-muted">{[...groups.values()].reduce((n, arr) => n + arr.length, 0)} 个页面</span></h2>
            {[...groups.entries()].map(([l2, entries]) => (
              <div key={l2} className="border border-border bg-surface">
                <h3 className="border-b border-border bg-surface-muted px-3 py-2 text-xs font-medium text-muted">{l2 || '未分组'}</h3>
                <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {entries.map(e => (
                    e.localHref ? (
                      <a key={e.id} href={e.localHref} className="group flex flex-col gap-1 bg-surface px-3 py-2 text-sm hover:bg-brand/5">
                        <span className="flex items-center justify-between font-medium group-hover:text-brand">
                          {e.name}<ExternalLink size={12} className="text-muted/50 group-hover:text-brand" />
                        </span>
                        <span className="text-xs text-muted" title={e.comp}>WIMOOR: {e.wimoorHref}</span>
                      </a>
                    ) : (
                      <div key={e.id} className="flex flex-col gap-1 bg-surface px-3 py-2 text-sm opacity-60" title="该页为分组/旧系统页或已由等价页承载">
                        <span className="flex items-center justify-between font-medium text-muted">{e.name}<span className="text-xs">已映射</span></span>
                        <span className="text-xs text-muted" title={e.comp}>WIMOOR: {e.wimoorHref}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}

        {filtered.length === 0 ? <p className="border border-border bg-surface px-4 py-8 text-center text-sm text-muted">没有匹配的页面。</p> : null}
      </section>
    </div>
  );
}
