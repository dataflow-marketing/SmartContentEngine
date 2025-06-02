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
  pageFieldTotals: Record<string, number>
  fieldInterestCounts: Record<string, Record<string, number>>
}> {
  console.log(`📝 Starting "generateReport" job for database "${db}"`)
  console.log(`❌ Ignoring fields: ${JSON.stringify(ignoreFields)}`)

  const pool = await getPool(db)

  const [websiteRows] = await pool.query<any[]>(
    'SELECT website_data FROM website LIMIT 1'
  )
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

  const [pageRows] = await pool.query<any[]>(
    'SELECT url, page_data FROM pages'
  )

  const totals: Record<string, number> = {}
  const fieldInterestCounts: Record<string, Record<string, number>> = {}

  for (const row of pageRows) {
    const url: string = row.url
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
        totals[key] = (totals[key] || 0) + count

        fieldInterestCounts[key] = fieldInterestCounts[key] || {}

        for (const item of value) {
          let label: string | null = null

          if (typeof item === 'string') {
            label = item.trim()
          } else if (item && typeof item === 'object') {
            if ('label' in item && typeof (item as any).label === 'string') {
              label = ((item as any).label as string).trim()
            } else {
              for (const [prop, val] of Object.entries(item)) {
                if (prop === 'description') continue
                if (typeof val === 'string') {
                  label = val.trim()
                  break
                }
              }
            }
          }

          if (label && label.length > 0 && !label.startsWith('[') && !label.startsWith('{')) {
            fieldInterestCounts[key][label] = (fieldInterestCounts[key][label] || 0) + 1
          }
        }
      }
    }
  }

  const sortedPageFieldTotals = Object.fromEntries(
    Object.entries(totals).sort(([aKey, aCount], [bKey, bCount]) => {
      if (bCount !== aCount) return bCount - aCount
      return aKey.localeCompare(bKey)
    })
  )

  const sortedFieldInterestCounts: Record<string, Record<string, number>> = {}
  for (const [field, counts] of Object.entries(fieldInterestCounts)) {
    const sortedCounts = Object.entries(counts).sort(([aLabel, aCnt], [bLabel, bCnt]) => {
      if (bCnt !== aCnt) return bCnt - aCnt
      return aLabel.localeCompare(bLabel)
    })
    sortedFieldInterestCounts[field] = Object.fromEntries(sortedCounts)
  }

  return {
    sitemap: parsedWebsiteData.sitemap,
    summary: parsedWebsiteData.summary,
    pageFieldTotals: sortedPageFieldTotals,
    fieldInterestCounts: sortedFieldInterestCounts,
  }
}
