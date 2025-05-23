import Handlebars from 'handlebars';
import { sanitizeText } from './text';

Handlebars.registerHelper('sanitize', function(text: any) {
  if (typeof text !== 'string') return text;
  return sanitizeText(text);
});

export function preparePrompt(
  template: string,
  data: { page?: Record<string, any>; website?: Record<string, any> }
): string {
  const tokenRegex = /{(page|website)\.([a-zA-Z0-9_]+)}/g;
  
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(template)) !== null) {
    const dataType = match[1];
    const field = match[2];
    
    if (dataType === 'page' && !data.page) {
      throw new Error(`Template uses {page.${field}} but no page data was provided.`);
    }
    if (dataType === 'website' && !data.website) {
      throw new Error(`Template uses {website.${field}} but no website data was provided.`);
    }
    
    const value = data[dataType]?.[field];
    if (value === undefined) {
      throw new Error(`Missing field "${dataType}.${field}" in provided data.`);
    }
  }
  
  const handlebarsTemplate = template.replace(tokenRegex, '{{{sanitize $1.$2}}}');
  
  const compiledTemplate = Handlebars.compile(handlebarsTemplate);
  return compiledTemplate(data);
}
