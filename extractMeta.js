import { parseArgs } from './common/argumentParser.js';
import { getDataDir, ensureDirExists, getJsonFiles, readJSON, writeJSON } from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';
import cliProgress from 'cli-progress';
import * as cheerio from 'cheerio';

(async () => {
  try {
    // Parse command-line arguments.
    const { domainName } = parseArgs();
    if (!domainName) {
      logger.error('Please provide a domain name as an argument.');
      process.exit(1);
    }
    
    // Get output directory and ensure it exists.
    const dataDir = await getDataDir(domainName);
    await ensureDirExists(dataDir);
    
    // Get all JSON files in the directory (excluding non-page files if needed).
    const jsonFiles = await getJsonFiles(dataDir);
    const pageFiles = jsonFiles.filter(file => file.endsWith('.json') && file !== 'crawled_urls.json');
    
    // Filter files that need metadata extraction:
    // Only process files that have a rawHtmlBase64 property and lack metadata or have an empty metadata object.
    const filesToProcess = [];
    for (const file of pageFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        if (data.rawHtmlBase64 && (!data.metadata || Object.keys(data.metadata).length === 0)) {
          filesToProcess.push(file);
        }
      } catch (err) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${err.message}`);
      }
    }
    
    const totalFiles = filesToProcess.length;
    logger.info(`Found ${totalFiles} JSON file(s) requiring metadata extraction.`);
    
    if (totalFiles === 0) {
      process.exit(0);
    }
    
    // Set up a progress bar.
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(totalFiles, 0);
    
    // Define a batch processing function.
    async function processBatch(batch) {
      await Promise.allSettled(
        batch.map(async (file) => {
          const filePath = joinPath(dataDir, file);
          let data;
          try {
            data = await readJSON(filePath);
          } catch (err) {
            logger.error(`Error reading ${file}: ${err.message}`);
            progressBar.increment();
            return;
          }
          
          // Only process if rawHtmlBase64 exists and metadata is missing or empty.
          if (data.rawHtmlBase64 && (!data.metadata || Object.keys(data.metadata).length === 0)) {
            try {
              // Decode raw HTML from base64.
              const rawHtml = Buffer.from(data.rawHtmlBase64, 'base64').toString('utf-8');
              const $ = cheerio.load(rawHtml);
              const metadata = {};
              $('meta').each((_, el) => {
                const name = $(el).attr('name') || $(el).attr('property');
                const content = $(el).attr('content');
                if (name && content) {
                  metadata[name] = content;
                }
              });
              data.metadata = metadata;
              await writeJSON(filePath, data);
              logger.debug(`Updated metadata for ${file}.`);
            } catch (err) {
              logger.error(`Error processing ${file}: ${err.message}`);
            }
          } else {
            logger.debug(`Skipping ${file}: does not meet criteria.`);
          }
          progressBar.increment();
        })
      );
    }
    
    // Process files in batches (using a simple batching mechanism).
    // You can import processInBatches from common/batchProcessor.js if available.
    const batchSize = 5; // Adjust the batch size as needed.
    for (let i = 0; i < totalFiles; i += batchSize) {
      const batch = filesToProcess.slice(i, i + batchSize);
      await processBatch(batch);
    }
    
    progressBar.stop();
    logger.info('Metadata extraction processing complete.');
  } catch (err) {
    logger.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  }
})();
