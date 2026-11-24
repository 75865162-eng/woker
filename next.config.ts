import type { NextConfig } from "next";
import path from "node:path";
import { amazonSlugRewrites } from "./src/lib/amazon/amazon-slug-routes";
import { namespaceRewrites } from "./src/lib/navigation/namespace-routes";

const distDir = process.env.NEXT_DIST_DIR || ".next";

const localOnlyTraceExcludes = [
  "**/.git/**/*",
  "**/tmp/**/*",
  "**/tools/**/*",
  "**/uploads/**/*",
  "**/.next-build-*/**",
];

const nextConfig: NextConfig = {
  typescript: { tsconfigPath: process.env.ERP_NEXT_TYPESCRIPT_CONFIG || "tsconfig.json" },
  distDir,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingExcludes: {
    "next-server": localOnlyTraceExcludes,
    "/**/*": localOnlyTraceExcludes,
  },
  async rewrites() {
    // 业务板块二级命名空间 → 真实页面。
    // - 商品/采购/仓库/财务/AI 等板块的二级统一走 /product、/purchase、/wms、/fin、/ai 前缀；
    // - Amazon 后缀 /amazon/<slug> 与赛狐 /sellfox/* 并存；
    // 均复用经营中台已实现的 workbench（/operations?view=xxx 或独立子路由），避免重复实现。
    return [...namespaceRewrites(), ...amazonSlugRewrites()];
  },
  async headers() {
    // CSP 白名单：所有第三方数据/LLM/SP-API 均为服务端调用，浏览器只连同源。
    // script/style 的 unsafe-inline 是 Next.js App Router hydration 与 Tailwind 运行时所需；
    // 图片仅放行本地与 Amazon 商品图 CDN（与 image-url.ts 白名单一致）。
    // ERP_CSP_REPORT_ONLY=true 时只上报不拦截，用于灰度观察后再收紧。
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://m.media-amazon.com https://images-na.ssl-images-amazon.com https://images-eu.ssl-images-amazon.com https://images-fe.ssl-images-amazon.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ];
    const cspName = process.env.ERP_CSP_REPORT_ONLY === "true" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: cspName, value: cspDirectives.join("; ") },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    ];
    if (process.env.ERP_HSTS_ENABLED === "true") headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
    return [{ source: "/:path*", headers }];
  },
  experimental: {
    // Keep client-side router cache entries alive so re-visiting a page does not
    // re-hit the server. Default is 0 for dynamic routes, which made every
    // sidebar click a full RSC round-trip.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
};

export default nextConfig;
