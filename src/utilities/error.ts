export function safeJSONParse(input: string): any {
    try {
      return JSON.parse(input);
    } catch (error) {
      return null;
    }
  }
 
  export function logError(err: Error, context?: string): void {
    console.error(`Error${context ? ` in ${context}` : ''}: ${err.message}`);
  }
  