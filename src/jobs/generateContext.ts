import { getPool, updatePageDataField } from '../db';
import { Ollama } from '@langchain/ollama';
import { getEmbedding } from '../utilities/embeddings';
import { QdrantClient } from '@qdrant/js-client-rest';
import { preparePrompt } from '../utilities/prompt';
import crypto from 'crypto';

interface jobPayload {
  db: string;
  prompt: string;
  field: string;
  forceRedo?: boolean;
}

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

function ensureArray(input: string[] | string | undefined): string[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

async function getExistingPoint(client: QdrantClient, collectionName: string, id: string) {
  const response = await client.retrieve(collectionName, {
    ids: [id],
    with_payload: true,
    with_vector: false,
  });
  return response?.length > 0 ? response[0] : null;
}

async function updatePayloadOnly(client: QdrantClient, collectionName: string, id: string, payload: Record<string, any>) {
  await client.setPayload(collectionName, {
    points: [id],
    payload,
  });
}

async function ensureCollectionExists(client: QdrantClient, collectionName: string, dimension: number) {
  try {
    await client.getCollection(collectionName);
    console.log(`📦 Qdrant collection '${collectionName}' already exists.`);
  } catch (error: any) {
    if (error.status === 404 || error.response?.status === 404) {
      console.log(`📦 Creating collection '${collectionName}'...`);
      await client.createCollection(collectionName, {
        vectors: {
          size: dimension,
          distance: 'Cosine',
        },
      });
    } else {
      console.error(`❌ Collection check error:`, error);
      throw error;
    }
  }
}

async function parseCompletion(output: string): Promise<any[] | null> {
  try {
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON array found in output');
    }
    const json = output.slice(start, end + 1);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.error('❌ Failed to parse completion as JSON:', err);
    return null;
  }
}

export async function run(payload?: jobPayload) {
  if (!payload || !payload.db || !payload.prompt || !payload.field) {
    throw new Error('Missing required payload: { db, prompt, field }');
  }

  const { db: databaseName, prompt: payloadPrompt, field: targetField, forceRedo = false } = payload;

  console.log(`📝 Starting job for DB: ${databaseName}, Field: ${targetField}`);
  if (forceRedo) console.log(`⚠️ Force reprocessing enabled`);

  const pool = await getPool(databaseName);
  const [rowsWebsite] = await pool.query(`SELECT website_data FROM website LIMIT 1`);
  const website_data = rowsWebsite[0].website_data;

  const whereClause = forceRedo ? '' : `WHERE JSON_EXTRACT(page_data, '$.${targetField}') IS NULL`;

  const [rowsPages] = await pool.query(`
    SELECT url, page_data
    FROM pages
    ${whereClause}
  `) as [Array<{ url: string; page_data: any }>, any];

  if (rowsPages.length === 0) {
    console.log(`✅ No pages to process.`);
    await pool.end();
    return;
  }

  console.log(`📄 Pages to process: ${rowsPages.length}`);

  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });

  const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  });

  const collectionName = `${databaseName}-${targetField}`;
  const embeddingDimension = 768;
  await ensureCollectionExists(qdrantClient, collectionName, embeddingDimension);

  for (const row of rowsPages) {
    const { url, page_data } = row;
    if (!page_data?.text) {
      console.warn(`⚠️ Skipping ${url} — no page_data.text`);
      continue;
    }

    console.log(`🚀 Processing ${url}`);

    try {
      const promptData = { page: page_data, website: website_data };
      const finalPrompt = preparePrompt(payloadPrompt, promptData);

      const completion = await llm.invoke(finalPrompt);

      const processedResult = await parseCompletion(completion);
      if (!processedResult || !Array.isArray(processedResult)) {
        console.warn(`⚠️ Empty or malformed result for ${url}`);
        continue;
      }

      await updatePageDataField(pool, url, targetField, processedResult);
      console.log(`✅ Saved ${targetField} for ${url}`);

      for (const item of processedResult) {
        const interest = item.interest || item.term;
        const text = item.text || item.content || '';

        if (!interest || !text || text.length < 20) {
          console.warn(`⚠️ Skipping weak or empty content for interest "${interest}"`);
          continue;
        }

        const id = generateId(interest);
        const existingPoint = await getExistingPoint(qdrantClient, collectionName, id);
        let urls: string[] = [url];

        if (existingPoint) {
          const existingUrls = ensureArray(existingPoint.payload?.urls);
          urls = Array.from(new Set([...existingUrls, url]));
          await updatePayloadOnly(qdrantClient, collectionName, id, {
            [targetField]: interest,
            text,
            urls,
          });
          console.log(`🔄 Updated vector for "${interest}" with ${urls.length} URLs`);
        } else {
          const embedding = await getEmbedding(text);
          if (!embedding || embedding.length === 0) {
            console.warn(`⚠️ Embedding failed for "${interest}"`);
            continue;
          }

          await qdrantClient.upsert(collectionName, {
            points: [
              {
                id,
                vector: embedding,
                payload: {
                  [targetField]: interest,
                  text,
                  urls,
                },
              },
            ],
          });

          console.log(`✅ Inserted new vector for "${interest}"`);
        }
      }

    } catch (error) {
      console.error(`❌ Error processing ${url}:`, error);
    }
  }

  console.log(`✅ Job completed.`);
  await pool.end();
}
