import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 多标签「点击假死」复发的静态防线。
 *
 * 背景（2026-11-19）：把 Next.js 每帧刷新的 live LayoutRouterContext 注入当前激活视图的
 * KeptView，会击穿 memo 导致整棵业务子树空转重渲染，主线程被占满后真实导航被拖延，
 * 表现为「点击假死」。该缺陷纯运行期难以在单测复现，故用源码守卫锁死修复不被改回。
 * 本测试随 `npm run test` 在 CI 每 PR 运行，零登录依赖。
 */

const root = process.cwd();
const shellSource = readFileSync(path.join(root, "src/components/app-shell/persistent-app-shell.tsx"), "utf8");
const navSource = readFileSync(path.join(root, "src/components/app-shell/business-navigation.ts"), "utf8");

/** 去掉注释再断言，避免注释里的说明文字造成误判。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const code = stripComments(shellSource);
const navCode = stripComments(navSource);

test("P0: 激活视图只使用登记时的稳定 context 快照，禁止注入 live segmentContext", () => {
  // KeptView 的 context prop 必须是 view.context（稳定快照），不得按当前 href 分支注入 segmentContext。
  // 这是防假死的核心不变式：live context 每帧换新引用，一旦作为 prop 传给 memo 的 KeptView
  // 就会击穿 memo，让整棵保活子树（重表单/表格）空转重渲染，主线程占满后表现为点击假死。
  const contextProp = code.match(/context=\{([^\n}]+)\}/);
  assert.ok(contextProp, "应能定位 KeptView 的 context prop");
  assert.ok(!/segmentContext/.test(contextProp![1]),
    `KeptView 的 context 不得注入 live segmentContext（会击穿 memo 引发渲染风暴），当前为: ${contextProp![1]}`);
  assert.match(contextProp![1], /view\.context/, "KeptView 的 context 必须是稳定的 view.context 快照");
});

test("P0: 视图登记 effect 必须在 context 变化时自愈,且以引用比较 bail 稳定页", () => {
  // 背景（2026-11-20）：children 在所有视图间共享同一引用（App Router 的 children 只是
  // 「当前分段」占位节点，靠 LayoutRouterContext 现场解析），旧版 effect 用
  // current.element === children 做 bail 恒为真 → context 快照一旦在过渡态登记就永不校正，
  // 表现为「切页后内容错位/空白、取数落在错误路由，F5 重建外壳才恢复」。
  // 修复：effect 依赖 segmentContext（Next 用新 tree 刷新它时校正快照），体内先用引用比较
  // bail。这不违反防假死不变式——live context 绝不作为 prop 传给 KeptView（见上一条守卫），
  // effect 依赖本身不会击穿 memo；稳定页 segmentContext 不变化，effect 不会 setViews。
  const selfHealEffect = code.match(/useEffect\(\(\) => \{[\s\S]*?current\.context === segmentContext[\s\S]*?\}, \[[^\]]*segmentContext[^\]]*\]\)/);
  assert.ok(selfHealEffect,
    "必须存在以 current.context === segmentContext 做 bail、且依赖含 segmentContext 的自愈 effect");
  // 禁止退回旧的恒真 bail：不得再用 element === children 作为唯一的跳过条件。
  const legacyBail = /if \(!current \|\| current\.element === children\) \{[\s\S]*?return;/;
  assert.ok(!legacyBail.test(code),
    "不得用 current.element === children 作为唯一 bail（children 共享引用使判断恒真，context 永不自愈）");
});

test("P1: AI 入口用 /ai/lili 命名空间 + 服务端 rewrite 直达，无 redirect 跳板页", () => {
  const aiGroup = navCode.match(/\{ id: "ai"[\s\S]*?\n  \] \}/);
  assert.ok(aiGroup, "应能定位 AI 导航组");
  const block = aiGroup![0];
  // 入口保持本板块命名空间前缀 /ai/lili（远端约束），但不得是 page.tsx redirect 跳板。
  assert.match(block, /href: "\/ai\/lili"/, "AI 一级入口应为 /ai/lili 命名空间路径");
  assert.match(block, /id: "ai\.lili", href: "\/ai\/lili"/, "粒粒 Lili 二级入口应为 /ai/lili");

  // 关键防线：/ai/lili 必须由 rewrite 直达 /lili，且不存在会优先于 rewrite 的 redirect 跳板页。
  const nsSource = readFileSync(path.join(root, "src/lib/navigation/namespace-routes.ts"), "utf8");
  const nsCode = stripComments(nsSource);
  assert.match(nsCode, /\{ href: "\/ai\/lili",[^}]*destination: "\/lili"/,
    "/ai/lili 必须由服务端 rewrite 直达 /lili");
  assert.ok(!existsSync(path.join(root, "src/app/(erp)/ai/lili/page.tsx")),
    "/ai/lili 不得存在 page.tsx redirect 跳板（文件系统路由会优先于 afterFiles rewrite）");
});

test("诊断模块在生产构建中必须为空操作（no-op）", () => {
  const diagSource = readFileSync(path.join(root, "src/lib/app-shell/tab-navigation-diagnostics.ts"), "utf8");
  const diagCode = stripComments(diagSource);
  assert.match(diagCode, /NODE_ENV/,
    "诊断模块必须按 NODE_ENV 守卫，确保生产环境零开销、零副作用");
});
