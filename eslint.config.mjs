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
    // scripts/next-run.mjs 会把产物写到 .next-run/<name>/ 下；不排除会把编译后的
    // server/*.js 当成源码扫描，产生上万条伪错误并让 npm run lint 在构建后必挂。
    // .next-types-*.json / .next-types-ambient-*.d.ts 是 next-run.mjs 生成在项目根的
    // 临时类型配置（dev 进程存活期间存在），需与 .next-types*/** 目录一并排除，
    // 否则 dev 运行时 npm run lint 会把 ambient 的 triple-slash reference 当成错误。
    ignores: ["integration-evidence/**", ".next/**", ".next-run/**", ".next-local-merge/**", ".next-dev/**", ".next-dev*/**", ".next-types*/**", ".next-types-*.json", ".next-types-ambient-*.d.ts", ".next-build/**", ".next-build*/**", ".next-verify/**", ".next-verify*/**", ".next-process-*/**", ".next-auth-check/**", ".next-amazon-live/**", "node_modules*/**", "out/**", "build/**", "tmp/**", "outputs/**", "next-env.d.ts", "tmp-node-server.js"],
  },
];

export default eslintConfig;
