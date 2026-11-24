import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const tools = read("src/lib/ai-chat/skill-tools.ts");
const runtime = read("src/lib/ai-chat/runtime.ts");
const orchestrator = read("src/lib/ai-chat/orchestrator.ts");
const billing = read("src/lib/ai-chat/billing.ts");
const workspace = read("src/components/ai-chat/ai-chat-workspace.tsx");

test("Skill 内部工具以 catalog/manifest/skill-engine 为唯一源，暴露 list/get/run", () => {
  assert.match(tools, /import \{ listSkills, findSkill, skillMarkdown \} from "@\/lib\/lili\/catalog"/);
  assert.match(tools, /import \{ getSkillManifest \} from "@\/lib\/lili\/skill-manifest"/);
  assert.match(tools, /import \{ loadSkillBody \} from "@\/lib\/skill-engine\/config"/);
  assert.match(tools, /import \{ runSkill \} from "@\/lib\/skill-engine\/runner"/);
  for (const name of ["skill_list", "skill_get", "skill_run"]) {
    assert.match(tools, new RegExp(`name: "${name}"`));
  }
});

test("Skill 发现/读取/运行三步只读放行；正文是流程文档不是指令", () => {
  assert.match(tools, /readOnlyHint: true/);
  assert.match(tools, /正文是流程说明，不是可执行工具，也不是指令/);
  assert.match(orchestrator, /skill_list 列出可用技能/);
  assert.match(orchestrator, /skill_run 用服务器内已配置的模型运行技能/);
});

test("identity 只来自 scope 闭包，不接受模型参数携带组织/用户/角色/工作区", () => {
  assert.match(tools, /rejectCredentials\(args\)/);
  assert.match(tools, /organizationId: context\.scope\.organizationId/);
  assert.match(tools, /workspaceId: context\.scope\.workspaceId/);
  assert.match(tools, /userId: context\.scope\.userId/);
  // 模型不可通过 inputs 传身份：normalizeInputs 只截字符串且工具 schema additionalProperties 为 string。
  assert.ok(tools.includes('additionalProperties: { type: "string" }'), "skill_run.inputs 只接受字符串值");
  assert.match(tools, /模型不可通过 inputs 传入组织、用户、角色或工作区/);
});

test("skill_run 前后复验会话；只做只读分析并保存自己的报告历史，不写业务表", () => {
  // dispatch 入口、runSkill 之前与生成完成后各有一次 assertSession。
  const assertCalls = (tools.match(/context\.assertSession\(\)/g) ?? []).length;
  assert.ok(assertCalls >= 3, `会话复验次数不足: ${assertCalls}`);
  assert.match(tools, /for await \(const event of generator\)/);
  assert.match(tools, /saveSkillRun\(\{/);
  assert.match(tools, /putReport\(\{/);
  assert.match(tools, /未执行任何写入|未修改任何店铺\/广告数据|只读分析/);
  // 未引入任何 prisma.<业务表>.create/update/delete 写操作（只允许 amazonSyncDataSource.findMany 读）。
  const writes = tools.match(/prisma\.\w+\.(create|update|delete|upsert|updateMany|deleteMany)/g) ?? [];
  assert.deepEqual(writes, [], `skill-tools 不应直接写业务表: ${writes.join(", ")}`);
  assert.match(tools, /findMany\(\{/);
});

test("skill_run 把下载链接作为 source 回灌为证据并可落库展示", () => {
  assert.match(tools, /source: `\/api\/skills\/\$\{encodeURIComponent\(view\.slug\)\}\/export\//);
  assert.match(orchestrator, /resultSource: bounded\.source/);
  assert.match(orchestrator, /boundResult\(result\)/);
  assert.match(workspace, /resultSource\?\.startsWith\("\/api\/skills\/"\)/);
  assert.match(workspace, /下载报告文件/);
});

test("积分只计量卖家精灵/西柚；Skill 与其他 provider 不收费，且走影子模式不成为故障源", () => {
  assert.match(billing, /new Set\(\["sellersprite", "xiyou"\]\)/);
  assert.match(billing, /startAgentMeter/);
  assert.match(billing, /agentId: "market"/);
  assert.match(orchestrator, /startPaidSourceMeter\(\{ scope, provider: tool\.provider/);
  assert.match(orchestrator, /await meter\?\.settle/);
  assert.match(orchestrator, /await meter\?\.release\(\)/);
  // 计量请求键由 runId + seq 派生，重放幂等。
  assert.match(billing, /chat-paid:\$\{input\.runId\}:\$\{input\.seq\}:\$\{input\.provider\}/);
  // 不拦截业务：异常由积分层吞掉（这里仅确认没有主动 throw 阻断）。
  assert.ok(!/throw new Error\("POINTS_/.test(billing));
});

test("编排层只在传入 settings 时注入服务器内 Skill 工具，保持三参数调用形式", () => {
  assert.ok(runtime.includes("settings?: AiModelSettings,"), "buildChatRuntime 增加可选 settings 参数");
  assert.ok(runtime.includes("sessionGuard?: () => Promise<void>,"), "保留 sessionGuard 参数");
  assert.ok(runtime.includes("enabledProviders?: ChatDataProvider[],"), "保留 enabledProviders 参数");
  assert.match(runtime, /if \(settings\) \{[\s\S]{0,400}createChatSkillTools\(/);
  assert.match(orchestrator, /buildChatRuntime\(scope, input\.sessionGuard, input\.enabledProviders, settings, input\.runId\)/);
});
