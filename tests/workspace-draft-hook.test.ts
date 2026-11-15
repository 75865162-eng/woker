import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { draftStorageKey, readDraft, removeDraft, writeDraft } from "../src/lib/workspace/draft-storage";

const source = readFileSync(new URL("../src/lib/workspace/use-draft-state.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*?;\s*/gms, "").replace("export function", "function"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.replace(/\bObject\.defineProperty\(exports, "__esModule", \{ value: true \}\);\s*/g, "");

test("草稿 hook 的延后 React 提交与 A 提交完成不会覆盖 B 草稿", () => {
  const values = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let workspaceId = "a";
  let cursor = 0;
  const slots: unknown[] = [];
  const effects: Array<() => void> = [];
  const listener = new Set<() => void>();
  const hook = runInNewContext(`${compiled}; useDraftState`, {
    useAppShellUser: () => ({ organizationId: "org", userId: "user" }),
    readWorkspaceScopeId: () => workspaceId,
    draftStorageKey, readDraft, writeDraft, removeDraft, sessionStorage,
    workspaceScopeChangedEventName: "scope",
    window: { addEventListener: (_name: string, fn: () => void) => listener.add(fn), removeEventListener: (_name: string, fn: () => void) => listener.delete(fn) },
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: unknown) => { slots[index] = value; }]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void) => effects.push(fn),
  }) as (key: string, initial: string) => readonly [string, (value: string | ((current: string) => string)) => void, () => void];
  function render() { cursor = 0; return hook("form", "initial"); }
  const a = render();
  effects.splice(0).forEach(fn => fn());
  a[1]("draft-A");
  workspaceId = "b";
  listener.forEach(fn => fn());
  const b = render();
  assert.equal(b[0], "initial");
  b[1]("draft-B");
  // A 发起提交时捕获的 clearDraft 在 B 已录入之后才完成。
  a[2]();
  assert.equal(render()[0], "draft-B");
  const key = (id: string) => {
    const result = draftStorageKey("form", { organizationId: "org", userId: "user", workspaceId: id });
    assert.ok(result);
    return result;
  };
  assert.equal(readDraft(sessionStorage, key("a"), "initial"), "initial");
  assert.equal(readDraft(sessionStorage, key("b"), "initial"), "draft-B");
  // 存储写入不能被 React 延后执行的 updater 搬到下一工作区。
  assert.ok(!source.includes("setValue((current)"));
});
