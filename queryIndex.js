// queryIndex.js
import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists } from './common/fileUtils.js';
import fs from 'fs/promises';
import path from 'path';
import { getEmbedding } from './common/vectorStore/generateEmbeddings.js';
import { logger } from './common/logger.js';
import faiss from 'faiss-node';

async function queryIndex() {
  // Parse command-line arguments; expect both domain and query.
  const { domainName, query } = parseArgs();
  if (!domainName || !query) {
    logger.error('Please provide both a domain name and a query (e.g., --domain blog_tracardi_com --query "data").');
    process.exit(1);
  }
  logger.info(`Querying index for domain: ${domainName} with query: ${query}`);

  // Get and validate the data directory.
  const dataDir = await getDataDir(domainName);
  await checkDirExists(dataDir);

  // Load the persisted Faiss index and document mapping.
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

  // Generate the embedding for the query.
  logger.info(`Generating embedding for query: ${query}`);
  const embedding = await getEmbedding({ model: 'all-minilm:l6-v2' });
  const queryEmbedding = await embedding.embedQuery(query);

  const dim = indexData.dim;
  // Rebuild the Faiss index.
  const index = new faiss.IndexFlatL2(dim);
  index.add(indexData.flatArray);

  // Search for the top k nearest neighbors.
  const k = 5; // Adjust the number of results as needed.
  logger.info(`Searching for the top ${k} similar document chunks...`);
  const searchResults = index.search(queryEmbedding, k);

  // Log the raw search results.
  logger.info('Raw Search Results:', JSON.stringify(searchResults, null, 2));

  // Use the 'labels' property (instead of indices) as per the returned result.
  const { labels, distances } = searchResults || {};
  if (!labels || !Array.isArray(labels)) {
    logger.error('Search results do not contain a valid labels array.');
    process.exit(1);
  }

  logger.info(`Top ${k} results:`);
  labels.forEach((idx, i) => {
    if (idx < 0 || idx >= docMapping.length) return;
    const meta = docMapping[idx];
    logger.info(`Result ${i + 1}: File: ${meta.source}, Chunk: ${meta.chunkIndex}, Distance: ${distances[i]}`);
  });
}

queryIndex().catch(err => {
  logger.error(`Querying index failed: ${err.message}`);
  process.exit(1);
});
