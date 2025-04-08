import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { htmlToText } from 'html-to-text';

const FIELD_LIMITS = {
  title: 255,
  description: 512,
  canonical: 2083,
  text: 10000,
};

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

function removeHeaderFooter(html: string): string {
  const $ = load(html);

  // Remove common header/footer elements and wrappers
  $('header, footer').remove();
  $('.header, .site-header, .main-header, .top-bar').remove();
  $('.footer, .site-footer, .main-footer, .global-footer').remove();
  $('.cookie-banner, .cookie-consent, .legal, .disclaimer').remove();

  return $.html();
}

// Optional: Type for clarity
export interface ExtractedFields {
  title: string;
  description: string;
  canonical: string;
  text: string;
}

export function extractFieldsFromBase64Html(base64Html: string): ExtractedFields {
  try {
    const html = Buffer.from(base64Html, 'base64').toString('utf-8');

    const cleanedHtml = removeHeaderFooter(html);
    const $ = load(cleanedHtml);

    const rawTitle = $('title').text() || '';
    const rawDescription = $('meta[name="description"]').attr('content') || '';
    const rawCanonical = $('link[rel="canonical"]').attr('href') || '';

    // ✅ Extract text with better sanitization
    const rawText = htmlToText(cleanedHtml, {
      wordwrap: false,
      selectors: [
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
      ],
      limits: {
        maxInputLength: 500_000, // Safety limit
      },
      preserveNewlines: true,
    });

    const extracted: ExtractedFields = {
      title: sanitize(rawTitle, FIELD_LIMITS.title),
      description: sanitize(rawDescription, FIELD_LIMITS.description),
      canonical: sanitize(rawCanonical, FIELD_LIMITS.canonical),
      text: sanitize(rawText, FIELD_LIMITS.text), // ✅ Final sanitised text
    };

    console.log('Extracted fields:', extracted);

    return extracted;
  } catch (error) {
    console.error('Error extracting fields:', error);

    return {
      title: '',
      description: '',
      canonical: '',
      text: '',
    };
  }
}
