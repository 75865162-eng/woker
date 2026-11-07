import { readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./environment.mjs";

export function runtimeVersion(root = projectRoot) {
  try { return JSON.parse(readFileSync(path.join(root, "RELEASE.json"), "utf8")).commit || "development"; }
  catch { return "development"; }
}
