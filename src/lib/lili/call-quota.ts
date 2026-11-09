/** ERP and Lili share this internal call allowance; supplier credits are separate. */
export type MarketCallReservation = {
  callId: string; runId: string; workspaceId: string;
  provider: "sellersprite" | "xiyou"; tool: string;
};
export type MarketCallOutcome = "COMPLETED" | "FAILED" | "UNKNOWN" | "REFUNDED";
export interface MarketCallQuota {
  reserve(input: MarketCallReservation): Promise<void>;
  settle(callId: string, outcome: MarketCallOutcome): Promise<void>;
}

export class MarketQuotaError extends Error {
  constructor(public readonly code: "MARKET_QUOTA_EXHAUSTED" | "MARKET_QUOTA_REPLAY_BLOCKED" | "MARKET_QUOTA_UNAVAILABLE") { super(code); }
}
