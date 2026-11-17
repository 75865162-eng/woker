import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { POST as uploadAsset } from "@/app/api/assets/upload/route";
import { POST as uploadFile } from "@/app/api/files/upload/route";
import { POST as uploadConclusion } from "@/app/api/products/conclusion-files/upload/route";
import { POST as uploadProductFile } from "@/app/api/products/file-assets/upload/route";
import { POST as uploadImage } from "@/app/api/products/image-assets/upload/route";
import { POST as uploadPatent } from "@/app/api/products/patent-files/upload/route";
import { POST as uploadVideo } from "@/app/api/products/video-assets/upload/route";
import { POST as uploadWorkbook } from "@/app/api/workspace/workbook-files/upload/route";
import { localStorageDriver } from "@/lib/storage/local-storage";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { WorkspaceScopeError, workspaceScopeFromRequest } from "@/lib/workspace/scope";

test("API permissions validate every explicit workspace selector without trusting cookies", async (t) => {
  const previous = { database: process.env.DATABASE_URL, driver: process.env.AUTH_DRIVER, secret: process.env.AUTH_SECRET, environment: process.env.NODE_ENV, storage: process.env.STORAGE_DRIVER };
  const previousPutFile = localStorageDriver.putFile;
  const previousPutBuffer = localStorageDriver.putBuffer;
  localStorageDriver.putBuffer = async ({ key, buffer, contentType }) => {
    storedFiles++;
    return { key, size: buffer.length, contentType };
  };
  const previousFetch = globalThis.fetch;
  let storedFiles = 0;
  localStorageDriver.putFile = async ({ key, file }) => {
    storedFiles++;
    return { key, size: file.size, contentType: file.type };
  };
  globalThis.fetch = (async () => { throw new Error("专项测试禁止网络访问"); }) as typeof fetch;
  const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
  const previousDb = globalDb.prisma;
  Object.assign(process.env, { DATABASE_URL: "postgresql://fixture.invalid/unused", AUTH_DRIVER: "database", AUTH_SECRET: "workspace-permission-test-signing-key-v3-2026" });
  const lookups: string[] = [];
  globalDb.prisma = {
    organizationMember: { findUnique: async () => ({ role: "viewer", user: { status: "active" } }) },
    workspaceMembership: { findUnique: async ({ where }: { where: { organizationId_workspaceId_userId: { workspaceId: string } } }) => where.organizationId_workspaceId_userId.workspaceId === "allowed-no-membership" ? null : { userId: "user-a" } },
    fileObject: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "fixture-file", createdAt: new Date(1), ...data }) },
    userSession: { findFirst: async () => ({ user: { id: "user-a", email: "user@fixture.invalid", name: "User", status: "active", memberships: [{ role: "viewer", organizationId: "org-a", organization: { name: "Fixture" } }] } }) },
    organizationRosterRole: { findMany: async () => [{ id: "viewer", name: "Viewer", description: "", sortOrder: 0, updatedAt: new Date(1), permissions: { listingAi: ["view", "create"], workspace: ["view", "create", "edit"], products: ["view", "edit"] } }] },
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { organizationId: string; id: string } } }) => {
      assert.equal(where.organizationId_id.organizationId, "org-a");
      const id = where.organizationId_id.id;
      lookups.push(id);
      return id.startsWith("allowed") ? { id } : null;
    } },
  };
  const payload = Buffer.from(JSON.stringify({ driver: "database", sessionId: "fixture", userId: "user-a", organizationId: "org-a", token: "fixture", expiresAt: new Date(Date.now() + 60000).toISOString() })).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SECRET!).update(payload).digest("base64url");
  const cookie = `amazon_bulk_ad_session=${payload}.${signature}; workspaceId=allowed-cookie`;
  const check = async (url: string, body?: object, header?: string) => {
    lookups.length = 0;
    const request = new Request(url, { method: body ? "POST" : "GET", headers: { cookie, ...(body ? { "content-type": "application/json" } : {}), ...(header === undefined ? {} : { "x-workspace-id": header }) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await requireApiPermission("listingAi", "view", request);
    return result.ok ? 200 : result.response.status;
  };

  try {
    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-query", undefined, "denied-header"), 403);
    assert.deepEqual(lookups, ["allowed-query", "denied-header"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-query", { workspaceId: "allowed-body", context: { workspaceId: "denied-context" }, }, "allowed-header"), 403);
    assert.deepEqual(lookups, ["allowed-body", "denied-context"]);

    lookups.length = 0;
    const textJsonRequest = new Request("http://fixture.invalid/api/example", { method: "POST", headers: { cookie, "content-type": "text/plain" }, body: JSON.stringify({ workspaceId: "denied-text-json" }) });
    const textJsonResult = await requireApiPermission("listingAi", "view", textJsonRequest);
    assert.equal(textJsonResult.ok, false);
    assert.equal(!textJsonResult.ok && textJsonResult.response.status, 403);
    assert.deepEqual(lookups, ["denied-text-json"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=denied-query", { workspaceId: "allowed-body" }, "allowed-header"), 403);
    assert.deepEqual(lookups, ["allowed-body", "denied-query"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=%20allowed-one%20&workspaceId=allowed-two", { workspaceId: " allowed-one ", context: { workspaceId: "allowed-two" } }, " allowed-one ") , 200);
    assert.deepEqual(lookups, ["allowed-one", "allowed-two"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-one&workspaceId=denied-second"), 403);
    assert.deepEqual(lookups, ["allowed-one", "denied-second"]);

    assert.equal(await check("http://fixture.invalid/api/example?workspaceId=allowed-1&workspaceId=allowed-2&workspaceId=allowed-3&workspaceId=allowed-4&workspaceId=allowed-5"), 403);
    assert.deepEqual(lookups, ["allowed-1", "allowed-2", "allowed-3", "allowed-4"]);

    assert.equal(await check("http://fixture.invalid/api/example", undefined, "  "), 403);
    assert.deepEqual(lookups, []);
    assert.equal(await check("http://fixture.invalid/api/example", { workspaceId: 42 }), 403);
    assert.deepEqual(lookups, []);
    assert.equal(await check("http://fixture.invalid/api/example"), 200);
    assert.deepEqual(lookups, []);

    for (const contentType of [undefined, "application/problem+json", "multipart/form-data; boundary=forged"]) {
      const request = new Request("http://fixture.invalid/api/example", { method: "POST", headers: { cookie, ...(contentType ? { "content-type": contentType } : {}) }, body: JSON.stringify({ context: { workspaceId: "denied-context" } }) });
      const result = await requireApiPermission("listingAi", "view", request);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.response.status, 403);
      assert.deepEqual(await request.json(), { context: { workspaceId: "denied-context" } });
    }

    const form = new FormData();
    form.set("file", new Blob(["fixture upload"]), "fixture.txt");
    const upload = new Request("http://fixture.invalid/api/example?workspaceId=allowed-upload", { method: "POST", headers: { cookie }, body: form });
    assert.equal((await requireApiPermission("listingAi", "view", upload)).ok, true);
    const uploadedFile = (await upload.formData()).get("file") as File;
    assert.equal(await uploadedFile.text(), "fixture upload");

    let chunksRead = 0;
    const largeBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead++;
        controller.enqueue(chunksRead === 1 ? new TextEncoder().encode("--fixture\r\n") : new Uint8Array(65536));
        if (chunksRead === 256) controller.close();
      },
    });
    const largeMultipart = new Request("http://fixture.invalid/api/example?workspaceId=allowed-upload", { method: "POST", headers: { cookie, "content-type": "multipart/form-data; boundary=fixture" }, body: largeBody, duplex: "half" } as RequestInit);
    assert.equal((await requireApiPermission("listingAi", "view", largeMultipart)).ok, true);
    assert.ok(chunksRead < 256, "鉴权不能读完整个大文件流");
    assert.equal(largeMultipart.bodyUsed, false);
    await largeMultipart.arrayBuffer();

    const prefix = new TextEncoder().encode("--fixture\r\n");
    let largeChunkPulls = 0;
    const largeChunkBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        largeChunkPulls++;
        const chunk = new Uint8Array(1024 * 1024);
        if (largeChunkPulls === 1) chunk.set(prefix);
        controller.enqueue(chunk);
        if (largeChunkPulls === 8) controller.close();
      },
    });
    const largeChunkRequest = new Request("http://fixture.invalid/api/example?workspaceId=allowed-upload", { method: "POST", headers: { cookie, "content-type": "multipart/form-data; boundary=fixture" }, body: largeChunkBody, duplex: "half" } as RequestInit);
    assert.equal((await requireApiPermission("listingAi", "view", largeChunkRequest)).ok, true);
    const pullsAfterAuthorization = largeChunkPulls;
    t.diagnostic(`1MiB分块流：鉴权返回时上游pull次数=${pullsAfterAuthorization}，总分块数=8；不代表固定内存上限`);
    assert.ok(pullsAfterAuthorization > 0 && pullsAfterAuthorization < 8, "鉴权不能主动读完整个大块上传流");
    assert.equal(largeChunkRequest.bodyUsed, false);
    const originalBody = new Uint8Array(await largeChunkRequest.arrayBuffer());
    assert.equal(originalBody.length, 8 * 1024 * 1024);
    assert.deepEqual(originalBody.subarray(0, prefix.length), prefix);
    assert.equal(largeChunkPulls, 8);

    let singleChunkPulls = 0;
    const singleChunkBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        singleChunkPulls++;
        const chunk = new Uint8Array(16 * 1024 * 1024);
        chunk.set(prefix);
        chunk[chunk.length - 1] = 123;
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const singleChunkRequest = new Request("http://fixture.invalid/api/example?workspaceId=allowed-upload", { method: "POST", headers: { cookie, "content-type": "multipart/form-data; boundary=fixture" }, body: singleChunkBody, duplex: "half" } as RequestInit);
    assert.equal((await requireApiPermission("listingAi", "view", singleChunkRequest)).ok, true);
    assert.equal(singleChunkPulls, 1);
    assert.equal(singleChunkRequest.bodyUsed, false);
    const singleChunkOriginal = new Uint8Array(await singleChunkRequest.arrayBuffer());
    assert.equal(singleChunkOriginal.length, 16 * 1024 * 1024);
    assert.deepEqual(singleChunkOriginal.subarray(0, prefix.length), prefix);
    assert.equal(singleChunkOriginal[singleChunkOriginal.length - 1], 123);
    t.diagnostic(`单个16MiB分块：上游pull次数=${singleChunkPulls}，原流完整可读；tee可能缓存整个16MiB块，不代表固定内存上限`);

    const forgedMultipart = new Request("http://fixture.invalid/api/example?workspaceId=allowed-query", { method: "POST", headers: { cookie, "content-type": "multipart/form-data; boundary=fixture" }, body: JSON.stringify({ workspaceId: "denied-body" }) });
    const forgedResult = await requireApiPermission("listingAi", "view", forgedMultipart);
    assert.equal(forgedResult.ok, false);
    assert.equal(!forgedResult.ok && forgedResult.response.status, 403);

    for (const [contentType, body, accepted] of [
      ['multipart/form-data; boundary="b"', '--b\r\nContent-Disposition: form-data; name="x"\r\n\r\na\r\n--b--\r\n', true],
      ['multipart/form-data; boundary=b', '--b--\r\n', true],
      ['multipart/form-data; boundary=b', '--b\r', false],
      ['multipart/form-data; boundary=b', '--wrong\r\n', false],
      ['multipart/form-data', '--b\r\n', false],
      ['multipart/form-data; boundary=b; boundary=c', '--b\r\n', false],
      [`multipart/form-data; boundary=${"b".repeat(71)}`, `--${"b".repeat(71)}\r\n`, false],
      ['multipart/form-data; boundary="bad*boundary"', '--bad*boundary\r\n', false],
    ] as const) {
      const request = new Request("http://fixture.invalid/api/example?workspaceId=allowed-short", { method: "POST", headers: { cookie, "content-type": contentType }, body });
      const result = await requireApiPermission("listingAi", "view", request);
      assert.equal(result.ok, accepted, contentType + " / " + body);
      assert.equal(request.bodyUsed, false);
      if (!accepted) assert.equal(!result.ok && result.response.status, 403);
      if (accepted) assert.ok(await request.formData());
    }

    const allowedText = new Request("http://fixture.invalid/api/example", { method: "POST", headers: { cookie }, body: JSON.stringify({ workspaceId: "allowed-text" }) });
    assert.equal((await requireApiPermission("listingAi", "view", allowedText)).ok, true);
    assert.deepEqual(await allowedText.json(), { workspaceId: "allowed-text" });

    for (const missingRequest of [undefined, null, {}]) {
      const result = await requireApiPermission("listingAi", "view", missingRequest as Request);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.response.status, 400);
    }
    for (const contentType of ["application/json", "text/plain", "application/x-www-form-urlencoded", "application/octet-stream", "multipart/form-datax; boundary=fixture"]) {
      const request = new Request("http://fixture.invalid/api/example?workspaceId=allowed-query", { method: "POST", headers: { cookie, "content-type": contentType, "x-workspace-id": "allowed-header" }, body: JSON.stringify({ workspaceId: "allowed-body", context: { workspaceId: "other-org" } }) });
      const result = await requireApiPermission("listingAi", "view", request);
      assert.equal(result.ok, false, contentType);
      assert.equal(!result.ok && result.response.status, 403);
      assert.equal((await request.json()).context.workspaceId, "other-org");
    }

    for (const body of [{ workspaceId: "other-org" }, { context: { workspaceId: "other-org" } }]) {
      const consumed = new Request("http://fixture.invalid/api/example?workspaceId=allowed-query", { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
      await consumed.json();
      lookups.length = 0;
      const result = await requireApiPermission("listingAi", "view", consumed);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.response.status, 400);
      assert.deepEqual(lookups, [], "已消费body必须在授权查询前拒绝");
    }
    const locked = new Request("http://fixture.invalid/api/example?workspaceId=allowed-query", { method: "POST", headers: { cookie }, body: JSON.stringify({ workspaceId: "other-org" }) });
    const reader = locked.body!.getReader();
    try {
      assert.equal(locked.bodyUsed, false);
      const result = await requireApiPermission("listingAi", "view", locked);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.response.status, 400);
    } finally {
      reader.releaseLock();
    }
    assert.equal((await locked.json()).workspaceId, "other-org");
    const brokenStream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("fixture读取失败")); } });
    const unreadable = new Request("http://fixture.invalid/api/example", { method: "POST", headers: { cookie }, body: brokenStream, duplex: "half" } as RequestInit);
    const unreadableResult = await requireApiPermission("listingAi", "view", unreadable);
    assert.equal(unreadableResult.ok, false);
    assert.equal(!unreadableResult.ok && unreadableResult.response.status, 400);
    const malformedJson = new Request("http://fixture.invalid/api/example?workspaceId=allowed-query", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{bad-json" });
    assert.equal((await requireApiPermission("listingAi", "view", malformedJson)).ok, true, "坏JSON仍交路由执行原有错误处理");
    assert.equal(await malformedJson.text(), "{bad-json");

    for (const environment of ["production", "development", "test"]) {
      Object.assign(process.env, { NODE_ENV: environment });
      assert.throws(() => workspaceScopeFromRequest(new Request("http://fixture.invalid/api/example")), WorkspaceScopeError);
    }
    Object.assign(process.env, { NODE_ENV: "production", STORAGE_DRIVER: "local" });
    assert.equal(await assertWorkspaceAccess("", "allowed-upload", "user-a"), false);
    assert.equal(await assertWorkspaceAccess("org-a", "", "user-a"), false);

    for (const [handler, missingFileError] of [
      [uploadAsset, "Missing upload file."], [uploadFile, "Missing upload file."],
      [uploadConclusion, "缺少结论 Excel 文件。"], [uploadProductFile, "缺少商品附件文件。"],
      [uploadImage, "缺少商品图片文件。"], [uploadPatent, "缺少专利附件。"],
      [uploadVideo, "缺少视频策划素材文件。"], [uploadWorkbook, "缺少工作簿文件。"],
    ] as const) {
      const sendForm = async (ids: Array<string | Blob>, url = "http://fixture.invalid/api/upload", header?: string) => {
        const form = new FormData();
        for (const id of ids) form.append("workspaceId", id);
        return handler(new Request(url, { method: "POST", headers: { cookie, ...(header ? { "x-workspace-id": header } : {}) }, body: form }));
      };
      for (const ids of [["other-org"], ["allowed-upload", "other-org"], ["other-org", "allowed-upload"]]) {
        assert.equal((await sendForm(ids, "http://fixture.invalid/api/upload?workspaceId=allowed-query", "allowed-header")).status, 403);
      }
      assert.equal((await sendForm(["allowed-no-membership"])).status, 403, "同组织未获工作区授权的上传必须在存储前拒绝");
      assert.equal((await sendForm([new Blob(["allowed-upload"])], "http://fixture.invalid/api/upload?workspaceId=allowed-query")).status, 400);
      assert.equal((await sendForm([])).status, 400);
      assert.equal((await sendForm([""])).status, 400);
      for (const response of [
        await sendForm(["allowed-upload", "allowed-upload"]),
        await sendForm([], "http://fixture.invalid/api/upload?workspaceId=allowed-query"),
        await sendForm([], "http://fixture.invalid/api/upload", "allowed-header"),
      ]) {
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, missingFileError, "合法作用域必须通过鉴权并到达业务文件检查");
      }
      assert.equal((await sendForm(["allowed-upload"], "http://fixture.invalid/api/upload?workspaceId=other-org")).status, 403);
      assert.equal((await sendForm(["allowed-upload"], "http://fixture.invalid/api/upload", "other-org")).status, 403);
      const malformed = new Request("http://fixture.invalid/api/upload?workspaceId=allowed-query", { method: "POST", headers: { cookie, "content-type": "multipart/form-data; boundary=fixture" }, body: "--fixture\r\nmalformed" });
      assert.equal((await handler(malformed)).status, 400);
    }
    assert.equal(storedFiles, 0, "所有拒绝请求不得触发存储写入");
    const imageForm = new FormData();
    imageForm.set("workspaceId", "allowed-upload");
    imageForm.set("file", new Blob(["fixture image"], { type: "image/png" }), "fixture.png");
    const imageResponse = await uploadAsset(new Request("http://fixture.invalid/api/assets/upload", { method: "POST", headers: { cookie }, body: imageForm }));
    assert.equal(imageResponse.status, 200, JSON.stringify(await imageResponse.clone().json()));
    assert.equal(storedFiles, 1);
    assert.equal((await imageResponse.json()).asset.name, "fixture.png");
    for (const [handler, name, type] of [
      [uploadConclusion, "fixture.xlsx", "application/octet-stream"],
      [uploadProductFile, "fixture.csv", "text/csv"],
      [uploadPatent, "fixture.pdf", "application/pdf"],
      [uploadVideo, "fixture.mp4", "video/mp4"],
      [uploadWorkbook, "fixture.xlsx", "application/octet-stream"],
    ] as const) {
      const form = new FormData();
      form.set("workspaceId", "allowed-upload");
      form.set("file", new Blob(["fixture upload"], { type }), name);
      const response = await handler(new Request("http://fixture.invalid/api/upload", { method: "POST", headers: { cookie }, body: form }));
      assert.equal(response.status, 200, `${name}: ${JSON.stringify(await response.json())}`);
    }
    assert.equal(storedFiles, 6);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    const productImageForm = new FormData();
    productImageForm.set("workspaceId", "allowed-upload");
    productImageForm.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "fixture.png");
    const productImageResponse = await uploadImage(new Request("http://fixture.invalid/api/upload", { method: "POST", headers: { cookie }, body: productImageForm }));
    assert.equal(productImageResponse.status, 200, JSON.stringify(await productImageResponse.json()));
    assert.equal(storedFiles, 9);
  } finally {
    globalDb.prisma = previousDb;
    localStorageDriver.putFile = previousPutFile;
    localStorageDriver.putBuffer = previousPutBuffer;
    globalThis.fetch = previousFetch;
    for (const [key, value] of [["DATABASE_URL", previous.database], ["AUTH_DRIVER", previous.driver], ["AUTH_SECRET", previous.secret], ["NODE_ENV", previous.environment], ["STORAGE_DRIVER", previous.storage]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
