export interface QqBotConfig {
  appId: string;
  secret: string;
  apiBaseUrl: string;
  sandbox: boolean;
  signatureCheckEnabled: boolean;
  codexEnabled: boolean;
  codexBin: string;
  codexWorkdir: string;
  codexSandbox: "read-only" | "workspace-write" | "danger-full-access";
  codexModel?: string;
  allowedUserIds: string[];
}

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 未配置。`);
  }
  return value;
}

export function getQqBotConfig(): QqBotConfig {
  return {
    appId: readRequiredEnv("QQ_BOT_APP_ID"),
    secret: readRequiredEnv("QQ_BOT_SECRET"),
    apiBaseUrl: process.env.QQ_BOT_API_BASE_URL?.trim() || "https://api.bot.qq.com",
    sandbox: process.env.QQ_BOT_SANDBOX === "true",
    signatureCheckEnabled: process.env.QQ_BOT_SIGNATURE_CHECK !== "false",
    codexEnabled: process.env.QQ_BOT_CODEX_ENABLED !== "false",
    codexBin: process.env.QQ_BOT_CODEX_BIN?.trim() || "codex",
    codexWorkdir: process.env.QQ_BOT_CODEX_WORKDIR?.trim() || process.cwd(),
    codexSandbox: parseCodexSandbox(process.env.QQ_BOT_CODEX_SANDBOX),
    codexModel: process.env.QQ_BOT_CODEX_MODEL?.trim() || undefined,
    allowedUserIds: parseCsv(process.env.QQ_BOT_ALLOWED_USER_IDS),
  };
}

function parseCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCodexSandbox(value: string | undefined): QqBotConfig["codexSandbox"] {
  if (value === "read-only" || value === "danger-full-access") return value;
  return "workspace-write";
}
