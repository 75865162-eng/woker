"use client";

/**
 * 列表页通用动作：确认、必选校验、导入导出、POST。
 *
 * 对应 Wimoor 原系统的交互约定：删除/审核/反审核先弹确认，批量动作先校验勾选，
 * 导出走后端生成文件再下载（不在前端拼 CSV），导入先校验体积与扩展名。
 */

export function confirmAction(
  message: string,
  options: { title?: string; danger?: boolean; confirmLabel?: string } = {},
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const text = options.title ? `${options.title}\n\n${message}` : message;
  // 保持零新依赖：window.confirm 与浏览器内建的 OK/Cancel 文案一致。
  void options.danger;
  void options.confirmLabel;
  return Promise.resolve(window.confirm(text));
}

export function requireSelection<T>(rows: T[] | Set<T>, message = "请先勾选至少一条记录"): boolean {
  const count = rows instanceof Set ? rows.size : rows.length;
  if (count > 0) return true;
  if (typeof window !== "undefined") window.alert(message);
  return false;
}

function appendParams(url: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch { /* 落到普通匹配 */ }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() || fallback;
}

/** 后端生成文件 → blob → <a download>；失败抛中文错误。 */
export async function downloadFile(
  url: string,
  options: {
    filename?: string;
    method?: "GET" | "POST";
    body?: unknown;
    params?: Record<string, string | number | undefined>;
  } = {},
): Promise<void> {
  if (typeof window === "undefined") throw new Error("导出只能在浏览器端执行");
  const target = appendParams(url, options.params);
  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(target, {
      method,
      cache: "no-store",
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
    });
  } catch {
    throw new Error("导出请求失败，请检查网络后重试");
  }
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`导出失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
  }
  const blob = await response.blob();
  const fallback = options.filename ?? `export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const filename = filenameFromDisposition(response.headers.get("content-disposition"), fallback);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // 立即 revoke 在部分浏览器会中断下载，延迟释放更稳妥。
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}

const DEFAULT_ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv", ".json", ".txt", ".zip"];

/** 导入：先做体积 / 扩展名校验，再以 multipart FormData 提交。 */
export async function uploadFile(
  url: string,
  file: File,
  options: { maxSizeMb?: number; fieldName?: string; extra?: Record<string, string> } = {},
): Promise<unknown> {
  const maxSizeMb = options.maxSizeMb ?? 20;
  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`文件不能超过 ${maxSizeMb}MB，当前 ${(file.size / 1024 / 1024).toFixed(1)}MB`);
  }
  if (file.size === 0) throw new Error("文件为空，请重新选择");
  const lower = file.name.toLowerCase();
  const accepted = options.fieldName === "any" || DEFAULT_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  if (!accepted) {
    throw new Error(`不支持的文件类型，请上传 ${DEFAULT_ALLOWED_EXTENSIONS.join(" / ")} 格式`);
  }

  const form = new FormData();
  form.append(options.fieldName && options.fieldName !== "any" ? options.fieldName : "file", file);
  for (const [key, value] of Object.entries(options.extra ?? {})) form.append(key, value);

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body: form, cache: "no-store" });
  } catch {
    throw new Error("导入请求失败，请检查网络后重试");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text) as unknown; } catch { payload = text; }
  }
  if (!response.ok) {
    const detail = typeof payload === "object" && payload !== null && "error" in payload
      ? String((payload as Record<string, unknown>).error)
      : text.slice(0, 200);
    throw new Error(`导入失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
  }
  return payload;
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  options: { headers?: Record<string, string> } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error("请求失败，请检查网络后重试");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text) as unknown; } catch { payload = text; }
  }
  if (!response.ok) {
    const detail = typeof payload === "object" && payload !== null && "error" in payload
      ? String((payload as Record<string, unknown>).error)
      : text.slice(0, 200);
    throw new Error(`请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
  }
  return payload as T;
}
