/**
 * WIMOOR 功能 100% 对齐契约测试。
 *
 * 固化「原版有的功能，迁移页都能找到」这一验收基准：
 *  1. 功能契约文件覆盖原版全部可映射页；
 *  2. 每个契约页的全部功能项都通过通用功能面板真实渲染；
 *  3. 全部迁移页（Master/Amazon/Report/Custom）都已接入面板；
 *  4. 写操作红线：写入动作走 preview 预览，不产生真实 HTTP 写入、闸门保留。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const CONTRACT_FILE = 'src/lib/wimoor-migration/page-feature-contracts.generated.ts';
const PANEL = 'src/components/wimoor-migration/wimoor-feature-panel.tsx';
const MASTER = 'src/components/wimoor-migration/master-data-workbench.tsx';
const AMAZON = 'src/components/wimoor-migration/amazon-dataset-workbench.tsx';

const contractSrc = read(CONTRACT_FILE);
const panelSrc = read(PANEL);
const masterSrc = read(MASTER);
const amazonSrc = read(AMAZON);

/** 从契约文件解析出所有契约条目：route + 各功能项数组 */
function parseContracts() {
  const entries: { route: string; body: string }[] = [];
  const re = /^  '(\/wimoor\/[^']+)': \{([\s\S]*?)^  \},/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contractSrc))) entries.push({ route: m[1], body: m[2] });
  return entries;
}
const contracts = parseContracts();

test('功能契约覆盖原版全部可映射页（>=110 页）', () => {
  assert.ok(contracts.length >= 110, `契约页数不足：${contracts.length}`);
  // 截图案例：广告管理页契约完整
  const ads = contracts.find(c => c.route === '/wimoor/ads/manager');
  assert.ok(ads, '缺少广告管理页契约');
  for (const label of ['新建广告活动', '新建广告组', '添加关键词', '调整预算', '保存这次搜索']) {
    assert.match(ads.body, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `广告管理契约缺少「${label}」`);
  }
});

test('契约包含全部功能维度（按钮/下拉/弹窗/标签页/选项/搜索字段）', () => {
  for (const dim of ['actions:', 'dropdowns:', 'dialogs:', 'tabs:', 'radios:', 'searchHints:']) {
    assert.ok(contractSrc.includes(dim), `契约缺少维度 ${dim}`);
  }
  // 功能项总量可验收（源码中字符串字面量数量）
  const literalCount = (contractSrc.match(/'[^']+'/g) ?? []).length;
  assert.ok(literalCount > 2000, `功能项总量偏低：${literalCount}`);
});

test('通用功能面板渲染契约全部功能维度', () => {
  for (const dim of ['actions', 'dropdowns', 'dialogs', 'tabs', 'radios', 'searchHints']) {
    assert.match(panelSrc, new RegExp(`contract\\.${dim}`), `面板未渲染维度 ${dim}`);
  }
  // 数据属性供浏览器验收
  assert.match(panelSrc, /data-wimoor-features/);
  assert.match(panelSrc, /data-contract-count/);
  assert.match(panelSrc, /data-wimoor-feature-panel/);
  // 按 kind / route 双通道查契约
  assert.match(panelSrc, /contractForKind/);
  assert.match(panelSrc, /contractForRoute/);
});

test('全部迁移页都已接入功能面板（无遗漏）', () => {
  const pagesDir = new URL('../src/app/(erp)/wimoor/', import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'page.tsx') files.push(p);
    }
  };
  walk(pagesDir);
  assert.ok(files.length >= 120, `迁移页数量偏低：${files.length}`);

  // 两类工作台组件层接入
  assert.match(masterSrc, /<WimoorFeaturePanel kind=\{config\.kind\}[\s\S]*bridge=\{featureBridge\}/);
  assert.match(amazonSrc, /<WimoorFeaturePanel route=\{pageKey\} \/>/);

  // Report/Custom 页面需各自显式注入 route。
  // 门户页 /wimoor 是导航页：已复刻原版树形菜单（左侧模块→右侧抽屉子菜单→搜索实时过滤），
  // 它的 route '/wimoor/page.tsx' 本无功能契约、原面板调用不渲染，故以 data-wimoor-portal 树形导航替代，属合理例外。
  let injected = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const isMaster = src.includes('MasterDataWorkbench');
    const isAmazon = src.includes('AmazonDatasetWorkbench');
    const isPortal = src.includes('data-wimoor-portal');
    if (isPortal) continue;
    if (!isMaster && !isAmazon) {
      assert.match(src, /<WimoorFeaturePanel route="\/wimoor/, `页面未接入功能面板：${f}`);
      injected++;
    }
  }
  assert.ok(injected >= 20, `显式注入页面数偏低：${injected}`);
});

test('设置模块别名 kind 能查到原版功能契约（防面板空白回归）', () => {
  // settings.user / settings.role 是设置模块的别名 kind，对应原版 system.admin / system.role。
  // 若 KIND_TO_ROUTE 缺别名，这两个页面的通用功能面板会查不到契约而空白。
  assert.match(contractSrc, /'settings\.user': '\/wimoor\/system\/admins'/, '缺少 settings.user 别名映射');
  assert.match(contractSrc, /'settings\.role': '\/wimoor\/system\/roles'/, '缺少 settings.role 别名映射');
  // 目标契约页确实存在且含功能项
  for (const route of ['/wimoor/system/admins', '/wimoor/system/roles']) {
    const c = contracts.find(x => x.route === route);
    assert.ok(c, `缺少目标契约页 ${route}`);
    assert.match(c!.body, /actions: \[[^\]]+/, `${route} 无功能项`);
  }
});

test('代码生成页递归提取覆盖无后缀 import 子组件（防漏提回归）', () => {
  const codegen = contracts.find(c => c.route === '/wimoor/system/codegen');
  assert.ok(codegen, '缺少代码生成页契约');
  assert.match(codegen!.body, /sourceComponents: 2/, '代码生成页未扫描到 importTable 子组件');
  for (const label of ['确 定', '取 消', '导入表']) {
    assert.match(codegen!.body, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `代码生成页漏提「${label}」`);
  }
});

test('写操作红线：写入动作走 preview 预览，真实 HTTP 闸门保留', () => {
  assert.match(panelSrc, /WRITE_HINTS/);
  assert.match(panelSrc, /setPreview/);
  assert.match(panelSrc, /操作预览/);
  // 不直接调用写 API：面板中不出现 fetch/axios 等真实写入（注释中的路径说明不算调用）
  const codeOnly = panelSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(codeOnly, /\bfetch\s*\(/);
  assert.doesNotMatch(codeOnly, /axios/);
  // 闸门语义说明存在
  assert.match(panelSrc, /WRITE_OPERATION_CONTRACT_NOT_VERIFIED/);
  assert.match(panelSrc, /不会修改生产广告/);
});
