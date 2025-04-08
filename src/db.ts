import mysql from 'mysql2/promise';
import crypto from 'crypto';
import { extractFieldsFromBase64Html } from './extractors'; // ✅ use the new extractor

export interface PageData {
  url: string;
  scraped_at: string;
  page_data?: Record<string, any>;
  raw_html_base64?: string;
}

// Helper: Creates the database if it does not exist.
async function createDatabaseIfNotExists(dbName: string, config: { host: string; user: string; password: string; port: number }): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.host,
    user: config.user,
    password: config.password,
    port: config.port,
  });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await connection.end();
}

export async function getPool(databaseName?: string): Promise<mysql.Pool> {
  const rawDbName = databaseName || process.env.DB_DATABASE || 'crawlerdb';
  const dbName = rawDbName.replace(/-/g, '_');

  console.log('**** Using database:', dbName);

  const connectionString = process.env.MYSQL_CONNECTION_STRING;
  if (connectionString) {
    return mysql.createPool(connectionString);
  } else {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    };

    console.log("Connecting to MySQL with:");
    console.log("Host:", config.host);
    console.log("User:", config.user);
    console.log("Database:", dbName);

    await createDatabaseIfNotExists(dbName, config);

    return mysql.createPool({
      ...config,
      database: dbName,
    });
  }
}

export async function initDb(pool: mysql.Pool): Promise<void> {
  // Create crawled_urls table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crawled_urls (
      url_hash CHAR(32) PRIMARY KEY,
      url VARCHAR(2083) NOT NULL,
      crawled_at DATETIME NOT NULL
    )
  `);

  // Create pages table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      url VARCHAR(2083) NOT NULL,
      page_data JSON NOT NULL,
      raw_html_base64 LONGTEXT,
      scraped_at DATETIME NOT NULL,

      -- Generated column: extract title from JSON page_data
      title VARCHAR(255) GENERATED ALWAYS AS (JSON_UNQUOTE(page_data->'$.title')) STORED,

      -- Indexes
      UNIQUE KEY uniq_page_url (url(768)),
      INDEX idx_title (title)
    )
  `);
}

export async function loadCrawledUrls(pool: mysql.Pool): Promise<Set<string>> {
  const [rows] = await pool.query("SELECT url FROM crawled_urls") as [Array<{ url: string }>, any];
  return new Set(rows.map(row => row.url));
}

export async function saveCrawledUrl(pool: mysql.Pool, url: string): Promise<void> {
  const urlHash = crypto.createHash('md5').update(url).digest('hex');
  await pool.query(
    "INSERT IGNORE INTO crawled_urls (url_hash, url, crawled_at) VALUES (?, ?, NOW())",
    [urlHash, url]
  );
}

export async function savePageData(pool: mysql.Pool, pageData: PageData): Promise<void> {
  // Always safely initialise page_data
  const safePageData = pageData.page_data ? { ...pageData.page_data } : {};

  // ✅ If raw_html_base64 is present, extract fields from it
  if (pageData.raw_html_base64) {
    const extractedFields = extractFieldsFromBase64Html(pageData.raw_html_base64);

    // Merge extracted fields into page_data
    Object.assign(safePageData, extractedFields);
  }

  console.log("Saving page data:", {
    url: pageData.url,
    scraped_at: pageData.scraped_at,
    page_data: safePageData,
    raw_html_base64: pageData.raw_html_base64 ? '[BASE64 content present]' : '[No base64 content]'
  });

  await pool.query(
    "INSERT INTO pages (url, page_data, raw_html_base64, scraped_at) VALUES (?, ?, ?, ?)",
    [
      pageData.url,
      JSON.stringify(safePageData),
      pageData.raw_html_base64 || null,
      pageData.scraped_at
    ]
  );
}
