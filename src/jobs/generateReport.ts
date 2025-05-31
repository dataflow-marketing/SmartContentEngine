import { getPool } from '../db'  // Adjust path if needed

export interface ReportParams {
  db: string
}

export async function run({ db }: ReportParams): Promise<{
  sitemap: string
  summary: string
}> {
  console.log(`📝 Starting "generateReport" job for database "${db}"`)

  const pool = await getPool(db)

  console.log(`🔍 Querying "website" table in database "${db}" for website_data`)
  const [rows] = await pool.query<any[]>(
    'SELECT website_data FROM website LIMIT 1'
  )

  if (rows.length === 0) {
    throw new Error('⚠️ No rows found in `website` table.')
  }
  console.log(`✅ Retrieved 1 row from "website"`)

  let parsed: { sitemap?: string; summary?: string }

  const raw = rows[0].website_data
  if (typeof raw === 'object' && raw !== null) {
    parsed = raw as { sitemap?: string; summary?: string }
  } else if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(
        `⚠️ Failed to parse website_data JSON: ${(err as Error).message}`
      )
    }
  } else {
    throw new Error(
      `⚠️ Unexpected type for website_data: ${typeof raw}`
    )
  }

  if (typeof parsed.sitemap !== 'string' || typeof parsed.summary !== 'string') {
    throw new Error(
      '⚠️ Invalid format in website_data: expected both "sitemap" and "summary" as strings.'
    )
  }
  console.log(`✅ Parsed JSON contains both sitemap & summary`)

  const result = {
    sitemap: parsed.sitemap,
    summary: parsed.summary,
  }
  console.log(`📝 generateReport output:`, result)

  return result
}
