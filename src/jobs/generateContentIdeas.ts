import { buildChain } from '../utilities/chain.js';
import { fetchVectorPayloads, collectionExists } from '../utilities/search.js';
import { StringOutputParser } from "@langchain/core/output_parsers";

export interface ContentGenerationParams {
  instruction: string;
  db: string;
  collections: string[];
  vectors: Record<string, string[]>;
}

export async function run({
  instruction,
  db,
  collections,
  vectors,
}: ContentGenerationParams) {
  if (!instruction || !db || !collections?.length) {
    throw new Error('Missing required parameters: instruction, db, or collections');
  }

  console.log(`🧠 Instruction: ${instruction}`);
  console.log(`📦 DB: ${db}`);
  console.log(`📚 Collections: ${collections.join(', ')}`);
  console.log(`📊 Vectors:`, vectors);

  const seenChunks = new Set<string>();
  const contextChunks: string[] = [];

  for (const collection of collections) {
    const fullCollectionName = `${db}-${collection}`;
    const exists = await collectionExists(fullCollectionName);
    if (!exists) {
      console.warn(`⚠️ Collection "${fullCollectionName}" does not exist. Skipping.`);
      continue;
    }

    const terms = vectors?.[collection];
    if (!Array.isArray(terms) || terms.length === 0) {
      console.warn(`⚠️ No terms provided for collection "${collection}". Skipping.`);
      continue;
    }

    for (const term of terms) {
      console.log(`🔍 Searching "${term}" in collection "${fullCollectionName}"...`);
      const payloads = await fetchVectorPayloads(term, fullCollectionName, 5);
      console.log(`✅ Found ${payloads.length} payloads for term "${term}"`);

      let countWithText = 0;

      for (const payload of payloads) {
        const text = payload.text;
        if (typeof text === 'string' && text.trim().length > 0) {
          const uniqueKey = `${collection}:${term}:${text}`;
          if (!seenChunks.has(uniqueKey)) {
            // Append clean RAG content chunk
            contextChunks.push(`${text}`);
            seenChunks.add(uniqueKey);
            countWithText++;
          }
        } else {
          console.warn(`⚠️ Payload missing "text" field for term "${term}"`);
        }
      }

      console.log(`📄 Added ${countWithText} text chunks from payloads for term "${term}"`);
    }
  }

  const context = contextChunks.join('\n\n---\n\n');

  if (!context.trim()) {
    console.warn('⚠️ No context collected from vector payloads.');
  }

  const finalPrompt = `${instruction}\n\n${context}`;
  console.log(`📝 Final prompt length: ${finalPrompt.length} chars`);

  const parser = new StringOutputParser();
  const chain = buildChain(parser);
  const output = await chain.invoke({ input: finalPrompt });

  return {
    output,
    prompt: finalPrompt
  };
}
