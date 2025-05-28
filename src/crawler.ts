import { CheerioCrawler, Configuration, RequestQueue } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
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

  for (const sitemapUrl of sitemapUrls) {
    console.log(`Processing sitemap: ${sitemapUrl}`);
    const urls = await parseSitemap(sitemapUrl);
    const newUrls = urls.filter((url) => !crawledUrls.has(url));
    const maxEntries = process.env.SITEMAP_MAX_CRAWL ? parseInt(process.env.SITEMAP_MAX_CRAWL) : 10;
    const limitedUrls = newUrls.slice(0, maxEntries);
    console.log(`Found ${urls.length} URLs, queueing ${limitedUrls.length} new URLs.`);

    Configuration.getGlobalConfig().useStorageClient(new MemoryStorage());
    const requestQueue = await RequestQueue.open('default');

    for (const url of limitedUrls) {
      await requestQueue.addRequest({ url, uniqueKey: url });
    }

    try {
      await pool.query(
        `UPDATE website
         SET website_data = JSON_SET(COALESCE(website_data, '{}'), '$.sitemap', ?)
         WHERE id = 1`,
        [sitemapUrl]
      );
      console.log(`✅ Updated DB with sitemap URL: ${sitemapUrl}`);
    } catch (error: any) {
      console.error(`❌ DB update error for sitemap ${sitemapUrl}: ${error.message}`);
    }

    const crawler = new CheerioCrawler({
      requestQueue,
      maxConcurrency: isSlowMode ? 1 : 5,
      useSessionPool: false,
      requestHandler: async ({ request, $ }) => {
        const url = request.url;
        console.log(`Crawling: ${url}`);
        try {
          const html = $.html();
          const rawHtmlBase64 = Buffer.from(html, 'utf-8').toString('base64');
          const extracted = extractFieldsFromBase64Html(rawHtmlBase64);
          const scrapedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

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
          console.log(`✅ Saved data for ${url}`);
          await sleep(isSlowMode ? 7000 : 1000);
        } catch (err: any) {
          console.error(`❌ Error crawling ${url}: ${err.message}`);
        }
      },
    });

    await crawler.run();
    console.log(`🎉 Finished crawl for sitemap: ${sitemapUrl}`);
  }

  console.log('🚀 All sitemaps processed.');
  await pool.end();
}
