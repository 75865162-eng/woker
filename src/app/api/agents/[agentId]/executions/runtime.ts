import { createAgentRuntime, createPlatformToolAdapter, defaultToolDefinitions } from "@/lib/agent-platform";
import { createMarketAgentExecutionExecutor, createSellerSpriteMcpAdapter, marketAgentId, marketToolDefinitions } from "@/lib/agent-platform/market";
import { createListingAgentExecutionExecutor, createListingMcpAdapter, listingAgentId, listingToolDefinitions } from "@/lib/agent-platform/listing";
import { createProductAgentExecutionExecutor, createProductMcpAdapter, productAgentId, productToolDefinitions } from "@/lib/agent-platform/product";
import { createSupplierAgentExecutionExecutor, createSupplierMcpAdapter, supplierAgentId, supplierToolDefinitions } from "@/lib/agent-platform/supplier";
import { createPpcAgentExecutionExecutor, createPpcAnalyticsAdapter, ppcAgentId, ppcToolDefinitions } from "@/lib/agent-platform/ppc";
import { amazonAdsToolDefinitions, createAmazonAdsApiAdapter } from "@/lib/agent-platform/amazon-ads";
import { createOrchestratorExecutionExecutor, createOrchestratorInternalAdapter, orchestratorAgentId, orchestratorToolDefinitions } from "@/lib/agent-platform/orchestrator";
import { createPpcInventoryConstraintResolver } from "@/lib/operations/ppc-inventory-guard";
import { createSelectionAdapter } from "@/lib/agent-platform/selection";
import { selectionEvidenceLoader } from "@/lib/agent-platform/selection-evidence-server";
import type { AgentDefinition, JsonValue } from "@/lib/agent-platform/types";
import type { getSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { createPlatformExecutionExecutor } from "./platform-executor";

type ExecutionRuntimeInput = {
  definition: AgentDefinition;
  body: Record<string, unknown>;
  userId: string;
  scope: { organizationId: string; workspaceId: string };
  sellerSpriteMcpSettings: Awaited<ReturnType<typeof getSellerSpriteMcpSettings>>;
  requestedToolId: string;
  requestedToolInput: JsonValue;
  requiresApproval: boolean;
};

export function isExecutionEnabled(agentId: string) {
  return ["platform-runtime-core", marketAgentId, listingAgentId, productAgentId, supplierAgentId, ppcAgentId, orchestratorAgentId].includes(agentId);
}

export function prepareExecutionRuntime(input: ExecutionRuntimeInput) {
  const { definition, body, userId, scope, sellerSpriteMcpSettings } = input;
  const request = { request: body, requestedByUserId: userId };
  switch (definition.id) {
    case marketAgentId:
      return {
        runtime: createAgentRuntime({ definitions: [definition], tools: marketToolDefinitions, adapters: [
          createSellerSpriteMcpAdapter({ settings: sellerSpriteMcpSettings }),
          createSelectionAdapter({ loadEvidence: selectionEvidenceLoader(scope) }),
        ] }),
        executor: createMarketAgentExecutionExecutor(request),
      };
    case listingAgentId:
      return { runtime: createAgentRuntime({ definitions: [definition], tools: listingToolDefinitions, adapters: [createListingMcpAdapter()] }), executor: createListingAgentExecutionExecutor(request) };
    case productAgentId:
      return { runtime: createAgentRuntime({ definitions: [definition], tools: productToolDefinitions, adapters: [createProductMcpAdapter()] }), executor: createProductAgentExecutionExecutor(request) };
    case supplierAgentId:
      return { runtime: createAgentRuntime({ definitions: [definition], tools: supplierToolDefinitions, adapters: [createSupplierMcpAdapter()] }), executor: createSupplierAgentExecutionExecutor(request) };
    case ppcAgentId:
      return {
        runtime: createAgentRuntime({ definitions: [definition], tools: [...ppcToolDefinitions, ...amazonAdsToolDefinitions], adapters: [
          createPpcAnalyticsAdapter(), createAmazonAdsApiAdapter({ writeEnabled: process.env.AMAZON_ADS_EXECUTION_ENABLED === "true" }),
        ] }),
        executor: createPpcAgentExecutionExecutor({ ...request, inventoryConstraint: createPpcInventoryConstraintResolver({ body, scope }) }),
      };
    case orchestratorAgentId:
      return { runtime: createAgentRuntime({ definitions: [definition], tools: orchestratorToolDefinitions, adapters: [createOrchestratorInternalAdapter()] }), executor: createOrchestratorExecutionExecutor(request) };
    default:
      return {
        runtime: createAgentRuntime({ definitions: [definition], tools: defaultToolDefinitions, adapters: [createPlatformToolAdapter()] }),
        executor: createPlatformExecutionExecutor(body, definition.id, userId, input.requestedToolId, input.requestedToolInput, input.requiresApproval),
      };
  }
}
