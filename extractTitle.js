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
    
    // Get all JSON files in the output directory.
    const jsonFiles = await getJsonFiles(dataDir);
    // Exclude non-page files (e.g., crawled_urls.json).
    const pageFiles = jsonFiles.filter(file => file.endsWith('.json') && file !== 'crawled_urls.json');
    
    // Filter files: Only process files that have a rawHtmlBase64 property and have no title (or an empty title).
    const filesToProcess = [];
    for (const file of pageFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        if (data.rawHtmlBase64 && (!data.title || data.title.trim() === '')) {
          filesToProcess.push(file);
        }
      } catch (err) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${err.message}`);
      }
    }
    
    const totalFiles = filesToProcess.length;
    logger.info(`Found ${totalFiles} JSON file(s) requiring title extraction.`);
    
    if (totalFiles === 0) {
      process.exit(0);
    }
    
    // Set up a progress bar.
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(totalFiles, 0);
    
    let processedCount = 0;
    let updatedCount = 0;
    
    // Process files in batches.
    const batchSize = 5; // Adjust batch size as needed.
    for (let i = 0; i < totalFiles; i += batchSize) {
      const batch = filesToProcess.slice(i, i + batchSize);
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
          
          // Decode raw HTML from base64.
          const rawHtml = Buffer.from(data.rawHtmlBase64, 'base64').toString('utf-8');
          const $ = cheerio.load(rawHtml);
          const extractedTitle = $('title').text().trim();
          
          if (extractedTitle) {
            data.title = extractedTitle;
            try {
              await writeJSON(filePath, data);
              logger.debug(`Updated title for ${file}: "${extractedTitle}"`);
              updatedCount++;
            } catch (writeErr) {
              logger.error(`Error updating ${file}: ${writeErr.message}`);
            }
          } else {
            logger.warn(`No title found in the raw HTML for ${file}.`);
          }
          
          processedCount++;
          progressBar.increment();
        })
      );
    }
    
    progressBar.stop();
    logger.info(`Processed ${processedCount} files. Updated title in ${updatedCount} file(s).`);
    
  } catch (error) {
    logger.error('Unexpected error: ' + error.message);
    process.exit(1);
  }
})();
