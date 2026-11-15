"use client";

import { createContext, useContext } from "react";

/**
 * 标签是否在前台。
 *
 * 单文档外壳会把访问过的页面留在 React 树里（隐藏但不卸载），这样筛选条件、分页、
 * 表单草稿这些组件状态在切换标签后仍然在。但「留在树里」也意味着 DOM 一直占着内存，
 * 长列表尤其明显——`useTabActive()` 让长列表可以在标签转入后台时释放行级 DOM，
 * 回到前台时按原样重建。
 */
const TabActivityContext = createContext(true);

export const TabActivityProvider = TabActivityContext.Provider;

export function useTabActive() {
  return useContext(TabActivityContext);
}
