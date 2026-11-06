/** Remove only this test's Next route reference; preserve concurrent changes. */
export function restoreNextEnvironment(current, baseline, dist) {
  const own = `/// <reference path="./${dist}/types/routes.d.ts" />`;
  if (!current.split(/\r?\n/).includes(own)) return current;
  const previous = baseline.split(/\r?\n/).filter(line => /^\/\/\/ <reference path=".*\/types\/routes\.d\.ts" \/>$/.test(line));
  return current.replace(own, previous.join("\n"));
}
