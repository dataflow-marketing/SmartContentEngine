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
    
    // Get the data directory for the domain and ensure it exists.
    const dataDir = await getDataDir(domainName);
    await ensureDirExists(dataDir);
    
    // Retrieve all JSON files from the output directory.
    const jsonFiles = await getJsonFiles(dataDir);
    // Exclude non-page files (e.g., crawled_urls.json).
    const pageFiles = jsonFiles.filter(file => file.endsWith('.json') && file !== 'crawled_urls.json');
    
    // Filter files: only process those with a rawHtmlBase64 property and missing content (or empty content).
    const filesToProcess = [];
    for (const file of pageFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        if (data.rawHtmlBase64 && (!data.content || data.content.trim() === '')) {
          filesToProcess.push(file);
        }
      } catch (err) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${err.message}`);
      }
    }
    
    const totalFiles = filesToProcess.length;
    logger.info(`Found ${totalFiles} JSON file(s) requiring content extraction.`);
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
          
          // Process only if there is a rawHtmlBase64 and missing/empty content.
          if (data.rawHtmlBase64 && (!data.content || data.content.trim() === '')) {
            // Decode raw HTML from base64.
            const rawHtml = Buffer.from(data.rawHtmlBase64, 'base64').toString('utf-8');
            // Load HTML with Cheerio.
            const $ = cheerio.load(rawHtml);
            // Remove unwanted elements if necessary.
            $('script, style, noscript, iframe, link, meta, svg').remove();
            // Extract the text content from the body.
            const extractedContent = $('body').text().replace(/\s+/g, ' ').trim();
            
            if (extractedContent) {
              data.content = extractedContent;
              try {
                await writeJSON(filePath, data);
                logger.debug(`Updated content for ${file}.`);
              } catch (writeErr) {
                logger.error(`Error updating ${file}: ${writeErr.message}`);
              }
            } else {
              logger.warn(`No content extracted for ${file}.`);
            }
          } else {
            logger.info(`Skipping ${file}: missing rawHtmlBase64 or content already exists.`);
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
    logger.info(`Processed content extraction for ${processedCount} file(s).`);
  } catch (error) {
    logger.error('Unexpected error: ' + error.message);
    process.exit(1);
  }
})();
