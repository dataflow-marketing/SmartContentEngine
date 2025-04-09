import { sanitizeText } from './text';

export function preparePrompt(template: string, dataSources: Record<string, Record<string, any>>): string {
  return template.replace(/{([\w.]+)}/g, (match, fullKey) => {
    const [sourceName, fieldName] = fullKey.split('.');

    if (!sourceName || !fieldName) {
      throw new Error(`Invalid placeholder format: '${fullKey}'. Use {source.field}`);
    }

    const source = dataSources[sourceName];

    if (!source) {
      throw new Error(`Missing data source '${sourceName}' in provided data`);
    }

    if (!(fieldName in source)) {
      throw new Error(`Missing field '${fieldName}' in data source '${sourceName}'`);
    }

    const value = source[fieldName];

    if (typeof value === 'string') {
      return sanitizeText(value);
    } else {
      return String(value);
    }
  });
}
