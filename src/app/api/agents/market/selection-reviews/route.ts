import { selectionLocalApi } from "@/lib/agent-platform/selection-local-api";

export const runtime = "nodejs";
export async function POST(request: Request) { return selectionLocalApi(request, "reviews"); }
