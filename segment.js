import { parseArgs } from './common/argumentParser.js';
import { 
  getDataDir, 
  checkDirExists, 
  getJsonFiles, 
  readJSON, 
  writeJSON, 
  fileExists 
} from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';
import { CONFIG } from './common/config.js';
import { post } from './common/httpClient.js';

(async () => {
  try {
    // Parse command-line arguments.
    const { domainName } = parseArgs();
    if (!domainName) {
      logger.error('Please provide a domain name as an argument.');
      process.exit(1);
    }
    
    // Get the data directory and ensure it exists.
    const dataDir = await getDataDir(domainName);
    await checkDirExists(dataDir);
    
    // Build the path to the segments file.
    const segmentsFile = joinPath(dataDir, 'segments.json');
    
    // Warn if the segments file doesn't exist (it will be created/overwritten).
    if (!(await fileExists(segmentsFile))) {
      logger.warn(`Segments file not found: ${segmentsFile}. A new segments file will be created.`);
    }
    
    // Use configuration for the LLM details.
    const ollamaUrl = CONFIG.llm.baseUrl + '/api/generate';
    const model = CONFIG.llm.model;
    
    // Get all JSON files (excluding segments.json and interests.json).
    const allFiles = await getJsonFiles(dataDir);
    const filesToProcess = allFiles.filter(
      file => file.endsWith('.json') && file !== 'segments.json' && file !== 'interests.json'
    );
    
    // Collect all interests from the JSON files.
    const allInterestsSet = new Set();
    for (const file of filesToProcess) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        if (Array.isArray(data.interests)) {
          data.interests.forEach(interest => allInterestsSet.add(interest));
        }
      } catch (err) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${err.message}`);
      }
    }
    
    if (allInterestsSet.size === 0) {
      logger.warn('No interests found in the files.');
      process.exit(0);
    }
    
    logger.info(`Processing ${allInterestsSet.size} interests into segments...`);
    const interestsArray = Array.from(allInterestsSet);
    
    // Function to get segments for interests using GenAI.
    async function getSegments(interests) {
      try {
        const prompt = `Given the following list of interests: \n\n${JSON.stringify(interests)}\n\nGroup them into broad segments that categorize these interests, such as 'technology', 'marketing', 'community', 'education', etc.\n\nProvide the segments as a JSON object where each interest maps to an array of relevant segments. Ensure your response is strictly valid JSON and contains only the JSON object.`;
        const payload = {
          model,
          prompt,
          stream: false
        };
        const response = await post(ollamaUrl, payload);
        const responseData = response.data.response.trim();
        const jsonStart = responseData.indexOf('{');
        const jsonEnd = responseData.lastIndexOf('}') + 1;
        if (jsonStart === -1 || jsonEnd === 0) {
          throw new Error('Invalid JSON format from LLM');
        }
        return JSON.parse(responseData.slice(jsonStart, jsonEnd));
      } catch (error) {
        logger.error('Error fetching segments from LLM: ' + error.message);
        return {};
      }
    }
    
    const segments = await getSegments(interestsArray);
    await writeJSON(segmentsFile, segments);
    logger.info('Segments mapping complete. Saved to segments.json');
    
  } catch (err) {
    logger.error('Unexpected error: ' + err.message);
    process.exit(1);
  }
})();
