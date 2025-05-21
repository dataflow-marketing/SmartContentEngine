import { Ollama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';

export function buildChain(outputParser: any) {
  const model = new Ollama({
    baseUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    temperature: 0.3,
    maxRetries: 3,
  });

  const prompt = PromptTemplate.fromTemplate('{input}');

  return RunnableSequence.from([
    prompt,
    model,
    outputParser
  ]);
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
