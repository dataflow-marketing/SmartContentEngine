/**
 * Validates page data.
 * If title is missing or empty, it defaults to 'Untitled'.
 * Content must be a non-empty string.
 */
export function validatePageData(data) {
  if (!data) {
    throw new Error('Data is null or undefined.');
  }
  if (typeof data.title !== 'string' || data.title.trim() === '') {
    data.title = 'Untitled';
  }
  if (typeof data.content !== 'string' || data.content.trim() === '') {
    throw new Error('Missing or invalid content in page data.');
  }
  return true;
}
