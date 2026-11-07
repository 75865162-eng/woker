/** Read at most maxBytes; never fall back to an unbounded storage getBuffer. */
export async function collectBoundedBuffer(source: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("STORAGE_READ_LIMIT_INVALID");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) throw new Error("STORAGE_READ_CHUNK_INVALID");
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("STORAGE_READ_LIMIT_EXCEEDED");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}
