# SmartContentEngine

This project is a modular web content processing suite that leverages AI to perform tasks such as scraping pages, generating summaries, extracting metadata, and more. The project is organized into common modules for file operations, HTTP requests, logging, argument parsing, and configuration, and each processing task is encapsulated in its own script.

## Table of Contents

- [Project Structure](#project-structure)
- [Common Modules](#common-modules)
- [CLI Options](#cli-options)
- [Scripts Overview](#scripts-overview)
  - [scrape.js](#scrapejs)
  - [extractMeta.js](#extractmetajs)
  - [extractTitle.js](#extracttitlejs)
  - [extractLinks.js](#extractlinksjs)
  - [extractImages.js](#extractimagesjs)
  - [extractContent.js](#extractcontentjs)
  - [extractCanonical.js](#extractcanonicaljs)
  - [summary.js](#summaryjs)
  - [overall.js](#overalljs)
  - [interests.js](#interestsjs)
  - [segment.js](#segmentjs)
  - [narrative.js](#narrativejs)
  - [report.js](#reportjs)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

## Project Structure

\`\`\`
.
├── common
│   ├── argumentParser.js   # Parses CLI arguments (supports --sitemap, --domain, --slow, --force, --batch-size)
│   ├── fileUtils.js        # File operations: read/write JSON and text, directory management, etc.
│   ├── httpClient.js       # HTTP requests using Axios (exports get and post)
│   ├── logger.js           # Logging via winston with helpers (e.g. logger.progress)
│   ├── metrics.js          # Tracks processing metrics
│   ├── pathUtils.js        # Path helper functions
│   ├── batchProcessor.js   # Processes items in batches
│   ├── validation.js       # Validates JSON page data
│   └── config.js           # Central configuration (e.g., LLM model, base URL, default batch size)
├── scrape.js               # Crawls pages from a sitemap, stores base64 HTML and scrape timestamp
├── summary.js              # Generates page summaries using an AI service
├── narrative.js            # Extracts narratives for page content using an AI service
├── interests.js            # Extracts key interests from pages using an AI service
├── segment.js              # Maps interests to segments using an AI service
├── overall.js              # Generates an overall summary from individual page summaries
├── report.js               # Generates a report on segments and narratives across pages
├── extractMeta.js          # Extracts metadata from the raw HTML stored in base64 in JSON files
├── extractTitle.js         # Extracts the page title from base64 HTML if missing in the JSON
├── extractLinks.js         # Extracts links from the raw HTML stored in JSON files
├── extractImages.js        # Extracts image URLs from the raw HTML stored in JSON files
├── extractContent.js       # Extracts content (text) from the raw HTML stored in JSON files
├── extractCanonical.js     # Extracts the canonical URL from the raw HTML stored in JSON files
└── README.md               # This file
\`\`\`

## CLI Options

This suite uses a unified CLI parser that accepts multiple options:
- \`--sitemap <sitemapUrl>\` or \`-s <sitemapUrl>\`: Specifies the sitemap URL to crawl (used by scripts like \`scrape.js\`).
- \`--domain <domainName>\` or \`-d <domainName>\`: Specifies the domain name to process (used by scripts like \`summary.js\`).
- \`--slow\` or \`-l\`: Run in slow mode (processes pages sequentially with delays).
- \`--force\` or \`-f\`: Force reprocessing even if data already exists.
- \`--batch-size <number>\` or \`-b <number>\`: Number of files to process concurrently.

## Scripts Overview

### scrape.js
**Purpose:**  
Crawls pages from the specified sitemap URL, storing a base64 encoded version of the raw HTML along with the scrape timestamp.

**Usage Example:**  
\`\`\`bash
node scrape.js --sitemap https://chadd.org/sitemap_index.xml --slow
\`\`\`

---

### summary.js
**Purpose:**  
Generates a summary for each page using an AI service, processing files in batches.

**Usage Example:**  
\`\`\`bash
node summary.js --domain chadd_org --force --batch-size 3
\`\`\`

---

### narrative.js
**Purpose:**  
Uses an AI service to generate narrative classifications for page content.

**Usage Example:**  
\`\`\`bash
node narrative.js --domain chadd_org --force --batch-size 2
\`\`\`

---

### interests.js
**Purpose:**  
Extracts key interests from page content using an AI service and updates the JSON files.

**Usage Example:**  
\`\`\`bash
node interests.js --domain chadd_org --force --batch-size 2
\`\`\`

---

### segment.js
**Purpose:**  
Maps extracted interests to predefined segments via an AI service and saves a global segments file.

**Usage Example:**  
\`\`\`bash
node segment.js --domain chadd_org
\`\`\`

---

### overall.js
**Purpose:**  
Generates an overall summary by combining individual page summaries using an AI service.

**Usage Example:**  
\`\`\`bash
node overall.js --domain chadd_org
\`\`\`

---

### report.js
**Purpose:**  
Generates a report on segments and narratives across pages.

**Usage Example:**  
\`\`\`bash
node report.js --domain chadd_org
\`\`\`

---

### extractMeta.js
**Purpose:**  
Extracts metadata from the raw HTML (stored as base64) in JSON files that are missing metadata.

**Usage Example:**  
\`\`\`bash
node extractMeta.js --domain chadd_org
\`\`\`

---

### extractTitle.js
**Purpose:**  
Extracts the page title from the base64 encoded raw HTML in JSON files where the title is missing or empty.

**Usage Example:**  
\`\`\`bash
node extractTitle.js --domain chadd_org
\`\`\`

---

### extractLinks.js
**Purpose:**  
Extracts links from the base64 encoded raw HTML in JSON files that are missing a valid links array.

**Usage Example:**  
\`\`\`bash
node extractLinks.js --domain chadd_org
\`\`\`

---

### extractImages.js
**Purpose:**  
Extracts image URLs from the base64 encoded raw HTML in JSON files that are missing a valid images array.

**Usage Example:**  
\`\`\`bash
node extractImages.js --domain chadd_org
\`\`\`

---

### extractContent.js
**Purpose:**  
Extracts textual content from the base64 encoded raw HTML in JSON files that are missing content.

**Usage Example:**  
\`\`\`bash
node extractContent.js --domain chadd_org
\`\`\`

---

### extractCanonical.js
**Purpose:**  
Extracts the canonical URL from the base64 encoded raw HTML in JSON files that are missing a valid canonical URL.

**Usage Example:**  
\`\`\`bash
node extractCanonical.js --domain chadd_org
\`\`\`

## Installation

1. **Clone the Repository:**

   \`\`\`bash
   git clone https://github.com/yourusername/your-repo-name.git
   cd your-repo-name
   \`\`\`

2. **Install Dependencies:**

   Ensure you have [Node.js](https://nodejs.org/) (v14 or later) installed, then run:

   \`\`\`bash
   npm install
   \`\`\`

3. **Configuration:**

   Configuration settings (LLM model, base URL, default batch size, etc.) are stored in \`common/config.js\` and can be overridden using environment variables via a \`.env\` file (if using [dotenv](https://www.npmjs.com/package/dotenv)).

4. **ES Module Setup:**

   Ensure your \`package.json\` includes:
   \`\`\`json
   {
     "name": "your-repo-name",
     "version": "1.0.0",
     "type": "module",
     "scripts": {
       "start": "node scrape.js"
     }
   }
   \`\`\`

## Usage

Execute each script via the Node.js CLI. For example:

- To scrape pages using a sitemap:
  \`\`\`bash
  node scrape.js --sitemap https://chadd.org/sitemap_index.xml --slow
  \`\`\`

- To generate summaries:
  \`\`\`bash
  node summary.js --domain chadd_org --force --batch-size 3
  \`\`\`

- To extract metadata:
  \`\`\`bash
  node extractMeta.js --domain chadd_org
  \`\`\`

- To extract titles:
  \`\`\`bash
  node extractTitle.js --domain chadd_org
  \`\`\`

- And so on for the other scripts...

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for improvements or bug fixes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
