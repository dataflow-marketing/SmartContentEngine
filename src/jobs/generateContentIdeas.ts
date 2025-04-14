import { buildChain, parseCompletion } from '../utilities/chain.js';
import { searchVectorStore, collectionExists } from '../utilities/search.js';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';

const parser = StructuredOutputParser.fromZodSchema(
  z.array(
    z.object({
      title: z.string(),
      excerpt: z.string(),
      summary: z.string(),
      body: z.string(),
      keyTakeaways: z.array(z.string()),
      wrapUp: z.string(),
      callToAction: z.string(),
    })
  )
);

export interface ContentGenerationParams {
  question: string;
  tone?: string;
  narrative?: string;
  interest?: string;
  numberOfQuestions?: number;
  db: string;
  collections: string[];
}

export interface BlogPost {
  title: string;
  excerpt: string;
  summary: string;
  body: string;
  keyTakeaways: string[];
  wrapUp: string;
  callToAction: string;
}

function escapeBraces(str: string): string {
  return str.replace(/{/g, '{{').replace(/}/g, '}}');
}

function cleanResult(result: string): string {
  return result
    .replace(/^```(?:json)?\n?/, '')
    .replace(/```$/, '')
    .trim();
}

function buildPrompt(params: ContentGenerationParams, context: string): string {
  const { question, tone = 'neutral', narrative = 'how-to', interest = 'general', numberOfQuestions = 3 } = params;
  const formatInstructions = escapeBraces(parser.getFormatInstructions());

  return `
You are a content strategist. Based on the context provided below from our content library, create ${numberOfQuestions} blog post ideas.

For each blog post, provide the following fields:
- Title
- Excerpt (1–2 sentences)
- Summary (50 words or less)
- Body (the text of the blog post)
- Key Takeaways (an array of 3–5 points, each point whould have a a short content to support the point)
- Wrap-up paragraph
- Call to action for comments

Use the following tone: ${tone}.
Use the following narrative style: ${narrative}.
Focus on the interest: ${interest}.

Context to consider:
${context}

Guiding question:
"${question}"

Format your response strictly as JSON according to the following JSON Schema:
${formatInstructions}

IMPORTANT: Only output the JSON array with no additional text, markdown formatting, or code fences.
All string values must be enclosed in a single pair of double quotes (") with proper commas between items.
Do not use triple quotes (""" or ''').
`.trim();
}

export async function run(payload?: ContentGenerationParams): Promise<BlogPost[]> {
  console.log('🟢 Payload received:', payload);
  if (!payload?.question || !payload?.db || !payload.collections || payload.collections.length === 0) {
    throw new Error('Missing required parameters: "question", "db", "collections[]"');
  }

  let combinedContext = '';
  const searchTermMap: Record<string, string | undefined> = {
    interests: payload.interest,
    tone: payload.tone,
    narrative: payload.narrative,
  };

  for (const collectionName of payload.collections) {
    const fullCollectionName = `${payload.db}-${collectionName}`;
    const searchTerm = searchTermMap[collectionName];
    if (!searchTerm) {
      console.warn(`⚠️ No search term provided for collection: ${fullCollectionName}`);
      continue;
    }
    const exists = await collectionExists(fullCollectionName);
    if (!exists) {
      console.warn(`⚠️ Collection does not exist: ${fullCollectionName}`);
      continue;
    }
    try {
      const contextChunk = await searchVectorStore(searchTerm, fullCollectionName);
      if (contextChunk && contextChunk.trim()) {
        combinedContext += `${contextChunk.trim()}\n\n`;
        console.log(`✅ Added context from collection: ${collectionName}`);
      } else {
        console.warn(`⚠️ No vector search results for term: "${searchTerm}" in collection: ${fullCollectionName}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Error searching collection: ${fullCollectionName}`, error.message);
    }
  }

  if (!combinedContext.trim() || combinedContext.length < 100) {
    console.warn('⚠️ No sufficient context found in any collection, using fallback.');
    combinedContext = 'General knowledge about influencer marketing, content creation strategies, and audience engagement.';
  }
  console.log(`✅ Combined context length: ${combinedContext.length} characters`);

  const prompt = buildPrompt(payload, combinedContext);
  console.log('📝 Final prompt:\n', prompt);

  const chain = buildChain(prompt);
  const completion = await chain.invoke({});
  const result = await parseCompletion(completion);
  const cleanedResult = cleanResult(result);
  
  let parsedResult: BlogPost[];
  try {
    parsedResult = await parser.parse(cleanedResult);
  } catch (error) {
    console.error('❌ Failed to parse structured output:', error);
    console.error('📝 Cleaned model output:', cleanedResult);
    try {
      parsedResult = JSON.parse(cleanedResult);
    } catch (error2) {
      console.error('❌ Raw JSON parsing failed:', error2);
      throw new Error('Model output could not be parsed as JSON.');
    }
  }

  if (!Array.isArray(parsedResult)) {
    throw new Error('Parsed result is not an array of blog posts.');
  }

  console.log('✅ Generated blog posts:', JSON.stringify(parsedResult, null, 2));
  return parsedResult;
}
