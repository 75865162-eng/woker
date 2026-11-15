"use client";

/**
 * 统一页面基建桶文件。
 * 布局层：@/components/erp-page
 * 元数据：@/lib/page/page-meta
 * 本桶：查询状态 / 缓存 / 取数 / 归一化 / 动作 / 事件
 */
export * from "./page-cache";
export * from "./page-fetch-bridge";
export * from "./page-bus";
export * from "./query-state";
export * from "./normalize";
export * from "./actions";
export * from "./use-list-query";
