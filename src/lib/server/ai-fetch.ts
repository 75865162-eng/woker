import { execFileSync } from "node:child_process";
import { fetch as undiciFetch, ProxyAgent, type BodyInit, type HeadersInit } from "undici";

let cachedProxyUrl: string | null | undefined;
let cachedDispatcher: ProxyAgent | undefined;

export interface AiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface AiFetchInit {
  method: string;
  signal?: AbortSignal;
  headers?: HeadersInit;
  body?: BodyInit;
}

function getSystemProxyUrl() {
  if (cachedProxyUrl !== undefined) return cachedProxyUrl;

  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (envProxy) {
    cachedProxyUrl = envProxy;
    return cachedProxyUrl;
  }

  try {
    const output = execFileSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 1000 });
    const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(output);
    const host = output.match(/HTTPSProxy\s*:\s*([^\n]+)/)?.[1]?.trim();
    const port = output.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]?.trim();

    cachedProxyUrl = httpsEnabled && host && port ? `http://${host}:${port}` : null;
  } catch {
    cachedProxyUrl = null;
  }

  return cachedProxyUrl;
}

function getDispatcher() {
  const proxyUrl = getSystemProxyUrl();
  if (!proxyUrl) return undefined;

  cachedDispatcher ??= new ProxyAgent(proxyUrl);
  return cachedDispatcher;
}

export async function fetchAiApi(url: string, init: AiFetchInit): Promise<AiFetchResponse> {
  try {
    return await undiciFetch(url, {
      ...init,
      dispatcher: getDispatcher(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "fetch failed") {
      const proxyUrl = getSystemProxyUrl();
      const proxyHint = proxyUrl ? `当前检测到系统代理 ${proxyUrl}，但仍无法连接。` : "当前服务端未检测到可用代理。";
      throw new Error(`无法连接 AI API。${proxyHint}请检查代理是否允许 Node/本地服务访问外网，或更换可访问的 Base URL。`);
    }
    throw error;
  }
}
