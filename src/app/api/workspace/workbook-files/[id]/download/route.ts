import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission("workspace", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const { id } = await params;
    const file = await prisma.fileObject.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
      },
    });

    if (!file) {
      return NextResponse.json({ error: "Workbook not found." }, { status: 404 });
    }

    const buffer = await getStorageDriver().getBuffer(file.storageKey);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workbook download failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
