import assert from "node:assert/strict";
import test from "node:test";
import { projectArchivedBusinessData } from "@/lib/amazon-sync/archive-business-query";

test("archive JSON keeps unknown fields and exact numeric lexemes, with path pagination", () => {
  const text = '{"payload":{"futureRows":[{"id":9007199254740993,"metric":1.2300,"future":{"flag":true}},{"id":2}]},"nextToken":"private"}';
  const result = projectArchivedBusinessData(text, "JSON", "/payload/futureRows", 1, 1);
  assert.equal(result.total, 2);
  assert.deepEqual(result.items, [{ id: "9007199254740993", metric: "1.2300", future: { flag: true } }]);
  assert.deepEqual(projectArchivedBusinessData(text, "JSON", "/payload/futureRows", 2, 1).items, [{ id: "2" }]);
});

test("archive paths cannot bypass recursive credential protection", () => {
  const text = JSON.stringify({ data: { access_token: "credential", futureField: "allowed", nested: { password: "private" } }, headers: { authorization: "Bearer private" }, NextToken: "private" });
  const result = projectArchivedBusinessData(text, "JSON", "", 1, 20);
  assert.deepEqual(result.items, [{ data: { futureField: "allowed", nested: {} } }]);
  assert.throws(() => projectArchivedBusinessData(text, "JSON", "/data/access_token", 1, 20), /不存在/);
  assert.throws(() => projectArchivedBusinessData(text, "JSON", "/data/toString", 1, 20), /不存在/);
  assert.deepEqual(projectArchivedBusinessData('{"a/b":{"~field":null}}', "JSON", "/a~1b/~0field", 1, 1).items, [null]);
});

test("TSV projection preserves duplicate and unknown columns without leaking credential cells", () => {
  const result = projectArchivedBusinessData('sku\tfuture\tfuture\taccessToken\nA\t1.2300\t2\tsecret\nB\t3\t4\tsecret\n', "REPORT", "", 2, 1);
  assert.deepEqual(result.columns, ["sku", "future", "future", "accessToken"]);
  assert.equal(result.total, 2);
  assert.deepEqual(result.items, [{ values: ["B", "3", "4", null] }]);
});

test("invalid or unsupported archive data is explicit, never silently truncated", () => {
  assert.throws(() => projectArchivedBusinessData('{"a":1,"a":2}', "JSON", "", 1, 20), /无法安全解析/);
  assert.throws(() => projectArchivedBusinessData("plain text", "REPORT", "", 1, 20), /格式暂不支持/);
  assert.throws(() => projectArchivedBusinessData("a\tb\n1\n", "REPORT", "", 1, 20), /不一致/);
  assert.throws(() => projectArchivedBusinessData("a\tb\n1\t2\n", "REPORT", "/a", 1, 20), /不接受/);
});
