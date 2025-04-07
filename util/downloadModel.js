// util/downloadModel.js
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

async function downloadModel() {
  // Construct the URL to resolve the file from the repo.
  // This URL uses the "resolve" endpoint to get the file from the "main" revision.
  const url = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/pytorch_model.bin';
  console.log(`Downloading model from ${url}...`);

  // Use the global fetch (available in Node 18+)
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unexpected response ${response.statusText}`);
  }
  const destPath = 'pytorch_model.bin';
  await streamPipeline(response.body, createWriteStream(destPath));
  console.log(`Model downloaded to: ${destPath}`);
}

downloadModel().catch((err) => {
  console.error('Error downloading model:', err);
});
