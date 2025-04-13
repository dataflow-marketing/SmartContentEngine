import { Ollama } from '@langchain/ollama';
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from '@langchain/core/prompts';

export function buildChain(prompt: string) {
  const model = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });

  const template = new PromptTemplate({
    template: prompt,
    inputVariables: [], // ✅ No variables to parse
  });

  return new LLMChain({
    llm: model,
    prompt: template,
  });
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
