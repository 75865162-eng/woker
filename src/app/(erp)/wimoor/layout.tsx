import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";

/**
 * WIMOOR 全功能迁移区的统一外壳。
 *
 * `(erp)` 层的 WorkspaceShell 只渲染经 AppShellPage 注册进 views 的内容：
 * children 本身被放进 <div hidden>。WIMOOR 的迁移页都是纯 'use client'
 * 页面，无法自己 import 服务端 AppShell，因此在这一层用服务端 layout
 * 统一包裹，让 121 个迁移页都能走 AppShellPage → registerPage 注册路径，
 * 否则页面内容滞留在 hidden 容器里，浏览器只看得到导航壳（白屏）。
 *
 * 这里用 layout 而非逐页包裹：href 由 AppShellPage 内部 usePathname() 读取，
 * 仍是每个子路由的真实地址，多标签保活的视图身份不受影响。
 */
export default function WimoorLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell title="WIMOOR 全功能" subtitle="WIMOOR 菜单完整迁移 · 全功能业务工作台">
      {children}
    </AppShell>
  );
}
