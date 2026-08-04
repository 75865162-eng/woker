import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { optimizeListing } from "@/lib/listing-ai/client";
import type { ListingOptimizationApiRequest, ListingOptimizationRequest } from "@/lib/listing-ai/types";

export const runtime = "nodejs";

const requiredFields: Array<keyof ListingOptimizationRequest> = ["marketplace", "language", "tone", "asin", "productFacts"];

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("listingAi", "create");

    if (!permission.ok) {
      return permission.response;
    }

    const body = (await request.json()) as ListingOptimizationApiRequest;
    const missing = requiredFields.filter((field) => !body[field]);

    if (missing.length) {
      return NextResponse.json({ error: `缺少必填字段：${missing.join(", ")}` }, { status: 400 });
    }

    const { aiSettings, ...input } = body;
    const result = await optimizeListing(input, aiSettings);
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "优化失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
