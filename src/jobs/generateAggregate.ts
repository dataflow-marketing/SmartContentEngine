import { getPool } from '../db';
import { Ollama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { buildChain, parseCompletion } from '../utilities/chain';

interface OverallSummaryPayload {
  db: string;
  prompt: string; // The prompt template must include a placeholder: either {summaries} or {summary}
  field: string;  // Target key in the website_data JSON (e.g., "overallSummary")
}

async function updateWebsiteDataField(pool: any, targetField: string, value: string): Promise<void> {
  await pool.query(
    `
    UPDATE website
    SET website_data = JSON_SET(website_data, '$.${targetField}', CAST(? AS JSON))
    WHERE id = 1
    `,
    [JSON.stringify(value)]
  );
}

export async function run(payload?: OverallSummaryPayload) {
  if (!payload || !payload.db || !payload.prompt || !payload.field) {
    throw new Error('Missing required payload: { db, prompt, field }');
  }
  const { db: databaseName, prompt: payloadPrompt, field: targetField } = payload;
  console.log(`📝 Starting overall summary generation for database: ${databaseName}, updating website_data.${targetField}`);
  
  const pool = await getPool(databaseName);
  
  const [rows] = await pool.query(
    `
    SELECT JSON_EXTRACT(page_data, '$.summary') AS summary 
    FROM pages 
    WHERE JSON_EXTRACT(page_data, '$.summary') IS NOT NULL
    `
  ) as [Array<{ summary: string }>, any];
  
  if (rows.length === 0) {
    console.log(`✅ No page summaries found in database: ${databaseName}`);
    await pool.end();
    return;
  }
  console.log(`Found ${rows.length} page summaries.`);
  
  const combinedSummaries = rows
    .map(row => {
      return typeof row.summary === 'string'
        ? row.summary.replace(/^"|"$/g, '')
        : '';
    })
    .join('\n');
  
  // Replace either {summaries} or {summary} depending on which placeholder is in the prompt.
  let finalPrompt = payloadPrompt;
  if (finalPrompt.includes('{summaries}')) {
    finalPrompt = finalPrompt.replace('{summaries}', combinedSummaries);
  } else if (finalPrompt.includes('{summary}')) {
    finalPrompt = finalPrompt.replace('{summary}', combinedSummaries);
  } else {
    console.warn('No placeholder for page summaries found in the prompt template.');
  }
  
  console.log('Final prompt constructed for overall summary generation.');
  
  const promptTemplate = PromptTemplate.fromTemplate(finalPrompt);
  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });
  const chain = promptTemplate.pipe(llm);
  
  const completion = await chain.invoke({});
  const overallSummary = await parseCompletion(completion);
  
  if (!overallSummary) {
    console.warn('⚠️ Overall summary generation returned an empty result. No update performed.');
    await pool.end();
    return;
  }
  
  await updateWebsiteDataField(pool, targetField, overallSummary);
  console.log(`✅ Updated website_data.${targetField} with overall summary`);
  
  await pool.end();
  console.log(`✅ Overall summary job completed for database: ${databaseName}`);
}
