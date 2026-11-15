/**
 * 全站密度偏好（紧凑 / 舒适）。
 *
 * 界面密度由 html[data-erp-density] 统一驱动：密集模式把排版基准压到 14px，
 * 表格行高、卡片内边距与文字层级随之收紧，ERP 列表页在 1080p 下能多显示 2~3 行。
 * 偏好写在 localStorage，页面框架与顶层外壳共用同一份读取逻辑。
 */
export const DENSITY_STORAGE_KEY = "tiaotiao.erp.density";

export type ErpDensity = "dense" | "comfortable";

export function readDensityPreference(): ErpDensity {
  if (typeof window === "undefined") return "dense";
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "comfortable" ? "comfortable" : "dense";
  } catch {
    return "dense";
  }
}

export function applyDensity(density: ErpDensity) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.erpDensity = density;
}

export function persistDensity(density: ErpDensity) {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // 隐私模式下忽略。
  }
}
