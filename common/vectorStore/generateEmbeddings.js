// common/vectorStore/generateEmbeddings.js
import { OllamaEmbeddings } from '@langchain/ollama';

export async function getEmbedding({ model }) {
  // Instantiate the embeddings class using Ollama.
  return new OllamaEmbeddings({ model });
}
