import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const orchestrator = read("src/lib/ai-chat/orchestrator.ts");
const runtime = read("src/lib/ai-chat/runtime.ts");

test("对话编排器要求端到端研究意图先走 research_prepare，禁止谎报无工具", () => {
  assert.match(orchestrator, /必须先调用 research_prepare 工具解析需求/);
  assert.match(orchestrator, /禁止回答“没有这些工具”或“技能库没有匹配流程”/);
});

test("仅对话运行时以只读方式注入 research_prepare，有状态 research_* 不进入对话", () => {
  assert.match(runtime, /import \{ publicResearchTools, callPublicResearchTool \} from "@\/lib\/lili\/public-research-tools"/);
  assert.match(runtime, /extraSkillTools[\s\S]{0,200}callPublicResearchTool/);
  assert.match(runtime, /stateful research_\* workflow[\s\S]{0,160}NOT added/);
});

test("编排器对四个只读 provider 放行，但拒绝被 blocked 或权限不足的工具", () => {
  assert.match(orchestrator, /tool\.provider === "sellfox" \|\| tool\.provider === "sellersprite" \|\| tool\.provider === "xiyou"/);
  assert.match(orchestrator, /tool\.availability === "available"/);
  assert.match(orchestrator, /throw new Error\("TOOL_NOT_READABLE"\)/);
  assert.match(orchestrator, /throw new Error\("TOOL_NOT_ALLOWED"\)/);
});

test("research_prepare 是只读、免认证、不持久化的阶段0工具", () => {
  const source = read("src/lib/lili/public-research-tools.ts");
  assert.match(source, /name: "research_prepare"/);
  assert.match(source, /readOnlyHint: true/);
  assert.match(source, /persisted: false/);
  assert.match(source, /marketDataCollected: false/);
});
