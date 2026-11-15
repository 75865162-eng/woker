import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // .next-*/** 覆盖自定义 distDir（如 .next-verify / .next-build-turbo），
    // 否则 eslint 会扫描数百 MB 的构建产物并拖垮文件代理。
    ignores: [".next/**", ".next-*/**", "node_modules*/**", "out/**", "build/**", "tmp/**", "outputs/**", "next-env.d.ts", "tmp-node-server.js"],
  },
];

export default eslintConfig;
