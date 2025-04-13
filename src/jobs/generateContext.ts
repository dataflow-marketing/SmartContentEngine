import { getPool, updatePageDataField } from '../db';
import { Ollama } from '@langchain/ollama';
import { buildChain, parseCompletion } from '../utilities/chain';
import { preparePrompt } from '../utilities/prompt';
import { getEmbedding } from '../utilities/embeddings';
import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';

interface jobPayload {
  db: string;
  prompt: string;
  field: string;
}

// ✅ Generate deterministic UUID from term
function generateId(content: string): string {
  const hash = crypto.createHash('sha1').update(content).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32),
  ].join('-');
}

// ✅ Ensure existing URLs are always an array
function ensureArray(input: string[] | string | undefined): string[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

// ✅ Get existing point from Qdrant by vector ID (CORRECTED)
async function getExistingPoint(client: QdrantClient, collectionName: string, id: string) {
  const response = await client.retrieve(collectionName, {
    ids: [id],
    with_payload: true,
    with_vector: false,
  });

  return response?.length > 0 ? response[0] : null;
}

// ✅ Update payload only
async function updatePayloadOnly(client: QdrantClient, collectionName: string, id: string, payload: Record<string, any>) {
  await client.setPayload(collectionName, {
    points: [id],
    payload,
  });
}

// ✅ Ensure collection exists (no errors, safe)
async function ensureCollectionExists(client: QdrantClient, collectionName: string, dimension: number) {
  try {
    await client.getCollection(collectionName);
    console.log(`📦 Qdrant collection '${collectionName}' already exists.`);
  } catch (error: any) {
    if (error.status === 404 || error.response?.status === 404) {
      console.log(`📦 Collection '${collectionName}' does not exist. Creating...`);
      await client.createCollection(collectionName, {
        vectors: {
          size: dimension,
          distance: 'Cosine',
        },
      });
      console.log(`✅ Collection '${collectionName}' created.`);
    } else {
      console.error(`❌ Error checking/creating collection:`, error);
      throw error;
    }
  }
}

// ✅ Main run function
export async function run(payload?: jobPayload) {
  if (!payload || !payload.db || !payload.prompt || !payload.field) {
    throw new Error('Missing required payload: { db, prompt, field }');
  }

  const { db: databaseName, prompt: payloadPrompt, field: targetField } = payload;
  console.log(`📝 Starting job for database: ${databaseName} updating field: ${targetField}`);

  const pool = await getPool(databaseName);

  const [rowsWebsite] = await pool.query(`SELECT website_data FROM website LIMIT 1`);
  const website_data = rowsWebsite[0].website_data;

  const [rowsPages] = await pool.query(`
    SELECT url, page_data
    FROM pages
  `) as [Array<{ url: string; page_data: any }>, any];

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

  const collectionName = `${databaseName}-${targetField}`;
  const embeddingDimension = 768;

  const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  });

  // ✅ Ensure collection exists before proceeding
  await ensureCollectionExists(qdrantClient, collectionName, embeddingDimension);

  for (const row of rowsPages) {
    const { url, page_data } = row;

    if (!page_data?.text) {
      console.warn(`⚠️ Skipping ${url} — no page_data.text found.`);
      continue;
    }

    console.log(`🚀 Processing ${url}`);

    try {
      const promptData = { page: page_data, website: website_data };
      const finalPrompt = preparePrompt(payloadPrompt, promptData);
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

      const terms = Array.isArray(processedResult) ? processedResult : [processedResult];

      for (const term of terms) {
        const id = generateId(term);

        const existingPoint = await getExistingPoint(qdrantClient, collectionName, id);

        let urls: string[] = [url];

        if (existingPoint) {
          console.log(`ℹ️ Term "${term}" already exists, merging URLs.`);
          const existingUrls = ensureArray(existingPoint.payload?.urls);
          urls = Array.from(new Set([...existingUrls, url]));

          await updatePayloadOnly(qdrantClient, collectionName, id, {
            [targetField]: term,
            urls,
          });

          console.log(`✅ Updated payload for term: "${term}" with URLs count: ${urls.length}`);
        } else {
          const embedding = await getEmbedding(term);

          if (!embedding || embedding.length === 0) {
            console.warn(`⚠️ Embedding generation failed for term "${term}". Skipping.`);
            continue;
          }

          await qdrantClient.upsert(collectionName, {
            points: [
              {
                id,
                vector: embedding,
                payload: {
                  [targetField]: term,
                  urls,
                },
              },
            ],
          });

          console.log(`✅ Inserted new vector for term: "${term}"`);
        }
      }

    } catch (error) {
      console.error(`❌ Error processing ${url}:`, error);
    }
  }

  console.log(`✅ Job completed for database: ${databaseName}`);
  await pool.end();
}
