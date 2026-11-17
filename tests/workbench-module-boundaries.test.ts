import assert from "node:assert/strict";
import test from "node:test";
import { useWorkspaceStore } from "../src/lib/stores/workspace-store";
import { normalizeDescriptionGeneratorDraft, normalizeTitleGeneratorDraft, readListingAiGenerationResponse } from "../src/components/listing-ai/listing-ai-workspace-runtime";

test("状态切片组合保留活动切换、规则编辑和导入状态", () => {
  const original = useWorkspaceStore.getState();
  try {
    const state = useWorkspaceStore.getState();
    state.openCampaignGroup("fixture-group");
    assert.equal(useWorkspaceStore.getState().activeCampaignGroupId, "fixture-group");
    assert.deepEqual(useWorkspaceStore.getState().openTabIds, ["fixture-group"]);
    assert.equal(useWorkspaceStore.getState().workspaceMode, "campaign");
    state.setRules([]);
    assert.deepEqual(useWorkspaceStore.getState().rules, []);
    state.setParseStarted("fixture.xlsx", new ArrayBuffer(4), "fixture-file");
    assert.equal(useWorkspaceStore.getState().parseStatus, "parsing");
    assert.equal(useWorkspaceStore.getState().originalWorkbookFileId, "fixture-file");
    assert.deepEqual(useWorkspaceStore.getState().openTabIds, []);
    state.setParseProgress(35, ["广告"]);
    assert.equal(useWorkspaceStore.getState().parseProgress, 35);
    assert.deepEqual(useWorkspaceStore.getState().parsedSheets, ["广告"]);
    state.setParseFailed("fixture failure");
    assert.equal(useWorkspaceStore.getState().parseError, "fixture failure");
  } finally {
    useWorkspaceStore.setState(original, true);
  }
});

test("ListingAI 模式归一化保留已有模式和默认字段", () => {
  const draft = normalizeTitleGeneratorDraft({ mode: "new", results: ["fixture title"] });
  assert.deepEqual(draft.modes.new.results, ["fixture title"]);
  assert.deepEqual(draft.modes.old.results, []);
  assert.ok(draft.fields.some((field) => field.key === "productChineseName"));
  const description = normalizeDescriptionGeneratorDraft({ results: ["fixture bullet"], history: [] });
  assert.deepEqual(description.results, ["fixture bullet"]);
  assert.ok(description.fields.length > 0);
});

test("ListingAI 生成响应解析保留有效结果并报告空白和代理错误", async () => {
  const success = await readListingAiGenerationResponse(new Response(JSON.stringify({ results: ["one", 2, "two"] })));
  assert.deepEqual(success.results, ["one", "two"]);
  const empty = await readListingAiGenerationResponse(new Response("", { status: 502 }));
  assert.match(empty.error ?? "", /HTTP 502/);
  const html = await readListingAiGenerationResponse(new Response("<h1>proxy failure</h1>", { status: 503 }));
  assert.match(html.error ?? "", /proxy failure/);
  assert.doesNotMatch(html.error ?? "", /<h1>/);
});
