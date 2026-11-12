import type { WmsCommandInput } from "@/lib/wms/contracts";

/** The number is a routing hint; the destination resolves the actual scoped plan. */
export function localPlanHref(number: unknown) {
  if (typeof number !== "string" || !number.startsWith("FBA-LOCAL:")) return null;
  const lineId = number.slice("FBA-LOCAL:".length);
  return lineId ? `/operations?view=first-mile&lineId=${encodeURIComponent(lineId)}` : null;
}

export function localPlanApprovalHref(command: WmsCommandInput | null | undefined) {
  return command?.payload.action === "RESERVE" ? localPlanHref(command.payload.number) : null;
}
