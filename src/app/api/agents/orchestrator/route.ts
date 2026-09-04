import { GET as getAgent } from "../[agentId]/route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getAgent(request, { params: Promise.resolve({ agentId: "orchestrator" }) });
}
