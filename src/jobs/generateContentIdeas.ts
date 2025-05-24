import { buildChain } from '../utilities/chain.js';
import { fetchVectorPayloads, collectionExists } from '../utilities/search.js';
import { StringOutputParser } from "@langchain/core/output_parsers";

export interface ContentGenerationParams {
  instruction: string;
  topic: string;
  db: string;
  collections: string[];
  // vectors are now optional – if absent, we'll use `topic` for the "interests" collection
  vectors?: Record<string, string[]>;
}

export async function run({
  instruction,
  topic,
  db,
  collections,
  vectors = {},
}: ContentGenerationParams) {
  if (!instruction || !topic || !db || !collections?.length) {
    throw new Error('Missing required parameters: instruction, topic, db, or collections');
  }

  console.log(`🧠 Instruction: ${instruction}`);
  console.log(`🏷 Topic: ${topic}`);
  console.log(`📦 DB: ${db}`);
  console.log(`📚 Collections: ${collections.join(', ')}`);
  console.log(`📊 Explicit Vectors:`, vectors);

  const seenChunks = new Set<string>();
  const contextChunks: string[] = [];

  for (const collection of collections) {
    const fullCollectionName = `${db}-${collection}`;
    const exists = await collectionExists(fullCollectionName);
    if (!exists) {
      console.warn(`⚠️ Collection "${fullCollectionName}" does not exist. Skipping.`);
      continue;
    }

    // If user passed explicit vectors for this collection, use them.
    // Otherwise, if it's the "interests" collection, use the topic as the search term.
    const terms = Array.isArray(vectors[collection]) && vectors[collection].length
      ? vectors[collection]
      : (collection === 'interests' ? [topic] : []);

    if (terms.length === 0) {
      console.warn(`⚠️ No terms provided for collection "${collection}". Skipping.`);
      continue;
    }

    for (const term of terms) {
      console.log(`🔍 Searching "${term}" in collection "${fullCollectionName}"...`);
      const payloads = await fetchVectorPayloads(term, fullCollectionName, 5);
      console.log(`✅ Found ${payloads.length} payloads for term "${term}"`);

      let countWithText = 0;
      for (const payload of payloads) {
        if (Array.isArray(payload.data)) {
          for (const entry of payload.data) {
            const text = entry.text;
            if (typeof text === 'string' && text.trim()) {
              const key = `${collection}:${term}:${text}`;
              if (!seenChunks.has(key)) {
                contextChunks.push(text.trim());
                seenChunks.add(key);
                countWithText++;
              }
            }
          }
        } else {
          console.warn(`⚠️ Payload missing "data" array for term "${term}"`);
        }
      }
      console.log(`📄 Added ${countWithText} text chunks for term "${term}"`);
    }
  }

  const context = contextChunks.join('\n\n---\n\n');
  if (!context) {
    console.warn('⚠️ No context collected from vector payloads.');
  }

  // Build the final prompt with Instruction → Topic → Context
  const finalPrompt = [
    instruction.trim(),
    `Topic: ${topic.trim()}`,
    context && `Context:\n${context}`,
  ].filter(Boolean).join('\n\n');

  console.log(`📝 Final prompt length: ${finalPrompt.length} chars`);

  const parser = new StringOutputParser();
  const chain = buildChain(parser);
  const output = await chain.invoke({ input: finalPrompt });

  return {
    output,
    prompt: finalPrompt,
  };
}
