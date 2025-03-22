import { parseArgs } from './common/argumentParser.js';
import { 
  getDataDir, 
  checkDirExists, 
  fileExists, 
  getJsonFiles, 
  readJSON, 
  writeJSON 
} from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';

(async () => {
  try {
    // Parse the domain name from command-line arguments.
    const { domainName } = parseArgs();
    if (!domainName) {
      logger.error('Please provide a domain name as an argument.');
      process.exit(1);
    }

    // Construct and verify the data directory.
    const dataDir = await getDataDir(domainName);
    await checkDirExists(dataDir);

    // Build the segments file path.
    const segmentsFile = joinPath(dataDir, 'segments.json');

    // Ensure the segments file exists.
    if (!(await fileExists(segmentsFile))) {
      logger.error(`Segments file not found: ${segmentsFile}`);
      process.exit(1);
    }

    // Read segments data from the segments file.
    const segmentsData = await readJSON(segmentsFile);

    // Get all JSON files in the data directory excluding segments.json and interests.json.
    const allFiles = await getJsonFiles(dataDir);
    const filesToProcess = allFiles.filter(
      file => file.endsWith('.json') && file !== 'segments.json' && file !== 'interests.json'
    );

    // Process each JSON file.
    for (const file of filesToProcess) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);

        if (data.interests && Array.isArray(data.interests)) {
          const pageSegments = new Set();

          // Map each interest to its segments based on the segments data.
          for (const interest of data.interests) {
            for (const [segment, segmentInterests] of Object.entries(segmentsData)) {
              if (segmentInterests.includes(interest)) {
                pageSegments.add(segment);
              }
            }
          }

          data.segments = Array.from(pageSegments);
          await writeJSON(filePath, data);
          logger.info(`Updated: ${file} with segments: ${data.segments.join(', ')}`);
        }
      } catch (err) {
        logger.error(`Error processing ${file}: ${err.message}`);
      }
    }

    logger.info('Segment allocation complete.');
  } catch (error) {
    logger.error('Unexpected error: ' + error.message);
    process.exit(1);
  }
})();
