// generateAnalysisReport.js
import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists, getJsonFiles, readJSON } from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';
import { readFile, writeFile } from 'fs/promises';

(async () => {
  try {
    // Parse domain name from command-line arguments.
    const { domainName } = parseArgs();
    if (!domainName) {
      logger.error('Error: Please provide a domain name as an argument.');
      process.exit(1);
    }
    
    // Construct and verify the data directory.
    const dataDir = await getDataDir(domainName);
    await checkDirExists(dataDir);
    logger.info(`Data directory located: ${dataDir}`);
    
    // Get JSON files from the data directory.
    const files = await getJsonFiles(dataDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    // Initialize counters and stores.
    const segmentCounts = {};
    const segmentNarratives = {};
    const missingNarrativeCounts = {};
    const narrativeCounts = {};
    const segmentInterests = {}; // track interests per segment
    const segmentTones = {};     // track tone per segment
    const segmentContents = {};  // track post content texts per segment

    // Process each JSON file to gather report data.
    for (const file of jsonFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        const segments = Array.isArray(data.segments) ? data.segments : [];
        const narratives = Array.isArray(data.narrative) ? data.narrative : [];
        const interests = Array.isArray(data.interests) ? data.interests : [];
        const tone = data.tone; // assumed to be a string
        const content = data.content; // assumed to be the full post content

        segments.forEach(segment => {
          // Update posts count per segment.
          segmentCounts[segment] = (segmentCounts[segment] || 0) + 1;

          // Initialize nested objects.
          if (!segmentNarratives[segment]) segmentNarratives[segment] = {};
          if (!segmentInterests[segment]) segmentInterests[segment] = {};
          if (!segmentTones[segment]) segmentTones[segment] = {};
          if (!segmentContents[segment]) segmentContents[segment] = [];

          // Process narratives.
          let hasValidNarrative = false;
          narratives.forEach(narrative => {
            // Define valid narratives.
            const validNarratives = new Set([
              "Self-Reflection", "Facts-and-Figures", "How-To", "Case Study", "Opinion Piece",
              "Comparative Analysis", "Expert Interview", "Step-by-Step Guide", "Trend Analysis",
              "Myth vs. Reality", "Problem-Solution", "Listicle", "Deep Dive/Explainer", "Behind-the-Scenes",
              "Frequently Asked Questions (FAQ)", "Beginner’s Guide", "Historical Perspective",
              "Success Story", "Industry Report", "Checklist or Cheat Sheet"
            ]);
            if (validNarratives.has(narrative)) {
              segmentNarratives[segment][narrative] = (segmentNarratives[segment][narrative] || 0) + 1;
              hasValidNarrative = true;
              narrativeCounts[narrative] = (narrativeCounts[narrative] || 0) + 1;
            }
          });
          if (!hasValidNarrative) {
            missingNarrativeCounts[segment] = (missingNarrativeCounts[segment] || 0) + 1;
          }

          // Process interests.
          interests.forEach(interest => {
            segmentInterests[segment][interest] = (segmentInterests[segment][interest] || 0) + 1;
          });

          // Process tone.
          if (tone) {
            segmentTones[segment][tone] = (segmentTones[segment][tone] || 0) + 1;
          }
          
          // Capture the post content.
          if (content && typeof content === 'string') {
            segmentContents[segment].push(content.trim());
          }
        });
      } catch (error) {
        logger.error(`Skipping invalid JSON file: ${file}`);
      }
    }

    // Calculate overall metrics.
    const totalFiles = jsonFiles.length;
    const totalValidNarratives = Object.values(narrativeCounts).reduce((acc, count) => acc + count, 0);
    const totalMissingNarratives = Object.values(missingNarrativeCounts).reduce((acc, count) => acc + count, 0);

    // Read overall summary from overall_summary.txt (if exists).
    const overallSummaryFile = joinPath(dataDir, 'overall_summary.txt');
    let overallSummaryContent = "";
    try {
      overallSummaryContent = await readFile(overallSummaryFile, { encoding: 'utf8' });
    } catch (err) {
      logger.warn(`Overall summary file not found: ${overallSummaryFile}`);
    }

    // Build the analysis report.
    const reportLines = [];
    reportLines.push("Segment & Narrative Analysis Report");
    reportLines.push("====================================");
    reportLines.push(`Domain: ${domainName}`);
    reportLines.push("");
    reportLines.push("Overall Metrics:");
    reportLines.push("----------------");
    reportLines.push(`Total Files Processed: ${totalFiles}`);
    reportLines.push(`Total Valid Narratives: ${totalValidNarratives}`);
    reportLines.push(`Total Missing Narratives: ${totalMissingNarratives}`);
    reportLines.push("");
    reportLines.push("Overall Summary:");
    reportLines.push("----------------");
    reportLines.push(overallSummaryContent || "No overall summary available.");
    reportLines.push("");
    reportLines.push("Per-Segment Analysis:");
    reportLines.push("---------------------");

    // Per-segment details.
    for (const segment in segmentCounts) {
      const totalPosts = segmentCounts[segment];
      reportLines.push(`Segment: ${segment}`);
      reportLines.push(`  - Total Posts: ${totalPosts}`);

      // Top 10 Narratives.
      if (segmentNarratives[segment]) {
        const entries = Object.entries(segmentNarratives[segment]).sort((a, b) => b[1] - a[1]);
        const topNarratives = entries.slice(0, 10);
        reportLines.push("  - Top Narratives (Top 10):");
        topNarratives.forEach(([narrative, count]) => {
          const percentage = ((count / totalPosts) * 100).toFixed(1);
          reportLines.push(`      * ${narrative}: ${count} (${percentage}%)`);
        });
      }

      // Top 10 Interests.
      if (segmentInterests[segment]) {
        const interestEntries = Object.entries(segmentInterests[segment]).sort((a, b) => b[1] - a[1]);
        const topInterests = interestEntries.slice(0, 10);
        reportLines.push("  - Top Interests (Top 10):");
        topInterests.forEach(([interest, count]) => {
          const percentage = ((count / totalPosts) * 100).toFixed(1);
          reportLines.push(`      * ${interest}: ${count} (${percentage}%)`);
        });
      }

      // Top 10 Tones.
      if (segmentTones[segment]) {
        const toneEntries = Object.entries(segmentTones[segment]).sort((a, b) => b[1] - a[1]);
        const topTones = toneEntries.slice(0, 10);
        reportLines.push("  - Top Tones (Top 10):");
        topTones.forEach(([tone, count]) => {
          const percentage = ((count / totalPosts) * 100).toFixed(1);
          reportLines.push(`      * ${tone}: ${count} (${percentage}%)`);
        });
      }

      // Add a backup summary of contributing post contents.
      if (segmentContents[segment] && segmentContents[segment].length > 0) {
        const sampleContents = segmentContents[segment].slice(0, 3); // sample 3 content blocks
        reportLines.push("  - Sample Post Contents for This Segment:");
        sampleContents.forEach((contentText, index) => {
          reportLines.push(`      ${index + 1}. ${contentText}`);
        });
      }
      
      reportLines.push("");
    }

    // Overall Narrative Frequency Analysis.
    reportLines.push("Overall Narrative Frequency Analysis:");
    reportLines.push("---------------------------------------");
    for (const narrative in narrativeCounts) {
      const count = narrativeCounts[narrative];
      const percentage = ((count / totalValidNarratives) * 100).toFixed(1);
      reportLines.push(`- ${narrative}: ${count} (${percentage}%)`);
    }
    reportLines.push("");

    // Underrepresented Narrative Types (less than 5% usage).
    const underrepresented = [];
    for (const narrative in narrativeCounts) {
      const count = narrativeCounts[narrative];
      if ((count / totalValidNarratives) < 0.05) {
        underrepresented.push(narrative);
      }
    }
    if (underrepresented.length > 0) {
      reportLines.push("Underrepresented Narrative Types:");
      underrepresented.forEach(narrative => {
        reportLines.push(`  * ${narrative}`);
      });
    } else {
      reportLines.push("No underrepresented narrative types identified.");
    }
    reportLines.push("");

    // Write the analysis report to a file in the data directory.
    const reportOutputPath = joinPath(dataDir, 'analysis_report.txt');
    await writeFile(reportOutputPath, reportLines.join("\n"), { encoding: 'utf8' });
    logger.info(`Analysis report generated and saved to: ${reportOutputPath}`);
    
    // Log the report summary.
    logger.info("\n" + reportLines.join("\n"));
    
  } catch (error) {
    logger.error("Unexpected error: " + error.message);
    process.exit(1);
  }
})();
