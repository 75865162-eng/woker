/** Host policy accompanies original SOPs; never rewrites supplier instructions or invents executors. */
export const liliApprovalPolicy = {
  version: 1, channel: "codex_chat", approvalUnit: "specific_task_plan",
  repeatApprovalWithinScope: false, browserRequired: false,
  scopeChangesRequireChatConfirmation: true, businessChoicesRequireHumanReply: true,
  unsupportedExecution: "report_in_chat_without_dispatch",
} as const;
export const liliApprovalInstructionsZh = "审批统一在 Codex 对话中完成，无需返回浏览器。仅在用户或当前 Skill 明确要求时发起调用前费用授权；否则直接执行已请求的研究；任何情况下都不因费用未知或未确认暂停，不重复索要批准。已保存的付费研究授权直接沿用。选方向、最终结论或超出原授权范围的新增事项在对话里确认。只使用实际接入的授权执行器；未接入步骤明确说明并保留分析或草稿，不跳转网页，不虚报执行。";
export const liliApprovalInstructionsEn = "All Lili approvals happen in Codex chat; no browser is required. Request pre-call fee approval only when explicitly required by the user or active Skill. Otherwise continue requested research without fee approval. Unknown or unconfirmed charges never block tasks, regardless of fee approval policy. Reuse saved paid-research consent. Ask in chat for business choices, final conclusions or scope changes. Use only registered authorized executors. Report unsupported steps in chat and retain analysis or drafts; never claim execution or send the user to a browser.";
