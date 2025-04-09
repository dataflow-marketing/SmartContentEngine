import { getPool, updatePageDataField } from '../db';
import { Ollama } from '@langchain/ollama';
import { buildChain, parseCompletion } from '../utilities/chain';
import { preparePrompt } from '../utilities/prompt';

interface SummaryJobPayload {
  db: string;
  prompt: string;
}

export async function run(payload?: SummaryJobPayload) {
  if (!payload || !payload.db || !payload.prompt) {
    throw new Error('Missing required payload: { db, prompt }');
  }
  const { db: databaseName, prompt: payloadPrompt } = payload;
  console.log(`📝 Starting summary job for database: ${databaseName}`);
  
  const pool = await getPool(databaseName);
  
  const [rows] = await pool.query(
    `
    SELECT url, page_data
    FROM pages
    WHERE JSON_EXTRACT(page_data, '$.summary') IS NULL
    `
  ) as [Array<{ url: string; page_data: any }>, any];
  
  if (rows.length === 0) {
    console.log(`✅ No pages to summarise in database: ${databaseName}`);
    return;
  }
  console.log(`Found ${rows.length} pages to summarise.`);
  
  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });
  
  for (const row of rows) {
    const { url, page_data } = row;
    if (!page_data?.text) {
      console.warn(`⚠️ Skipping ${url} — no page_data.text found.`);
      continue;
    }
    console.log(`🚀 Generating summary for ${url}`);
    
    try {
      const finalPrompt = preparePrompt(payloadPrompt, page_data);
      
      const chain = buildChain(finalPrompt);
      
      const completion = await chain.invoke({});
      
      if (!completion) {
        console.warn(`⚠️ No summary generated for ${url}. Skipping update.`);
        continue;
      }
      
      const summary = await parseCompletion(completion);
      if (!summary) {
        console.warn(`⚠️ Empty summary for ${url}. Skipping update.`);
        continue;
      }
      
      await updatePageDataField(pool, url, 'summary', summary);
      console.log(`✅ Summary saved for ${url}`);
      
    } catch (error) {
      console.error(`❌ Error processing ${url}:`, error);
    }
  }
  console.log(`✅ Summary job completed for database: ${databaseName}`);
}
