import type { NextConfig } from "next";
import path from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";

const nextConfig: NextConfig = {
  distDir,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
