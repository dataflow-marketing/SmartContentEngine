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


// import { parseArgs } from './common/argumentParser.js';
// import { 
//   getDataDir, 
//   checkDirExists, 
//   getJsonFiles, 
//   readJSON, 
//   writeJSON, 
//   fileExists
// } from './common/fileUtils.js';
// import { joinPath } from './common/pathUtils.js';
// import { logger } from './common/logger.js';
// import { post } from './common/httpClient.js';
// import { readFile } from 'fs/promises';  // Import Node's readFile instead of readTextFile

// // Predefined constants
// const BATCH_SIZE = 2;
// const contentTypes = [
//   "Self-Reflection", "Facts-and-Figures", "How-To", "Case Study", "Opinion Piece",
//   "Comparative Analysis", "Expert Interview", "Step-by-Step Guide", "Trend Analysis",
//   "Myth vs. Reality", "Problem-Solution", "Listicle", "Deep Dive/Explainer", "Behind-the-Scenes",
//   "Frequently Asked Questions (FAQ)", "Beginner’s Guide", "Historical Perspective",
//   "Success Story", "Industry Report", "Checklist or Cheat Sheet"
// ];

// (async () => {
//   try {
//     // Parse the domain name from command-line arguments.
//     const { domainName } = parseArgs();
//     if (!domainName) {
//       logger.error('Please provide a domain name as an argument.');
//       process.exit(1);
//     }

//     // Construct and verify the data directory.
//     const dataDir = await getDataDir(domainName);
//     await checkDirExists(dataDir);

//     // Build overall summary file path and verify its existence.
//     const overallSummaryFile = joinPath(dataDir, 'overall_summary.txt');
//     if (!(await fileExists(overallSummaryFile))) {
//       logger.error(`Overall summary file not found: ${overallSummaryFile}`);
//       process.exit(1);
//     }
//     // Use readFile from 'fs/promises' to read the overall summary.
//     const overallSummary = (await readFile(overallSummaryFile, 'utf8')).trim();

//     // LLM service details.
//     const ollamaUrl = 'http://localhost:11434/api/generate';
//     const model = 'llama3.2';

//     // Function to extract a valid JSON object from the response.
//     function extractValidJSON(response) {
//       try {
//         let cleanedResponse = response.trim();
//         if (cleanedResponse.startsWith('"') && cleanedResponse.endsWith('"')) {
//           cleanedResponse = JSON.parse(cleanedResponse);
//         }
//         const jsonMatch = cleanedResponse.match(/\{.*?\}/s);
//         if (!jsonMatch) throw new Error('No valid JSON object found');
//         return JSON.parse(jsonMatch[0]);
//       } catch (error) {
//         return { narrative: [] };
//       }
//     }

//     // Function to classify content type using GenAI.
//     async function classifyContentType(title, content) {
//       try {
//         const payload = {
//           model,
//           prompt: JSON.stringify({
//             summary: overallSummary,
//             title,
//             content,
//             instruction: `Classify the content based on the following predefined types: ${contentTypes.join(", ")}.
// Return a JSON object in the format {"narrative":["Type1", "Type2"]}, selecting the most relevant categories.
// Return only the JSON object. If no narratives are found, return {"narrative":[]} only.`
//           }),
//           stream: false
//         };

//         const response = await post(ollamaUrl, payload);
//         const responseData = response.data.response.trim();
//         return extractValidJSON(responseData);
//       } catch (error) {
//         logger.error('Error fetching content type from LLM: ' + error.message);
//         return { narrative: [] };
//       }
//     }

//     // Retrieve the list of JSON files that require narrative processing.
//     async function getRemainingFiles() {
//       const files = await getJsonFiles(dataDir);
//       const filteredFiles = [];
//       for (const file of files) {
//         if (file.endsWith('.json') && file !== 'segments.json' && file !== 'interests.json') {
//           const filePath = joinPath(dataDir, file);
//           try {
//             const data = await readJSON(filePath);
//             if (!Array.isArray(data.narrative) || data.narrative.length === 0) {
//               filteredFiles.push(file);
//             }
//           } catch (error) {
//             logger.error(`Skipping invalid JSON: ${file}`);
//           }
//         }
//       }
//       return filteredFiles;
//     }

//     // Process files in batches.
//     async function processFiles() {
//       let filesToProcess = await getRemainingFiles();
//       logger.info(`Found ${filesToProcess.length} JSON files requiring narrative processing.`);

//       let batchNumber = 1;

//       while (filesToProcess.length > 0) {
//         logger.info(`Processing batch ${batchNumber} (${Math.min(BATCH_SIZE, filesToProcess.length)} files)...`);
//         const batch = filesToProcess.slice(0, BATCH_SIZE);

//         await Promise.all(
//           batch.map(async file => {
//             const filePath = joinPath(dataDir, file);
//             let data;
//             try {
//               data = await readJSON(filePath);
//             } catch (error) {
//               logger.error(`Failed to read ${file}, skipping.`);
//               return;
//             }

//             const title = data.title || "Untitled";
//             const content = data.content || "";
//             logger.info(`Processing file: ${file}`);

//             const contentType = await classifyContentType(title, content);

//             if (!Array.isArray(contentType.narrative) || contentType.narrative.length === 0) {
//               logger.warn(`No valid content type extracted for ${file}; setting narrative to empty.`);
//               data.narrative = [];
//             } else {
//               data.narrative = contentType.narrative;
//               logger.info(`Updated ${file} with narrative: ${data.narrative.join(", ")}`);
//             }

//             await writeJSON(filePath, data);
//           })
//         );

//         // Refresh the list of remaining files after completing a batch.
//         filesToProcess = await getRemainingFiles();
//         logger.info(`Batch ${batchNumber} complete. ${filesToProcess.length} files remain.`);
//         batchNumber++;
//       }

//       logger.info('Processing complete. All necessary JSON files have been updated.');
//     }

//     await processFiles();
//   } catch (error) {
//     logger.error('Unexpected error: ' + error.message);
//     process.exit(1);
//   }
// })();
