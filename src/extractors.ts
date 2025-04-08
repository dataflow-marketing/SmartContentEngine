import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { htmlToText } from 'html-to-text';

/**
 * Configuration: field limits to match database schema
 */
const FIELD_LIMITS = {
  title: 255,
  description: 512,
  canonical: 2083,
  text: 10000,
};

/**
 * Sanitizes extracted text.
 */
function sanitize(value: string | null | undefined, maxLength: number): string {
  if (!value) return '';

  const clean = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
    textFilter: text => text.trim(),
  });

  return clean.slice(0, maxLength);
}

/**
 * Remove known header and footer elements from the HTML
 */
function removeHeaderFooter(html: string): string {
  const $ = load(html);

  // Remove obvious header and footer elements
  $('header, footer').remove();

  // Remove common class-based headers and footers
  $('.header, .site-header, .main-header, .top-bar').remove();
  $('.footer, .site-footer, .main-footer, .global-footer').remove();
  $('.cookie-banner, .cookie-consent, .legal, .disclaimer').remove();

  return $.html();
}

/**
 * Extracts useful fields from base64-encoded HTML.
 */
export function extractFieldsFromBase64Html(base64Html: string): {
  title: string;
  description: string;
  canonical: string;
  text: string;
} {
  try {
    const html = Buffer.from(base64Html, 'base64').toString('utf-8');

    const cleanedHtml = removeHeaderFooter(html);
    const $ = load(cleanedHtml);

    const rawTitle = $('title').text() || '';
    const rawDescription = $('meta[name="description"]').attr('content') || '';
    const rawCanonical = $('link[rel="canonical"]').attr('href') || '';

    const rawText = htmlToText(cleanedHtml, {
      wordwrap: false,
      selectors: [
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
      ]
    });

    const extracted = {
      title: sanitize(rawTitle, FIELD_LIMITS.title),
      description: sanitize(rawDescription, FIELD_LIMITS.description),
      canonical: sanitize(rawCanonical, FIELD_LIMITS.canonical),
      text: sanitize(rawText, FIELD_LIMITS.text),
    };

    console.log('Extracted fields:', extracted);

    return extracted;
  } catch (error) {
    console.error('Error extracting fields:', error);

    return {
      title: '',
      description: '',
      canonical: '',
      text: ''
    };
  }
}
