import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// For logs (optional, useful in prod)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface JobModule {
  run: (payload?: any) => Promise<void>;
}

import * as generateContext from './jobs/generateContext.js';

const jobMap: Record<string, JobModule> = {
  'generateContext': generateContext
};

export async function listJobs() {
  console.log('📂 Hardcoded jobs:');
  Object.keys(jobMap).forEach((job) => console.log(`✅ ${job}`));
  return Object.keys(jobMap);
}

export async function runJob(jobName: string, payload?: any) {
  if (jobName === 'all') {
    const results = await Promise.allSettled(
      Object.entries(jobMap).map(async ([name, job]) => {
        console.log(`➡️ Running job: ${name}`);
        await job.run(payload);
        return name;
      })
    );

    return results.map((result, idx) => ({
      job: Object.keys(jobMap)[idx],
      status: result.status,
      reason: result.status === 'rejected' ? (result.reason as Error).message : undefined,
    }));
  }

  const selectedJob = jobMap[jobName];

  if (!selectedJob) {
    throw new Error(`Job not found: ${jobName}`);
  }

  console.log(`➡️ Running job: ${jobName}`);
  await selectedJob.run(payload);

  return { job: jobName, status: 'fulfilled' };
}
