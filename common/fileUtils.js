import fs from 'fs/promises';
import path from 'path';

/**
 * Constructs the data directory path for a given domain.
 */
export async function getDataDir(domainName) {
  return path.join('./', 'data', domainName.replace(/\W/g, '_'));
}

/**
 * Ensures that the given directory exists.
 * If it does not, the directory (and any necessary parent directories) is created.
 * @param {string} dir - The directory path.
 */
export async function ensureDirExists(dir) {
  try {
    await fs.access(dir);
  } catch (error) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Checks if a directory exists. For convenience, we alias ensureDirExists as checkDirExists.
 * @param {string} dir - The directory path.
 */
export const checkDirExists = ensureDirExists;

/**
 * Checks if a file exists.
 * @param {string} filePath - The file path.
 * @returns {Promise<boolean>}
 */
export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and parses a JSON file asynchronously.
 * @param {string} filePath - The file path.
 * @returns {Promise<any>}
 */
export async function readJSON(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

/**
 * Writes data to a JSON file asynchronously.
 * @param {string} filePath - The file path.
 * @param {any} data - The data to write.
 * @returns {Promise<void>}
 */
export async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Retrieves an array of filenames in a directory that end with '.json'.
 * @param {string} dir - The directory path.
 * @returns {Promise<string[]>}
 */
export async function getJsonFiles(dir) {
  const files = await fs.readdir(dir);
  return files.filter(file => file.endsWith('.json'));
}
