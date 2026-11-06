import { findSkill, listSkills, listTools, listWorkflows, skillMarkdown, type InputSchema } from "./catalog";

export function validateToolInput(schema: InputSchema, input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["input must be an object"];
  const values = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of schema.required ?? []) {
    if (values[key] === undefined || values[key] === null || values[key] === "") errors.push(`${key} is required`);
  }
  for (const [key, value] of Object.entries(values)) {
    const spec = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (!spec) { errors.push(`${key} is not a defined parameter`); continue; }
    const valid = !spec.type || (spec.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value)
      : spec.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : spec.type === "array" ? Array.isArray(value)
      : spec.type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
      : typeof value === spec.type);
    if (!valid) errors.push(`${key} must be ${spec.type}`);
    if (spec.enum && !spec.enum.includes(value)) errors.push(`${key} is not an allowed value`);
    if (typeof value === "string" && value.length > 4000) errors.push(`${key} is too long`);
  }
  return errors;
}

export async function runCatalogTool(name: string, input: unknown) {
  const tool = listTools().find((row) => row.name === name);
  if (!tool) return { status: 404, body: { ok: false, error: "unknown_tool" } };
  const errors = validateToolInput(tool.inputSchema, input);
  if (errors.length) return { status: 400, body: { ok: false, error: "invalid_tool_input", details: errors } };
  const args = input as Record<string, unknown>;
  if (name === "meta_search_skills") {
    const query = String(args.query).trim().toLowerCase();
    if (!query) return { status: 400, body: { ok: false, error: "empty_query" } };
    const matches = listSkills().filter((skill) => `${skill.slug} ${skill.nameZh} ${skill.nameEn} ${skill.summaryZh} ${skill.summaryEn}`.toLowerCase().includes(query));
    return { status: 200, body: { ok: true, source: "shipped-definitions", skills: matches.slice(0, 20), total: matches.length } };
  }
  if (name === "meta_load_skill") {
    const skill = findSkill(String(args.skill_name));
    if (!skill) return { status: 404, body: { ok: false, error: "unknown_skill" } };
    return { status: 200, body: { ok: true, source: "shipped-definitions", skill, markdown: await skillMarkdown(skill.slug) } };
  }
  if (name === "meta_list_workflows") return { status: 200, body: { ok: true, source: "shipped-definitions", definitionOnly: true, templates: listWorkflows(), message: "仅工作流定义；没有查询保存记录、调度或执行状态。" } };
  return { status: 501, body: { ok: false, error: tool.readOnly ? "tool_adapter_not_mapped" : "live_write_unsupported", tool: name,
    message: "该 Lili 工具尚未映射到主系统的授权执行器。未查询业务数据、创建任务或执行外部写入。",
    nextPath: name.startsWith("ads_") ? "/amazon-ads" : name.startsWith("listing_") ? "/listing-ai" : "/agents" } };
}
