import { getPool, updatePageDataField } from '../db';
import { Ollama } from '@langchain/ollama';
import { buildChain, parseCompletion } from '../utilities/chain';
import { preparePrompt } from '../utilities/prompt';

interface GenAIJobPayload {
  db: string;
  prompt: string;
  field: string;
}

export async function run(payload?: GenAIJobPayload) {
  if (!payload || !payload.db || !payload.prompt || !payload.field) {
    throw new Error('Missing required payload: { db, prompt, field }');
  }
  const { db: databaseName, prompt: payloadPrompt, field: targetField } = payload;
  console.log(`📝 Starting job for database: ${databaseName} updating field: ${targetField}`);
  
  const pool = await getPool(databaseName);
  
  const query = `
    SELECT url, page_data
    FROM pages
    WHERE JSON_EXTRACT(page_data, '$.${targetField}') IS NULL
  `;
  const [rows] = await pool.query(query) as [Array<{ url: string; page_data: any }>, any];
  
  if (rows.length === 0) {
    console.log(`✅ No pages to process in database: ${databaseName}`);
    return;
  }
  console.log(`Found ${rows.length} pages to process.`);
  
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
    console.log(`🚀 Processing ${url}`);
    
    try {
      const finalPrompt = preparePrompt(payloadPrompt, page_data);
      
      const chain = buildChain(finalPrompt);
      
      const completion = await chain.invoke({});
      if (!completion) {
        console.warn(`⚠️ No output generated for ${url}. Skipping update.`);
        continue;
      }
      
      const processedResult = await parseCompletion(completion);
      if (!processedResult) {
        console.warn(`⚠️ Processed result empty for ${url}. Skipping update.`);
        continue;
      }
      
      await updatePageDataField(pool, url, targetField, processedResult);
      console.log(`✅ Updated ${targetField} for ${url}`);
      
    } catch (error) {
      console.error(`❌ Error processing ${url}:`, error);
    }
  }
  console.log(`✅ Job completed for database: ${databaseName}`);
}
