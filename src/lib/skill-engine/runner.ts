import type { AiModelSettings } from "@/lib/ai-settings";
import { fetchAiApi } from "@/lib/server/ai-fetch";
import { buildAiRequestHeaders, buildAiTextEndpoint, buildResponsesRequestOptions } from "@/lib/server/ai-runtime";
import { skillTableAvailability } from "@/lib/amazon-sync/skill-data";
import type { DataSource, SkillReportRow, SkillRunEvent, SkillView, StructuredReport } from "./types";

/** 运行时不接触任何写接口：Skill 引擎只做只读分析，结论以报告呈现，写入仍走主系统审批流。 */

const NEEDS_DATA = "NEEDS_DATA";

function systemInstructions(view: SkillView, body: string, dataContext: string): string {
  return [
    "你是条条的运营分析助手，基于给定 Skill 定义与可用的本地数据事实，输出分析报告。",
    "严格约束：",
    "1. 只能使用下方『本地数据事实』中实际提供的数值；没有提供的事实一律写 " + NEEDS_DATA + "，严禁编造、估算或补零。",
    "2. 金额与数量保持原始精度字符串，不要四舍五入成猜测值。",
    "3. 结论要可执行，但不承诺已执行任何店铺修改；写入类动作只给出建议，不声称已落地。",
    "4. 输出必须是单个 JSON 对象，不要包裹 Markdown 代码块，不要附加解释文字。",
    "JSON 结构：",
    '{"title": string, "markdown": string, "rows": Array<Record<string,string|number|null>>, "notes"?: string[]}',
    "markdown 用二级标题分段（如 ## 概览、## 诊断、## 建议）；rows 用于表格导出，字段名用中文，缺失值用 null。",
    "",
    "=== Skill 名称 ===",
    view.name,
    "=== Skill 摘要 ===",
    view.summary,
    "=== Skill 执行步骤（须遵循的分析路径）===",
    view.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "=== Skill 完整定义 ===",
    body || "（该 Skill 无附加正文，按摘要与步骤执行。）",
    "=== 本地数据事实（真实来源；未提供即视为缺失）===",
    dataContext,
  ].join("\n");
}

function userPrompt(view: SkillView, inputs: Record<string, string>): string {
  const lines = [`Skill: ${view.slug}`, "参数："];
  for (const input of view.inputs) {
    const value = inputs[input.key]?.trim();
    lines.push(`- ${input.label}: ${value || "（未提供）"}`);
  }
  lines.push("", "请按系统约束输出 JSON 报告。");
  return lines.join("\n");
}

function buildDataContext(view: SkillView, sources: DataSource[]): string {
  const availability = skillTableAvailability(sources);
  const relevant = view.dataTables.length
    ? availability.filter((table) => view.dataTables.includes(table.name))
    : availability.filter((table) => table.available);
  if (!relevant.length) {
    return "当前工作区没有已发布、可读取的本地数据快照。所有业务数值均为 " + NEEDS_DATA + "；请据此输出方法性报告，不要编造数据。";
  }
  return relevant
    .map((table) => [
      `- 数据集 ${table.name}：可用=${table.available}`,
      `  行数=${table.rowCount ?? NEEDS_DATA}，新鲜度=${table.freshness}，最近同步=${table.lastSyncAt ?? NEEDS_DATA}`,
      table.warnings.length ? `  提示：${table.warnings.join("；")}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n");
}

function parseStructuredReport(text: string): StructuredReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 非 JSON 时保留为纯文本报告，rows 为空，交由导出层生成纯文本 Word。
    return { title: "分析报告", markdown: text.trim(), rows: [], notes: ["模型未按结构化格式输出，已保留原文。"] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { title: "分析报告", markdown: text.trim(), rows: [], notes: ["模型返回内容格式异常，已保留原文。"] };
  }
  const value = parsed as Record<string, unknown>;
  const title = typeof value.title === "string" && value.title.trim() ? value.title : "分析报告";
  const markdown = typeof value.markdown === "string" && value.markdown.trim() ? value.markdown : "";
  const rows: SkillReportRow[] = [];
  if (Array.isArray(value.rows)) {
    for (const row of value.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const clean: SkillReportRow = {};
      for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
        if (cell === null || cell === undefined || cell === "") clean[key] = null;
        else if (typeof cell === "string" || typeof cell === "number") clean[key] = cell;
        else clean[key] = String(cell);
      }
      if (Object.keys(clean).length) rows.push(clean);
    }
  }
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === "string")
    : undefined;
  return { title, markdown: markdown || title, rows, notes };
}

function extractText(value: unknown, chat: boolean): string {
  const body = value as {
    choices?: { message?: { content?: string } }[];
    output_text?: string;
    output?: { content?: { text?: string }[] }[];
  };
  return chat
    ? body.choices?.[0]?.message?.content ?? ""
    : body.output_text ?? body.output?.flatMap((part) => part.content ?? []).map((part) => part.text ?? "").join("\n") ?? "";
}

export type RunOptions = {
  view: SkillView;
  body: string;
  inputs: Record<string, string>;
  aiSettings: AiModelSettings;
  sources: DataSource[];
  actor: string;
};

/** 生成器完成后，运行方通过此回调取得结构化报告用于导出（流式事件本身不含大对象）。 */
export type RunResult = { report: StructuredReport };

export type RunHooks = {
  /** 报告生成后调用，返回临时下载 id 与可持久化历史 id；由路由层负责导出、存储与历史落库。 */
  persistReport: (report: StructuredReport, fileName: string) => Promise<{ downloadId: string; historyId: string | null }>;
};

/**
 * 执行 Skill 并产出 SSE 事件序列。生成器逐步 yield，路由层边执行边推送。
 * LLM 不可用时产出 error 事件，绝不伪造报告。
 */
export async function* runSkill(options: RunOptions, hooks: RunHooks): AsyncGenerator<SkillRunEvent> {
  const { view, body, inputs, aiSettings, sources } = options;

  yield { type: "step", step: { id: "definition", label: "读取 Skill 定义", status: "done", detail: `${view.steps.length} 个分析步骤` } };
  const dataContext = buildDataContext(view, sources);
  yield { type: "step", step: { id: "data", label: "核对本地数据可用性", status: "done", detail: dataContext.includes(NEEDS_DATA) ? "部分数据缺失，将标注 NEEDS_DATA" : "已获取可用数据集摘要" } };

  if (!aiSettings.apiKey) {
    yield { type: "error", code: "AI_NOT_CONFIGURED", message: "当前工作区未配置 AI 模型，无法生成报告。请先在系统设置中配置 AI 凭据。" };
    return;
  }

  const chat = aiSettings.wireApi === "chat_completions";
  yield { type: "step", step: { id: "llm", label: "调用 AI 分析生成报告", status: "running" } };

  const requestBody = chat
    ? {
        model: aiSettings.model,
        messages: [
          { role: "system", content: systemInstructions(view, body, dataContext) },
          { role: "user", content: userPrompt(view, inputs) },
        ],
        response_format: { type: "json_object" },
      }
    : {
        ...buildResponsesRequestOptions(aiSettings),
        model: aiSettings.model,
        instructions: systemInstructions(view, body, dataContext),
        input: userPrompt(view, inputs),
        text: { format: { type: "json_object" } },
      };

  let response: Awaited<ReturnType<typeof fetchAiApi>>;
  try {
    response = await fetchAiApi(buildAiTextEndpoint(aiSettings), {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
      headers: buildAiRequestHeaders(aiSettings),
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    yield { type: "error", code: "AI_CONNECTION_FAILED", message: error instanceof Error ? error.message : "连接 AI 服务失败。" };
    return;
  }

  if (!response.ok) {
    yield { type: "error", code: "AI_HTTP_ERROR", message: `AI 服务返回异常状态 ${response.status}。` };
    return;
  }

  let text: string;
  try {
    text = extractText(await response.json(), chat);
  } catch {
    yield { type: "error", code: "AI_RESPONSE_INVALID", message: "AI 返回内容无法解析。" };
    return;
  }
  if (!text || text.includes(aiSettings.apiKey)) {
    yield { type: "error", code: "AI_RESPONSE_UNSAFE", message: "AI 返回为空或包含敏感信息，已中止。" };
    return;
  }

  yield { type: "step", step: { id: "llm", label: "调用 AI 分析生成报告", status: "done" } };
  const report = parseStructuredReport(text);

  // 逐段推送，前端获得"流式"渲染体验（内容来自真实模型的完整输出）。
  const chunks = report.markdown.match(/[\s\S]{1,240}/g) ?? [report.markdown];
  for (const chunk of chunks) {
    yield { type: "delta", text: chunk };
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const exportFileName = `${view.name.replace(/[\\/:*?"<>|]/g, "_")}_${inputs.asin?.trim() || view.slug}_${stamp}.${view.exportFormat}`;
  yield { type: "step", step: { id: "export", label: "生成导出文件", status: "running" } };
  let downloadId: string;
  let historyId: string | null = null;
  try {
    const persisted = await hooks.persistReport(report, exportFileName);
    downloadId = persisted.downloadId;
    historyId = persisted.historyId;
  } catch {
    yield { type: "error", code: "EXPORT_FAILED", message: "报告已生成，但导出文件创建失败。" };
    return;
  }
  yield { type: "step", step: { id: "export", label: "生成导出文件", status: "done", detail: exportFileName } };
  yield {
    type: "done",
    report: report.markdown,
    exportFormat: view.exportFormat,
    exportFileName,
    downloadId,
    historyId,
  };
  void options.actor;
}
