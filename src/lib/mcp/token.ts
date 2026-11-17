import { createHash } from "node:crypto";

export const mcpTokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
