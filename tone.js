import { parseArgs } from './common/argumentParser.js';
import { processFiles } from './genericProcessor.js';
import { generateTone } from './common/modelClient.js';
import { handleError } from './common/errorHandling.js';

(async () => {
  try {
    const { domainName, force, batchSize } = parseArgs();
    const allowedTones = [
      "friendly",
      "professional",
      "authoritative",
      "playful",
      "casual",
      "informative",
      "empathetic",
      "enthusiastic",
      "neutral",
      "optimistic",
      "inquisitive",
      "formal",
      "motivational",
      "witty",
      "sincere",
      "compassionate",
      "persuasive",
      "balanced"
    ];
    await processFiles({
      domainName,
      force,
      batchSize,
      generationFunction: generateTone,
      resultField: 'tone',
      allowedValues: allowedTones,
      description: 'tone analysis'
    });
  } catch (error) {
    handleError(error);
    process.exit(1);
  }
})();