// generateBlogPosts.js
import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists, readJSON, writeJSON } from './common/fileUtils.js';
import { logger } from './common/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { Ollama } from '@langchain/ollama';
import { getEmbedding } from './common/vectorStore/generateEmbeddings.js';
import faiss from 'faiss-node';
import JSON5 from 'json5'; // Fallback for parsing loosely formatted JSON

/**
 * Sanitizes text for file names.
 */
function sanitizeFilename(text) {
  return text.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 50);
}

/**
 * Formats the blog post prompt by replacing placeholders.
 */
function formatBlogPrompt(template, variables) {
  return template.replace(/{(\w+)}/g, (_, key) => variables[key] || '');
}

async function generateBlogPosts() {
  // Parse the domain name from CLI arguments.
  const { domainName } = parseArgs();
  if (!domainName) {
    logger.error("Please provide a domain name as an argument.");
    process.exit(1);
  }
  logger.info(`Starting blog post generation for domain: ${domainName}`);

  // Get and validate the domain's data directory.
  const dataDir = await getDataDir(domainName);
  await checkDirExists(dataDir);
  logger.info(`Data directory located: ${dataDir}`);

  // Load generated questions.
  const questionsPath = path.join(dataDir, "generated_questions.json");
  let questions;
  try {
    questions = await readJSON(questionsPath);
    logger.info(`Loaded ${questions.length} generated questions from ${questionsPath}`);
  } catch (err) {
    logger.error("Failed to load generated questions: " + err.message);
    process.exit(1);
  }

  // Load stored embeddings data (saved during indexing).
  const embeddingsPath = path.join(dataDir, "faiss_index.json");
  let indexData;
  try {
    indexData = await readJSON(embeddingsPath);
    logger.info(`Loaded Faiss index data from ${embeddingsPath}`);
  } catch (err) {
    logger.error("Failed to load Faiss index data: " + err.message);
    process.exit(1);
  }
  const { dim, flatArray, nbDocs } = indexData;
  logger.info(`Embedding dimension: ${dim}, Number of vectors: ${nbDocs || (flatArray.length / dim)}`);

  // Rebuild the Faiss index.
  const index = new faiss.IndexFlatL2(dim);
  index.add(flatArray);
  logger.info(`Rebuilt Faiss index with ${nbDocs || (flatArray.length / dim)} vectors.`);

  // Load the document mapping.
  const mappingPath = path.join(dataDir, "docMapping.json");
  let docMapping;
  try {
    docMapping = await readJSON(mappingPath);
    logger.info(`Loaded document mapping from ${mappingPath}`);
  } catch (err) {
    logger.error("Failed to load document mapping: " + err.message);
    process.exit(1);
  }

  // Prepare the embedding instance for query embeddings.
  const embeddingInstance = await getEmbedding({ model: 'all-minilm:l6-v2' });

  // Set up the local LLM via Ollama.
  const llm = new Ollama({
    model: 'llama3.2', // Adjust if necessary.
    temperature: 0,
    baseUrl: 'http://localhost:11434'
  });

  // Define a prompt template for blog post generation.
  const blogPostPromptTemplate = `
You are an expert content creator.
Using the following question and source references, create a medium-length, engaging blog post in Markdown format.
Include:
  - A catchy title,
  - A brief introduction,
  - Main content that expands on the question,
  - Key takeaways,
  - A practical example,
  - An engaging closing with a call to action to comment,
  - Suggested segments that this content maps to.
Question: "{question}"
Source References: {sources}
Retrieval Details: {retrievalDetails}
Generate a JSON object with the keys:
  "title", "introduction", "content", "keyTakeaways", "example", "closing", "suggestedSegments", "question", "sources", and "retrievalDetails".
Only output the JSON object.
  `;

  // Create an output directory for blog posts.
  const outputDir = path.join(dataDir, "blogPosts");
  await fs.mkdir(outputDir, { recursive: true });

  // Process each question.
  for (const question of questions) {
    logger.info(`Processing question: "${question}"`);

    let queryEmbedding;
    try {
      queryEmbedding = await embeddingInstance.embedQuery(question);
    } catch (err) {
      logger.error(`Failed to generate embedding for question "${question}": ${err.message}`);
      continue;
    }

    const k = 5;
    let searchResults;
    try {
      searchResults = index.search(queryEmbedding, k);
      logger.info(`Raw Faiss search result for "${question}": ${JSON.stringify(searchResults)}`);
    } catch (err) {
      logger.error(`Faiss search failed for question "${question}": ${err.message}`);
      continue;
    }

    // Attempt to extract indices from "ids" or "labels".
    let indices = [];
    if (searchResults.ids && Array.isArray(searchResults.ids)) {
      indices = searchResults.ids;
    } else if (searchResults.labels && Array.isArray(searchResults.labels)) {
      indices = searchResults.labels;
    } else {
      logger.warn(`No valid indices found in Faiss search result for question "${question}".`);
    }

    // Retrieve full docMapping entries and formatted source references.
    let sources = [];
    let mappingReferences = [];
    indices.forEach(i => {
      if (i < 0 || i >= docMapping.length) {
        logger.warn(`Returned index ${i} is out of bounds.`);
      } else {
        const meta = docMapping[i];
        if (meta) {
          sources.push(`${meta.source} (chunk ${meta.chunkIndex} of ${meta.totalChunks})`);
          mappingReferences.push(meta);
        }
      }
    });

    // Build retrieval details.
    const retrievalDetails = {
      faissSearchResults: searchResults,
      docMappingReferences: mappingReferences,
      sources: sources
    };

    // Convert sources and retrieval details to JSON strings.
    const sourcesField = JSON.stringify(sources);
    const retrievalDetailsField = JSON.stringify(retrievalDetails);

    // Format the blog post prompt.
    const prompt = blogPostPromptTemplate
      .replace(/{question}/g, question)
      .replace(/{sources}/g, sourcesField)
      .replace(/{retrievalDetails}/g, retrievalDetailsField);

    logger.info(`Generating blog post for question: "${question}"`);
    let response;
    try {
      response = await llm.call(prompt);
      logger.info(`Raw LLM response for "${question}": ${response}`);
    } catch (err) {
      logger.error(`LLM call failed for question "${question}": ${err.message}`);
      continue;
    }

    let blogPost;
    try {
      // Try standard JSON.parse; if it fails, try JSON5.
      blogPost = JSON.parse(response);
    } catch (err) {
      try {
        blogPost = JSON5.parse(response);
        logger.warn(`Used JSON5 to parse blog post for question "${question}".`);
      } catch (err2) {
        logger.error(`Failed to parse blog post JSON for question "${question}": ${err2.message}`);
        continue;
      }
    }

    // Ensure the blog post includes the question, sources, and retrieval details.
    blogPost.question = question;
    blogPost.sources = sources;
    blogPost.retrievalDetails = retrievalDetails;

    const safeQuestion = sanitizeFilename(question);
    const outputPath = path.join(outputDir, `post_${safeQuestion}.json`);
    try {
      await writeJSON(outputPath, blogPost);
      logger.info(`Saved blog post for question "${question}" to ${outputPath}`);
    } catch (err) {
      logger.error(`Failed to save blog post for question "${question}": ${err.message}`);
    }
  }

  logger.info("Blog post generation complete.");
}

generateBlogPosts().catch(err => {
  logger.error("Failed to generate blog posts: " + err.message);
  process.exit(1);
});
