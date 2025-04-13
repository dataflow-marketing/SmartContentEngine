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

export async function parseCompletion(completion: any): Promise<string | string[]> {
  if (!completion) return '';

  try {
    const rawText = typeof completion === 'string' ? completion : completion.text;
    const parsed = JSON.parse(rawText);

    // ✅ If parsed is an array, return it directly
    if (Array.isArray(parsed)) {
      return parsed;
    }

    // ✅ If parsed has a summary field, return it
    if (parsed && typeof parsed.summary === 'string') {
      return parsed.summary.trim();
    }

    // ✅ If parsed is something else, just return the rawText
    return rawText.trim();
  } catch (e) {
    // If JSON parsing fails, fallback to raw text
    return (typeof completion === 'string' ? completion : completion.text).trim();
  }
}