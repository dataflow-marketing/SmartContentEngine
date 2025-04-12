import Handlebars from 'handlebars';
import { sanitizeText } from './text';

/**
 * Registers a Handlebars helper called "sanitize" which applies your sanitizeText function.
 */
Handlebars.registerHelper('sanitize', function(text: any) {
  if (typeof text !== 'string') return text;
  return sanitizeText(text);
});

/**
 * Prepares a prompt from a template by:
 * 1. Validating that required tokens are present in the provided data.
 * 2. Converting tokens from the form {page.field} or {website.field} 
 *    to Handlebars syntax that includes the sanitize helper.
 * 3. Compiling and rendering the template.
 *
 * @param template - The template string (using your custom token format, e.g., "{page.title} {page.text}")
 * @param data - An object containing either a "page" or "website" property (or both), e.g.:
 *
 *      {
 *         page: { title: "Hello", text: "World", tone: "friendly" }
 *      }
 *      or
 *      {
 *         website: { summary: "Good", sitemap: "https://example.com/sitemap.xml" }
 *      }
 *
 * @returns The rendered prompt.
 */
export function preparePrompt(
  template: string,
  data: { page?: Record<string, any>; website?: Record<string, any> }
): string {
  // Regular expression to match tokens in the form {page.field} or {website.field}
  const tokenRegex = /{(page|website)\.([a-zA-Z0-9_]+)}/g;
  
  // Validate that all tokens have corresponding data.
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(template)) !== null) {
    const dataType = match[1]; // "page" or "website"
    const field = match[2];    // e.g. "title", "text", "summary", etc.
    
    if (dataType === 'page' && !data.page) {
      throw new Error(`Template uses {page.${field}} but no page data was provided.`);
    }
    if (dataType === 'website' && !data.website) {
      throw new Error(`Template uses {website.${field}} but no website data was provided.`);
    }
    
    // Optionally, you could check that data[dataType][field] is defined.
    const value = data[dataType]?.[field];
    if (value === undefined) {
      throw new Error(`Missing field "${dataType}.${field}" in provided data.`);
    }
  }
  
  // Replace tokens: convert each token like "{page.title}" to "{{sanitize page.title}}"
  const handlebarsTemplate = template.replace(tokenRegex, '{{sanitize $1.$2}}');
  
  // Compile and render the template with Handlebars.
  const compiledTemplate = Handlebars.compile(handlebarsTemplate);
  return compiledTemplate(data);
}
