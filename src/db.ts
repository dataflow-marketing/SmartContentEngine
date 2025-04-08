import mysql from 'mysql2/promise';
import crypto from 'crypto';

export interface PageData {
  url: string;
  title: string;
  scraped_at: string;
  raw_html_base64: string;
}

// Helper: Creates the database if it does not exist.
async function createDatabaseIfNotExists(dbName: string, config: { host: string; user: string; password: string; port: number }): Promise<void> {
  // Connect without specifying a database.
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
  // Use the provided databaseName or fallback to environment variable, or default to 'crawlerdb'
  const rawDbName = databaseName || process.env.DB_DATABASE || 'crawlerdb';
  // Replace dashes with underscores.
  const dbName = rawDbName.replace(/-/g, '_');

  console.log('**** ',dbName);

  const connectionString = process.env.MYSQL_CONNECTION_STRING;
  if (connectionString) {
    // Assumes the connection string includes the database name.
    return mysql.createPool(connectionString);
  } else {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    };


    console.log("Connecting to MySQL with:");
console.log("Host:", process.env.DB_HOST);
console.log("User:", process.env.DB_USER);
console.log("Database:", process.env.DB_DATABASE);
console.log(process.env.DB_PASSWORD);

    await createDatabaseIfNotExists(dbName, config);

    return mysql.createPool({
      ...config,
      database: dbName,
    });
  }
}

export async function initDb(pool: mysql.Pool): Promise<void> {
  // Create the crawled_urls table with a hashed primary key.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crawled_urls (
      url_hash CHAR(32) PRIMARY KEY,
      url VARCHAR(2083) NOT NULL,
      crawled_at DATETIME NOT NULL
    )
  `);

  // Create the pages table with a unique index on a prefix of the URL.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      url VARCHAR(2083) NOT NULL,
      title VARCHAR(1024),
      scraped_at DATETIME NOT NULL,
      raw_html_base64 TEXT,
      UNIQUE KEY uniq_page_url (url(768))
    )
  `);
}

export async function loadCrawledUrls(pool: mysql.Pool): Promise<Set<string>> {
  const [rows] = await pool.query("SELECT url FROM crawled_urls") as [Array<{ url: string }>, any];
  return new Set(rows.map(row => row.url));
}

export async function saveCrawledUrl(pool: mysql.Pool, url: string): Promise<void> {
  // Compute MD5 hash of the URL.
  const urlHash = crypto.createHash('md5').update(url).digest('hex');
  await pool.query(
    "INSERT IGNORE INTO crawled_urls (url_hash, url, crawled_at) VALUES (?, ?, NOW())",
    [urlHash, url]
  );
}

export async function savePageData(pool: mysql.Pool, pageData: PageData): Promise<void> {
  await pool.query(
    "INSERT INTO pages (url, title, scraped_at, raw_html_base64) VALUES (?, ?, ?, ?)",
    [pageData.url, pageData.title, pageData.scraped_at, pageData.raw_html_base64]
  );
}
