import type { NextConfig } from "next";
import path from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";

const localOnlyTraceExcludes = [
  "**/.git/**/*",
  "**/.next*/**/*",
  "**/tmp/**/*",
  "**/tools/**/*",
  "**/uploads/**/*",
  "**\\.git\\**\\*",
  "**\\.next*\\**\\*",
  "**\\tmp\\**\\*",
  "**\\tools\\**\\*",
  "**\\uploads\\**\\*",
];

const nextConfig: NextConfig = {
  distDir,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingExcludes: {
    "next-server": localOnlyTraceExcludes,
    "/**/*": localOnlyTraceExcludes,
  },
};

export default nextConfig;
