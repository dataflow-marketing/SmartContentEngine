// indexContent.js
import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists } from './common/fileUtils.js';
import { Document } from 'langchain/document';
import fs from 'fs/promises';
import path from 'path';
import { getEmbedding } from './common/vectorStore/generateEmbeddings.js';
import { logger } from './common/logger.js';
import faiss from 'faiss-node';

// Helper function to split text into chunks of a given size (in words).
function chunkText(text, chunkSize = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(' '));
  }
  return chunks;
}

/**
 * Attempts to embed a single chunk using a safe strategy.
 * If embedding fails due to input length, trims the chunk by reducing its word count by 20%
 * and retries up to maxAttempts.
 *
 * Returns an object { chunk: <final chunk text>, embedding: <embedding array> }
 * or null if all attempts fail.
 */
async function safeEmbedChunk(chunk, embedding, maxAttempts = 5) {
  let attempt = 0;
  let currentChunk = chunk;
  while (attempt < maxAttempts) {
    try {
      // Try embedding the chunk (wrapped in an array to use embedDocuments).
      const [embedResult] = await embedding.embedDocuments([currentChunk]);
      return { chunk: currentChunk, embedding: embedResult };
    } catch (error) {
      if (error.message.includes("input length exceeds maximum context length")) {
        const words = currentChunk.split(/\s+/).filter(Boolean);
        const newLength = Math.max(Math.floor(words.length * 0.8), 1);
        logger.warn(`Chunk too long (attempt ${attempt + 1}): trimming from ${words.length} to ${newLength} words.`);
        currentChunk = words.slice(0, newLength).join(' ');
        attempt++;
      } else {
        logger.error(`Unexpected error during embedding: ${error.message}`);
        throw error;
      }
    }
  }
  logger.error(`Failed to embed chunk after ${maxAttempts} attempts. Skipping this chunk.`);
  return null;
}

async function indexDocuments() {
  const { domainName } = parseArgs();
  if (!domainName) {
    logger.error('Please provide a domain name as an argument.');
    process.exit(1);
  }
  logger.info(`Starting indexing for domain: ${domainName}`);

  // Get and validate the data directory.
  const dataDir = await getDataDir(domainName);
  await checkDirExists(dataDir);
  logger.info(`Data directory located: ${dataDir}`);

  // Read files from the data directory and filter for valid content files.
  const allFiles = await fs.readdir(dataDir);
  const files = allFiles.filter(file =>
    file.endsWith('.txt') || file.endsWith('.md') || file.endsWith('.json')
  );
  logger.info(`Found ${files.length} content files in ${dataDir}.`);

  if (files.length === 0) {
    logger.warn(`No content files found in ${dataDir}. Exiting.`);
    process.exit(0);
  }

  // Process all files.
  const selectedFiles = files.slice(0);
  logger.info(`Indexing ${selectedFiles.length} document(s).`);

  const docs = [];
  let processedFiles = 0;
  let totalChunksLoaded = 0;
  // Set the maximum allowed words per chunk.
  const MAX_ALLOWED_WORDS = 30;
  // We'll initially chunk the text using a larger window (e.g., 50 words)
  // then trim any chunk exceeding MAX_ALLOWED_WORDS.
  const CHUNK_SIZE = 50;
  
  for (const file of selectedFiles) {
    try {
      const filePath = path.join(dataDir, file);
      let textContent;
      if (file.endsWith('.json')) {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.content) {
          logger.warn(`File ${file} does not have a "content" field. Skipping.`);
          continue;
        }
        textContent = parsed.content;
      } else {
        textContent = await fs.readFile(filePath, 'utf-8');
      }

      // Split the text into chunks.
      const chunks = chunkText(textContent, CHUNK_SIZE);
      logger.info(`File ${file}: split into ${chunks.length} chunk(s).`);
      chunks.forEach((chunk, idx) => {
        let words = chunk.split(/\s+/).filter(Boolean);
        if (words.length > MAX_ALLOWED_WORDS) {
          logger.warn(`Trimming chunk ${idx + 1} of file ${file} from ${words.length} to ${MAX_ALLOWED_WORDS} words.`);
          words = words.slice(0, MAX_ALLOWED_WORDS);
          chunk = words.join(' ');
        }
        docs.push(new Document({
          pageContent: chunk,
          metadata: { source: file, chunkIndex: idx + 1, totalChunks: chunks.length }
        }));
        totalChunksLoaded++;
        const percent = ((idx + 1) / chunks.length * 100).toFixed(1);
        logger.info(`Loaded chunk ${idx + 1}/${chunks.length} from ${file} (${words.length} words, ${percent}% complete for this file).`);
      });

      processedFiles++;
      logger.info(`Processed ${processedFiles}/${selectedFiles.length}: ${file}`);
    } catch (err) {
      logger.error(`Error processing file ${file}: ${err.message}`);
    }
  }
  logger.info(`Finished processing files. Total document chunks loaded: ${totalChunksLoaded}`);

  if (docs.length === 0) {
    logger.warn("No document chunks to index. Exiting.");
    process.exit(0);
  }

  logger.info(`Generating embeddings for ${docs.length} document chunk(s) using safe embedding...`);
  const embedding = await getEmbedding({ model: 'all-minilm:l6-v2' });
  const validEmbeddings = [];
  const validDocs = [];
  let processedChunks = 0;
  for (const doc of docs) {
    processedChunks++;
    const result = await safeEmbedChunk(doc.pageContent, embedding);
    if (result) {
      validEmbeddings.push(result.embedding);
      validDocs.push(doc);
      if (processedChunks % 1000 === 0) {
        logger.info(`Embedded ${processedChunks} chunks so far...`);
      }
    } else {
      logger.warn(`Skipped chunk ${processedChunks}/${docs.length} due to embedding failure.`);
    }
  }
  logger.info(`Successfully embedded ${validEmbeddings.length} out of ${docs.length} document chunks.`);
  
  if (validEmbeddings.length === 0) {
    logger.error("No document chunks were successfully embedded. Exiting.");
    process.exit(1);
  }

  const finalDim = validEmbeddings[0].length;
  logger.info(`Embedding dimension: ${finalDim}`);

  // Flatten embeddings into a plain JavaScript array.
  const nbDocs = validEmbeddings.length;
  const flatArray = validEmbeddings.flat();

  // Create a Faiss index (IndexFlatL2) using faiss-node.
  const index = new faiss.IndexFlatL2(finalDim);
  index.add(flatArray);
  logger.info(`Faiss index built with ${nbDocs} vectors.`);

  // Save the necessary index data to rebuild later.
  const indexData = {
    dim: finalDim,
    nbDocs,
    flatArray: Array.from(flatArray)
  };
  const indexPath = path.join(dataDir, 'faiss_index.json');
  await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
  logger.info(`Faiss index data saved to: ${indexPath}`);

  // Save document mapping for metadata retrieval during Q&A.
  const docMapping = validDocs.map(doc => doc.metadata);
  const mappingPath = path.join(dataDir, 'docMapping.json');
  await fs.writeFile(mappingPath, JSON.stringify(docMapping, null, 2), 'utf-8');
  logger.info(`Document mapping saved to: ${mappingPath}`);
}

indexDocuments().catch(err => {
  logger.error('Indexing failed:', err);
  process.exit(1);
});
