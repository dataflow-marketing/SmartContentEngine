// src/utilities/prompts.ts
import { sanitizeText } from './text';

/**
 * Prepares the final prompt by sanitizing the raw title and text from the page data
 * and then replacing the placeholders {title} and {content} (or {text}) in the template.
 *
 * @param template - The prompt template (e.g. "Summarise this page:\n\nTitle: {title}\n\nContent: {content}")
 * @param pageData - An object that should contain at least "title" and "text".
 * @returns The final prompt string with placeholders replaced.
 */
export function preparePrompt(template: string, pageData: { title?: string; text: string }): string {
  const rawTitle = pageData.title || 'Untitled';
  const rawText = pageData.text;
  const title = sanitizeText(rawTitle);
  const text = sanitizeText(rawText);
  
  if (!text) {
    throw new Error('Sanitized text is empty');
  }
  
  // Replace both {content} and {text} in case either placeholder is used.
  return template.replace('{title}', title)
                 .replace('{content}', text)
                 .replace('{text}', text);
}
