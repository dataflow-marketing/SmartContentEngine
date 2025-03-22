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
    
    // Get the output directory and ensure it exists.
    const dataDir = await getDataDir(domainName);
    await ensureDirExists(dataDir);
    
    // Retrieve all JSON files in the output directory.
    const jsonFiles = await getJsonFiles(dataDir);
    // Exclude non-page files (e.g., crawled_urls.json).
    const pageFiles = jsonFiles.filter(file => file.endsWith('.json') && file !== 'crawled_urls.json');
    
    // Filter files: only process those with a rawHtmlBase64 field and missing a valid images array.
    const filesToProcess = [];
    for (const file of pageFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        // Process if there is rawHtmlBase64 and images property is missing or empty.
        if (data.rawHtmlBase64 && (!data.images || !Array.isArray(data.images) || data.images.length === 0)) {
          filesToProcess.push(file);
        }
      } catch (err) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${err.message}`);
      }
    }
    
    const totalFiles = filesToProcess.length;
    logger.info(`Found ${totalFiles} JSON file(s) requiring image extraction.`);
    if (totalFiles === 0) {
      process.exit(0);
    }
    
    // Set up a progress bar.
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(totalFiles, 0);
    
    let processedCount = 0;
    const batchSize = 5; // Adjust batch size as needed.
    
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
          
          if (data.rawHtmlBase64) {
            // Decode the raw HTML from base64.
            const rawHtml = Buffer.from(data.rawHtmlBase64, 'base64').toString('utf-8');
            const $ = cheerio.load(rawHtml);
            const images = [];
            $('img').each((_, el) => {
              const imgSrc = $(el).attr('src');
              if (imgSrc) {
                try {
                  // If data.url is available use it to resolve relative URLs.
                  const base = data.url || '';
                  const absoluteUrl = new URL(imgSrc, base).href;
                  images.push(absoluteUrl);
                } catch (err) {
                  // Skip if URL conversion fails.
                }
              }
            });
            data.images = images;
            try {
              await writeJSON(filePath, data);
              logger.debug(`Updated ${file} with ${images.length} images.`);
            } catch (writeErr) {
              logger.error(`Error updating ${file}: ${writeErr.message}`);
            }
          } else {
            logger.info(`Skipping ${file}: missing rawHtmlBase64.`);
          }
          processedCount++;
          progressBar.increment();
        })
      );
    }
    
    // Process files in batches.
    for (let i = 0; i < totalFiles; i += batchSize) {
      const batch = filesToProcess.slice(i, i + batchSize);
      await processBatch(batch);
    }
    
    progressBar.stop();
    logger.info(`Processed image extraction for ${processedCount} file(s).`);
  } catch (error) {
    logger.error('Unexpected error: ' + error.message);
    process.exit(1);
  }
})();
