/**
 * Processes items in batches.
 *
 * @param {Array} items - Items to process.
 * @param {number} batchSize - Number of items per batch.
 * @param {Function} processBatch - Async callback to process a batch.
 */
export async function processInBatches(items, batchSize, processBatch) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processBatch(batch);
  }
}
