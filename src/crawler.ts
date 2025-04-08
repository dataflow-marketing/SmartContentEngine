import { BasicCrawler, RequestQueue } from 'crawlee';
import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { XMLParser } from "fast-xml-parser";
import { getPool, initDb, loadCrawledUrls, saveCrawledUrl, savePageData, PageData } from './db';

export interface CrawlOptions {
  sitemapUrl?: string;
  databaseName?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const response = await axios.get(sitemapUrl);
    const sitemapXML: string = response.data;
    const options = { ignoreAttributes: false, attributeNamePrefix: '' };
    const parser = new XMLParser(options);
    const parsed = parser.parse(sitemapXML);

    let urls: string[] = [];
    if (parsed.urlset && parsed.urlset.url) {
      let urlEntries = parsed.urlset.url;
      if (!Array.isArray(urlEntries)) {
        urlEntries = [urlEntries];
      }
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
    console.error("No sitemap URL provided.");
    return;
  }
  const sitemapUrls: string[] = [sitemap];

  const rawDbName = options.databaseName || process.env.DB_DATABASE;
  if (!rawDbName) {
    console.error("No database name provided.");
    return;
  }
  const dbName = rawDbName.replace(/-/g, '_');

  const pool = await getPool(dbName);

  await initDb(pool);

  const isSlowMode: boolean = process.env.SLOW_MODE === 'true';

  const crawledUrls: Set<string> = await loadCrawledUrls(pool);
  const requestQueue = await RequestQueue.open();

  for (const sitemapUrl of sitemapUrls) {
    console.log(`Processing sitemap: ${sitemapUrl}`);
    const urls: string[] = await parseSitemap(sitemapUrl);
    console.log(`Found ${urls.length} URLs in sitemap ${sitemapUrl}`);
    const newUrls = urls.filter(url => !crawledUrls.has(url));
    console.log(`Queueing ${newUrls.length} new URLs for crawling.`);
    for (const url of newUrls) {
      await requestQueue.addRequest({ url });
    }
  }

  const crawler = new BasicCrawler({
    requestQueue,
    maxConcurrency: isSlowMode ? 1 : 5,
    handleRequestFunction: async ({ request }) => {
      const url: string = request.url;
      console.log(`Crawling: ${url}`);
      try {
        const response = await axios.get(url);
        const html: string = response.data;
        const $ = cheerio.load(html);
        const title: string = $('title').text().trim();
        const rawHtmlBase64: string = Buffer.from(html, 'utf-8').toString('base64');
        const scrapedAt: string = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const pageData: PageData = { url, title, scraped_at: scrapedAt, raw_html_base64: rawHtmlBase64 };
        await savePageData(pool, pageData);
        await saveCrawledUrl(pool, url);
        console.log(`Saved page data for ${url}`);
        if (isSlowMode) {
          await sleep(7000);
        } else {
          await sleep(1000);
        }
      } catch (err: any) {
        console.error(`Error crawling ${url}: ${err.message}`);
      }
    },
  });

  await crawler.run();
  console.log('Crawling complete.');
  await pool.end();
}
