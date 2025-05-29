import { getPool } from '../db';
import { Ollama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { QdrantClient } from '@qdrant/js-client-rest';
import { getEmbedding } from '../utilities/embeddings';
import { parseCompletion } from '../utilities/chain';

interface jobPayload {
  db: string;
  prompt: string;
  aggregationItem: string;
  searchTerm?: string;
}

export async function run(payload?: jobPayload) {
  if (!payload || !payload.db || !payload.prompt || !payload.aggregationItem) {
    throw new Error('Missing required payload: { db, prompt, aggregationItem }');
  }

  const { db: databaseName, prompt: payloadPrompt, aggregationItem, searchTerm } = payload;

  console.log(`📝 Starting aggregate generation for database: ${databaseName}, targeting website_data.${aggregationItem}`);

  const pool = await getPool(databaseName);
  const collectionName = `${databaseName}-${aggregationItem}`;

  const termForEmbedding = searchTerm || aggregationItem;
  const searchEmbedding = await getEmbedding(termForEmbedding);
  console.log(`🔍 Using embedding for search term: "${termForEmbedding}"`);

  const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  });

  let searchResult;
  try {
    searchResult = await qdrantClient.search(collectionName, {
      vector: searchEmbedding,
      limit: 5,
      with_payload: true,
    });
  } catch (err: any) {
    // handle missing collection
    if (err?.status === 404) {
      console.warn(`⚠️ Qdrant collection "${collectionName}" not found. Skipping vector aggregate.`);
      await pool.end();
      return;
    }
    // re-throw any other error
    throw err;
  }

  if (!searchResult.length) {
    console.log(`✅ No relevant vectors found in Qdrant collection: ${collectionName}`);
    await pool.end();
    return;
  }

  console.log(`Found ${searchResult.length} relevant entries from Qdrant.`);
  const combinedContent = searchResult
    .map(r => r.payload?.[aggregationItem]?.trim() || '')
    .filter(Boolean)
    .join('\n');

  if (!combinedContent) {
    console.warn('⚠️ No valid content found in search results. Skipping generation.');
    await pool.end();
    return;
  }

  // inject combinedContent into the prompt
  const placeholder = `{${aggregationItem}}`;
  const finalPrompt = payloadPrompt.includes(placeholder)
    ? payloadPrompt.replace(new RegExp(placeholder, 'g'), combinedContent)
    : payloadPrompt;

  console.log(finalPrompt);

  const promptTemplate = PromptTemplate.fromTemplate(finalPrompt);
  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.2',
    temperature: 0.3,
    maxRetries: 3,
  });

  const chain = promptTemplate.pipe(llm);
  const completion = await chain.invoke({});
  const overallResult = await parseCompletion(completion);

  if (!overallResult) {
    console.warn('⚠️ Overall generation returned an empty result. No update performed.');
    await pool.end();
    return;
  }

  await pool.query(
    `
    UPDATE website
    SET website_data = JSON_SET(website_data, '$.${aggregationItem}', CAST(? AS JSON))
    WHERE id = 1
    `,
    [JSON.stringify(overallResult)]
  );
  console.log(`✅ Database updated: website_data.${aggregationItem} set successfully.`);

  await pool.end();
  console.log(`✅ Job completed for database: ${databaseName}`);
}
