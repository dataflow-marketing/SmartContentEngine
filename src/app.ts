import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { startCrawl, CrawlOptions } from './crawler';
import { runJob, listJobs } from './orchestrator';

const app = new Hono();

// Middleware for API key authentication.
app.use('*', async (c, next) => {
  const providedKey = c.req.header('x-api-key');
  const expectedKey = process.env.API_SECRET_KEY;
  if (!providedKey || providedKey !== expectedKey) {
    return c.text('Unauthorized', 401);
  }
  return next();
});

// Health endpoint
app.get('/health', (c) => c.json({ status: 'ok' }));

// Crawl route (PUT)
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

// Route to list available jobs.
app.get('/jobs', async (c) => {
  try {
    const jobs = await listJobs();
    return c.json({ jobs });
  } catch (error) {
    console.error(error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

// Route to run a job. The result from runJob is returned in the JSON response.
app.post('/jobs/run', async (c) => {
  try {
    const body = await c.req.json();
    const { job, payload } = body;
    if (!job) {
      return c.json({ error: 'Job name is required in the request body' }, 400);
    }
    // Await the job result and return it in the response.
    const result = await runJob(job, payload);
    return c.json({ result });
  } catch (error) {
    console.error(error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

// Start the server.
serve(app);
