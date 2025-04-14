process.env.CRAWLEE_STORAGE_DIR = 'storage';

import { CheerioCrawler, RequestQueue } from 'crawlee';
import Sitemapper from 'sitemapper';
import {
  getPool,
  initDb,
  loadCrawledUrls,
  saveCrawledUrl,
  savePageData,
  PageData,
} from './db';
import { extractFieldsFromBase64Html } from './extractors';

export interface CrawlOptions {
  sitemapUrl?: string;
  databaseName?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const sitemapper = new Sitemapper({ timeout: 15000 });
    const data = await sitemapper.fetch(sitemapUrl);
    return data.sites;
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

  const requestQueue = await RequestQueue.open('default');

  const maxEntries = process.env.SITEMAP_MAX_CRAWL ? parseInt(process.env.SITEMAP_MAX_CRAWL) : 10;

  for (const sitemapUrl of sitemapUrls) {
    console.log(`Processing sitemap: ${sitemapUrl}`);
    const urls = await parseSitemap(sitemapUrl);
    console.log(`Found ${urls.length} URLs in sitemap ${sitemapUrl}`);

    const newUrls = urls.filter((url) => !crawledUrls.has(url));
    const limitedUrls = newUrls.slice(0, maxEntries);
    console.log(`Queueing ${limitedUrls.length} new URLs for crawling.`);

    for (const url of limitedUrls) {
      await requestQueue.addRequest({ url, uniqueKey: url });
    }
  }

  try {
    await pool.query(
      `UPDATE website
       SET website_data = JSON_SET(COALESCE(website_data, '{}'), '$.sitemap', ?)
       WHERE id = 1`,
      [sitemap]
    );
    console.log(`✅ Pre-update: website.website_data updated with sitemap URL: ${sitemap}`);
  } catch (error: any) {
    console.error(`❌ Error pre-updating website_data with sitemap URL: ${error.message}`);
  }

  const crawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency: isSlowMode ? 1 : 5,
    requestHandler: async ({ request, $, response }) => {
      const url = request.url;
      console.log(`Crawling: ${url}`);

      try {
        const html: string = $.html();
        const rawHtmlBase64: string = Buffer.from(html, 'utf-8').toString('base64');

        const extracted = extractFieldsFromBase64Html(rawHtmlBase64);

        const scrapedAt: string = new Date().toISOString().slice(0, 19).replace('T', ' ');

        const pageData: PageData = {
          url,
          scraped_at: scrapedAt,
          raw_html_base64: rawHtmlBase64,
          page_data: {
            title: extracted.title,
            text: extracted.text,
          },
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
