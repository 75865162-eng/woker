/** In-memory Prisma predicates for run lease/transaction tests, with real conditional updates. */
export function matchesRun(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((part) => matchesRun(row, part));
    if (key === "AND") return (value as Record<string, unknown>[]).every((part) => matchesRun(row, part));
    const actual = row[key] ?? null;
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value).every(([operation, expected]) => {
        const a = actual instanceof Date ? actual.getTime() : actual as number;
        const b = expected instanceof Date ? expected.getTime() : expected as number;
        if (operation === "in") return (expected as unknown[]).includes(actual);
        if (actual === null) return false;
        return operation === "lt" ? a < b : operation === "lte" ? a <= b : operation === "gt" ? a > b : operation === "gte" ? a >= b : false;
      });
    }
    return actual === value;
  });
}
export function runStore(get: () => Record<string, unknown>, put: (value: Record<string, unknown>) => void) {
  function update(data: Record<string, unknown>) {
    const next = { ...get() };
    for (const [key, value] of Object.entries(data)) next[key] = value && typeof value === "object" && "increment" in value ? Number(next[key] ?? 0) + Number(value.increment) : value;
    put(next); return structuredClone(next);
  }
  return {
    findUnique: async () => structuredClone(get()),
    update: async ({ data }: { data: Record<string, unknown> }) => update(data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!matchesRun(get(), where)) return { count: 0 };
      update(data); return { count: 1 };
    },
  };
}
