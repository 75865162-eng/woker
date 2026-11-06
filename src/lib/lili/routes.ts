const liliPages = [
  { path: "start", title: "开始使用" }, { path: "skills", title: "技能" },
  { path: "cases", title: "工作流模板" },
  { path: "tools", title: "工具目录" }, { path: "workflows", title: "工作流状态" },
  { path: "tool-config", title: "工具配置" }, { path: "team", title: "团队" },
  { path: "settings", title: "设置" }, { path: "approvals", title: "审批" },
  { path: "recharge", title: "充值" }, { path: "help", title: "帮助" },
] as const;

export const liliNavigation = liliPages.filter((item) =>
  !["team", "settings", "help"].includes(item.path),
);

export type LiliPage = { kind: string; slug?: string; title: string; moduleId: string };
export function resolveLiliPage(parts: string[]): LiliPage | null {
  if (parts.length === 0) return { kind: "start", title: "开始使用", moduleId: "agents" };
  if (parts.length === 1 && parts[0] === "login") return { kind: "login", title: "登录", moduleId: "agents" };
  if (parts[0] !== "v2") return null;
  let remaining = parts.slice(1);
  if (remaining[0] === "lab") remaining = remaining.slice(1);
  const [kind, slug] = remaining;
  const item = liliPages.find((row) => row.path === kind);
  if (!item || remaining.length > 2) return null;
  if (slug && !["skills", "cases", "tools", "workflows"].includes(kind)) return null;
  if (parts[1] === "lab" && (!slug || !["skills", "cases"].includes(kind))) return null;
  const moduleId = kind === "team" ? "accounts" : ["settings", "tool-config"].includes(kind) ? "settings" : "agents";
  return { kind, slug, title: item.title, moduleId };
}

/** Fetch URLs have a dedicated API namespace; links are explicit because basePath is gone. */
export const BASE_PATH = "/lili";
export function withBasePath(path: string): string {
  if (path === "/api" || path.startsWith("/api/")) return `/api/lili${path.slice(4)}`;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}/${path.replace(/^\/+/, "")}`;
}
