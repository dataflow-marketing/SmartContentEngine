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

async function updateWebsiteDataField(pool: any, targetField: string, value: string): Promise<void> {
  await pool.query(
    `
    UPDATE website
    SET website_data = JSON_SET(website_data, '$.${targetField}', CAST(? AS JSON))
    WHERE id = 1
    `,
    [JSON.stringify(value)]
  );
  console.log(`✅ Database updated: website_data.${targetField} set successfully.`);
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

  // Query the vector collection
  const searchResult = await qdrantClient.search(collectionName, {
    vector: searchEmbedding,
    limit: 5,
    with_payload: true,
  });

  if (!searchResult || searchResult.length === 0) {
    console.log(`✅ No relevant vectors found in Qdrant collection: ${collectionName}`);
    await pool.end();
    return;
  }

  console.log(`Found ${searchResult.length} relevant entries from Qdrant.`);

  searchResult.forEach((result, index) => {
    console.log(`Result ${index + 1} full doc:`, JSON.stringify(result, null, 2));
  });

  // Safely combine payload contents
  const combinedContent = searchResult
    .map((result) => result.payload?.[aggregationItem]?.trim() || '')
    .filter(text => text.length > 0)
    .join('\n');

  if (!combinedContent) {
    console.warn('⚠️ No valid content found in search results. Skipping overall generation.');
    await pool.end();
    return;
  }

  let finalPrompt = payloadPrompt;
  const dynamicPlaceholder = `{${aggregationItem}}`;

  if (finalPrompt.includes(dynamicPlaceholder)) {
    finalPrompt = finalPrompt.replace(new RegExp(dynamicPlaceholder, 'g'), combinedContent);
  } else {
    console.warn(`⚠️ No placeholder matching your aggregationItem (${dynamicPlaceholder}) found in the prompt template.`);
  }
console.log (finalPrompt);
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

  await updateWebsiteDataField(pool, aggregationItem, overallResult);

  await pool.end();
  console.log(`✅ Job completed for database: ${databaseName}`);
}
