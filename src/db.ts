import mysql from 'mysql2/promise';
import crypto from 'crypto';

export interface PageData {
  url: string;
  scraped_at: string;
  raw_html_base64: string;
  page_data: {
    title: string;
    text?: string;
  };
}

async function createDatabaseIfNotExists(
  dbName: string,
  config: { host: string; user: string; password: string; port: number }
): Promise<void> {
  const connection = await mysql.createConnection(config);
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await connection.end();
}

export async function getPool(databaseName?: string): Promise<mysql.Pool> {
  const rawDbName = databaseName || process.env.DB_DATABASE || 'crawlerdb';
  const dbName = rawDbName.replace(/-/g, '_');

  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  };

  await createDatabaseIfNotExists(dbName, config);

  return mysql.createPool({
    ...config,
    database: dbName,
  });
}

export async function initDb(pool: mysql.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crawled_urls (
      url_hash CHAR(32) PRIMARY KEY,
      url VARCHAR(2083) NOT NULL,
      crawled_at DATETIME NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      url VARCHAR(2083) NOT NULL,
      scraped_at DATETIME NOT NULL,
      raw_html_base64 LONGTEXT,
      page_data JSON,
      UNIQUE KEY uniq_page_url (url(768))
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS website (
      id INT AUTO_INCREMENT PRIMARY KEY,
      website_data JSON
    )
  `);

  const [rows] = await pool.query(`SELECT COUNT(*) as count FROM website`) as any[];
  if (rows[0].count === 0) {
    await pool.query(`INSERT INTO website (website_data) VALUES ('{}')`);
  }
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
  await pool.query(
    `
    INSERT INTO pages (url, scraped_at, raw_html_base64, page_data)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE page_data = VALUES(page_data)
    `,
    [
      pageData.url,
      pageData.scraped_at,
      pageData.raw_html_base64,
      JSON.stringify(pageData.page_data),
    ]
  );
}

export async function updatePageDataField(
  pool: mysql.Pool,
  url: string,
  field: keyof PageData['page_data'],
  value: any
): Promise<void> {
  await pool.query(
    `
    UPDATE pages
    SET page_data = JSON_SET(page_data, ?, CAST(? AS JSON))
    WHERE url = ?
    `,
    [`$.${field}`, JSON.stringify(value), url]
  );
}

export async function updatePageDataFields(
  pool: mysql.Pool,
  url: string,
  updates: Record<string, any>
): Promise<void> {
  const updateFragments: string[] = [];
  const params: any[] = [];

  for (const [field, value] of Object.entries(updates)) {
    updateFragments.push('?, CAST(? AS JSON)');
    params.push(`$.${field}`, JSON.stringify(value));
  }

  const updateClause = updateFragments.join(', ');

  await pool.query(
    `
    UPDATE pages
    SET page_data = JSON_SET(page_data, ${updateClause})
    WHERE url = ?
    `,
    [...params, url]
  );
}

export async function updateWebsiteDataField(
  pool: mysql.Pool,
  field: string,
  value: any
): Promise<void> {
  await pool.query(
    `
    UPDATE website
    SET website_data = JSON_SET(website_data, '$.${field}', CAST(? AS JSON))
    WHERE id = 1
    `,
    [JSON.stringify(value)]
  );
}

export async function getPageTextByUrl(dbName: string, url: string): Promise<string | null> {
  const pool = await getPool(dbName);
  const [rows] = await pool.query(
    `SELECT page_data->>'$.text' AS text FROM pages WHERE url = ? LIMIT 1`,
    [url]
  ) as [Array<{ text: string | null }>, any];

  if (rows.length && rows[0].text) {
    return rows[0].text;
  }

  return null;
}

export async function getPageSummaryByUrl(dbName: string, url: string): Promise<string | null> {
  const pool = await getPool(dbName);
  const [rows] = await pool.query(
    `SELECT page_data->>'$.summary' AS summary FROM pages WHERE url = ? LIMIT 1`,
    [url]
  ) as [Array<{ summary: string | null }>, any];

  if (rows.length && rows[0].summary) {
    return rows[0].summary;
  }

  return null;
}
