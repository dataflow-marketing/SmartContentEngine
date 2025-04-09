import { getPool } from '../db';

export async function processPages<T>(
  databaseName: string,
  query: string,
  processRow: (row: any, pool: any) => Promise<T>
): Promise<void> {
  const pool = await getPool(databaseName);
  const [rows] = await pool.query(query) as [Array<any>, any];
  if (!rows || rows.length === 0) {
    console.log(`✅ No records found in database: ${databaseName}`);
    return;
  }
  console.log(`Found ${rows.length} records to process.`);
  
  for (const row of rows) {
    try {
      await processRow(row, pool);
    } catch (error) {
      console.error(`❌ Error processing record ${row.url}:`, error);
    }
  }
}
