/** External observations remain in versioned Amazon snapshots. They are never
 * merged into manually maintained ProductRecord fields, including title/ASIN.
 * This guard lives at the repository boundary so imports and single edits agree.
 */
export function stripAmazonProductObservations<T extends object>(product: T): T {
  const clean = { ...product };
  Reflect.deleteProperty(clean, "amazonSnapshots");
  Reflect.deleteProperty(clean, "amazonSnapshotError");
  return clean;
}
