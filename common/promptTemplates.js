import { PromptTemplate } from '@langchain/core/prompts';
import { CONFIG } from './config.js';

export function getSummaryTemplate() {
  return PromptTemplate.fromTemplate(CONFIG.prompt.summary);
}
