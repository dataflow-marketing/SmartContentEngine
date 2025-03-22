import { parseArgs } from './common/argumentParser.js';
import { processFiles } from './genericProcessor.js';
import { generateSummary } from './common/modelClient.js';
import { handleError } from './common/errorHandling.js';

(async () => {
  try {
    const { domainName, force, batchSize } = parseArgs();
    await processFiles({
      domainName,
      force,
      batchSize,
      generationFunction: generateSummary,
      resultField: 'summary',
      allowedValues: null, // No specific allowed values for summary.
      description: 'summary generation'
    });
  } catch (error) {
    handleError(error);
    process.exit(1);
  }
})();
