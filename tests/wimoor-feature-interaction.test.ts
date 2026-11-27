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
  assert.match(panelSrc, /onSelect: \(\) => clickAction\(label, '下拉动作'\)/, '下拉项未绑定点击语义');
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
  assert.match(panelSrc, /onChange=\{\(\) => \{ setActiveRadio\(radio\)/, 'radio 未绑定选择');
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
