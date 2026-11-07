import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBoundedBuffer } from "../src/lib/storage/bounded-buffer";

test("bounded storage collection closes the producer at the first excessive chunk", async () => {
  let read = 0, closed = false;
  async function* source() {
    try { for (let i = 0; i < 10000; i++) { read++; yield new Uint8Array(1024); } }
    finally { closed = true; }
  }
  await assert.rejects(() => collectBoundedBuffer(source(), 2048), /LIMIT_EXCEEDED/);
  assert.equal(read, 3);
  assert.equal(closed, true);
  assert.deepEqual(await collectBoundedBuffer((async function* () { yield Buffer.from("a"); yield Buffer.from("bc"); })(), 3), Buffer.from("abc"));
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(() => collectBoundedBuffer(source(), invalid), /LIMIT_INVALID/);
});

test("oversized disk objects stop after a bounded read and release the stream", async () => {
  const root = await mkdtemp(join(tmpdir(), "ads-bounded-storage-"));
  const file = join(root, "fixture.bin");
  try {
    await writeFile(file, Buffer.alloc(1024 * 1024));
    const source = createReadStream(file, { highWaterMark: 1024 });
    await assert.rejects(() => collectBoundedBuffer(source, 4096), /LIMIT_EXCEEDED/);
    assert.ok(source.bytesRead <= 6144, `bounded read consumed ${source.bytesRead} bytes`);
    assert.equal(source.destroyed, true);
    const exact = createReadStream(file, { highWaterMark: 64 * 1024 });
    assert.equal((await collectBoundedBuffer(exact, 1024 * 1024)).length, 1024 * 1024);
  } finally { await rm(root, { recursive: true, force: true }); }
});
