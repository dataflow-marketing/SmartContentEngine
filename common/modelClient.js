import { Ollama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { CONFIG } from './config.js';
import { logger } from './logger.js';

// Create prompt templates.
const summaryPrompt = PromptTemplate.fromTemplate(CONFIG.prompt.summary);
const tonePrompt = PromptTemplate.fromTemplate(CONFIG.prompt.tone);
const interestsPrompt = PromptTemplate.fromTemplate(CONFIG.prompt.interests);
const narrativePrompt = PromptTemplate.fromTemplate(CONFIG.prompt.narrative);

// Instantiate the LLM.
const llm = new Ollama({
  model: CONFIG.llm.model,
  temperature: CONFIG.llm.temperature,
  maxRetries: CONFIG.llm.maxRetries,
  baseUrl: CONFIG.llm.baseUrl
});

// Create chains from the prompt templates and the LLM.
const summaryChain = summaryPrompt.pipe(llm);
const toneChain = tonePrompt.pipe(llm);
const interestsChain = interestsPrompt.pipe(llm);
const narrativeChain = narrativePrompt.pipe(llm);

// Timeout helper: returns fallback if the promise does not resolve within timeoutMs.
function withTimeout(promise, timeoutMs, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
  ]);
}

// Retry helper with exponential backoff.
async function exponentialBackoffRetry(fn, retries = 3, delay = 1000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= retries) {
        throw error;
      }
      const backoff = delay * Math.pow(2, attempt);
      logger.warn(`Retrying in ${backoff} ms... (attempt ${attempt})`);
      await new Promise((res) => setTimeout(res, backoff));
    }
  }
}

// Timeout constant: 30 seconds.
const TIMEOUT_MS = 30000;

/**
 * Generates a summary using the LLM chain with retries and a timeout.
 * If the process takes longer than 30 seconds, returns an empty object.
 */
export async function generateSummary(title, content) {
  const fn = async () => {
    const completion = await summaryChain.invoke({
      output_language: 'English',
      title: title,
      content: content
    });
    try {
      const summaryResponse = JSON.parse(
        typeof completion === 'string' ? completion : completion.text
      );
      return summaryResponse;
    } catch (e) {
      return { summary: (typeof completion === 'string' ? completion : completion.text).trim() };
    }
  };

  try {
    return await withTimeout(exponentialBackoffRetry(fn, 3, 1000), TIMEOUT_MS, {});
  } catch (error) {
    logger.error(`Error generating summary for "${title}": ${error.message}`);
    return {};
  }
}

/**
 * Generates a tone analysis using the LLM chain with retries and a timeout.
 * If the process takes longer than 30 seconds, returns an empty object.
 */
export async function generateTone(title, content) {
  const fn = async () => {
    const completion = await toneChain.invoke({
      output_language: 'English',
      title: title,
      content: content
    });
    try {
      const toneResponse = JSON.parse(
        typeof completion === 'string' ? completion : completion.text
      );
      return toneResponse;
    } catch (e) {
      return { tone: (typeof completion === 'string' ? completion : completion.text).trim() };
    }
  };

  try {
    return await withTimeout(exponentialBackoffRetry(fn, 3, 1000), TIMEOUT_MS, {});
  } catch (error) {
    logger.error(`Error generating tone for "${title}": ${error.message}`);
    return {};
  }
}

/**
 * Generates interests extraction using the LLM chain with retries and a timeout.
 * It uses an overall summary as extra context.
 * If the process takes longer than 30 seconds, returns an empty object.
 *
 * @param {string} title
 * @param {string} content
 * @param {string} overallSummary - The overall summary from the domain.
 * @returns {Promise<Object>}
 */
export async function generateInterests(title, content, overallSummary) {
  const fn = async () => {
    const completion = await interestsChain.invoke({
      output_language: 'English',
      summary: overallSummary,
      title: title,
      content: content
    });
    try {
      const interestsResponse = JSON.parse(
        typeof completion === 'string' ? completion : completion.text
      );
      return interestsResponse;
    } catch (e) {
      return { interests: (typeof completion === 'string' ? completion : completion.text).trim() };
    }
  };

  try {
    return await withTimeout(exponentialBackoffRetry(fn, 3, 1000), TIMEOUT_MS, {});
  } catch (error) {
    logger.error(`Error generating interests for "${title}": ${error.message}`);
    return {};
  }
}

export async function generateNarrative(title, content) {
  const fn = async () => {
//    console.log(narrativeChain);
    const completion = await narrativeChain.invoke({
      output_language: 'English',
      title: title,
      content: content
    });
    try {
      const narrativeResponse = JSON.parse(
        typeof completion === 'string' ? completion : completion.text
      );
      return narrativeResponse;
    } catch (e) {
      return { narrative: (typeof completion === 'string' ? completion : completion.text).trim() };
    }
  };

  try {
    return await withTimeout(exponentialBackoffRetry(fn, 3, 1000), TIMEOUT_MS, {});
  } catch (error) {
    logger.error(`Error generating narrative for "${title}": ${error.message}`);
    return {};
  }
}
