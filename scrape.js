import { parseArgs } from './common/argumentParser.js';
import { 
  getDataDir, 
  ensureDirExists, 
  fileExists, 
  getJsonFiles, 
  readJSON, 
  writeJSON 
} from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';
import { get } from './common/httpClient.js';
import * as cheerio from 'cheerio';
import Sitemapper from 'sitemapper';
import crypto from 'crypto';
import cliProgress from 'cli-progress';

// Parse command-line arguments.
const args = parseArgs(); // Expects { sitemapUrl, slowMode } from our parser.
const sitemapUrl = args.sitemapUrl;
const isSlowMode = args.slowMode;

if (!sitemapUrl) {
  logger.error('Please provide a sitemap URL as an argument.');
  process.exit(1);
}

// Determine the domain name from the sitemap URL.
const domainName = new URL(sitemapUrl).hostname.replace(/\W/g, '_');

// Build output directory and file paths.
const outputDir = await getDataDir(domainName);
await ensureDirExists(outputDir);
const crawledUrlsFile = joinPath(outputDir, 'crawled_urls.json');

// Load previously crawled URLs if available.
let crawledUrls = new Set();
if (await fileExists(crawledUrlsFile)) {
  try {
    const data = await readJSON(crawledUrlsFile);
    crawledUrls = new Set(data);
  } catch (error) {
    logger.error('Error reading crawled URLs file: ' + error.message);
  }
}

// Build a mapping of URLs to existing JSON data.
const existingFiles = await getJsonFiles(outputDir);
const filesMap = new Map();
for (const file of existingFiles) {
  if (file === 'crawled_urls.json') continue;
  const filePath = joinPath(outputDir, file);
  try {
    const data = await readJSON(filePath);
    if (data.url) {
      filesMap.set(data.url, data);
    }
  } catch (error) {
    logger.warn(`Skipping file ${file} due to read/parse error: ${error.message}`);
  }
}

// Initialize Sitemapper with the provided sitemap URL.
const sitemap = new Sitemapper({ url: sitemapUrl, timeout: 15000 });

/**
 * Generates a safe filename for a given page.
 * @param {string} title - The page title.
 * @param {string} url - The page URL.
 * @returns {string|null} - A sanitized filename or null if too long.
 */
function sanitizeFilename(title, url) {
  let filename = title || new URL(url).pathname.replace(/\W+/g, ' ').trim();
  filename = filename.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
  const urlHash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
  filename = `${filename}_${urlHash}`;
  if (filename.length > 255) {
    logger.warn(`Skipping ${url} due to filename length exceeding 255 characters.`);
    return null;
  }
  return filename;
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms 
 * @returns {Promise}
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches a page using an HTTP GET request and extracts its content.
 * Also, stores a base64 encoded version of the raw HTML and records the scrape timestamp.
 * @param {string} url 
 * @returns {Promise<Object|null>}
 */
async function fetchPage(url) {
  try {
    logger.debug(`Fetching: ${url}`);
    const { data } = await get(url);
    // Encode the raw HTML into base64.
    const rawHtmlBase64 = Buffer.from(data, 'utf-8').toString('base64');
    const $ = cheerio.load(data);
    const title = $('title').text().trim();
    
    // Record the time when the page was scraped.
    const scrapedAt = new Date().toISOString();

    // For this version we only store the base64 HTML and scrape timestamp.
    return { url, title, rawHtmlBase64, scrapedAt };
  } catch (error) {
    logger.error(`Error fetching ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Persists crawled URLs to a file.
 */
async function saveCrawledUrls() {
  await writeJSON(crawledUrlsFile, Array.from(crawledUrls));
}

/**
 * Crawls new pages from the sitemap that have not yet been processed, or whose JSON file
 * lacks the rawHtmlBase64 or scrapedAt fields.
 */
async function crawlNewPages() {
  const { sites } = await sitemap.fetch();
  // Filter sites: process if no file exists OR if the file exists but lacks rawHtmlBase64 or scrapedAt.
  const newPages = sites.filter(url => {
    const fileData = filesMap.get(url);
    return !fileData || !fileData.rawHtmlBase64 || !fileData.scrapedAt;
  });

  if (newPages.length === 0) {
    logger.info('No new pages to crawl.');
    return;
  }

  logger.info(isSlowMode ? 'Running in slow mode...' : 'Running in fast mode...');
  logger.info(`Total new pages to crawl: ${newPages.length}`);

  // Set up the progress bar.
  const progressBar = new cliProgress.SingleBar({
    format: 'Progress |{bar}| {percentage}% | {value}/{total}',
  }, cliProgress.Presets.shades_classic);
  progressBar.start(newPages.length, 0);

  let processedCount = 0;

  if (isSlowMode) {
    // Sequential processing with a delay.
    for (const url of newPages) {
      logger.debug(`Crawling: ${url}`);
      const pageData = await fetchPage(url);
      if (pageData) {
        const filename = sanitizeFilename(pageData.title, url);
        if (!filename) continue;
        try {
          await writeJSON(joinPath(outputDir, `${filename}.json`), pageData);
          crawledUrls.add(url);
          await saveCrawledUrls();
        } catch (err) {
          logger.error(`Error saving file for ${url}: ${err.message}`);
        }
      }
      processedCount++;
      progressBar.update(processedCount);
      await sleep(7000);
    }
  } else {
    // Concurrent processing with a slight delay between fetches.
    const promises = newPages.map(async (url) => {
      logger.info(`Crawling: ${url}`);
      await sleep(1000); // 1-second delay between each request
      const pageData = await fetchPage(url);
      if (pageData) {
        const filename = sanitizeFilename(pageData.title, url);
        if (!filename) return;
        try {
          await writeJSON(joinPath(outputDir, `${filename}.json`), pageData);
          crawledUrls.add(url);
          await saveCrawledUrls();
        } catch (err) {
          logger.error(`Error saving file for ${url}: ${err.message}`);
        }
      }
      processedCount++;
      progressBar.update(processedCount);
    });
    await Promise.all(promises);
  }

  progressBar.stop();
  logger.info('Crawling complete.');
}

await crawlNewPages();
