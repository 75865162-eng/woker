/**
 * WIMOOR 功能面板「真实交互」契约测试。
 *
 * 固化用户验收要求：原版子功能不能「平铺成静态 chip」，必须按原版语义
 * 渲染为可交互控件——下拉点击展开、搜索字段可输入可搜索、标签页可切换、
 * 选项可单选。同时保留写操作红线（只读对照，不造数、不发真实请求）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const panelSrc = read('src/components/wimoor-migration/wimoor-feature-panel.tsx');

test('下拉动作使用真实 Dropdown 组件而非平铺 chip', () => {
  assert.match(panelSrc, /import \{[^}]*Dropdown[^}]*\} from '@\/components\/ui\/overlays'/, '未从 overlays 导入 Dropdown');
  assert.match(panelSrc, /<Dropdown[\s\S]*items=\{dropdownItems\}/, '下拉动作未用 Dropdown 渲染');
  assert.match(panelSrc, /trigger=\{[\s\S]*展开下拉动作/, 'Dropdown 缺少可点击触发器');
  assert.match(panelSrc, /onSelect: \(\) => \{[\s\S]*bridge\?\.onDropdown[\s\S]*clickAction\(label, '下拉动作'\)/, '下拉项未绑定点击语义（含 bridge 分支）');
});

test('搜索字段渲染为真实可输入控件（Input/Select/DatePicker）', () => {
  assert.match(panelSrc, /import \{[^}]*Input[^}]*DatePicker[^}]*\} from '@\/components\/ui\/form-controls'/, '未导入真实表单控件');
  assert.match(panelSrc, /<DatePicker[\s\S]*aria-label=\{hint\}/, '日期字段未用 DatePicker');
  assert.match(panelSrc, /<Select[\s\S]*aria-label=\{hint\}/, '下拉字段未用 Select');
  assert.match(panelSrc, /<Input[\s\S]*aria-label=\{hint\}/, '文本字段未用 Input');
  assert.match(panelSrc, /data-testid="wimoor-feature-search-bar"/, '缺少搜索栏标识');
});

test('搜索栏具备真实搜索/重置交互且反馈当前条件', () => {
  assert.match(panelSrc, /onClick=\{doSearch\}/, '缺少搜索按钮');
  assert.match(panelSrc, /onClick=\{resetSearch\}/, '缺少重置按钮');
  assert.match(panelSrc, /setSearchValues\(prev => \(\{ \.\.\.prev, \[hint\]: v \}\)\)/, '搜索值未写入状态');
  assert.match(panelSrc, /已按 \$\{filledConditions\.length\} 个条件搜索/, '搜索未反馈当前条件');
  assert.match(panelSrc, /e\.key === 'Enter'\) doSearch\(\)/, '回车未触发搜索');
});

test('标签页可切换、选项可单选', () => {
  assert.match(panelSrc, /setActiveTab\(tab\)/, '标签页未绑定切换');
  assert.match(panelSrc, /type="radio"[\s\S]*checked=\{activeRadio === radio\}/, '选项未用真实 radio');
  assert.match(panelSrc, /setActiveRadio\(radio\)[\s\S]*bridge\?\.onOption/, 'radio 未绑定选择（含 bridge 分支）');
});

test('搜索字段语义分类覆盖文本/下拉/日期/列标签', () => {
  assert.match(panelSrc, /export function classifySearchField/, '缺少语义分类函数');
  assert.match(panelSrc, /\^\(开始\|结束\|选择\)\(日期\|月份\|时间\)/, '缺少日期分类规则');
  assert.match(panelSrc, /\^\(全部\|请选择\|选择\)/, '缺少下拉分类规则');
  assert.match(panelSrc, /\^\(请输入\|搜索\|输入\)/, '缺少文本分类规则');
  assert.match(panelSrc, /return 'column'/, '缺少列标签兜底分类');
});

test('写操作红线保留：写入动作只弹预览，不发真实请求、不造数', () => {
  assert.match(panelSrc, /WRITE_HINTS/);
  assert.match(panelSrc, /setPreview/);
  assert.match(panelSrc, /操作预览/);
  assert.match(panelSrc, /WRITE_OPERATION_CONTRACT_NOT_VERIFIED/);
  assert.match(panelSrc, /不会修改生产广告/);
  assert.match(panelSrc, /只读对照，不造数/);
  const codeOnly = panelSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(codeOnly, /\bfetch\s*\(/);
  assert.doesNotMatch(codeOnly, /axios/);
});

const workbenchSrc = read('src/components/wimoor-migration/master-data-workbench.tsx');

test('功能面板接入工作台真实能力（bridge），不再是空 toast', () => {
  // 面板定义了 bridge 接口
  assert.match(panelSrc, /export interface WimoorFeatureBridge/, '面板缺少 bridge 接口定义');
  assert.match(panelSrc, /bridge\?: WimoorFeatureBridge/, '面板未接收 bridge prop');
  // 面板各功能项都走 bridge 回调
  assert.match(panelSrc, /bridge\?\.onSubmitSearch/, '搜索未接 bridge');
  assert.match(panelSrc, /bridge\?\.onSearch/, '搜索字段输入未接 bridge');
  assert.match(panelSrc, /bridge\?\.onResetSearch/, '重置未接 bridge');
  assert.match(panelSrc, /bridge\?\.onDropdown/, '下拉未接 bridge');
  assert.match(panelSrc, /bridge\?\.onTab/, '标签页未接 bridge');
  assert.match(panelSrc, /bridge\?\.onOption/, '选项未接 bridge');
  assert.match(panelSrc, /bridge\?\.onAction/, '操作按钮未接 bridge');
  assert.match(panelSrc, /bridge\?\.onDialog/, '弹窗未接 bridge');
});

test('工作台把面板功能映射到真实筛选/查询/操作状态', () => {
  assert.match(workbenchSrc, /const featureBridge = useMemo/, '工作台未构建 featureBridge');
  assert.match(workbenchSrc, /<WimoorFeaturePanel kind=\{config\.kind\} bridge=\{featureBridge\}/, '面板未传入 bridge');
  // 标签→真实字段映射
  assert.match(workbenchSrc, /const resolveFieldKey = \(label: string\)/, '缺少标签→字段映射');
  assert.match(workbenchSrc, /setQuickValues\(v => \(\{ \.\.\.v, \[key\]: value \}\)\)/, '搜索未写真实筛选状态');
  assert.match(workbenchSrc, /setSearch\(value\)/, '未命中字段未走真实全文查询');
  // 下拉/操作交给真实 runMenuAction 分发
  assert.match(workbenchSrc, /onDropdown: \(label: string\)[\s\S]*runMenuActionRef\.current/, '下拉未接真实动作分发');
  assert.match(workbenchSrc, /runMenuActionRef\.current = runMenuAction/, '动作分发 ref 未赋值');
  // 页签驱动真实 activeTab
  assert.match(workbenchSrc, /onTab: \(label: string\)[\s\S]*setActiveTab\(tab\.value\)/, '页签未驱动真实状态');
});

test('原版分区布局：页签→工具栏→inline筛选→折叠列字段，不再平铺', () => {
  // 面板按被移植页布局范式分区，而非 116 项堆成一排 chip
  assert.match(panelSrc, /data-wimoor-layout="original"/, '缺少原版布局标识');
  const tabIdx = panelSrc.indexOf('① 顶部标签页');
  const toolbarIdx = panelSrc.indexOf('② 工具栏');
  const filterIdx = panelSrc.indexOf('③ 筛选区');
  const colIdx = panelSrc.indexOf('⑤ 列字段');
  assert.ok(tabIdx > 0 && toolbarIdx > tabIdx && filterIdx > toolbarIdx && colIdx > filterIdx,
    `原版分区顺序错误：tab=${tabIdx} toolbar=${toolbarIdx} filter=${filterIdx} col=${colIdx}`);
  // 列字段折叠，不抢主视觉
  assert.match(panelSrc, /columnsOpen/, '列字段未做折叠');
  // 有桥接时默认展开，让原版功能真实可见可用
  assert.match(panelSrc, /useState\(defaultOpen \|\| !!bridge\)/, '桥接页未默认展开面板');
});

test('下拉筛选字段用工作台真实数据选项，不再伪造「指定XX」', () => {
  assert.match(panelSrc, /optionsFor\?: \(field: string\)/, 'bridge 缺少 optionsFor 接口');
  assert.match(panelSrc, /const real = bridge\?\.optionsFor\?\.\(hint\)/, '面板未取真实选项');
  assert.match(panelSrc, /options=\{optionsFor\(hint\)\}/, 'Select 未使用真实选项');
  assert.match(workbenchSrc, /optionsFor: \(field: string\) =>/, '工作台未实现 optionsFor');
  assert.match(workbenchSrc, /from the current data|从本页已加载数据按映射字段去重/, '工作台未从真实数据去重生成选项');
});

test('布局对齐原版：页签在功能行之后、表格之前，面板折叠置底', () => {
  // 功能行之后紧跟状态页签，再是 DataTable
  const funcRowIdx = workbenchSrc.indexOf('{/* 功能行 */}');
  const tabIdx = workbenchSrc.indexOf('{/* 状态页签：原版布局位于功能行之后、表格之前 */}');
  const tableIdx = workbenchSrc.indexOf('<DataTable<Row>');
  const panelIdx = workbenchSrc.indexOf('<WimoorFeaturePanel kind={config.kind} bridge={featureBridge}');
  assert.ok(funcRowIdx > 0 && tabIdx > funcRowIdx && tableIdx > tabIdx,
    `布局顺序错误：功能行=${funcRowIdx} 页签=${tabIdx} 表格=${tableIdx}`);
  assert.ok(panelIdx > tableIdx, '功能面板未在表格之后（应折叠置底，不抢主视觉）');
});
