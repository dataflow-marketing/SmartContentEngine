import { parseArgs } from './common/argumentParser.js';
import { getDataDir, checkDirExists, getJsonFiles, readJSON } from './common/fileUtils.js';
import { joinPath } from './common/pathUtils.js';
import { logger } from './common/logger.js';
import fs from 'fs';
import { readFile } from 'fs/promises';

(async () => {
  try {
    // Parse command-line arguments
    const { domainName } = parseArgs();
    if (!domainName) {
      logger.error('Error: Please provide a domain name as an argument.');
      process.exit(1);
    }

    // Construct and verify the data directory
    const dataDir = await getDataDir(domainName);
    await checkDirExists(dataDir);

    // Define valid narrative types
    const validNarratives = new Set([
      "Self-Reflection", "Facts-and-Figures", "How-To", "Case Study", "Opinion Piece",
      "Comparative Analysis", "Expert Interview", "Step-by-Step Guide", "Trend Analysis",
      "Myth vs. Reality", "Problem-Solution", "Listicle", "Deep Dive/Explainer", "Behind-the-Scenes",
      "Frequently Asked Questions (FAQ)", "Beginner’s Guide", "Historical Perspective",
      "Success Story", "Industry Report", "Checklist or Cheat Sheet"
    ]);

    // Initialize counters and stores
    const segmentCounts = {};
    const segmentNarratives = {};
    const missingNarrativeCounts = {};
    const narrativeCounts = {};
    const segmentsWithNarrativeDiversity = {};
    const segmentInterests = {}; // to track interests per segment
    const segmentTones = {};     // to track tone per segment

    // Get JSON files from the data directory
    const files = await getJsonFiles(dataDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    // Process each file and gather data
    for (const file of jsonFiles) {
      const filePath = joinPath(dataDir, file);
      try {
        const data = await readJSON(filePath);
        const segments = Array.isArray(data.segments) ? data.segments : [];
        const narratives = Array.isArray(data.narrative) ? data.narrative : [];
        const interests = Array.isArray(data.interests) ? data.interests : [];
        const tone = data.tone; // assumed to be a string

        segments.forEach(segment => {
          // Update total posts count per segment
          segmentCounts[segment] = (segmentCounts[segment] || 0) + 1;
          
          // Initialize nested objects if not already done
          if (!segmentNarratives[segment]) {
            segmentNarratives[segment] = {};
          }
          if (!segmentInterests[segment]) {
            segmentInterests[segment] = {};
          }
          if (!segmentTones[segment]) {
            segmentTones[segment] = {};
          }

          // Process narratives for this segment
          let hasValidNarrative = false;
          let uniqueNarratives = new Set();
          narratives.forEach(narrative => {
            if (validNarratives.has(narrative)) {
              segmentNarratives[segment][narrative] = (segmentNarratives[segment][narrative] || 0) + 1;
              uniqueNarratives.add(narrative);
              hasValidNarrative = true;
            }
          });
          if (!hasValidNarrative) {
            missingNarrativeCounts[segment] = (missingNarrativeCounts[segment] || 0) + 1;
          }
          segmentsWithNarrativeDiversity[segment] = uniqueNarratives.size;

          // Process interests for this segment
          interests.forEach(interest => {
            segmentInterests[segment][interest] = (segmentInterests[segment][interest] || 0) + 1;
          });

          // Process tone for this segment (if provided)
          if (tone) {
            segmentTones[segment][tone] = (segmentTones[segment][tone] || 0) + 1;
          }
        });

        // Track overall narrative occurrences
        narratives.forEach(narrative => {
          if (validNarratives.has(narrative)) {
            narrativeCounts[narrative] = (narrativeCounts[narrative] || 0) + 1;
          }
        });
      } catch (error) {
        logger.error(`Skipping invalid JSON file: ${file}`);
      }
    }

    // Calculate overall metrics
    const totalFiles = jsonFiles.length;
    const totalValidNarratives = Object.values(narrativeCounts).reduce((acc, count) => acc + count, 0);
    const totalMissingNarratives = Object.values(missingNarrativeCounts).reduce((acc, count) => acc + count, 0);

    // Read overall summary from overall_summary.txt
    const overallSummaryFile = joinPath(dataDir, 'overall_summary.txt');
    let overallSummaryContent = "";
    try {
      overallSummaryContent = await readFile(overallSummaryFile, 'utf8');
    } catch (err) {
      logger.warn(`Overall summary file not found: ${overallSummaryFile}`);
    }

    // Build the analysis report as an array of lines
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

    // For each segment, output detailed info
    for (const segment in segmentCounts) {
      const totalPosts = segmentCounts[segment];
      reportLines.push(`Segment: ${segment}`);
      reportLines.push(`  - Total Posts: ${totalPosts}`);

      // Top 5 Narratives
      if (segmentNarratives[segment]) {
        const entries = Object.entries(segmentNarratives[segment]).sort((a, b) => b[1] - a[1]);
        const topNarratives = entries.slice(0, 5);
        reportLines.push("  - Top Narratives:");
        topNarratives.forEach(([narrative, count]) => {
          const percentage = ((count / totalPosts) * 100).toFixed(1);
          reportLines.push(`      * ${narrative}: ${count} (${percentage}%)`);
        });
      }

      // Top 5 Interests
      if (segmentInterests[segment]) {
        const interestEntries = Object.entries(segmentInterests[segment]).sort((a, b) => b[1] - a[1]);
        const topInterests = interestEntries.slice(0, 5);
        reportLines.push("  - Top interests:");
        topInterests.forEach(([interest, count]) => {
          const percentage = ((count / totalPosts) * 100).toFixed(1);
          reportLines.push(`      * ${interest}: ${count} (${percentage}%)`);
        });
      }

      // Top 5 Tones
      if (segmentTones[segment]) {
        const toneEntries = Object.entries(segmentTones[segment]).sort((a, b) => b[1] - a[1]);
        const topTones = toneEntries.slice(0, 5);
        reportLines.push("  - Top tones:");
        topTones.forEach(([tone, count]) => {
          const percentage = ((count / totalPosts) * 100).toFixed(1);
          reportLines.push(`      * ${tone}: ${count} (${percentage}%)`);
        });
      }
      
      reportLines.push("");
    }

    // (Optional) Overall Narrative Frequency Analysis
    reportLines.push("Overall Narrative Frequency Analysis:");
    reportLines.push("---------------------------------------");
    for (const narrative in narrativeCounts) {
      const count = narrativeCounts[narrative];
      const percentage = ((count / totalValidNarratives) * 100).toFixed(1);
      reportLines.push(`- ${narrative}: ${count} (${percentage}%)`);
    }
    reportLines.push("");

    // Identify underrepresented narrative types (those with less than 5% usage)
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

    // Write the analysis report to a file
    const reportContent = reportLines.join("\n");
    fs.writeFileSync('analysis_report.txt', reportContent, 'utf8');
    logger.info("Analysis report generated: analysis_report.txt");
    
    // Also log the report summary to the console
    logger.info("\n" + reportContent);
    
  } catch (error) {
    logger.error("Unexpected error: " + error.message);
    process.exit(1);
  }
})();
