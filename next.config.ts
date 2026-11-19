import type { NextConfig } from "next";
import path from "node:path";
import { amazonSlugRewrites } from "./src/lib/amazon/amazon-slug-routes";

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
    // Amazon 页面后缀命名空间：/amazon/<slug> 与赛狐 /sellfox/* 并存，
    // 复用经营中台已实现的 workbench（/operations?view=xxx 或独立子路由）。
    return amazonSlugRewrites();
  },
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
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
