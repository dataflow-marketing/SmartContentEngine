import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { startCrawl } from "./crawler";
import { runJob, listJobs } from "./orchestrator";

console.log("▶️ CORS_ALLOWED_ORIGINS =", process.env.CORS_ALLOWED_ORIGINS);

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

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      console.log("🌐 Incoming Origin:", origin);
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

  startCrawl({ sitemapUrl: sitemap, databaseName: db })
    .then(() => console.log("Crawl finished successfully."))
    .catch((err) => console.error("Error during crawl:", err));

  return c.json({ status: "started", sitemap, database: db, slow });
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
    console.error(error);
    return c.json({ error: error.message }, 500);
  }
});

app.post("/jobs/run", async (c) => {
  // 1. Parse out job name (and payload)
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

  try {
    const result = await runJob(job, payload);
    return c.json({ result });
  } catch (error: any) {
    console.error(error);
    return c.json({ error: error.message }, 500);
  }
});

serve(app);
