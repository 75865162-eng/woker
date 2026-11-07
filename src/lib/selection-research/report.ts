import { calculateLandedCostScenario, landedCostEvidenceIds } from "./landed-cost";
import { evaluateResearchEconomics, evaluateProductScorecard } from "./economics";
import { prepareLowStarReviews, rankReviewProblems } from "./review-evidence";
import type { Run } from "./types";
import { rejectCredentials } from "./schema";
import { researchBudgetPreview, researchUsage } from "./budget";
import { budgetSummary } from "./engine";

function reviewSection(result: Run["results"][number]) {
  if (!result.reviewEvidence) return "";
  const reviews = prepareLowStarReviews(result.reviewEvidence);
  const problems = rankReviewProblems(reviews, result.reviewProblems ?? []);
  return `<h3>低星评论样本与改良证据</h3><pre>${escape(JSON.stringify({ ...reviews, problems }, null, 2))}</pre>`;
}
function landedCostSection(result: Run["results"][number]) {
  if (!result.landedCostScenarios) return "";
  return `<h3>关税与到岸成本情景（代码重算）</h3><p>候选税目、待确认税率和压力测试仅作为预算情景；计算成功不表示税率已核实。</p><pre>${escape(JSON.stringify(result.landedCostScenarios.map(scenario => ({ ...scenario, result: calculateLandedCostScenario(scenario) })), null, 2))}</pre>`;
}
function decisionSection(result: Run["results"][number]) {
  if (!result.decisionAnalysis) return "";
  return `<h3>评分与利润重算</h3><pre>${escape(JSON.stringify({
    scenarios: result.decisionAnalysis.scenarios.map(scenario => ({ ...scenario, result: evaluateResearchEconomics(scenario) })),
    scorecards: result.decisionAnalysis.scorecards.map(card => ({ ...card, result: evaluateProductScorecard(card) })),
  }, null, 2))}</pre>`;
}
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
/** A static, offline, single-file report. No external assets, scripts or provider branding. */
export function renderResearchReport(run: Run, images: { evidenceId: string; mime: "image/png" | "image/jpeg" | "image/webp"; base64: string; alt: string }[] = []): string {
  if (run.status !== "COMPLETED" || run.results.length !== 5 || !run.decisions.some((entry) => entry.decision.kind === "SELECT") || !run.decisions.some((entry) => entry.decision.kind === "CONFIRM")) throw new Error("REPORT_REQUIRES_BOTH_HUMAN_GATES");
  rejectCredentials(run);
  // Retries render the approved snapshot identically, including after FileObject was saved but the task checkpoint failed.
  const approvedAt = [...run.decisions].reverse().find(entry => entry.decision.kind === "CONFIRM")!.at;
  const media = images.map((image) => {
    if (!run.calls.some((call) => call.id === image.evidenceId && call.status === "SUCCEEDED") || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw new Error("IMAGE_EVIDENCE_REQUIRED");
    const bytes = Buffer.from(image.base64, "base64");
    if (bytes.length > 2_000_000 || !(image.mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || image.mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 || image.mime === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")) throw new Error("INVALID_EMBEDDED_IMAGE");
    return `<figure><img style="max-width:320px" alt="${escape(image.alt)}" src="data:${image.mime};base64,${image.base64}"><figcaption>${escape(image.alt)} · 证据 ${escape(image.evidenceId)}</figcaption></figure>`;
  }).join("");
  const labels = ["细分市场", "深度市场研究", "评论与改良机会", "关税与到岸成本", "决策与风险"];
  const sections = run.results.map((result, i) => `<section id="stage-${i + 1}"><h2>${i + 1}. ${labels[i]}</h2><p>${escape(result.summary)}</p>${result.verdict ? `<p><strong>结论：${escape(result.verdict)}</strong></p>` : ""}${i === 1 ? media : ""}${i === 2 ? reviewSection(result) : ""}${i === 4 ? decisionSection(result) : ""}${i === 3 ? landedCostSection(result) : ""}<table><thead><tr><th>结论</th><th>数据性质</th><th>公式 / 适用日期</th><th>证据</th></tr></thead><tbody>${result.claims.map((claim) => `<tr><td>${escape(claim.text)}</td><td>${escape(claim.kind)}</td><td>${escape(claim.formula)} ${escape(claim.applicableDate)} ${escape(claim.sourceUrl)}</td><td>${claim.evidenceIds.map((id) => `<a href="#e-${escape(id)}">${escape(id)}</a>`).join("<br>")}</td></tr>`).join("")}</tbody></table></section>`).join("");
  const budget = budgetSummary(run);
  const maximum = Math.max(1, ...Object.values(budget).map((entry) => entry.limit));
  const chart = `<svg viewBox="0 0 600 ${Math.max(60, Object.keys(budget).length * 45)}" role="img" aria-label="各数据源预算单位使用与上限">${Object.entries(budget).map(([provider, entry], i) => `<text x="0" y="${i * 45 + 20}" font-size="12">${escape(provider)}</text><rect x="140" y="${i * 45 + 5}" width="${entry.limit / maximum * 340}" height="20" fill="#e2e8f0"/><rect x="140" y="${i * 45 + 5}" width="${Math.min(entry.committed / maximum * 340, 340)}" height="20" fill="#2563eb"/><text x="490" y="${i * 45 + 20}" font-size="12">${entry.committed} / ${entry.limit}</text>`).join("")}</svg>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>AI 选品研究报告</title><style>body{max-width:1200px;margin:auto;padding:24px;color:#172033;font:15px/1.6 system-ui,sans-serif}nav{display:flex;flex-wrap:wrap;gap:16px;padding:12px;background:#eef2f7}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:10px;border:1px solid #cbd5e1;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2f7}section{margin:32px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{border:1px solid #cbd5e1;padding:12px;margin:8px 0}svg{width:100%;max-width:700px}a{color:#1d4ed8}.warning{padding:16px;background:#fff4cf}@media print{body{max-width:none;padding:0}nav{display:none}h2{break-after:avoid}details{break-inside:avoid}details::details-content{display:block}a{color:inherit}table{font-size:11px}}</style></head><body><h1>AI 选品研究报告</h1><p>审批定稿时间：${escape(approvedAt)} · 查询市场：${escape(run.marketplace)}${run.asin ? ` · 目标 ASIN：${escape(run.asin)}` : ""} · 项目：${escape(run.id)}</p><p>报告由本地选品研究引擎依据保存证据整理，AI 结论须结合原始记录审阅。</p>${run.mode === "fixture" ? '<p class="warning">离线测试报告：所有市场记录均为测试样本，不代表真实行情，不能用于采购或投资决策。</p>' : ""}<p>${escape(run.requirement)}</p><nav>${labels.map((label, i) => `<a href="#stage-${i + 1}">${i + 1}. ${label}</a>`).join("")}<a href="#evidence">原始证据</a><a href="#audit">审批与预算</a></nav>${sections}<section id="audit"><h2>调用与审批</h2><p>图表按各服务政策的 unit 展示已占用次数或积分 / 获批上限，不是费用金额。calls 仅表示请求次数；单次金额未知时必须查看扣费回执，不同服务的单位不能相加。使用浏览器打印功能可保存 PDF。</p>${run.budgetMode === "mock_unlimited" ? `<p class="warning">${escape(researchBudgetPreview(run).message)}</p>` : chart}<pre>${escape(JSON.stringify({ preview: researchBudgetPreview(run), usage: researchUsage(run), budgets: budget, policies: run.policies, decisions: run.decisions, skills: run.skills.map(({ name, sha256 }) => ({ name, sha256 })) }, null, 2))}</pre></section><section id="evidence"><h2>原始请求与响应</h2><p>数据市场：${escape(run.marketplace)}；每条记录包含查询时间、阶段、Skill、参数、原始 JSON-RPC 响应和扣费核对状态。</p>${run.calls.map((call) => `<details id="e-${escape(call.id)}"><summary>${escape(call.tool)} · ${escape(call.requestedAt)} · ${escape(call.status)}</summary><pre>${escape(JSON.stringify(call, null, 2))}</pre></details>`).join("")}</section></body></html>`;
}


/** An available phase report is a review artifact, never an approved final recommendation. */
export function renderResearchStageReport(run: Run, stage: number): string {
  if (!Number.isInteger(stage) || stage < 1 || stage > 5 || !run.results[stage - 1]) throw new Error("RESEARCH_STAGE_REPORT_UNAVAILABLE");
  rejectCredentials(run);
  const result = run.results[stage - 1];
  const citedIds = new Set([...landedCostEvidenceIds(result.landedCostScenarios), ...result.claims.flatMap(claim => claim.evidenceIds), ...(result.reviewEvidence ?? []).map(row => row.evidenceId),
    ...(result.decisionAnalysis?.scenarios ?? []).flatMap(scenario => Object.values(scenario.basis).flatMap(basis => basis?.evidenceIds ?? [])),
    ...(result.decisionAnalysis?.scorecards ?? []).flatMap(card => card.dimensions.flatMap(row => row.evidenceIds))]);
  const evidence = run.calls.filter(call => citedIds.has(call.id));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>第${stage}阶段研究报告</title><style>body{max-width:1100px;margin:auto;padding:24px;font:15px/1.6 system-ui;color:#172033}pre{white-space:pre-wrap;overflow-wrap:anywhere}article,details{padding:12px;border:1px solid #cbd5e1;margin:12px 0}.warning{background:#fff4cf;padding:12px}</style></head><body><h1>第${stage}阶段研究报告 · 待人工审阅</h1><p class="warning">本报告仅覆盖已完成阶段，不代表最终审批、采购或上架授权。${run.mode === "fixture" ? "隔离样本，不代表真实市场。" : "数据不足之处保留待验证。"}</p><p>项目：${escape(run.id)} · 市场：${escape(run.marketplace)} · 保存版本：${run.revision}</p><p>${escape(run.requirement)}</p><p>${escape(result.summary)}</p>${result.candidates ? `<h2>候选方向</h2><ul>${result.candidates.map(row => `<li>${escape(row.name)} · ${escape(row.id)}</li>`).join("")}</ul>` : ""}<h2>结论与证据</h2>${result.claims.map(claim => `<article><p>${escape(claim.kind)} · ${escape(claim.text)}</p><p>${escape(claim.formula)} ${escape(claim.applicableDate)} ${escape(claim.sourceUrl)}</p>${claim.evidenceIds.map(id => `<a href="#e-${escape(id)}">${escape(id)}</a>`).join(" ")}</article>`).join("")}${reviewSection(result)}${decisionSection(result)}${landedCostSection(result)}<h2>原始证据</h2><p>请求时间不代表来源数据日期；样本不能等同于全市场。</p>${evidence.map(call => `<details id="e-${escape(call.id)}"><summary>${escape(call.tool)} · ${escape(call.requestedAt)} · ${escape(call.status)}</summary><pre>${escape(JSON.stringify(call, null, 2))}</pre></details>`).join("")}<h2>阶段预算与调用用量</h2><pre>${escape(JSON.stringify({ preview: researchBudgetPreview(run), usage: researchUsage(run), skill: { name: run.skills[stage - 1]?.name, sha256: run.skills[stage - 1]?.sha256 } }, null, 2))}</pre></body></html>`;
}
