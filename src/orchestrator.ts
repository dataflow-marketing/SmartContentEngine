import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// No job interface definitions required here
import * as generateAggregate from './jobs/generateAggregate.js';
import * as generateContext from './jobs/generateContext.js';
import * as generateContentIdeas from './jobs/generateContentIdeas.js'; // our updated job

const jobMap: Record<string, { run: (payload?: any) => Promise<any> }> = {
  generateContext,
  generateAggregate,
  generateContentIdeas,
};

export async function listJobs() {
  console.log('📂 Hardcoded jobs:');
  const jobs = Object.keys(jobMap);
  jobs.forEach((job) => console.log(`✅ ${job}`));
  return jobs;
}

export async function runJob(jobName: string, payload?: any): Promise<any> {
  if (jobName === 'all') {
    const results = await Promise.allSettled(
      Object.entries(jobMap).map(async ([name, job]) => {
        console.log(`➡️ Running job: ${name}`);
        const res = await job.run(payload);
        return { job: name, result: res };
      })
    );
    return results.map((result, idx) => ({
      job: Object.keys(jobMap)[idx],
      status: result.status,
      result: result.status === 'fulfilled' ? (result as any).value : undefined,
      reason: result.status === 'rejected' ? (result as any).reason.message : undefined,
    }));
  }

  const selectedJob = jobMap[jobName];
  if (!selectedJob) {
    throw new Error(`Job not found: ${jobName}`);
  }
  console.log(`➡️ Running job: ${jobName}`);
  const result = await selectedJob.run(payload);
  return { job: jobName, status: 'fulfilled', result };
}
