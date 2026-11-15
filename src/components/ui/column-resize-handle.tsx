"use client";

/** 表头右缘拖拽手柄：平时不可见，hover/拖拽时显示 2px 细线；双击重置该列 */
export function ColumnResizeHandle({ onPointerDown, onReset, label }: { onPointerDown: (e: React.PointerEvent) => void; onReset: () => void; label: string }) {
  return (
    <span
      className="col-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`调整${label}列宽，双击恢复默认`}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
    />
  );
}
