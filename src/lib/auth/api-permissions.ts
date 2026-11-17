import { NextResponse } from "next/server";
import { roleCanPerformAction, type PermissionAction } from "@/lib/accounts/permissions";
import { type CurrentUser } from "@/lib/auth/session";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import { assertWorkspaceAccess } from "@/lib/workspace/access";

export type ApiPermissionResult =
  | {
      ok: true;
      user: CurrentUser;
    }
  | {
      ok: false;
      response: NextResponse;
    };

async function hasMultipartPrefix(request: Request): Promise<boolean> {
  const contentType = request.headers.get("content-type") ?? "";
  const boundaries = [...contentType.matchAll(/(?:^|;)\s*boundary=(?:"([^"\r\n]*)"|([^;\s]*))\s*(?=;|$)/gi)];
  const boundary = boundaries[0]?.[1] ?? boundaries[0]?.[2];
  if (boundaries.length !== 1 || !boundary || boundary.length > 70 || !/^[0-9A-Za-z'()+_,./:=? -]+$/.test(boundary) || boundary.endsWith(" ")) return false;
  const expected = new TextEncoder().encode(`--${boundary}`);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let offset = 0;
  let suffix = "";
  try {
    reader = request.clone().body?.getReader();
    if (!reader) return false;
    // 只比较最多74字节；流实现可能按上游chunk预取，不能承诺底层逐字节读取。
    while (offset < expected.length + 2) {
      const { value, done } = await reader.read();
      if (done) return false;
      const length = Math.min(value.length, expected.length + 2 - offset);
      for (let index = 0; index < length; index++) {
        const position = offset + index;
        if (position < expected.length) {
          if (value[index] !== expected[position]) return false;
        } else {
          suffix += String.fromCharCode(value[index]);
        }
      }
      offset += length;
    }
    return suffix === "\r\n" || suffix === "--";
  } catch {
    return false;
  } finally {
    // 不等待tee另一分支消费完成，也不继续读取上传文件。
    void reader?.cancel().catch(() => undefined);
  }
}

// request 必须显式传入：workspace 选择器只从该 request 读取，漏传会静默跳过租户/工作区围栏。
// 页面（RSC）没有 Request，应改用 getAuthorizationContext() 自行做页面级判定。
export async function requireApiPermission(moduleId: string, action: PermissionAction, request: Request): Promise<ApiPermissionResult> {
  if (!(request instanceof Request)) {
    return { ok: false, response: NextResponse.json({ error: "Missing or invalid request." }, { status: 400 }) };
  }
  if (request.bodyUsed || request.body?.locked) {
    return { ok: false, response: NextResponse.json({ error: "Request body is unavailable for authorization." }, { status: 400 }) };
  }
  const authorization = await getAuthorizationContext(request);
  const user = authorization?.user;

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const permissions = authorization!.permissions;

  if (!roleCanPerformAction(user.role, moduleId, action, permissions)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  // Workspace selectors are untrusted input. Cookies never grant authorization.
  if (request) {
    const workspaceIds: unknown[] = [];
    // JSON解析不依赖Content-Type；multipart仅验证有界前缀，避免完整缓冲上传文件。
    const isMultipart = request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data");
    if (request.body !== null && isMultipart && !(await hasMultipartPrefix(request))) {
      return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
    }
    if (request.body !== null && !isMultipart) {
      try {
        const body = await request.clone().json() as Record<string, unknown>;
        const context = body?.context && typeof body.context === "object" ? body.context as Record<string, unknown> : undefined;
        if (body && Object.hasOwn(body, "workspaceId")) workspaceIds.push(body.workspaceId);
        if (context && Object.hasOwn(context, "workspaceId")) workspaceIds.push(context.workspaceId);
      } catch (error) {
        // 坏JSON仍由路由按既有合同处理；无法读取/克隆时不得跳过选择器校验。
        if (!(error instanceof SyntaxError)) {
          return { ok: false, response: NextResponse.json({ error: "Request body is unavailable for authorization." }, { status: 400 }) };
        }
      }
    }
    workspaceIds.push(...new URL(request.url).searchParams.getAll("workspaceId"));
    const headerWorkspaceId = request.headers.get("x-workspace-id");
    if (headerWorkspaceId !== null) workspaceIds.push(headerWorkspaceId);

    const checked = new Set<string>();
    for (const value of workspaceIds) {
      if (typeof value !== "string") {
        return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
      }
      const workspaceId = value.trim();
      if (checked.has(workspaceId)) continue;
      checked.add(workspaceId);
      // 四个选择器位置已足够；拒绝重复 query 参数放大数据库查询。
      if (checked.size > 4) {
        return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
      }
      if (!(await assertWorkspaceAccess(user.organizationId, workspaceId, user.id, undefined, request))) {
        return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
      }
    }
  }

  return {
    ok: true,
    user,
  };
}
