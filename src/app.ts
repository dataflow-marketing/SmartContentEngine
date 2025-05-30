import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { startCrawl } from "./crawler";
import { runJob, listJobs } from "./orchestrator";
import PQueue from "p-queue";

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const PUBLIC_JOBS = new Set(
  (process.env.PUBLIC_JOBS || "")
    .split(",")
    .map((j) => j.trim())
    .filter(Boolean)
);

const contentIdeasQueue = new PQueue({ concurrency: 1 });
const defaultQueue      = new PQueue({ concurrency: 1 });

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      return allowedOrigins.includes(origin ?? "") ? origin : "";
    },
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-api-key"],
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.put("/crawl", async (c) => {
  const key = c.req.header("x-api-key");
  if (key !== process.env.API_SECRET_KEY) {
    return c.text("Unauthorized", 401);
  }

  const { sitemap, db, slow } = await c.req.json();
  if (!sitemap || !db) {
    return c.json({ error: "Missing required fields: sitemap and db" }, 400);
  }

  process.env.SLOW_MODE = slow ? "true" : "false";

  try {
    await startCrawl({ sitemapUrl: sitemap, databaseName: db });
    return c.json({ status: "finished", sitemap, database: db, slow });
  } catch (err: any) {
    return c.json({ status: "error", message: err.message }, 500);
  }
});

app.get("/jobs", async (c) => {
  const key = c.req.header("x-api-key");
  if (key !== process.env.API_SECRET_KEY) {
    return c.text("Unauthorized", 401);
  }

  try {
    const jobs = await listJobs();
    return c.json({ jobs });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

app.post("/jobs/run", async (c) => {
  const { job, payload } = await c.req.json();
  if (!job) {
    return c.json({ error: "Job name is required" }, 400);
  }

  if (!PUBLIC_JOBS.has(job)) {
    const key = c.req.header("x-api-key");
    if (key !== process.env.API_SECRET_KEY) {
      return c.text("Unauthorized", 401);
    }
  }

  const queue = job === "generateContentIdeas"
    ? contentIdeasQueue
    : defaultQueue;

  const task = () => runJob(job, payload);
  try {
    const result = await queue.add(task);
    return c.json({ status: "queued", job, result });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

serve(app);
