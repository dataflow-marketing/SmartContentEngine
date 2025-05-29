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
  vector?: boolean;
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

async function getExistingPoint(
  client: QdrantClient,
  collectionName: string,
  id: string
) {
  const response = await client.retrieve(collectionName, {
    ids: [id],
    with_payload: true,
    with_vector: false,
  });
  return response?.length > 0 ? response[0] : null;
}

async function updatePayloadOnly(
  client: QdrantClient,
  collectionName: string,
  id: string,
  payload: Record<string, any>
) {
  await client.setPayload(collectionName, {
    points: [id],
    payload,
  });
}

async function ensureCollectionExists(
  client: QdrantClient,
  collectionName: string,
  dimension: number
) {
  try {
    await client.getCollection(collectionName);
  } catch (error: any) {
    if (error.status === 404 || error.response?.status === 404) {
      await client.createCollection(collectionName, {
        vectors: { size: dimension, distance: 'Cosine' },
      });
    } else {
      throw error;
    }
  }
}

async function parseCompletion(output: string): Promise<any[] | null> {
  try {
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('No JSON array');
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function run(payload?: jobPayload) {
  if (!payload?.db || !payload.prompt || !payload.field) {
    throw new Error('Missing required payload: { db, prompt, field }');
  }

  const {
    db: databaseName,
    prompt: payloadPrompt,
    field: targetField,
    vector: vectorEnabled = false,
    forceRedo = false,
  } = payload;

  console.log(`📝 Job for DB=${databaseName}, field=${targetField}, vector=${vectorEnabled}`);
  if (forceRedo) console.log(`⚠️ forceRedo`);

  const pool = await getPool(databaseName);
  const [[{ website_data }]] = await pool.query(`SELECT website_data FROM website LIMIT 1`);

  const jsonPath = `$.${targetField}`;
  const where = forceRedo
    ? ''
    : `WHERE JSON_EXTRACT(page_data, '${jsonPath}') IS NULL`;

  const [pages] = await pool.query<{ url: string; page_data: any }[]>(
    `SELECT url, page_data FROM pages ${where}`
  );

  if (!pages.length) {
    console.log(`✅ nothing to do`);
    await pool.end();
    return;
  }

  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });

  const llmTimeoutMs = parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || '60000', 10);
  async function invokeWithTimeout(prompt: string): Promise<string> {
    return Promise.race<string>([
      llm.invoke(prompt),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error(`LLM request timed out after ${llmTimeoutMs}ms`)),
          llmTimeoutMs
        )
      ),
    ]);
  }

  let qdrantClient: QdrantClient, collectionName: string;
  if (vectorEnabled) {
    qdrantClient = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });
    collectionName = `${databaseName}-${targetField}`;
    await ensureCollectionExists(qdrantClient, collectionName, 768);
  }

  for (const { url: pageUrl, page_data: pageData } of pages) {
    if (!pageData?.text) {
      console.warn(`⚠ skip ${pageUrl} (no page_data.text)`);
      continue;
    }

    console.log(`🚀 ${pageUrl}`);
    const promptData = { page: pageData, website: website_data };
    const finalPrompt = preparePrompt(payloadPrompt, promptData);

    let completion: string;
    try {
      completion = await invokeWithTimeout(finalPrompt);
    } catch (error: any) {
      console.error(`⚠️ LLM request for ${pageUrl} failed or timed out:`, error);
      continue;
    }

    if (!vectorEnabled) {
      const textResult = completion.trim();
      await updatePageDataField(pool, pageUrl, targetField, textResult);
      console.log(`✅ [text] saved for ${pageUrl}`);
      continue;
    }

    let items = await parseCompletion(completion);

    if (!items) {
      console.warn(`⚠ no JSON array, treating raw output as single item for ${pageUrl}`);
      const bare = completion.trim().replace(/^"|"$/g, '');
      items = [{ interest: bare, text: pageData.text }];
    } else {
      if (items.every(i => typeof i === 'string')) {
        items = items.map(str => ({ interest: str, text: pageData.text }));
      }
    }

    await updatePageDataField(pool, pageUrl, targetField, items);
    console.log(`✅ [json] saved for ${pageUrl}`);

    for (const item of items) {
      const interest = item.interest || item.term;
      const text = item.text || item.content || '';
      if (!interest || text.length < 20) continue;

      const id = generateId(interest);
      const existing = await getExistingPoint(qdrantClient!, collectionName!, id);

      if (existing) {
        const data = Array.isArray(existing.payload?.data)
          ? existing.payload.data
          : [];
        const updated = [...data, { text, url: pageUrl }];
        await updatePayloadOnly(qdrantClient!, collectionName!, id, {
          [targetField]: interest,
          data: updated,
        });
        console.log(`🔄 merged ${updated.length} for \"${interest}\"`);
      } else {
        const vector = await getEmbedding(text);
        if (!vector?.length) continue;

        await qdrantClient!.upsert(collectionName!, {
          points: [{ id, vector, payload: { [targetField]: interest, data: [{ text, url: pageUrl }] } }],
        });
        console.log(`✅ inserted \"${interest}\"`);
      }
    }
  }

  console.log(`✅ done`);
  await pool.end();
}
