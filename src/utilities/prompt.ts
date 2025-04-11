import { sanitizeText } from './text';

export function preparePrompt(template: string, pageData: Record<string, any>): string {
  return template.replace(/{(\w+)}/g, (match, key) => {
    if (!(key in pageData)) {
      throw new Error(`Missing field '${key}' in page data`);
    }
    const value = pageData[key];
    // If the value is a string, sanitize it; otherwise convert to string.
    if (typeof value === 'string') {
      return sanitizeText(value);
    } else {
      return String(value);
    }
  });
}