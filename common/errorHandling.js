export class ProcessingError extends Error {
  constructor(message, fileName) {
    super(message);
    this.name = 'ProcessingError';
    this.fileName = fileName;
  }
}

export function handleError(error) {
  console.error(`[ERROR] ${new Date().toISOString()} - ${error.name}: ${error.message}`);
  if (error.fileName) {
    console.error(`Error processing file: ${error.fileName}`);
  }
}
