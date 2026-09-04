import { prisma } from "@/lib/db/prisma";

const agentPlatformDelegates = [
  "agentDefinition",
  "agentExecution",
  "agentTool",
  "agentMemory",
  "agentApproval",
  "agentEvent",
  "agentTask",
  "agentExecutionTrace",
  "agentToolCall",
] as const;

export function hasAgentPlatformPrismaDelegates() {
  if (!process.env.DATABASE_URL) return false;

  const client = prisma as unknown as Record<string, unknown>;

  return agentPlatformDelegates.every((delegateName) => typeof client[delegateName] === "object" && client[delegateName] !== null);
}

export function isMissingAgentPlatformPersistenceError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  if ("code" in error && (error as { code?: string }).code === "P2021") {
    return true;
  }

  if (error instanceof TypeError) {
    return /Cannot read properties of undefined \(reading '(findMany|findFirst|findUnique|create|createMany|update|updateMany)'\)/.test(error.message);
  }

  return false;
}
