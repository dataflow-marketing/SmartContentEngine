// generateQuestions.js
import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists, writeJSON } from './common/fileUtils.js';
import { logger } from './common/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { Ollama } from '@langchain/ollama';
import { getEmbedding } from './common/vectorStore/generateEmbeddings.js';

/**
 * Attempts to extract a JSON substring from the given text by finding the first '[' and last ']'.
 */
function extractJSON(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1);
  }
  return text;
}

/**
 * Fallback: Extracts candidate question strings by matching double-quoted text.
 */
function extractQuotedQuestions(text) {
  const matches = text.match(/"([^"]+)"/g);
  if (matches) {
    return matches.map(q => q.replace(/"/g, '').trim());
  }
  return [];
}

/**
 * Helper function that attempts to parse the LLM response into a JSON array.
 */
function parseQuestions(response) {
  try {
    return JSON.parse(response);
  } catch (err) {
    logger.warn("Initial JSON parse failed, attempting to extract safe JSON...");
    const safeJSON = extractJSON(response);
    try {
      return JSON.parse(safeJSON);
    } catch (err2) {
      logger.warn("Safe JSON parse failed, extracting quoted strings as fallback...");
      return extractQuotedQuestions(safeJSON);
    }
  }
}

async function generateQuestions() {
  // Parse the domain name from CLI arguments.
  const { domainName } = parseArgs();
  if (!domainName) {
    logger.error("Please provide a domain name as an argument.");
    process.exit(1);
  }
  logger.info(`Generating questions for domain: ${domainName}`);

  // Locate and verify the data directory.
  const dataDir = await getDataDir(domainName);
  await checkDirExists(dataDir);
  logger.info(`Data directory located: ${dataDir}`);

  // Load the analysis report.
  const reportPath = path.join(dataDir, "analysis_report.txt");
  let reportContent = "";
  try {
    reportContent = await fs.readFile(reportPath, { encoding: "utf8" });
    logger.info(`Loaded analysis report from ${reportPath}`);
  } catch (err) {
    logger.error(`Failed to load analysis report from ${reportPath}: ${err.message}`);
    process.exit(1);
  }

  // ----- NEW: Load Faiss index data and document mapping for source references -----
  // Load stored embeddings data (saved during indexing).
  const embeddingsPath = path.join(dataDir, "faiss_index.json");
  let indexData;
  try {
    indexData = await fs.readFile(embeddingsPath, { encoding: "utf8" });
    indexData = JSON.parse(indexData);
    logger.info(`Loaded embeddings data from ${embeddingsPath}`);
  } catch (err) {
    logger.error("Failed to load embeddings data: " + err.message);
    process.exit(1);
  }
  const { dim, flatArray, nbDocs } = indexData;
  logger.info(`Embedding dimension: ${dim}, Number of vectors: ${nbDocs || (flatArray.length / dim)}`);

  // Rebuild the Faiss index using faiss-node.
  const faiss = (await import('faiss-node')).default || (await import('faiss-node'));
  const index = new faiss.IndexFlatL2(dim);
  index.add(flatArray);
  logger.info(`Rebuilt Faiss index with ${nbDocs || (flatArray.length / dim)} vectors.`);

  // Load the document mapping.
  const mappingPath = path.join(dataDir, "docMapping.json");
  let docMapping;
  try {
    docMapping = await fs.readFile(mappingPath, { encoding: "utf8" });
    docMapping = JSON.parse(docMapping);
    logger.info(`Loaded document mapping from ${mappingPath}`);
  } catch (err) {
    logger.error("Failed to load document mapping: " + err.message);
    process.exit(1);
  }
  // ----------------------------------------------------------------------------------

  // Set up the local LLM via Ollama.
  const llm = new Ollama({
    model: 'llama3.2',  // Adjust if needed.
    temperature: 0,
    baseUrl: 'http://localhost:11434'
  });

  // Also prepare an embedding instance (for generating a query embedding from the report).
  const embeddingInstance = await getEmbedding({ model: 'all-minilm:l6-v2' });

  // Use the analysis report to retrieve top source references.
  let sourceReferences = [];
  try {
    // Compute an embedding for the entire report.
    const reportEmbedding = await embeddingInstance.embedQuery(reportContent);
    // Set k (number of top sources) to retrieve.
    const k = 5;
    const searchResults = index.search(reportEmbedding, k);
    // Map the returned indices to source references using docMapping.
    if (searchResults && Array.isArray(searchResults.ids)) {
      sourceReferences = searchResults.ids.map(i => {
        const meta = docMapping[i];
        return meta ? `${meta.source} (chunk ${meta.chunkIndex} of ${meta.totalChunks})` : null;
      }).filter(Boolean);
    }
  } catch (err) {
    logger.warn("Failed to retrieve source references from Faiss index: " + err.message);
  }
  logger.info(`Retrieved source references: ${JSON.stringify(sourceReferences)}`);

  // Define a prompt template for generating questions.
  // Note the explicit instruction to return only a valid, single-line JSON array of question strings.
  // Receiving more than 100 questions is acceptable.
  const prompt = `
You are an expert content strategist.
Based on the following analysis report:
------------------------------------
${reportContent}
------------------------------------
And based on the following source references: ${JSON.stringify(sourceReferences)}
Generate at least 100 concise, thought-provoking questions that can be used as single-line prompts.
Return the result as a single-line JSON array of question strings with no additional text, markdown, or formatting.
`;

  logger.info("Generating questions from the analysis report and source references...");

  let questions = [];
  let response;
  const maxAttempts = 3;
  let attempt = 0;

  // Retry mechanism in case the generated output is invalid or contains fewer than 100 questions.
  while (attempt < maxAttempts) {
    attempt++;
    try {
      response = await llm.call(prompt);
      logger.info("Raw LLM response:");
      logger.info(response);
    } catch (err) {
      logger.error("LLM call failed: " + err.message);
      process.exit(1);
    }

    questions = parseQuestions(response);

    if (Array.isArray(questions) && questions.length >= 100) {
      logger.info(`Successfully generated ${questions.length} questions.`);
      break;
    } else {
      logger.warn(`Attempt ${attempt}: Expected at least 100 questions, but received ${Array.isArray(questions) ? questions.length : 'invalid output'}.`);
      if (attempt < maxAttempts) {
        logger.info("Retrying the LLM call with the same prompt...");
      }
    }
  }

  if (!Array.isArray(questions) || questions.length < 100) {
    logger.error("Failed to generate a valid set of at least 100 questions after multiple attempts.");
    process.exit(1);
  }

  // Save the generated questions to a file.
  const outputPath = path.join(dataDir, "generated_questions.json");
  try {
    await writeJSON(outputPath, questions);
    logger.info(`Generated questions saved to ${outputPath}`);
  } catch (err) {
    logger.error("Failed to save generated questions: " + err.message);
    process.exit(1);
  }
}

generateQuestions().catch(err => {
  logger.error("Failed to generate questions: " + err.message);
  process.exit(1);
});
