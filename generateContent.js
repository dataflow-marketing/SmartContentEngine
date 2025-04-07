// generateContent.js
import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists, readJSON, writeJSON } from './common/fileUtils.js';
import { logger } from './common/logger.js';
import { Ollama } from '@langchain/ollama';
import fs from 'fs/promises';
import path from 'path';

/**
 * A simple prompt formatter that replaces {key} placeholders with their corresponding values.
 */
function formatPrompt(template, variables) {
  return template.replace(/{(\w+)}/g, (_, key) => variables[key] || '');
}

async function generateContent() {
  // Parse domain from command-line arguments.
  const { domainName } = parseArgs();
  if (!domainName) {
    logger.error('Please provide a domain name as an argument.');
    process.exit(1);
  }
  logger.info(`Starting content generation for domain: ${domainName}`);

  // Get and validate the domain-specific data directory.
  const dataDir = await getDataDir(domainName);
  await checkDirExists(dataDir);
  logger.info(`Data directory located: ${dataDir}`);

  // Read all JSON files in the directory that contain domain data.
  const allFiles = await fs.readdir(dataDir);
  const jsonFiles = allFiles.filter(file => file.endsWith('.json'));

  if (jsonFiles.length === 0) {
    logger.error(`No JSON files found in ${dataDir}. Cannot aggregate domain data.`);
    process.exit(1);
  }

  // Aggregate data from each JSON file.
  let aggregatedData = { segments: [], interests: [], narratives: [], tones: [] };
  for (const file of jsonFiles) {
    try {
      const filePath = path.join(dataDir, file);
      const data = await readJSON(filePath);
      // Assume each JSON file may contain some or all of the following fields.
      if (data.segments) aggregatedData.segments.push(...data.segments);
      if (data.interests) aggregatedData.interests.push(...data.interests);
      if (data.narratives) aggregatedData.narratives.push(...data.narratives);
      if (data.tones) aggregatedData.tones.push(...data.tones);
    } catch (err) {
      logger.error(`Error reading ${file}: ${err.message}`);
    }
  }
  // Deduplicate arrays.
  aggregatedData.segments = Array.from(new Set(aggregatedData.segments));
  aggregatedData.interests = Array.from(new Set(aggregatedData.interests));
  aggregatedData.narratives = Array.from(new Set(aggregatedData.narratives));
  aggregatedData.tones = Array.from(new Set(aggregatedData.tones));
  logger.info(`Aggregated domain data:\n${JSON.stringify(aggregatedData, null, 2)}`);

  // Set up your local LLM via Ollama.
  const llm = new Ollama({
    model: 'llama3.2',  // Adjust as necessary for your local model.
    temperature: 0,
    baseUrl: 'http://localhost:11434'
  });

  // Define prompt templates.
  const questionPromptTemplate = `
Given the interest "{interest}" and the following domain context:
Segments: {segments}
Narratives: {narratives}
Tones: {tones}
List 3 relevant questions that readers might ask.
Output a JSON array of questions.
  `;
  const answerPromptTemplate = `
Answer the question "{question}" in a concise and informative manner suitable for a blog post.
Output only the answer text.
  `;
  const postPromptTemplate = `
Using the following Q&A:
Question: {question}
Answer: {answer}
Create a short blog post. Include a catchy title and a brief introduction.
Output a JSON object with keys "title", "introduction", and "content".
  `;

  // Create an output directory for generated content.
  const outputDir = path.join(dataDir, 'generatedContent');
  await fs.mkdir(outputDir, { recursive: true });

  // For each interest, generate Q&A and then a blog post.
  for (const interest of aggregatedData.interests) {
    try {
      // Generate questions for the interest.
      const qPrompt = formatPrompt(questionPromptTemplate, {
        interest,
        segments: aggregatedData.segments.join(', '),
        narratives: aggregatedData.narratives.join(', '),
        tones: aggregatedData.tones.join(', ')
      });
      logger.info(`Generating questions for interest: "${interest}"`);
      const qResponse = await llm.generate(qPrompt);
      let questions;
      try {
        questions = JSON.parse(qResponse);
      } catch (err) {
        logger.error(`Failed to parse questions for interest "${interest}": ${err.message}`);
        continue;
      }
      if (!Array.isArray(questions) || questions.length === 0) {
        logger.warn(`No questions generated for interest "${interest}". Skipping.`);
        continue;
      }

      // For each question, generate an answer and a blog post.
      for (const question of questions) {
        try {
          // Generate answer.
          const aPrompt = formatPrompt(answerPromptTemplate, { question });
          logger.info(`Generating answer for question: "${question}"`);
          const answer = await llm.generate(aPrompt);

          // Generate blog post from the Q&A.
          const pPrompt = formatPrompt(postPromptTemplate, { question, answer });
          logger.info(`Generating blog post for Q&A pair.`);
          const postResponse = await llm.generate(pPrompt);
          let blogPost;
          try {
            blogPost = JSON.parse(postResponse);
          } catch (err) {
            logger.error(`Failed to parse blog post for question "${question}": ${err.message}`);
            continue;
          }

          // Save the blog post.
          const safeInterest = interest.replace(/\s+/g, '_');
          const safeQuestion = question.replace(/\s+/g, '_').slice(0, 50); // limit length for file name
          const outputPath = path.join(outputDir, `${safeInterest}_${safeQuestion}.json`);
          await writeJSON(outputPath, blogPost);
          logger.info(`Saved blog post for interest "${interest}" to ${outputPath}`);
        } catch (err) {
          logger.error(`Error generating answer or post for question "${question}": ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`Error generating content for interest "${interest}": ${err.message}`);
    }
  }

  logger.info("Content generation complete.");
}

generateContent().catch(err => {
  logger.error("Failed to generate content:", err);
  process.exit(1);
});
