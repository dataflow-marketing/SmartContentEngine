import { getDataDir, checkDirExists, getJsonFiles, readJSON, writeJSON } from './common/fileUtils.js';
import { processInBatches } from './common/batchProcessor.js';
import { logger } from './common/logger.js';
import { validatePageData } from './common/validation.js';
import { handleError } from './common/errorHandling.js';
import { metrics } from './common/metrics.js';
import { joinPath } from './common/pathUtils.js';
import cliProgress from 'cli-progress';

/**
 * Processes files using a provided generation function.
 *
 * @param {Object} options - Options for processing.
 * @param {string} options.domainName - Domain to get the data directory.
 * @param {boolean} options.force - Whether to force processing.
 * @param {number} options.batchSize - Batch size for processing files.
 * @param {Function} options.generationFunction - Function to generate the target field (e.g., generateTone, generateSummary, generateInterests).
 * @param {string} options.resultField - The JSON field to update (e.g., "tone", "summary", or "interests").
 * @param {string[]|null} options.allowedValues - Optional array of allowed values for validation. If null, any value is accepted.
 * @param {string} options.description - Description of the process (for logging/progress).
 */
async function processFiles({ domainName, force, batchSize, generationFunction, resultField, allowedValues, description }) {
  try {
    const dataDir = await getDataDir(domainName);
    await checkDirExists(dataDir);

    const files = await getJsonFiles(dataDir);
    logger.info(`Found ${files.length} JSON files in ${dataDir}`);

    // Filter files that need processing.
    const filesToProcess = [];
    for (const file of files) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        // Skip if the file has already been marked as failed.
        if (data.failed) {
          logger.info(`Skipping ${file} as it is marked as failed.`);
          continue;
        }
        // Process if force is enabled or if the target field is missing/empty,
        // and ensure content exists.
        if (
          (force || !data[resultField] || (typeof data[resultField] === 'string' && data[resultField].trim() === '')) &&
          typeof data.content === 'string' &&
          data.content.trim() !== ''
        ) {
          filesToProcess.push(file);
        }
      } catch (e) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${e.message}`);
      }
    }

    logger.info(`Total files needing ${description}: ${filesToProcess.length}`);

    // Set up a progress bar.
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(filesToProcess.length, 0);

    async function processBatch(batch) {
      await Promise.allSettled(
        batch.map(async (file) => {
          const filePath = joinPath(dataDir, file);
          let data;
          try {
            data = await readJSON(filePath);
            validatePageData(data);
          } catch (err) {
            logger.error(`Validation failed for ${file}: ${err.message}`);
            metrics.incrementFailed();
            // Mark file as failed so it won't be reprocessed.
            if (data) {
              data.failed = true;
              await writeJSON(filePath, data);
            }
            progressBar.increment();
            return;
          }
          // Skip if not forcing and the result field already exists.
          if (!force && data[resultField]) {
            logger.info(`Skipping: ${file} (${resultField} already exists)`);
            metrics.incrementProcessed();
            progressBar.increment();
            return;
          }

          logger.debug(`Generating ${description} for: ${file}`);
          const result = await generationFunction(data.title, data.content);
          if (
            result &&
            result[resultField] &&
            (!allowedValues || allowedValues.includes(result[resultField]))
          ) {
            data[resultField] = result[resultField];
            await writeJSON(filePath, data);
            logger.debug(`Updated: ${file} with ${resultField}: ${result[resultField]}`);
            metrics.incrementProcessed();
          } else {
            logger.warn(`Failed to generate valid ${description} for ${file}, marking as failed.`);
            metrics.incrementFailed();
            // Mark file as failed so it won't be reprocessed.
            data.failed = true;
            await writeJSON(filePath, data);
          }
          progressBar.increment();
        })
      );
    }

    await processInBatches(filesToProcess, batchSize, processBatch);
    progressBar.stop();

    logger.info(`${description} processing complete.`);
    logger.info(`Metrics: ${JSON.stringify(metrics.getMetrics())}`);
  } catch (error) {
    handleError(error);
    throw error;
  }
}

export { processFiles };
