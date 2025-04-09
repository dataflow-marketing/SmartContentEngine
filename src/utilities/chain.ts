import { PromptTemplate } from '@langchain/core/prompts';
import { Ollama } from '@langchain/ollama';

export function buildChain(promptTemplateString: string) {
  const promptTemplate = PromptTemplate.fromTemplate(promptTemplateString);
  const llm = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });
  return promptTemplate.pipe(llm);
}

export async function parseCompletion(completion: any): Promise<string> {
  if (!completion) return '';
  try {
    const parsed = JSON.parse(
      typeof completion === 'string' ? completion : completion.text
    );
    return parsed.summary || (typeof completion === 'string' ? completion : completion.text).trim();
  } catch (e) {
    return (typeof completion === 'string' ? completion : completion.text).trim();
  }
}
