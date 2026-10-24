/** Bound details on demand and never expose transport credentials inside nested raw data. */
export function sellfoxPayloadPreview(value: unknown) {
  let remaining = 500; let truncated = false;
  function visit(input: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 6) { truncated = true; return "[已截断]"; }
    if (typeof input === "string") {
      const safe = input.replace(/((?:access_token|client_secret|authorization|sign)=)[^\s&"']+/gi, "$1[已隐藏]");
      if (safe.length > 2000) { truncated = true; return `${safe.slice(0, 2000)}…`; }
      return safe;
    }
    if (input === null || typeof input !== "object") return input;
    if (Array.isArray(input)) { if (input.length > 50) truncated = true; return input.slice(0, 50).map((item) => visit(item, depth + 1)); }
    const entries = Object.entries(input); if (entries.length > 50) truncated = true;
    return Object.fromEntries(entries.slice(0, 50).map(([key, item]) => [key, /^(?:access_?token|refresh_?token|token|client_?secret|secret|authorization|sign|signature|api_?key|password)$/i.test(key) ? "[已隐藏]" : visit(item, depth + 1)]));
  }
  const payload = visit(value, 0);
  return { payload, truncated };
}
