import { defineConfig } from "prisma/config";
import { applyRuntimeEnvironment } from "./scripts/runtime/environment.mjs";

// Code generation/schema validation require no database or Redis connection.
const schemaOnly = ["generate", "validate", "format"].includes(process.argv[2] ?? "");
const environment = applyRuntimeEnvironment({ validation: schemaOnly ? "schema" : "database" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: environment.DATABASE_URL ? { url: environment.DATABASE_URL } : undefined,
});
