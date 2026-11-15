"use client";

import type { ComponentType, ReactNode } from "react";

/** 语义色调，统一组件库内状态色表达（浅色主题）。 */
export type ErpTone = "default" | "brand" | "success" | "warning" | "danger" | "info";

/** 页面级操作按钮描述：工具栏、空态、详情底部等处复用。 */
export type ErpAction = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: ErpTone;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  hidden?: boolean;
  hint?: string;
};

/** KPI 统计卡数据项：对应统计报表页 / 列表页顶部指标条。 */
export type ErpStat = {
  id: string;
  label: string;
  value: string | number;
  hint?: string;
  tone?: ErpTone;
  href?: string;
  onClick?: () => void;
};

/** 已选筛选条件回显项。 */
export type ErpFilterChip = { key: string; label: string; value: string };

/** 面包屑节点。 */
export type ErpBreadcrumb = { label: string; href?: string };

/** 表格列定义；渲染优先级为 render > value > 按 key 读取行字段。 */
export type ErpColumn<T> = {
  key: string;
  label: string;
  width?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  render?: (row: T, index: number) => ReactNode;
  value?: (row: T) => string | number | null | undefined;
  hint?: string;
};
