import { parseArgs } from './common/argumentParser.js';
import { getDataDir, ensureDirExists, getJsonFiles, readJSON, writeJSON } from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';
import * as cheerio from 'cheerio';
import cliProgress from 'cli-progress';

(async () => {
  try {
    // Parse command-line arguments.
    const { domainName } = parseArgs();
    if (!domainName) {
      logger.error('Please provide a domain name as an argument.');
      process.exit(1);
    }

    // Get the output directory for the domain and ensure it exists.
    const dataDir = await getDataDir(domainName);
    await ensureDirExists(dataDir);

    // Get all JSON files in the output directory.
    const jsonFiles = await getJsonFiles(dataDir);
    // Exclude non-page files if necessary (e.g., crawled_urls.json).
    const pageFiles = jsonFiles.filter(file => file.endsWith('.json') && file !== 'crawled_urls.json');

    // Filter files that have a rawHtmlBase64 property but no valid links array.
    const filesToProcess = [];
    for (const file of pageFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        // Process only if rawHtmlBase64 exists and either links is missing or empty.
        if (data.rawHtmlBase64 && (!data.links || !Array.isArray(data.links) || data.links.length === 0)) {
          filesToProcess.push(file);
        }
      } catch (err) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${err.message}`);
      }
    }

    const totalFiles = filesToProcess.length;
    logger.info(`Found ${totalFiles} JSON file(s) requiring link extraction.`);

    if (totalFiles === 0) {
      process.exit(0);
    }

    // Set up a progress bar.
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(totalFiles, 0);

    let processedCount = 0;
    const batchSize = 5; // Adjust as needed.

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

          // Only process if rawHtmlBase64 exists.
          if (data.rawHtmlBase64) {
            // Decode raw HTML from base64.
            const rawHtml = Buffer.from(data.rawHtmlBase64, 'base64').toString('utf-8');
            const $ = cheerio.load(rawHtml);
            const links = [];
            $('a[href]').each((_, el) => {
              const link = $(el).attr('href');
              if (link && !link.startsWith('mailto:') && !link.startsWith('tel:')) {
                try {
                  // Convert relative links to absolute URLs using document base if needed.
                  const absoluteLink = new URL(link, data.url || '').href;
                  links.push(absoluteLink);
                } catch (error) {
                  // If URL constructor fails, skip that link.
                }
              }
            });
            data.links = links;
            try {
              await writeJSON(filePath, data);
              logger.debug(`Updated links for ${file} (${links.length} links extracted).`);
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

    for (let i = 0; i < totalFiles; i += batchSize) {
      const batch = filesToProcess.slice(i, i + batchSize);
      await processBatch(batch);
    }

    progressBar.stop();
    logger.info(`Processed ${processedCount} file(s) for link extraction.`);
  } catch (error) {
    logger.error('Unexpected error: ' + error.message);
    process.exit(1);
  }
})();
