// src/api.ts
import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startCrawl, CrawlOptions } from './crawler';

const app = new Hono();

// Security middleware: Verify the API access key from header "x-api-key".
app.use('*', async (c, next) => {
  const providedKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_SECRET_KEY; 
  if (!providedKey || providedKey !== expectedKey) {
    return c.text('Unauthorized', 401);
  }
  return next();
});

// PUT /crawl endpoint.
// Expects a JSON body with keys:
// - sitemap: a single sitemap URL (string)
// - db: the database name to use for storage (string)
// - slow: a boolean value (optional)
app.put('/crawl', async (c) => {
  const body = await c.req.json();
  const { sitemap, db, slow } = body;

  if (!sitemap || !db) {
    return c.json({ error: 'Missing required fields: sitemap and db' }, 400);
  }

  // Update SLOW_MODE based on input.
  process.env.SLOW_MODE = slow === true ? 'true' : 'false';

  const options: CrawlOptions = {
    sitemapUrl: sitemap,
    databaseName: db,
  };

  // Trigger the crawl asynchronously.
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

// Start the Hono server.
serve(app);
