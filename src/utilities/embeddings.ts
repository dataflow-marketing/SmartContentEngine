// src/utilities/embeddings.ts

// If using Node.js 18+, fetch is built in.
// Otherwise, uncomment the following lines for node-fetch:
// import fetch from 'node-fetch';

export async function getEmbedding(text: string): Promise<number[]> {
    const model = process.env.OLLAMA_EMBEDDING_MODEL || 'llama3.2';
    // Use the endpoint for nomic embed-text as documented.
    const endpoint = process.env.NOMIC_EMBED_ENDPOINT || 'http://localhost:11434/api/embeddings';
  
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ "model":model, "prompt":text }),
      });
      if (!response.ok) {
        console.error(`Error: ${response.status} ${response.statusText}`);
        return [];
      }
      const data = await response.json();
      if (Array.isArray(data.embedding)) {
        return data.embedding;
      } else {
        console.error('No embedding found in response:', data);
        return [];
      }
    } catch (error) {
      console.error('Error generating embedding with nomic embed-text:', error);
      return [];
    }
  }
  