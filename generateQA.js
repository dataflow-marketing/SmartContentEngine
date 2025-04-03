// generateQA.js
import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists } from './common/fileUtils.js';
import fs from 'fs/promises';
import path from 'path';
import { getEmbedding } from './common/vectorStore/generateEmbeddings.js';
import { logger } from './common/logger.js';
import faiss from 'faiss-node';

// Import Ollama and prompt utilities from LangChain.
import { Ollama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { LLMChain } from 'langchain/chains';

// Configuration for Ollama LLM and the Q&A prompt.
const CONFIG = {
  llm: {
    model: 'llama3.2',           // Using "llama3.2" as requested.
    temperature: 0,
    maxRetries: 3,
    baseUrl: 'http://localhost:11434' // Adjust if needed.
  },
  prompt: {
    qa: "You are a knowledgeable assistant. Use the following context to answer the question.\n\nContext:\n{context}\n\nQuestion: {question}\n\nAnswer:"
  },
  chunkSize: 50 // Number of words per chunk (must match indexing logic)
};

/**
 * Helper function that, given metadata and the data directory, re-reads the file,
 * splits the content into chunks, and returns the chunk corresponding to meta.chunkIndex.
 */
async function getChunkContent(dataDir, meta, chunkSize = CONFIG.chunkSize) {
  const filePath = path.join(dataDir, meta.source);
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const words = text.split(/\s+/).filter(Boolean);
    // meta.chunkIndex is assumed to be 1-indexed.
    const start = (meta.chunkIndex - 1) * chunkSize;
    const chunkWords = words.slice(start, start + chunkSize);
    return chunkWords.join(" ");
  } catch (e) {
    logger.error(`Error reading file ${meta.source} to extract chunk ${meta.chunkIndex}: ${e.message}`);
    return "[Content not available]";
  }
}

async function generateQA() {
  // Parse command-line arguments; require both domain and query.
  const { domainName, query } = parseArgs();
  if (!domainName || !query) {
    logger.error('Please provide both a domain name and a query (e.g., --domain blog_tracardi_com --query "Your question here").');
    process.exit(1);
  }
  logger.info(`Starting Q&A generation for domain: ${domainName} with query: ${query}`);
  
  // Get and validate the data directory.
  const dataDir = await getDataDir(domainName);
  await checkDirExists(dataDir);

  // Load persisted Faiss index data and document mapping.
  const indexPath = path.join(dataDir, 'faiss_index.json');
  const mappingPath = path.join(dataDir, 'docMapping.json');
  let indexData, docMapping;
  try {
    const rawIndex = await fs.readFile(indexPath, 'utf8');
    indexData = JSON.parse(rawIndex);
    const rawMapping = await fs.readFile(mappingPath, 'utf8');
    docMapping = JSON.parse(rawMapping);
  } catch (err) {
    logger.error(`Failed to load index or document mapping: ${err.message}`);
    process.exit(1);
  }

  // Generate an embedding for the query.
  logger.info(`Generating embedding for query: "${query}"`);
  const embedding = await getEmbedding({ model: 'all-minilm:l6-v2' });
  const queryEmbedding = await embedding.embedQuery(query);
  logger.info('Query embedding generated:', queryEmbedding);

  // Rebuild the Faiss index using the stored data.
  const dim = indexData.dim;
  const index = new faiss.IndexFlatL2(dim);
  index.add(indexData.flatArray);
  logger.info(`Rebuilt Faiss index with ${indexData.nbDocs} vectors.`);

  // Search for the top k nearest neighbors using the query embedding.
  const k = 5;
  logger.info(`Searching for the top ${k} similar document chunks...`);
  const searchResults = index.search(queryEmbedding, k);
  logger.info('Raw Search Results:', JSON.stringify(searchResults, null, 2));

  // Use the 'labels' property (instead of indices) from the search results.
  const { labels, distances } = searchResults || {};
  if (!labels || !Array.isArray(labels)) {
    logger.error('Search results do not contain a valid labels array.');
    process.exit(1);
  }

  logger.info(`Top ${k} search results:`);
  // Build context asynchronously: for each label, load the actual text chunk and log progress.
  let contextTexts = [];
  for (let i = 0; i < labels.length; i++) {
    const idx = labels[i];
    if (idx < 0 || idx >= docMapping.length) {
      logger.warn(`Result ${i + 1} has an invalid label: ${idx}`);
      continue;
    }
    const meta = docMapping[idx];
    logger.info(`Result ${i + 1}: File: ${meta.source}, Chunk: ${meta.chunkIndex}, Distance: ${distances[i]}`);
    
    // Log progress for chunk loading.
    logger.info(`Loading chunk ${i + 1} of ${labels.length}...`);
    
    // Try to get the content from metadata; if not available, re-read the file.
    let chunkText = meta.content;
    if (!chunkText) {
      chunkText = await getChunkContent(dataDir, meta, CONFIG.chunkSize);
    }
    contextTexts.push(`Source (${meta.source}, chunk ${meta.chunkIndex}):\n${chunkText}`);
  }

  // Combine retrieved context.
  const context = contextTexts.join('\n\n');
  if (!context) {
    logger.error('No context could be loaded from the retrieved document chunks.');
    process.exit(1);
  }

  // Write the context to the console.
  console.log('\nRetrieved Context:\n');
  console.log(context);
  
  // Create the prompt template for Q&A.
  const prompt = PromptTemplate.fromTemplate(CONFIG.prompt.qa);

  // Instantiate the Ollama LLM using the configuration.
  const llm = new Ollama({
    model: CONFIG.llm.model,
    temperature: CONFIG.llm.temperature,
    maxRetries: CONFIG.llm.maxRetries,
    baseUrl: CONFIG.llm.baseUrl
  });

  // Create the LLM chain with the prompt and LLM.
  const chain = new LLMChain({ llm, prompt });

  logger.info('Generating answer from the Ollama model...');
  // Use chain.call() with the complete input object.
  const answer = await chain.call({ context, question: query });
  console.log('\nGenerated Answer:\n');
  console.log(answer);
}

generateQA().catch(err => {
  logger.error('Q&A generation failed:', err);
  process.exit(1);
});
