/**
 * Split an array into batches of specified size
 *
 * @param items - Array to split
 * @param batchSize - Maximum number of items per batch
 * @returns Array of batches, each containing up to batchSize items
 */
export function splitToBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
