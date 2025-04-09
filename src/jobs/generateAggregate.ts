import { getPool } from '../db';
import { Ollama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { QdrantVectorStore } from '@langchain/qdrant';
import { Embeddings } from 'langchain/embeddings/base';
import { getEmbedding } from '../utilities/embeddings';
import { parseCompletion } from '../utilities/chain';

interface OverallPayload {
  db: string;
  prompt: string; // Prompt with placeholder: {dynamicFieldName}
  field: string;  // Target key in website_data (dynamic field name)
}

// Dummy Embeddings implementation to satisfy Langchain's internal checks
class CustomEmbeddings implements Embeddings {
  async embedQuery(_text: string): Promise<number[]> {
    return Array(768).fill(0); // Matching your embedding dimension
  }
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map(() => Array(768).fill(0));
  }
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

export async function run(payload?: OverallPayload) {
  if (!payload || !payload.db || !payload.prompt || !payload.field) {
    throw new Error('Missing required payload: { db, prompt, field }');
  }

  const { db: databaseName, prompt: payloadPrompt, field: targetField } = payload;
  console.log(`📝 Starting overall generation for database: ${databaseName}, targeting website_data.${targetField}`);

  const pool = await getPool(databaseName);
  const collectionName = `${databaseName}-${targetField}`;

  // Generate embedding for the search query
  const searchEmbedding = await getEmbedding('aggregate');

  const vectorStore = await QdrantVectorStore.fromExistingCollection(
    new CustomEmbeddings(),
    {
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      collectionName,
    }
  );

  const results = await vectorStore.similaritySearchVectorWithScore(searchEmbedding, 20);

  if (!results || results.length === 0) {
    console.log(`✅ No relevant vectors found in Qdrant collection: ${collectionName}`);
    await pool.end();
    return;
  }

  console.log(`Found ${results.length} relevant entries from Qdrant.`);

  const combinedContent = results
    .map(([doc]) => doc.pageContent.trim())
    .filter(text => text.length > 0)
    .join('\n');

  if (!combinedContent) {
    console.warn('⚠️ No valid content found in search results. Skipping overall generation.');
    await pool.end();
    return;
  }

  // Prepare the final prompt by replacing the dynamic placeholder
  let finalPrompt = payloadPrompt;
  const dynamicPlaceholder = `{${targetField}}`;

  if (finalPrompt.includes(dynamicPlaceholder)) {
    finalPrompt = finalPrompt.split(dynamicPlaceholder).join(combinedContent); // safer than replace() in case multiple
  } else {
    console.warn(`⚠️ No placeholder matching your field (${dynamicPlaceholder}) found in the prompt template.`);
  }

  const promptTemplate = PromptTemplate.fromTemplate(finalPrompt);

  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
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

  await updateWebsiteDataField(pool, targetField, overallResult);

  await pool.end();
  console.log(`✅ Job completed for database: ${databaseName}`);
}
