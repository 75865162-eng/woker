import { sellfoxEmptyStub } from "@/lib/sellfox/replica-stub";

export const runtime = "nodejs";

export function GET(request: Request) {
  return sellfoxEmptyStub(request);
}
