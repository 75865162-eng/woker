import type { Page } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { SnapshotStore } from "../snapshot/store";
import { PipelineError } from "../io";
import { selectors } from "./selectors";
export class RateLimit {
  private lastRequest = 0;
  private controller = new AbortController();
  close() { this.controller.abort(); }
  private blocked = new Set<string>();
  private reservation: Promise<void> = Promise.resolve();
  constructor(private store: SnapshotStore, private intervalMs: number, private budget: number) {}
  async reserve() {
    const operation = this.reservation.then(() => this.reserveOne());
    this.reservation = operation.catch(() => {});
    return operation;
  }
  private async reserveOne() {
    if (this.controller.signal.aborted) throw new PipelineError("COLLECTION_CLOSED");
    if (!await this.store.reserve(this.budget)) throw new PipelineError("DAILY_BUDGET_EXHAUSTED");
    await delay(Math.max(0, this.lastRequest + this.intervalMs - Date.now()), undefined, { signal: this.controller.signal });
    this.lastRequest = Date.now();
  }
  async navigate(page: Page, url: string) {
    const host = new URL(url).hostname;
    if (this.blocked.has(host)) throw new PipelineError("SITE_CIRCUIT_OPEN");
    await this.reserve();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const status = response?.status() ?? 0;
    const blocked = await page.locator(selectors.blockedForm).count();
    const text = (await page.locator("body").innerText()).slice(0, 6000);
    if ([403,429,503].includes(status) || blocked || /robot check|enter the characters you see|sorry.*something went wrong|安全验证|访问受限|请先登录/i.test(text) || /(?:login|passport)\./.test(new URL(page.url()).hostname)) {
      this.blocked.add(host); throw new PipelineError("SITE_BLOCKED_OR_LOGIN_REQUIRED");
    }
    if (status >= 400 || status === 0) throw new PipelineError("HTTP_NAVIGATION_FAILED");
  }
}
