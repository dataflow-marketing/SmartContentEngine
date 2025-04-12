import { getPool, updatePageDataField } from '../db';
import { Ollama } from '@langchain/ollama';
import { buildChain, parseCompletion } from '../utilities/chain';
import { preparePrompt } from '../utilities/prompt';
import { getEmbedding } from '../utilities/embeddings';
import { QdrantVectorStore } from '@langchain/qdrant';
import { Embeddings } from 'langchain/embeddings/base';
import { QdrantClient } from '@qdrant/js-client-rest';

interface jobPayload {
  db: string;
  prompt: string;
  field: string;
}

// Dummy Embeddings implementation to satisfy Langchain's internal checks
class CustomEmbeddings implements Embeddings {
  async embedQuery(_text: string): Promise<number[]> {
    return Array(768).fill(0); // Matching your actual embedding dimension
  }
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map(() => Array(768).fill(0));
  }
}

async function ensureCollectionExists(collectionName: string, dimension: number) {
  const client = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  });

  const collections = await client.getCollections();
  const exists = collections.collections.some(col => col.name === collectionName);

  if (!exists) {
    console.log(`📦 Creating Qdrant collection '${collectionName}' with dimension ${dimension}`);
    await client.createCollection(collectionName, {
      vectors: {
        size: dimension,
        distance: 'Cosine',
      },
    });
    console.log(`✅ Collection '${collectionName}' created.`);
  } else {
    console.log(`📦 Qdrant collection '${collectionName}' already exists.`);
  }
}

export async function run(payload?: jobPayload) {
  if (!payload || !payload.db || !payload.prompt || !payload.field) {
    throw new Error('Missing required payload: { db, prompt, field }');
  }

  const { db: databaseName, prompt: payloadPrompt, field: targetField } = payload;
  console.log(`📝 Starting job for database: ${databaseName} updating field: ${targetField}`);

  const pool = await getPool(databaseName);

  const queryWebsite = `
    SELECT website_data 
    FROM website 
    LIMIT 1 
  `;
  const [rowsWebsite] = await pool.query(queryWebsite);
  console.log(rowsWebsite);
  const website_data = rowsWebsite[0].website_data
  console.log(rowsWebsite[0].website_data);

  const queryPages = `
    SELECT url, page_data
    FROM pages
    /* WHERE JSON_EXTRACT(page_data, '$.${targetField}') IS NULL */
  `;
  const [rowsPages] = await pool.query(queryPages) as [Array<{ url: string; page_data: any }>, any];

  if (rowsPages.length === 0) {
    console.log(`✅ No pages to process in database: ${databaseName}`);
    await pool.end();
    return;
  }

  console.log(`Found ${rowsPages.length} pages to process.`);

  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });

  // Dynamic collection name: databaseName-field
  const collectionName = `${databaseName}-${targetField}`;
  const embeddingDimension = 768; // Match your embedding dimension

  await ensureCollectionExists(collectionName, embeddingDimension);

  const vectorStore = await QdrantVectorStore.fromExistingCollection(
    new CustomEmbeddings(),
    {
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      collectionName,
    }
  );

  for (const row of rowsPages) {
    const { url, page_data } = row;

    if (!page_data?.text) {
      console.warn(`⚠️ Skipping ${url} — no page_data.text found.`);
      continue;
    }

    console.log(`🚀 Processing ${url}`);

    try {
      // Build the prompt data object. Now we include the fetched websiteData.
      const promptData = {
        page: page_data,       // Data from pages table record.
        website: website_data   // Data from website table (fetched before loop).
      };

      // Prepare the final prompt using your preparePrompt function.
      const finalPrompt = preparePrompt(payloadPrompt, promptData);

      const chain = buildChain(finalPrompt);
      const completion = await chain.invoke({});

      if (!completion) {
        console.warn(`⚠️ No output generated for ${url}. Skipping update.`);
        continue;
      }

      const processedResult = await parseCompletion(completion);
      console.log(processedResult);

      if (!processedResult) {
        console.warn(`⚠️ Processed result empty for ${url}. Skipping update.`);
        continue;
      }

      await updatePageDataField(pool, url, targetField, processedResult);
      console.log(`✅ Updated ${targetField} for ${url}`);

      const embedding = await getEmbedding(processedResult);
      console.log(`Embedding size: ${embedding.length}`);

      if (!embedding || embedding.length === 0) {
        console.warn(`⚠️ Embedding generation failed for ${url}. Skipping embedding update.`);
        continue;
      }

      // Store the document in Qdrant.
      await vectorStore.addDocuments(
        [
          {
            pageContent: processedResult,
            metadata: {
              url,
              [targetField]: processedResult,
              summary: processedResult, // Optional: good for aggregation.
            },
          },
        ],
        [embedding]
      );

      console.log(`✅ Stored document in Qdrant for ${url}`);

    } catch (error) {
      console.error(`❌ Error processing ${url}:`, error);
    }
  }

  console.log(`✅ Job completed for database: ${databaseName}`);
  await pool.end();
}
