import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// For logs (optional, useful in prod)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface JobModule {
  run: (payload?: any) => Promise<void>;
}

// ✅ Hardcoded job imports
import * as generateSummary from './jobs/generateSummary.js';
//import * as genaiInterests from './genai/interests.js';
// Add new jobs here 👇
// import * as otherJob from './other/jobName.js';

// ✅ Hardcoded job map
const jobMap: Record<string, JobModule> = {
  'generateSummary': generateSummary,
//  'genai:interests': genaiInterests,
  // Add new jobs here 👇
  // 'other:jobName': otherJob,
};

// ✅ List all jobs
export async function listJobs() {
  console.log('📂 Hardcoded jobs:');
  Object.keys(jobMap).forEach((job) => console.log(`✅ ${job}`));
  return Object.keys(jobMap);
}

// ✅ Run selected job or all
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
