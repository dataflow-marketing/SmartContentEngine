import 'dotenv/config';
import { Hono, Context } from 'hono';
import { serve } from '@hono/node-server';
import { startCrawl, CrawlOptions } from './crawler';
import { runJob, listJobs } from './orchestrator';

console.log('▶️ CORS_ALLOWED_ORIGINS =', process.env.CORS_ALLOWED_ORIGINS);
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

async function corsHandler(c: Context, next: () => Promise<any>) {
  const origin = c.req.header('origin');
  console.log('[CORS] origin =', origin, 'allowed =', allowedOrigins);

  if (origin && allowedOrigins.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    c.header('Access-Control-Allow-Credentials', 'true');
  }

  // handle preflight
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  return next();
}

const app = new Hono();

app.use('*', corsHandler);

app.options('/jobs/run', (c) => {
  const origin = c.req.header('origin') || '';
  if (allowedOrigins.includes(origin)) {
    return c
      .header('Access-Control-Allow-Origin', origin)
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type, x-api-key')
      .header('Access-Control-Allow-Credentials', 'true')
      .body(null, 204);
  }
  return c.text('Forbidden', 403);
});

app.get('/health', (c) => c.json({ status: 'ok' }));

app.put('/crawl', async (c) => {
  const providedKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_SECRET_KEY;
  if (!providedKey || providedKey !== expectedKey) {
    return c.text('Unauthorized', 401);
  }

  const { sitemap, db, slow } = await c.req.json();
  if (!sitemap || !db) {
    return c.json({ error: 'Missing required fields: sitemap and db' }, 400);
  }

  process.env.SLOW_MODE = slow === true ? 'true' : 'false';
  const options: CrawlOptions = { sitemapUrl: sitemap, databaseName: db };

  startCrawl(options)
    .then(() => console.log('Crawl finished successfully.'))
    .catch(err => console.error('Error during crawl:', err));

  return c.json({ status: 'started', sitemap, database: db, slow });
});

app.get('/jobs', async (c) => {
  const providedKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_SECRET_KEY;
  if (!providedKey || providedKey !== expectedKey) {
    return c.text('Unauthorized', 401);
  }

  try {
    const jobs = await listJobs();
    return c.json({ jobs });
  } catch (error) {
    console.error(error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

app.post('/jobs/run', async (c) => {
  const providedKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_SECRET_KEY;
  if (!providedKey || providedKey !== expectedKey) {
    return c.text('Unauthorized', 401);
  }

  try {
    const { job, payload } = await c.req.json();
    if (!job) {
      return c.json({ error: 'Job name is required in the request body' }, 400);
    }
    const result = await runJob(job, payload);
    return c.json({ result });
  } catch (error) {
    console.error(error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

serve(app);
