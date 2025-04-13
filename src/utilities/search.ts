// src/utilities/search.ts

import { QdrantClient } from '@qdrant/js-client-rest';

const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';

export async function collectionExists(collectionName: string): Promise<boolean> {
  const client = new QdrantClient({ url: qdrantUrl });

  try {
    const collectionInfo = await client.getCollection(collectionName);
    return !!collectionInfo;
  } catch (error: any) {
    if (error?.response?.status === 404 || error?.data?.status?.error?.includes('doesn\'t exist')) {
      return false;
    }
    throw error;
  }
}

export async function searchVectorStore(term: string, collectionName: string): Promise<string> {
  if (!term.trim()) {
    console.warn(`⚠️ No search term provided for collection: ${collectionName}`);
    return '';
  }

  const client = new QdrantClient({ url: qdrantUrl });

  try {
    const searchResult = await client.search(collectionName, {
      vector: Array(768).fill(0), // Dummy vector
      filter: {
        must: [
          {
            key: 'summary',
            match: {
              value: term,
            },
          },
        ],
      },
      limit: 5,
    });

    if (!searchResult.length) {
      console.warn(`⚠️ No vector search results for term: "${term}" in collection: ${collectionName}`);
      return '';
    }

    const texts = searchResult
      .map(item => item.payload?.summary || item.payload?.interests || '')
      .filter(Boolean);

    return texts.join('\n');
  } catch (error: any) {
    console.warn(`⚠️ Vector search failed for collection: ${collectionName}`, error.message);
    return '';
  }
}
