export function sanitizeText(input: string): string {
    return input.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }