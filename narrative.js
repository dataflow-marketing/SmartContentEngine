import { parseArgs } from './common/argumentParser.js';
import { processFiles } from './genericProcessor.js';
import { generateNarrative } from './common/modelClient.js';
import { handleError } from './common/errorHandling.js';

(async () => {
  try {
    const { domainName, force, batchSize } = parseArgs();
    const allowedNarratives = [
      "Self-Reflection", 
      "Facts-and-Figures", 
      "How-To", 
      "Case Study", 
      "Opinion Piece",
      "Comparative Analysis", 
      "Expert Interview", 
      "Step-by-Step Guide", 
      "Trend Analysis",
      "Myth vs. Reality", 
      "Problem-Solution", 
      "Listicle", 
      "Deep Dive/Explainer", 
      "Behind-the-Scenes",
      "Frequently Asked Questions (FAQ)", 
      "Beginner’s Guide", 
      "Historical Perspective",
      "Success Story", 
      "Industry Report", 
      "Checklist or Cheat Sheet"      
    ];
    await processFiles({
      domainName,
      force,
      batchSize,
      generationFunction: generateNarrative,
      resultField: 'narrative',
      allowedValues: null,
      description: 'narrative analysis'
    });
  } catch (error) {
    handleError(error);
    process.exit(1);
  }
})();
