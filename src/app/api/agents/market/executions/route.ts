import { POST as executeAgent } from "../../[agentId]/executions/route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return executeAgent(request, { params: Promise.resolve({ agentId: "market" }) });
}
