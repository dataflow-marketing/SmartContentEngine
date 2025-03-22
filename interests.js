import { parseArgs } from './common/argumentParser.js';
import { getDataDir, fileExists } from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { processFiles } from './genericProcessor.js';
import { CONFIG } from './common/config.js';
import { generateInterests } from './common/modelClient.js';
import { handleError } from './common/errorHandling.js';
import { readFile } from 'fs/promises';

(async () => {
  try {
    const { domainName, force, batchSize } = parseArgs();
    if (!domainName) {
      throw new Error('Please provide a domain name as an argument.');
    }
    
    const dataDir = await getDataDir(domainName);
    
    // Define the overall summary file path.
    const overallSummaryFile = joinPath(dataDir, 'overall_summary.txt');
    if (!(await fileExists(overallSummaryFile))) {
      throw new Error(`Overall summary file not found: ${overallSummaryFile}`);
    }
    const overallSummary = (await readFile(overallSummaryFile, 'utf8')).trim();

    // Create a generation function that includes overallSummary.
    const generateInterestsFn = (title, content) =>
      generateInterests(title, content, overallSummary);

    await processFiles({
      domainName,
      force,
      batchSize,
      generationFunction: generateInterestsFn,
      resultField: 'interests',
      allowedValues: null, // Interests is a JSON array; validation is handled in generateInterests.
      description: 'interests extraction'
    });
  } catch (error) {
    handleError(error);
    process.exit(1);
  }
})();
