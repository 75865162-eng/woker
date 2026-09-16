import type { AgentDefinition, AgentToolDefinition } from "./types";

export function canAgentUseTool(agent: AgentDefinition, tool: AgentToolDefinition) {
  if (!agent.enabled || !tool.enabled) return false;

  return tool.permission.every((permission) => agent.permissions.includes(permission)) && agent.tools.includes(tool.toolId);
}

export function canAgentUsePermission(agent: AgentDefinition, permission: string) {
  return agent.enabled && agent.permissions.includes(permission);
}

