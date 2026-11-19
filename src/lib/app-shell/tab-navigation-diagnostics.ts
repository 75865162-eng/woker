/**
 * 多标签导航故障诊断（仅开发环境）。
 *
 * 设计约束：
 * - 生产构建中 `captureTabEvent` 立即返回，`installTabDiagnostics` 不注册任何监听，
 *   因此对最终用户零成本、零行为影响。
 * - 不修改任何业务逻辑：这里只观察、只记录，不 preventDefault、不 router.push、
 *   不强制刷新、不强制重渲染。
 * - 通过 window.__WOKER_TAB_DIAG__ 暴露快照，Playwright 与人工均可读取。
 */
"use client";

export type TabEvent =
  | { t: "click"; at: number; target: string; tabs: number; activeId: string }
  | { t: "route"; at: number; href: string; phase: "start" | "end" }
  | { t: "mount"; at: number; href: string; count: number }
  | { t: "unmount"; at: number; href: string; count: number }
  | { t: "render"; at: number; href: string; count: number }
  | { t: "viewsig"; at: number; href: string; elementId: number; contextId: number; visible: boolean }
  | { t: "appshellrender"; at: number; key: string; count: number; configId: number }
  | { t: "shellrender"; at: number; childrenId: number; segmentContextId: number; configurationId: number; displayId: number; views: number; tabs: number }
  | { t: "request"; at: number; kind: "start" | "end"; url: string; ms?: number; ok?: boolean }
  | { t: "error"; at: number; source: "onerror" | "unhandledrejection" | "console"; message: string }
  | { t: "longtask"; at: number; ms: number }
  | { t: "heap"; at: number; usedJSHeapSize?: number; totalJSHeapSize?: number };

export type ViewSig = {
  elementId: number;
  contextId: number;
  visible: boolean;
  renders: number;
  /** elementId / contextId / visible 任一变化就 +1；稳定视图应为 0。 */
  changes: number;
};

export type ShellSig = {
  renders: number;
  childrenChanges: number;
  segmentContextChanges: number;
  configurationChanges: number;
  displayChanges: number;
  lastChildrenId: number;
  lastSegmentContextId: number;
  lastConfigurationId?: number;
  lastDisplayId?: number;
};

export type TabDiagnosticSnapshot = {
  enabled: boolean;
  startedAt: number;
  events: TabEvent[];
  shellSig: ShellSig;
  counters: {
    clicks: number;
    routes: number;
    mounts: number;
    unmounts: number;
    renders: number;
    requestsStarted: number;
    requestsEnded: number;
    requestsPending: number;
    errors: number;
    longtasks: number;
  };
  mountByHref: Record<string, number>;
  renderByHref: Record<string, number>;
  viewSigs: Record<string, ViewSig>;
  appShellRenders: Record<string, number>;
  /** 外壳 state 更新来源计数：renderSetViews / effectSetViews / effectBail / setConfig。 */
  causes: Record<string, number>;
};

const IS_DEV = process.env.NODE_ENV !== "production";
const MAX_EVENTS = 4000;
const SNAPSHOT_KEY = "__WOKER_TAB_DIAG__";

type Store = {
  snapshot: TabDiagnosticSnapshot;
  installed: boolean;
};

/** 给对象引用分配稳定 id，用来判断 KeptView 的 element/context/configuration 是否换了引用。 */
const refIds = new WeakMap<object, number>();
let refIdSeq = 0;
export function diagRefId(value: unknown): number {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return 0;
  const obj = value as object;
  const existing = refIds.get(obj);
  if (existing !== undefined) return existing;
  const id = ++refIdSeq;
  refIds.set(obj, id);
  return id;
}

function emptySnapshot(): TabDiagnosticSnapshot {
  return {
    enabled: true, startedAt: Date.now(), events: [],
    shellSig: { renders: 0, childrenChanges: 0, segmentContextChanges: 0, configurationChanges: 0, displayChanges: 0, lastChildrenId: 0, lastSegmentContextId: 0 },
    counters: {
      clicks: 0, routes: 0, mounts: 0, unmounts: 0, renders: 0,
      requestsStarted: 0, requestsEnded: 0, requestsPending: 0,
      errors: 0, longtasks: 0,
    },
    mountByHref: {}, renderByHref: {}, viewSigs: {}, appShellRenders: {}, causes: {},
  };
}

/** 记录一次外壳 state 更新来源（dev-only，生产 no-op）。 */
export function bumpShellCause(kind: string): void {
  const s = store();
  if (!s) return;
  s.snapshot.causes[kind] = (s.snapshot.causes[kind] ?? 0) + 1;
}

function store(): Store | null {
  if (!IS_DEV || typeof window === "undefined") return null;
  const global = window as unknown as Record<string, Store | undefined>;
  if (!global[SNAPSHOT_KEY]) {
    global[SNAPSHOT_KEY] = { installed: false, snapshot: emptySnapshot() };
  }
  return global[SNAPSHOT_KEY]!;
}

function push(s: Store, event: TabEvent) {
  const snap = s.snapshot;
  snap.events.push(event);
  if (snap.events.length > MAX_EVENTS) snap.events.splice(0, snap.events.length - MAX_EVENTS);
}

/** 记录一个诊断事件。生产环境是 no-op。 */
export function captureTabEvent(event: TabEvent): void {
  const s = store();
  if (!s) return;
  const c = s.snapshot.counters;
  switch (event.t) {
    case "click": c.clicks++; break;
    case "route": c.routes++; break;
    case "mount":
      c.mounts++;
      s.snapshot.mountByHref[event.href] = event.count;
      break;
    case "unmount": c.unmounts++; break;
    case "render":
      c.renders++;
      s.snapshot.renderByHref[event.href] = event.count;
      break;
    case "viewsig": {
      const prev = s.snapshot.viewSigs[event.href];
      const changed = !prev
        || prev.elementId !== event.elementId
        || prev.contextId !== event.contextId
        || prev.visible !== event.visible;
      s.snapshot.viewSigs[event.href] = {
        elementId: event.elementId,
        contextId: event.contextId,
        visible: event.visible,
        renders: (prev?.renders ?? 0) + 1,
        changes: (prev?.changes ?? 0) + (changed ? 1 : 0),
      };
      break;
    }
    case "appshellrender":
      s.snapshot.appShellRenders[event.key] = event.count;
      break;
    case "shellrender": {
      const sig = s.snapshot.shellSig;
      if (sig.renders > 0) {
        if (sig.lastChildrenId !== event.childrenId) sig.childrenChanges++;
        if (sig.lastSegmentContextId !== event.segmentContextId) sig.segmentContextChanges++;
        if (sig.lastConfigurationId !== event.configurationId) sig.configurationChanges++;
        if (sig.lastDisplayId !== event.displayId) sig.displayChanges++;
      }
      sig.renders++;
      sig.lastChildrenId = event.childrenId;
      sig.lastSegmentContextId = event.segmentContextId;
      sig.lastConfigurationId = event.configurationId;
      sig.lastDisplayId = event.displayId;
      break;
    }
    case "request":
      if (event.kind === "start") { c.requestsStarted++; c.requestsPending++; }
      else { c.requestsEnded++; c.requestsPending = Math.max(0, c.requestsPending - 1); }
      break;
    case "error": c.errors++; break;
    case "longtask": c.longtasks++; break;
    case "heap": break;
  }
  push(s, event);
}

/** 读取当前诊断快照（供测试/人工核对）。生产环境返回 enabled:false 的空快照。 */
export function readTabDiagnostics(): TabDiagnosticSnapshot {
  if (IS_DEV && typeof window !== "undefined") {
    const s = store();
    if (s) return s.snapshot;
  }
  return {
    enabled: false, startedAt: 0, events: [],
    shellSig: { renders: 0, childrenChanges: 0, segmentContextChanges: 0, configurationChanges: 0, displayChanges: 0, lastChildrenId: 0, lastSegmentContextId: 0 },
    counters: { clicks: 0, routes: 0, mounts: 0, unmounts: 0, renders: 0, requestsStarted: 0, requestsEnded: 0, requestsPending: 0, errors: 0, longtasks: 0 },
    mountByHref: {}, renderByHref: {}, viewSigs: {}, appShellRenders: {}, causes: {},
  };
}

/** 重置计数器（测试之间隔离用）。 */
export function resetTabDiagnostics(): void {
  const s = store();
  if (!s) return;
  s.snapshot.events = [];
  s.snapshot.startedAt = Date.now();
  s.snapshot.mountByHref = {};
  s.snapshot.renderByHref = {};
  s.snapshot.viewSigs = {};
  s.snapshot.appShellRenders = {};
  s.snapshot.causes = {};
  s.snapshot.shellSig = { renders: 0, childrenChanges: 0, segmentContextChanges: 0, configurationChanges: 0, displayChanges: 0, lastChildrenId: 0, lastSegmentContextId: 0 };
  const c = s.snapshot.counters;
  c.clicks = c.routes = c.mounts = c.unmounts = c.renders = 0;
  c.requestsStarted = c.requestsEnded = c.requestsPending = 0;
  c.errors = c.longtasks = 0;
}

/**
 * 安装全局探针（JS 异常、未处理 Promise、长任务、fetch 计数、周期 heap 采样）。
 * 只在开发环境生效，且幂等（多次调用只装一次）。
 */
export function installTabDiagnostics(): () => void {
  const s = store();
  if (!s || s.installed) return () => {};
  s.installed = true;

  const onError = (event: ErrorEvent) => {
    captureTabEvent({ t: "error", at: Date.now(), source: "onerror", message: String(event.message || "unknown") });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    let message = "unhandled rejection";
    try { message = String((event.reason as { message?: string })?.message ?? event.reason ?? message); } catch { /* noop */ }
    captureTabEvent({ t: "error", at: Date.now(), source: "unhandledrejection", message });
  };
  const onConsoleError = (...args: unknown[]) => {
    captureTabEvent({ t: "error", at: Date.now(), source: "console", message: args.map((a) => String(a)).join(" ").slice(0, 400) });
  };
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => { onConsoleError(...args); origConsoleError.apply(console, args as never[]); };

  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const started = Date.now();
    captureTabEvent({ t: "request", at: started, kind: "start", url: url.slice(0, 300) });
    return origFetch(input, init).then(
      (res) => { captureTabEvent({ t: "request", at: Date.now(), kind: "end", url: url.slice(0, 300), ms: Date.now() - started, ok: res.ok }); return res; },
      (err) => { captureTabEvent({ t: "request", at: Date.now(), kind: "end", url: url.slice(0, 300), ms: Date.now() - started, ok: false }); throw err; },
    );
  };

  let longTaskObserver: PerformanceObserver | null = null;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        captureTabEvent({ t: "longtask", at: Date.now(), ms: Math.round(entry.duration) });
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch { /* 浏览器不支持 longtask */ }

  const heapTimer = window.setInterval(() => {
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } };
    if (perf.memory) {
      captureTabEvent({ t: "heap", at: Date.now(), usedJSHeapSize: perf.memory.usedJSHeapSize, totalJSHeapSize: perf.memory.totalJSHeapSize });
    }
  }, 5000);

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    console.error = origConsoleError;
    window.fetch = origFetch;
    window.clearInterval(heapTimer);
    longTaskObserver?.disconnect();
    if (store()) store()!.installed = false;
  };
}
