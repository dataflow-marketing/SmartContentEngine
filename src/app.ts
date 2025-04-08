import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startCrawl, CrawlOptions } from './crawler';

const app = new Hono();

app.use('*', async (c, next) => {
  const providedKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_SECRET_KEY; 
  if (!providedKey || providedKey !== expectedKey) {
    return c.text('Unauthorized', 401);
  }
  return next();
});

app.put('/crawl', async (c) => {
  const body = await c.req.json();
  const { sitemap, db, slow } = body;

  if (!sitemap || !db) {
    return c.json({ error: 'Missing required fields: sitemap and db' }, 400);
  }

  process.env.SLOW_MODE = slow === true ? 'true' : 'false';

  const options: CrawlOptions = {
    sitemapUrl: sitemap,
    databaseName: db,
  };

  startCrawl(options)
    .then(() => console.log('Crawl finished successfully.'))
    .catch(err => console.error('Error during crawl:', err));

  return c.json({
    status: 'started',
    sitemap,
    database: db,
    slow,
  });
});

serve(app);
