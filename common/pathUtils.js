import path from 'path';

/**
 * Joins multiple path segments into a single normalized path.
 * @param  {...string} parts
 * @returns {string}
 */
export function joinPath(...parts) {
  return path.join(...parts);
}

/**
 * Resolves a sequence of paths or path segments into an absolute path.
 * @param  {...string} parts
 * @returns {string}
 */
export function resolvePath(...parts) {
  return path.resolve(...parts);
}
