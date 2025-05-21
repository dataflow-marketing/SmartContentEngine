import { QdrantClient } from '@qdrant/js-client-rest';
import { getEmbedding } from './embeddings.js';

const qdrantUrlRaw = process.env.QDRANT_URL;
if (!qdrantUrlRaw) throw new Error('Missing QDRANT_URL');
const qurl = new URL(qdrantUrlRaw.replace(/\/+\$/, ''));
qurl.username = process.env.QDRANT_USER || '';
qurl.password = process.env.QDRANT_PASSWORD || '';

const client = new QdrantClient({
  url: qurl.toString(),
  checkCompatibility: false,
});

export async function collectionExists(name: string): Promise<boolean> {
  try {
    await client.getCollection(name);
    return true;
  } catch (e: any) {
    if (e?.response?.status === 404 || e?.status === 404) return false;
    throw e;
  }
}

export async function fetchVectorPayloads(
  term: string,
  collectionName: string,
  limit = 10
): Promise<any[]> {
  const cleaned = term.trim();
  if (!cleaned) {
    console.warn(`⚠️ No search term for collection ${collectionName}`);
    return [];
  }

  const vector = await getEmbedding(cleaned);
  if (!vector?.length) {
    console.warn(`⚠️ Embedding failed for "${term}"`);
    return [];
  }

  try {
    const results = await client.search(collectionName, {
      vector,
      limit,
      with_payload: true,
    });
    return results.map(hit => hit.payload).filter(Boolean);
  } catch (e: any) {
    console.warn(`⚠️ Qdrant search error for ${collectionName}:`, e.message);
    return [];
  }
}

export async function searchVectorStore(
  term: string,
  collectionName: string,
  limit = 5
): Promise<string> {
  const results = await fetchVectorPayloads(term, collectionName, limit);

  if (!results.length) {
    return `No relevant data found for "${term}" in "${collectionName}".`;
  }

  const lines: string[] = results.map((item, i) => {
    const summary = item.summary || item.text || item.content || '';
    const source = item.url || item.source || '';
    return `#${i + 1}: ${summary}${source ? `\n(Source: ${source})` : ''}`;
  });

  return `Results from collection "${collectionName}" for term "${term}":\n\n` + lines.join('\n\n');
}
