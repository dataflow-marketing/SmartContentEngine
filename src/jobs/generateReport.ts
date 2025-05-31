import { getPool } from '../db'

export interface ReportParams {
  db: string
}

export async function run({ db }: ReportParams): Promise<{
  sitemap: string
  summary: string
  pageFieldTotals: Record<string, number>
  fieldInterestCounts: Record<string, Record<string, number>>
}> {
  console.log(`📝 Starting "generateReport" job for database "${db}"`)

  const pool = await getPool(db)

  console.log(`🔍 Querying "website" table in database "${db}" for website_data`)
  const [websiteRows] = await pool.query<any[]>(
    'SELECT website_data FROM website LIMIT 1'
  )

  if (websiteRows.length === 0) {
    throw new Error('⚠️ No rows found in `website` table.')
  }
  console.log(`✅ Retrieved 1 row from "website"`)

  const rawWebsiteData = websiteRows[0].website_data
  let parsedWebsiteData: { sitemap?: string; summary?: string }

  if (typeof rawWebsiteData === 'object' && rawWebsiteData !== null) {
    parsedWebsiteData = rawWebsiteData as { sitemap?: string; summary?: string }
  } else if (typeof rawWebsiteData === 'string') {
    try {
      parsedWebsiteData = JSON.parse(rawWebsiteData)
    } catch (err) {
      throw new Error(
        `⚠️ Failed to parse website_data JSON: ${(err as Error).message}`
      )
    }
  } else {
    throw new Error(
      `⚠️ Unexpected type for website_data: ${typeof rawWebsiteData}`
    )
  }

  if (
    typeof parsedWebsiteData.sitemap !== 'string' ||
    typeof parsedWebsiteData.summary !== 'string'
  ) {
    throw new Error(
      '⚠️ Invalid format in website_data: expected both "sitemap" and "summary" as strings.'
    )
  }
  console.log(`✅ Parsed JSON contains both sitemap & summary`)

  console.log(`🔍 Querying "pages" table for page_data`)
  const [pageRows] = await pool.query<any[]>('SELECT page_data FROM pages')

  const totals: Record<string, number> = {}
  const fieldInterestCounts: Record<string, Record<string, number>> = {}

  for (const row of pageRows) {
    const rawPageData = row.page_data
    let parsedPageData: Record<string, any>

    if (typeof rawPageData === 'object' && rawPageData !== null) {
      parsedPageData = rawPageData
    } else if (typeof rawPageData === 'string') {
      try {
        parsedPageData = JSON.parse(rawPageData)
      } catch (err) {
        console.warn(
          `⚠️ Skipping row with invalid JSON in page_data: ${(err as Error).message}`
        )
        continue
      }
    } else {
      console.warn(
        `⚠️ Skipping row with unexpected type for page_data: ${typeof rawPageData}`
      )
      continue
    }

    for (const [key, value] of Object.entries(parsedPageData)) {
      if (Array.isArray(value)) {
        const count = value.length
        totals[key] = (totals[key] || 0) + count

        // 4b. If array items have an `interest` property, accumulate per‐field counts
        for (const item of value) {
          if (item && typeof item === 'object' && 'interest' in item) {
            const label = String(item.interest)
            if (!fieldInterestCounts[key]) {
              fieldInterestCounts[key] = {}
            }
            fieldInterestCounts[key][label] =
              (fieldInterestCounts[key][label] || 0) + 1
          }
        }
      }
    }
  }

  console.log(`✅ Aggregated page_data array field totals:`, totals)
  console.log(`✅ Aggregated per‐field interest counts:`, fieldInterestCounts)

  const sortedPageFieldTotals = Object.fromEntries(
    Object.entries(totals).sort(([, aCount], [, bCount]) => bCount - aCount)
  )

  const sortedFieldInterestCounts: Record<string, Record<string, number>> = {}
  for (const [field, counts] of Object.entries(fieldInterestCounts)) {
    sortedFieldInterestCounts[field] = Object.fromEntries(
      Object.entries(counts).sort(([, aCount], [, bCount]) => bCount - aCount)
    )
  }

  console.log(`✅ Sorted pageFieldTotals:`, sortedPageFieldTotals)
  console.log(`✅ Sorted fieldInterestCounts:`, sortedFieldInterestCounts)

  const result = {
    sitemap: parsedWebsiteData.sitemap,
    summary: parsedWebsiteData.summary,
    pageFieldTotals: sortedPageFieldTotals,
    fieldInterestCounts: sortedFieldInterestCounts,
  }
  console.log(`📝 generateReport output:`, result)

  return result
}
