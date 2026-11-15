import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

type Workflow = { jobs: Record<string, { if?: string; needs?: string | string[]; steps: Array<{ name?: string; run?: string; env?: Record<string, string> }> }> };
const workflow = parse(readFileSync(new URL("../.github/workflows/ci-cd.yml", import.meta.url), "utf8")) as Workflow;

test("release CI enforces schema, strict types and UI guard before building an artifact", () => {
  const steps = workflow.jobs.build.steps;
  const build = steps.findIndex(step => step.name === "Build");
  for (const [name, command] of [["Validate Prisma schema", "npx --no-install prisma validate"], ["Typecheck", "npm run typecheck"], ["UI regression guard", "npm run ui:guard"]]) {
    const index = steps.findIndex(step => step.name === name);
    assert.ok(index >= 0 && index < build, `${name} must block the release build`);
    assert.equal(steps[index].run, command);
  }
  assert.ok(steps.findIndex(step => step.name === "Test") < build);
  assert.ok(steps.findIndex(step => step.name === "Lint") < build);
});

test("an existing production deployment cannot bypass the performance comparison job", () => {
  const perf = workflow.jobs["performance-regression"];
  assert.match(perf.if ?? "", /workflow_dispatch/);
  assert.match(perf.if ?? "", /inputs\.deploy_production/);
  assert.match(perf.if ?? "", /!inputs\.initial_deployment/);
  assert.equal(perf.steps.find(step => step.name === "Measure base revision")?.env?.BASE_SHA, "${{ github.event.pull_request.base.sha || inputs.base_sha }}");
  const deploy = workflow.jobs["deploy-production"];
  assert.ok(Array.isArray(deploy.needs) && deploy.needs.includes("build") && deploy.needs.includes("performance-regression"));
  assert.match(deploy.if ?? "", /needs\.performance-regression\.result == 'success'/);
  assert.match(deploy.if ?? "", /inputs\.initial_deployment && needs\.performance-regression\.result == 'skipped'/);
  assert.match(deploy.if ?? "", /needs\.build\.result == 'success'/);
});
