// Preload before maintenance code imports a database client. Does not open connections.
import { applyRuntimeEnvironment } from "./environment.mjs";
applyRuntimeEnvironment({ validation: "database" });
