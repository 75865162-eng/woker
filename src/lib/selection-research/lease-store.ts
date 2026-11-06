import { randomUUID } from "node:crypto";
import type { Run, Scope, Store } from "./types";

export interface ResearchRow { run: Run; leaseId: string | null; leaseUntil: number; version: string }
export interface ResearchRepository {
  create(run: Run): Promise<void>;
  read(id: string, scope: Scope): Promise<ResearchRow>;
  compareAndSet(id: string, scope: Scope, version: string, value: { run: Run; leaseId: string | null; leaseUntil: number }): Promise<string | null>;
}
/** Durable lease with CAS. Never hold a database transaction across an AI/provider request. */
export class LeaseResearchStore implements Store {
  constructor(private readonly repository: ResearchRepository, private readonly scope: Scope, private readonly now = Date.now) {}
  async create(run: Run) { await this.repository.create(run); }
  async read(id: string) { return (await this.repository.read(id, this.scope)).run; }
  async transaction<T>(id: string, work: (run: Run, save: () => Promise<void>) => Promise<T>): Promise<T> {
    const row = await this.repository.read(id, this.scope);
    if (row.leaseId && row.leaseUntil > this.now()) throw new Error("RESEARCH_BUSY");
    const leaseId = randomUUID();
    let version = await this.repository.compareAndSet(id, this.scope, row.version, { run: row.run, leaseId, leaseUntil: this.now() + 120_000 });
    if (!version) throw new Error("RESEARCH_BUSY");
    let until = this.now() + 120_000;
    const run = structuredClone(row.run);
    try {
      return await work(run, async () => {
        if (this.now() >= until) throw new Error("RESEARCH_LEASE_EXPIRED");
        run.revision++; run.updatedAt = new Date(this.now()).toISOString();
        const next = await this.repository.compareAndSet(id, this.scope, version!, { run, leaseId, leaseUntil: this.now() + 120_000 });
        if (!next) throw new Error("RESEARCH_LEASE_LOST");
        version = next; until = this.now() + 120_000;
      });
    } finally {
      // Release only the last successfully saved state: a rejected decision must not leak partial mutations.
      const latest = await this.repository.read(id, this.scope);
      if (latest.leaseId === leaseId && latest.version === version) await this.repository.compareAndSet(id, this.scope, version, { run: latest.run, leaseId: null, leaseUntil: 0 });
    }
  }
}
