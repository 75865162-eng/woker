'use client';

/**
 * WIMOOR 全功能门户：复刻原版 Wimoor AsideMenu 交互。
 * 原版：左侧一级模块菜单 → 点击/悬停弹出抽屉子菜单 → 子菜单按二级分组、分组可折叠展开 → 点击子项跳转。
 * 本页：左侧模块栏（点击即展开），右侧抽屉式二级分组（点击即下拉/折叠），顶部搜索按原版逻辑实时过滤并自动展开命中分组。
 * 每个入口标注 WIMOOR 原始 href 与源 Vue 组件，便于逐页对照。
 */
import { useMemo, useState } from 'react';
import { Search, ExternalLink, ChevronRight, ChevronDown, PanelLeft } from 'lucide-react';
import { Input } from '@/components/ui/form-controls';
import { WIMOOR_PAGE_ENTRIES, type WimoorPageEntry } from '@/lib/wimoor-migration/page-registry';

const MODULE_ICONS: Record<string, string> = {
  '产品': '📦', '销售': '📈', '采购': '🛒', '仓库': '🏭', '发货': '🚚',
  '广告': '🎯', '账目': '🧾', '财务': '💰', '设置': '⚙️', '系统': '🔧',
};

type Group = { l2: string; entries: WimoorPageEntry[] };

export default function WimoorPortalPage() {
  const [query, setQuery] = useState('');
  // 当前展开的一级模块（原版一次只展开一个抽屉）
  const [activeModule, setActiveModule] = useState<string>('产品');
  // 已折叠的二级分组 key = `${l1}/${l2}`（原版 handleExpend：点击箭头切换展开/收起）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 左侧栏是否收起
  const [railCollapsed, setRailCollapsed] = useState(false);

  const modules = useMemo(() => [...new Set(WIMOOR_PAGE_ENTRIES.map(e => e.l1))], []);

  const q = query.trim().toLowerCase();
  // 搜索：按原版逻辑实时过滤（名称/二级分组/组件/原始href任一命中）
  const matched = useMemo(() => WIMOOR_PAGE_ENTRIES.filter(e =>
    !q || `${e.name} ${e.l2} ${e.comp} ${e.wimoorHref}`.toLowerCase().includes(q)
  ), [q]);

  // 当前模块的数据；搜索命中时跨模块展示命中项
  const groups: Group[] = useMemo(() => {
    const pool = q ? matched : WIMOOR_PAGE_ENTRIES.filter(e => e.l1 === activeModule);
    const m = new Map<string, WimoorPageEntry[]>();
    for (const e of pool) {
      const key = q ? `${e.l1}/${e.l2}` : e.l2;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return [...m.entries()].map(([key, entries]) => ({ l2: key, entries }));
  }, [q, matched, activeModule]);

  // 搜索时自动展开所有命中分组（原版搜索即展开），否则用手动折叠状态
  const isOpen = (g: Group) => q ? true : !collapsed.has(`${activeModule}/${g.l2}`);
  const toggleGroup = (g: Group) => {
    const key = `${activeModule}/${g.l2}`;
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // 命中文字高亮（原版搜索体验）
  const highlight = (text: string) => {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text;
    return <>{text.slice(0, i)}<mark className="bg-brand/20 text-brand px-0.5">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
  };

  const activeCount = (mod: string) => WIMOOR_PAGE_ENTRIES.filter(e => e.l1 === mod).length;

  return (
    <div className="flex flex-col gap-3 p-4" data-wimoor-portal="1">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">WIMOOR 全功能门户</h1>
        <p className="text-xs text-muted">WIMOOR 菜单完整迁移：{WIMOOR_PAGE_ENTRIES.length} 个页面入口 · 按原版树形菜单交互（点击模块展开 · 点击分组折叠 · 搜索实时过滤）</p>
      </header>

      <div className="flex min-h-[600px] border border-border bg-surface">
        {/* 左侧一级模块栏：对应原版 AsideMenu 的 el-menu（点击展开抽屉） */}
        <aside className={`flex shrink-0 flex-col border-r border-border bg-surface-muted transition-all ${railCollapsed ? 'w-12' : 'w-44'}`} aria-label="一级模块菜单">
          <button
            onClick={() => setRailCollapsed(v => !v)}
            className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-xs text-muted hover:text-foreground"
            aria-label={railCollapsed ? '展开模块栏' : '收起模块栏'}
          >
            <PanelLeft size={15} />{!railCollapsed && <span>收起导航</span>}
          </button>
          <nav className="flex flex-1 flex-col gap-px p-1">
            {modules.map(mod => {
              const selected = !q && activeModule === mod;
              return (
                <button
                  key={mod}
                  data-module-id={mod}
                  aria-expanded={selected}
                  aria-pressed={selected}
                  onClick={() => { setActiveModule(mod); setQuery(''); setCollapsed(new Set()); }}
                  title={mod}
                  className={`flex items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors ${selected ? 'bg-brand/10 text-brand font-medium' : 'text-foreground hover:bg-brand/5'}`}
                >
                  <span className="w-5 text-center">{MODULE_ICONS[mod] ?? '▫️'}</span>
                  {!railCollapsed && <>
                    <span className="flex-1 truncate">{mod}</span>
                    <span className="text-[10px] text-muted/70">{activeCount(mod)}</span>
                    <ChevronRight size={12} className={selected ? 'rotate-90 text-brand transition-transform' : 'text-muted/50 transition-transform'} />
                  </>}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 右侧抽屉式子菜单：对应原版 el-drawer（分组可折叠展开） */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                aria-label="搜索页面"
                value={query}
                placeholder="搜索页面名称 / 模块 / 组件 / 原始路径"
                onChange={e => setQuery(e.target.value)}
                className="pl-7"
              />
            </div>
            <span className="text-xs text-muted" data-testid="portal-match-count">
              {q ? `命中 ${matched.length} / ${WIMOOR_PAGE_ENTRIES.length} 个页面` : `${groups.reduce((n, g) => n + g.entries.length, 0)} 个页面`}
            </span>
          </div>

          <div className="flex-1 overflow-auto p-3">
            <h2 className="mb-3 text-sm font-semibold text-muted">
              {q ? '搜索结果' : <>{MODULE_ICONS[activeModule] ?? '▫️'} {activeModule} <span className="font-normal">· {groups.reduce((n, g) => n + g.entries.length, 0)} 个页面</span></>}
            </h2>

            <div className="flex flex-col gap-2" data-testid="portal-groups">
              {groups.map(g => {
                const open = isOpen(g);
                return (
                  <div key={g.l2} className="border border-border" data-group={g.l2}>
                    {/* 二级分组头：点击即下拉/折叠（原版 handleExpend） */}
                    <button
                      data-group-header={g.l2}
                      aria-expanded={open}
                      onClick={() => toggleGroup(g)}
                      className="flex w-full items-center gap-2 border-b border-border bg-surface-muted px-3 py-2 text-left text-xs font-medium text-muted hover:text-foreground"
                    >
                      {open ? <ChevronDown size={14} className="text-brand" /> : <ChevronRight size={14} />}
                      <span className="flex-1">{highlight(g.l2)}</span>
                      <span className="text-muted/70">{g.entries.length}</span>
                    </button>
                    {/* 组内页面入口：展开后可见，点击跳转 */}
                    {open && (
                      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-group-body={g.l2}>
                        {g.entries.map(e => (
                          e.localHref ? (
                            <a
                              key={e.id}
                              href={e.localHref}
                              data-entry-id={e.id}
                              className="group flex flex-col gap-1 bg-surface px-3 py-2 text-sm hover:bg-brand/5"
                            >
                              <span className="flex items-center justify-between font-medium group-hover:text-brand">
                                {highlight(e.name)}<ExternalLink size={12} className="text-muted/50 group-hover:text-brand" />
                              </span>
                              <span className="text-xs text-muted" title={e.comp}>{q && e.l1 !== activeModule ? `${e.l1} · ` : ''}WIMOOR: {e.wimoorHref}</span>
                            </a>
                          ) : (
                            <div key={e.id} data-entry-id={e.id} className="flex flex-col gap-1 bg-surface px-3 py-2 text-sm opacity-60" title="该页为分组/旧系统页或已由等价页承载">
                              <span className="flex items-center justify-between font-medium text-muted">{highlight(e.name)}<span className="text-xs">已映射</span></span>
                              <span className="text-xs text-muted" title={e.comp}>WIMOOR: {e.wimoorHref}</span>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {groups.length === 0 && (
                <p className="border border-border bg-surface px-4 py-8 text-center text-sm text-muted">没有匹配的页面。</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
