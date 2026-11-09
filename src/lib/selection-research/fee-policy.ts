import type { Run } from "./types";

/** Only task instructions and the active Skill may request extra fee review. */
export function researchFeeReviewRequired(run: Pick<Run, "requirement" | "skills" | "stage">) {
  const required = /(?:付费|费用|扣费|收费)[^。\n]{0,45}(?:先|需|必须)[^。\n]{0,25}(?:审批|批准|确认)|(?:先|需|必须)[^。\n]{0,25}(?:审批|批准|确认)[^。\n]{0,30}(?:付费|费用|扣费)|(?:paid|chargeable)[^.!\n]{0,70}(?:require|must|before)[^.!\n]{0,50}(?:approval|confirmation)/i;
  return [run.requirement ?? "", run.skills?.[run.stage - 1]?.markdown ?? ""].some(text =>
    text.split(/[。\n]/).some(clause => !/(?:无需|不需|不要|取消|删除|不得).{0,35}(?:费用|付费|审批|批准|确认)|(?:do not|no need|without).{0,40}(?:fee|paid|approval|confirmation)/i.test(clause) && required.test(clause)));
}
