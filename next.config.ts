import type { NextConfig } from "next";
import path from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";

const localOnlyTraceExcludes = [
  "**/.git/**/*",
  "**/tmp/**/*",
  "**/tools/**/*",
  "**/uploads/**/*",
  "**\\.git\\**\\*",
  "**\\tmp\\**\\*",
  "**\\tools\\**\\*",
  "**\\uploads\\**\\*",
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
