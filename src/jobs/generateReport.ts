import { getPool } from '../db'
import mysql from 'mysql2/promise'

export interface ReportParams {
  db: string
  ignoreFields: string[]
}

async function getPageEmbedding(dbName: string, url: string): Promise<number[] | null> {
  return null
}

export async function run({
  db,
  ignoreFields,
}: ReportParams): Promise<{
  sitemap: string
  summary: string
  pageFieldTotals: Array<{ field: string; total: number }>
  fieldInterestCounts: Record<string, Array<{ label: string; count: number; percentage: number }>>
}> {
  console.log(`📝 Starting "generateReport" job for database "${db}"`)
  console.log(`❌ Ignoring fields: ${JSON.stringify(ignoreFields)}`)

  const pool = await getPool(db)

  const [websiteRows] = await pool.query<any[]>(`SELECT website_data FROM website LIMIT 1`)
  if (websiteRows.length === 0) {
    throw new Error('⚠️ No rows found in `website` table.')
  }
  const rawWebsiteData = websiteRows[0].website_data
  let parsedWebsiteData: { sitemap?: string; summary?: string }
  if (typeof rawWebsiteData === 'object' && rawWebsiteData !== null) {
    parsedWebsiteData = rawWebsiteData as { sitemap?: string; summary?: string }
  } else if (typeof rawWebsiteData === 'string') {
    try {
      parsedWebsiteData = JSON.parse(rawWebsiteData)
    } catch {
      throw new Error(`⚠️ Failed to parse website_data JSON`)
    }
  } else {
    throw new Error(`⚠️ Unexpected type for website_data: ${typeof rawWebsiteData}`)
  }

  if (
    typeof parsedWebsiteData.sitemap !== 'string' ||
    typeof parsedWebsiteData.summary !== 'string'
  ) {
    throw new Error(
      '⚠️ Invalid format in website_data: expected both "sitemap" and "summary" as strings.'
    )
  }

  const [pageRows] = await pool.query<any[]>(`SELECT url, page_data FROM pages`)

  const totalsRaw: Record<string, number> = {}
  const fieldCountsRaw: Record<string, Record<string, number>> = {}

  for (const row of pageRows) {
    let parsedPageData: Record<string, any> | null = null
    if (typeof row.page_data === 'object' && row.page_data !== null) {
      parsedPageData = row.page_data
    } else if (typeof row.page_data === 'string') {
      try {
        parsedPageData = JSON.parse(row.page_data)
      } catch {
        continue
      }
    } else {
      continue
    }

    for (const [key, value] of Object.entries(parsedPageData)) {
      if (ignoreFields.includes(key)) continue

      if (Array.isArray(value)) {
        const count = value.length
        totalsRaw[key] = (totalsRaw[key] || 0) + count

        fieldCountsRaw[key] = fieldCountsRaw[key] || {}

        for (const item of value) {
          let label: string | null = null

          if (typeof item === 'string') {
            label = item.trim()
          } else if (item && typeof item === 'object') {
            if ('interest' in item && typeof (item as any).interest === 'string') {
              label = ((item as any).interest as string).trim()
            }
            else if ('label' in item && typeof (item as any).label === 'string') {
              label = ((item as any).label as string).trim()
            }
            else if (key in item && typeof (item as any)[key] === 'string') {
              label = ((item as any)[key] as string).trim()
            }
          }

          if (label && label.length > 0 && !label.startsWith('[') && !label.startsWith('{')) {
            fieldCountsRaw[key][label] = (fieldCountsRaw[key][label] || 0) + 1
          }
        }
      }
    }
  }

  const pageFieldTotals = Object.entries(totalsRaw)
    .sort(([, aCount], [, bCount]) => bCount - aCount)
    .map(([field, total]) => ({ field, total }))

  const fieldInterestCounts: Record<string, Array<{ label: string; count: number; percentage: number }>> = {}
  for (const [field, counts] of Object.entries(fieldCountsRaw)) {
    const totalForField = totalsRaw[field] || 1
    const sortedEntries = Object.entries(counts).sort(([, aCnt], [, bCnt]) => bCnt - aCnt)
    fieldInterestCounts[field] = sortedEntries.map(([label, cnt]) => ({
      label,
      count: cnt,
      percentage: parseFloat(((cnt / totalForField) * 100).toFixed(1)),
    }))
  }

  return {
    sitemap: parsedWebsiteData.sitemap,
    summary: parsedWebsiteData.summary,
    pageFieldTotals,
    fieldInterestCounts,
  }
}
