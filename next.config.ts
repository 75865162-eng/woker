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
  distDir,
  output: "standalone",
  async rewrites() {
    // Production Caddy owns this prefix; local development uses the same boundary.
    return process.env.NODE_ENV === "development"
      ? [{ source: "/lili/:path*", destination: "http://127.0.0.1:43123/lili/:path*" }]
      : [];
  },
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingExcludes: {
    "next-server": localOnlyTraceExcludes,
    "/**/*": localOnlyTraceExcludes,
  },
};

export default nextConfig;
