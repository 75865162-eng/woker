# 本地 Lili 路由

主应用开发服务器将 `/lili` 与 `/lili/*` 转发到 `http://127.0.0.1:43123/lili`，包括页面、API 和静态文件。该前缀由 Lili 自己的登录流程验证；主应用其他路径继续使用原有认证。仅开发模式启用，生产继续由 Caddy 分流，不改变两个应用的数据库、会话或发布边界。

先在独立 Lili 源码目录启动其数据库和 `npm run dev`（端口 43123），再在本仓库执行 `npm run dev`（端口 3000）。访问 `http://localhost:3000/lili/v2/tool-config`。首次点击“进入沙盒”。两个服务都必须运行，43123 不可用时代理请求将失败。

当前本机 Lili 源码位于 `/Users/chenjieliang/Documents/lili`，来自 `zxc5700216/lili` 默认分支 `new`，校验版本 `1b616be8198322c4b34c69503b39df6b35f449d0`。它是逐文件校验的源码包，不含 Git 历史。数据库为独立本地演示库，工具密钥需在本机重新配置，不复制生产密钥。

本地集成补丁：Lili 的 `src/app/api/session/route.ts` 将登录响应 `Location` 设为带 `/lili` 前缀的相对地址，避免登录后跳到上游 43123。此补丁尚未同步到 Lili GitHub；后续更新源码包时需保留或在独立 Lili 仓库提交。

回滚：撤销 `next.config.ts` 中的 Lili rewrite 和根目录 `middleware.ts` 的开发模式 Lili 放行，然后重启主应用开发服务器。
