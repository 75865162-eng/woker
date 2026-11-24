import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const page = read("src/app/(erp)/ai/chat/page.tsx");
const workspace = read("src/components/ai-chat/ai-chat-workspace.tsx");
const catalog = read("src/lib/lili/catalog.ts");

test("AI 对话页按当前语言把技能 prompt 传给工作台", () => {
  assert.match(page, /prompt: locale === "en" \? s\.promptEn : s\.promptZh/, "中英文 prompt 需随 locale 下发");
});

test("工作台 Skill 类型携带 prompt，且选中时自动填入输入框", () => {
  assert.match(workspace, /type Skill = \{[^}]*prompt: string[^}]*\}/);
  // applySkill 同时切换技能、填入 prompt、聚焦输入框。
  assert.match(workspace, /const applySkill = useCallback\(\(slug: string\) => \{[\s\S]{0,240}setSkillSlug\(slug\)[\s\S]{0,240}setDraft\(picked\.prompt\)[\s\S]{0,120}focus\(\)/);
});

test("顶部下拉选择技能走 applySkill（自动填入对话框）", () => {
  assert.match(workspace, /<select value=\{skillSlug\} onChange=\{e => applySkill\(e\.target\.value\)\}/);
});

test("右侧候选技能点击走 applySkill（自动填入对话框）", () => {
  assert.match(workspace, /filteredSkills\.map\(s => <button[^>]*onClick=\{\(\) => applySkill\(s\.slug\)\}/);
});

test("URL 带 skill 参数进入时也把 prompt 填入对话框", () => {
  assert.match(workspace, /if \(initialSkillSlug\) \{[\s\S]{0,240}setDraft\(picked\.prompt\)/);
});

test("技能 prompt 来自目录的中文/英文问法，长度在单条消息上限内", () => {
  assert.match(catalog, /promptZh: \[/);
  assert.match(catalog, /promptEn: \[/);
  const types = read("src/lib/ai-chat/types.ts");
  const limit = Number(types.match(/maxMessageChars:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(limit) && limit > 0, "应能解析消息字数上限");
  const skills = JSON.parse(read("src/data/lili/skills.json")) as Array<{ zhSum: string; stepsZh: string[] }>;
  for (const s of skills) {
    const prompt = [`使用技能。`, s.zhSum, ...s.stepsZh].join("\n");
    assert.ok(prompt.length < limit, `技能 prompt 不应超过单条消息上限: ${prompt.length} >= ${limit}`);
  }
});
