export type ColumnWidths = Record<string, number>;

export const COLUMN_WIDTH_MIN = 48;
export const COLUMN_WIDTH_MAX = 800;

export function normalizeColumnWidths(value: unknown): ColumnWidths {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, width]) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(key) || typeof width !== "number" || !Number.isFinite(width) || width <= 0) return [];
      return [[key, Math.round(Math.min(Math.max(width, COLUMN_WIDTH_MIN), COLUMN_WIDTH_MAX))]];
    }),
  );
}

export function createColumnResizeController(options: {
  target: Pick<Window, "addEventListener" | "removeEventListener">;
  scope: string;
  getScope: () => string;
  getWidths: () => ColumnWidths;
  setWidths: (widths: ColumnWidths) => void;
  persist: (widths: ColumnWidths) => void;
}) {
  let active: (() => void) | null = null;
  let disposed = false;

  return {
    start(startX: number, startWidth: number, columnKey: string) {
      if (disposed || startWidth <= 0) return;
      active?.();
      const scope = options.scope;
      const valid = () => !disposed && options.getScope() === scope;
      const cleanup = () => {
        options.target.removeEventListener("pointermove", onMove);
        options.target.removeEventListener("pointerup", onUp);
        options.target.removeEventListener("pointercancel", onCancel);
        if (active === cleanup) active = null;
      };
      const onMove = (event: Event) => {
        if (!valid()) { cleanup(); return; }
        const x = (event as PointerEvent).clientX;
        const nextWidth = Math.round(Math.min(Math.max(startWidth + x - startX, COLUMN_WIDTH_MIN), COLUMN_WIDTH_MAX));
        options.setWidths({ ...options.getWidths(), [columnKey]: nextWidth });
      };
      const onUp = () => {
        const canPersist = valid();
        cleanup();
        if (canPersist) options.persist(options.getWidths());
      };
      const onCancel = () => cleanup();
      active = cleanup;
      options.target.addEventListener("pointermove", onMove);
      options.target.addEventListener("pointerup", onUp);
      options.target.addEventListener("pointercancel", onCancel);
    },
    cancel() { active?.(); },
    dispose() {
      disposed = true;
      active?.();
    },
  };
}
