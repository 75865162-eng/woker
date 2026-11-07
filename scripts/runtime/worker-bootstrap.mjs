import { applyRuntimeEnvironment } from "./environment.mjs";
applyRuntimeEnvironment();

if (!process.env.ERP_WORKER_REGISTRATION) throw new Error("Use npm run worker (or its registered single-worker commands); direct Worker entrypoints are disabled.");
