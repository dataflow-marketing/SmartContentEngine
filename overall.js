import { parseArgs } from './common/argumentParser.js';
import { 
  getDataDir, 
  checkDirExists, 
  getJsonFiles, 
  readJSON 
} from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';
import { CONFIG } from './common/config.js';
import { post } from './common/httpClient.js';
import { writeFile } from 'fs/promises';

(async () => {
  try {
    // Parse command-line arguments.
    const { domainName } = parseArgs();
    if (!domainName) {
      logger.error('Please provide a domain name as an argument.');
      process.exit(1);
    }
    
    // Get the data directory for the domain and verify it exists.
    const dataDir = await getDataDir(domainName);
    await checkDirExists(dataDir);
    
    // Build the overall summary file path.
    const overallSummaryFile = joinPath(dataDir, 'overall_summary.txt');
    
    // Get all JSON files from the data directory.
    const files = await getJsonFiles(dataDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    // Combine summaries from all JSON files that contain a summary.
    let combinedSummaries = '';
    for (const file of jsonFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        if (data.summary) {
          combinedSummaries += data.summary + '\n';
        }
      } catch (e) {
        logger.warn(`Skipping file ${file} due to read/parse error: ${e.message}`);
      }
    }
    
    // Function to generate an overall summary via the LLM service.
    async function generateOverallSummary(summaries) {
      try {
        const prompt = `Using the following summaries of individual pages, generate an overall summary that describes what all the content is about:\n\n"""${summaries}"""\n\nEnsure the summary is concise and clearly represents the main topics covered. Provide only the summary itself, no extra text.`;
        const payload = {
          model: CONFIG.llm.model,
          prompt,
          stream: false
        };
        // Use the HTTP client from our common module.
        const ollamaUrl = CONFIG.llm.baseUrl + '/api/generate';
        const response = await post(ollamaUrl, payload);
        const responseData = response.data.response.trim();
        return responseData;
      } catch (error) {
        logger.error('Error generating overall summary from LLM: ' + error.message);
        return '';
      }
    }
    
    logger.info('Generating overall summary...');
    const overallSummary = await generateOverallSummary(combinedSummaries);
    
    if (overallSummary) {
      await writeFile(overallSummaryFile, overallSummary, 'utf8');
      logger.info(`Overall summary saved to ${overallSummaryFile}`);
    } else {
      logger.error('Failed to generate overall summary.');
    }
    
  } catch (err) {
    logger.error('Unexpected error: ' + err.message);
    process.exit(1);
  }
})();
