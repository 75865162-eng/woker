export function AppShellLoading() {
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[76px] flex-col items-center border-r border-border bg-white">
        <div className="flex h-16 w-full items-center justify-center border-b border-border">
          <div className="h-10 w-10 animate-pulse rounded-lg bg-surface-muted" />
        </div>
        <div className="flex flex-1 flex-col items-center gap-2 py-4">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-11 w-11 animate-pulse rounded-md bg-surface-muted" />
          ))}
        </div>
      </aside>
      <main className="pl-[76px]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-white/95 px-6 backdrop-blur">
          <div className="space-y-2">
            <div className="h-5 w-48 animate-pulse rounded bg-surface-muted" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded bg-surface-muted" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-9 w-40 animate-pulse rounded-md border border-border bg-white" />
            <div className="h-9 w-9 animate-pulse rounded-md border border-border bg-white" />
            <div className="h-9 w-9 animate-pulse rounded-full border border-border bg-white" />
          </div>
        </header>
        <div className="p-6">
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
              <div className="h-4 w-40 animate-pulse rounded bg-surface-muted" />
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="h-24 animate-pulse rounded-md bg-surface-muted" />
                <div className="h-24 animate-pulse rounded-md bg-surface-muted" />
                <div className="h-24 animate-pulse rounded-md bg-surface-muted" />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-white p-5 shadow-sm">
              <div className="h-4 w-52 animate-pulse rounded bg-surface-muted" />
              <div className="mt-4 space-y-3">
                <div className="h-12 animate-pulse rounded-md bg-surface-muted" />
                <div className="h-12 animate-pulse rounded-md bg-surface-muted" />
                <div className="h-12 animate-pulse rounded-md bg-surface-muted" />
                <div className="h-12 animate-pulse rounded-md bg-surface-muted" />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
