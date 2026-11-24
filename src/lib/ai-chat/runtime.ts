import { createRuntimeTools, runtimeName, type ProviderStatus, type RuntimeProvider, type RuntimeTools, type ExtraSkillTool } from "@/lib/lili/runtime-tools";
import { publicResearchTools, callPublicResearchTool } from "@/lib/lili/public-research-tools";
import type { Json } from "@/lib/selection-research/types";
import { createChatAmazonMcpIdentity, listDiscoverableAmazonMcpTools, invokeAmazonMcp } from "@/lib/amazon-sync/mcp";
import { createErpSessionSellfoxMcpIdentity, invokeSellfoxMcp } from "@/lib/sellfox/mcp";
import { sellfoxDiscoverableTools } from "@/lib/sellfox/mcp-tool-registry";
import { getSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { createSellerSpriteResearchTransport, sellerSpritePolicy } from "@/lib/selection-research/seller-transport";
import { toolConfigStore } from "@/lib/lili/tool-config-server";
import { xiyouResearchReadTools } from "@/lib/lili/runtime-tools";
import { createLiliTransport } from "@/lib/selection-research/lili-transport";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import type { ChatScope } from "./types";
import type { ChatDataProvider } from "./data-sources";

export type ChatRuntime = {
  tools: RuntimeTools;
  providers: ProviderStatus[];
  /** 会话失效断言：在每次工具调用前后由编排器复用，工作区切换即抛错。 */
  assertSession: () => Promise<void>;
  /** 把内部 runtimeName（erp__xxx）翻译为展示用的 provider/tool。 */
  describeTool: (name: string) => { provider: string; tool: string };
};

/**
 * 组装聊天可用的只读运行时：仅装配用户在「数据源配置」中显式确认启用、且凭证可用的 provider。
 * Amazon 使用账号下 ACTIVE MCP 凭证身份（受 tools/scopes 约束），Sellfox 使用 ERP 会话身份（受凭证店铺范围约束）。
 * 卖家精灵/西柚是第三方付费只读数据源：仅复用 Lili 侧已审核的只读工具策略（sellerSpritePolicy /
 * xiyouResearchReadTools），工具发现与调用前后都做会话 + 工作区复验；付费审批属于选品研究任务域，
 * 聊天仅做即时只读查询，受 maxToolCalls 上限与全程审计约束，且不暴露任何写/有状态 research_* 工具。
 */
export async function buildChatRuntime(
  scope: ChatScope,
  sessionGuard?: () => Promise<void>,
  enabledProviders?: ChatDataProvider[],
): Promise<ChatRuntime> {
  const assertSession = async () => {
    await sessionGuard?.();
    if (!await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, scope.userId)) {
      throw new SyncInputError("工作区或登录会话已变化，本次分析已停止。", 401);
    }
  };
  await assertSession();

  const providers: RuntimeProvider[] = [];
  const enabled = new Set<string>(enabledProviders ?? []);

  // Amazon：仅当用户显式启用。使用账号下 ACTIVE MCP 凭证身份，受凭证 tools/scopes 约束。
  if (enabled.has("amazon")) {
    try {
      const amazonIdentity = await createChatAmazonMcpIdentity(scope);
      providers.push({
        id: "erp",
        isReadOnly: () => true,
        transport: {
          async listTools() {
            await assertSession();
            const tools = await listDiscoverableAmazonMcpTools(amazonIdentity, "2025-06-18");
            await assertSession();
            return tools as never;
          },
          async callTool(name, args, signal) {
            await assertSession();
            const result = await invokeAmazonMcp(amazonIdentity, name, args, undefined, signal);
            await assertSession();
            return result as never;
          },
        },
      });
    } catch {
      providers.push({ id: "erp", reason: "AMAZON_MCP_CREDENTIAL_UNAVAILABLE", isReadOnly: () => false });
    }
  }

  // Sellfox：仅当用户显式启用。从当前用户的持久化 sfmcp 凭证构造会话身份（含实时店铺范围交集）。
  if (enabled.has("sellfox")) {
    try {
      const sfIdentity = await createErpSessionSellfoxMcpIdentity(scope);
      const sfTools = sellfoxDiscoverableTools(sfIdentity.tools).filter(t => t.operationMode === "READ_ONLY");
      const sfNames = new Set<string>(sfTools.map(t => String(t.name)));
      providers.push({
        id: "sellfox",
        isReadOnly: () => true,
        transport: {
          async listTools() {
            await assertSession();
            return sfTools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema,
              annotations: { readOnlyHint: true } })) as never;
          },
          async callTool(name, args) {
            await assertSession();
            if (!sfNames.has(name)) throw new SyncInputError("工具不可访问。", 403);
            const result = await invokeSellfoxMcp(sfIdentity, name as Parameters<typeof invokeSellfoxMcp>[1], args);
            await assertSession();
            return result as never;
          },
        },
      });
    } catch {
      // Sellfox 凭证不可用：作为不可用 provider 暴露，不隐藏 Amazon。
      providers.push({ id: "sellfox", reason: "SELLFOX_ERP_SESSION_UNAVAILABLE", isReadOnly: () => false });
    }
  }

  // 卖家精灵 SellerSprite：仅当用户显式启用。复用 Lili 已审核只读策略，工具发现/调用前后复验会话与工作区。
  if (enabled.has("sellersprite")) {
    try {
      const settingsScope = { workspaceId: scope.workspaceId, accountId: "", marketplace: "" };
      const settings = await getSellerSpriteMcpSettings(
        { organizationId: scope.organizationId, id: scope.userId }, settingsScope,
      );
      if (!settings.enabled || !settings.apiKey?.trim() || !settings.serverUrl?.startsWith("http")) {
        providers.push({ id: "sellersprite", reason: "SELLERSPRITE_MCP_NOT_CONFIGURED", isReadOnly: () => false });
      } else {
        const base = createSellerSpriteResearchTransport(settings);
        providers.push({
          id: "sellersprite",
          isReadOnly: tool => tool.annotations?.readOnlyHint !== false && Boolean(sellerSpritePolicy(tool)),
          transport: {
            async listTools(signal) {
              await assertSession();
              const tools = await base.listTools(signal);
              await assertSession();
              return tools as never;
            },
            async callTool(name, args, signal, schema) {
              await assertSession();
              const result = await base.callTool(name, args, signal, schema);
              await assertSession();
              return result as never;
            },
          },
        });
      }
    } catch {
      providers.push({ id: "sellersprite", reason: "SELLERSPRITE_MCP_UNAVAILABLE", isReadOnly: () => false });
    }
  }

  // 西柚 Xiyou：仅当用户显式启用。复用 Lili 已审核只读工具白名单，工具发现/调用前后复验会话与工作区。
  if (enabled.has("xiyou")) {
    try {
      const settings = await toolConfigStore.read(scope);
      if (!settings.enabled || !settings.mcpToken?.trim()) {
        providers.push({ id: "xiyou", reason: "XIYOU_MCP_NOT_CONFIGURED", isReadOnly: () => false });
      } else {
        const base = createLiliTransport({ endpoint: settings.mcpUrl, authorization: "Bearer " + settings.mcpToken });
        providers.push({
          id: "xiyou",
          isReadOnly: tool => tool.annotations?.readOnlyHint !== false && xiyouResearchReadTools.has(tool.name),
          transport: {
            async listTools(signal) {
              await assertSession();
              const tools = await base.listTools(signal);
              await assertSession();
              return tools as never;
            },
            async callTool(name, args, signal, schema) {
              await assertSession();
              const result = await base.callTool(name, args, signal, schema);
              await assertSession();
              return result as never;
            },
          },
        });
      }
    } catch {
      providers.push({ id: "xiyou", reason: "XIYOU_MCP_UNAVAILABLE", isReadOnly: () => false });
    }
  }

  // Chat-only read-only Skill tools. research_prepare is anonymous/stateless (no private data,
  // no persistence, no spend), so it is safe to expose here; the stateful research_* workflow
  // stays on its own authenticated/approval-gated MCP surface and is intentionally NOT added.
  const extraSkillTools: ExtraSkillTool[] = publicResearchTools
    .filter(tool => tool.annotations?.readOnlyHint !== false)
    .map(tool => ({ ...tool, dispatch: async (args) => await callPublicResearchTool(tool.name, args) as Json }));
  const tools = createRuntimeTools(providers, { discoveryTimeoutMs: 20_000, extraSkillTools });
  let cached: ProviderStatus[] | undefined;
  const discover = async () => {
    if (!cached) cached = (await tools.discover()).providers;
    return cached;
  };

  return {
    tools,
    get providers() { return cached ?? []; },
    assertSession,
    describeTool: (name: string) => {
      if (name.startsWith("erp__")) return { provider: "amazon", tool: name.slice("erp__".length) };
      if (name.startsWith("sellfox__")) return { provider: "sellfox", tool: name.slice("sellfox__".length) };
      if (name.startsWith("sellersprite__")) return { provider: "sellersprite", tool: name.slice("sellersprite__".length) };
      if (name.startsWith("xiyou__")) return { provider: "xiyou", tool: name.slice("xiyou__".length) };
      return { provider: "skills", tool: name };
    },
    // 暴露 discover 供编排器在回答中写入 provider 状态。
    ...({ discover } as unknown as object),
  } as ChatRuntime & { discover: () => Promise<ProviderStatus[]> };
}

/** 供编排器读取 provider 状态（首次会触发发现）。 */
export async function chatProviderStatus(runtime: ChatRuntime): Promise<ProviderStatus[]> {
  return (runtime as ChatRuntime & { discover: () => Promise<ProviderStatus[]> }).discover();
}

export { runtimeName };
