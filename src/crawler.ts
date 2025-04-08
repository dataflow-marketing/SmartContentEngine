// ✅ Force memory storage for Crawlee 3.13.1
process.env.CRAWLEE_STORAGE_DIR = 'storage';

import { CheerioCrawler, RequestQueue, Configuration } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import {
  getPool,
  initDb,
  loadCrawledUrls,
  saveCrawledUrl,
  savePageData,
  PageData,
} from './db';

// Optional: create configuration (won't be passed directly in 3.13.1)
const configuration = new Configuration({
  storage: new MemoryStorage(),
  persistStorage: false,
});

export interface CrawlOptions {
  sitemapUrl?: string;
  databaseName?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const response = await axios.get(sitemapUrl);
    const sitemapXML: string = response.data;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const parsed = parser.parse(sitemapXML);

    let urls: string[] = [];
    if (parsed.urlset?.url) {
      const urlEntries = Array.isArray(parsed.urlset.url)
        ? parsed.urlset.url
        : [parsed.urlset.url];
      urls = urlEntries.map((entry: any) => entry.loc).filter(Boolean);
    }

    return urls;
  } catch (err: any) {
    console.error(`Error parsing sitemap ${sitemapUrl}: ${err.message}`);
    return [];
  }
}

export async function startCrawl(options: CrawlOptions = {}): Promise<void> {
  const sitemap = options.sitemapUrl || process.env.SITEMAP_URL;
  if (!sitemap) {
    console.error('No sitemap URL provided.');
    return;
  }

  const rawDbName = options.databaseName || process.env.DB_DATABASE;
  if (!rawDbName) {
    console.error('No database name provided.');
    return;
  }
  const dbName = rawDbName.replace(/-/g, '_');

  const pool = await getPool(dbName);
  await initDb(pool);

  const isSlowMode = process.env.SLOW_MODE === 'true';
  const crawledUrls = await loadCrawledUrls(pool);

  const sitemapUrls = [sitemap];

  // ✅ No args — Crawlee will use env variable to control storage
  const requestQueue = await RequestQueue.open('default');

  for (const sitemapUrl of sitemapUrls) {
    console.log(`Processing sitemap: ${sitemapUrl}`);
    const urls = await parseSitemap(sitemapUrl);
    console.log(`Found ${urls.length} URLs in sitemap ${sitemapUrl}`);

    const newUrls = urls.filter((url) => !crawledUrls.has(url));
    console.log(`Queueing ${newUrls.length} new URLs for crawling.`);

    for (const url of newUrls) {
      await requestQueue.addRequest({ url, uniqueKey: url });
    }
  }

  const crawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency: isSlowMode ? 1 : 5,
    requestHandler: async ({ request, $, response }) => {
      const url = request.url;
      console.log(`Crawling: ${url}`);

      try {
        const html: string = $.html();
        const title: string = $('title').text().trim();
        const rawHtmlBase64: string = Buffer.from(html, 'utf-8').toString('base64');
        const scrapedAt: string = new Date().toISOString().slice(0, 19).replace('T', ' ');

        const pageData: PageData = {
          url,
          scraped_at: scrapedAt,
          raw_html_base64: rawHtmlBase64,
          page_data: { title },
        };

        await savePageData(pool, pageData);
        await saveCrawledUrl(pool, url);
        console.log(`✅ Saved page data for ${url}`);

        await sleep(isSlowMode ? 7000 : 1000);
      } catch (err: any) {
        console.error(`❌ Error crawling ${url}: ${err.message}`);
      }
    },
  });

  await crawler.run();
  console.log('🎉 Crawling complete.');
  await pool.end();
}


import { CheerioCrawler, RequestQueue, Configuration } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import {
  getPool,
  initDb,
  loadCrawledUrls,
  saveCrawledUrl,
  savePageData,
  PageData,
} from './db';

// Optional: create configuration (won't be passed directly in 3.13.1)
const configuration = new Configuration({
  storage: new MemoryStorage(),
  persistStorage: false,
});

export interface CrawlOptions {
  sitemapUrl?: string;
  databaseName?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const response = await axios.get(sitemapUrl);
    const sitemapXML: string = response.data;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const parsed = parser.parse(sitemapXML);

    let urls: string[] = [];
    if (parsed.urlset?.url) {
      const urlEntries = Array.isArray(parsed.urlset.url)
        ? parsed.urlset.url
        : [parsed.urlset.url];
      urls = urlEntries.map((entry: any) => entry.loc).filter(Boolean);
    }

    return urls;
  } catch (err: any) {
    console.error(`Error parsing sitemap ${sitemapUrl}: ${err.message}`);
    return [];
  }
}

export async function startCrawl(options: CrawlOptions = {}): Promise<void> {
  const sitemap = options.sitemapUrl || process.env.SITEMAP_URL;
  if (!sitemap) {
    console.error('No sitemap URL provided.');
    return;
  }

  const rawDbName = options.databaseName || process.env.DB_DATABASE;
  if (!rawDbName) {
    console.error('No database name provided.');
    return;
  }
  const dbName = rawDbName.replace(/-/g, '_');

  const pool = await getPool(dbName);
  await initDb(pool);

  const isSlowMode = process.env.SLOW_MODE === 'true';
  const crawledUrls = await loadCrawledUrls(pool);

  const sitemapUrls = [sitemap];

  // ✅ No args — Crawlee will use env variable to control storage
  const requestQueue = await RequestQueue.open('default');

  for (const sitemapUrl of sitemapUrls) {
    console.log(`Processing sitemap: ${sitemapUrl}`);
    const urls = await parseSitemap(sitemapUrl);
    console.log(`Found ${urls.length} URLs in sitemap ${sitemapUrl}`);

    const newUrls = urls.filter((url) => !crawledUrls.has(url));
    console.log(`Queueing ${newUrls.length} new URLs for crawling.`);

    for (const url of newUrls) {
      await requestQueue.addRequest({ url, uniqueKey: url });
    }
  }

  const crawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency: isSlowMode ? 1 : 5,
    requestHandler: async ({ request, $, response }) => {
      const url = request.url;
      console.log(`Crawling: ${url}`);

      try {
        const html: string = $.html();
        const title: string = $('title').text().trim();
        const rawHtmlBase64: string = Buffer.from(html, 'utf-8').toString('base64');
        const scrapedAt: string = new Date().toISOString().slice(0, 19).replace('T', ' ');

        const pageData: PageData = {
          url,
          scraped_at: scrapedAt,
          raw_html_base64: rawHtmlBase64,
          page_data: { title },
        };

        await savePageData(pool, pageData);
        await saveCrawledUrl(pool, url);
        console.log(`✅ Saved page data for ${url}`);

        await sleep(isSlowMode ? 7000 : 1000);
      } catch (err: any) {
        console.error(`❌ Error crawling ${url}: ${err.message}`);
      }
    },
  });

  await crawler.run();
  console.log('🎉 Crawling complete.');
  await pool.end();
}
