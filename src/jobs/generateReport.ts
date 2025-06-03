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

  let pool
  try {
    pool = await getPool(db)
  } catch (e) {
    console.error('❌ Failed to get DB pool:', e)
    throw new Error('Database connection error')
  }

  let parsedWebsiteData: { sitemap: string; summary: string } = { sitemap: '', summary: '' }
  try {
    const [websiteRows] = await pool.query<any[]>(`SELECT website_data FROM website LIMIT 1`)
    if (!Array.isArray(websiteRows) || websiteRows.length === 0) {
      console.warn('⚠️ No rows found in `website` table. Using empty sitemap/summary.')
    } else {
      const rawWebsiteData = websiteRows[0].website_data
      let interim: any = {}
      if (typeof rawWebsiteData === 'object' && rawWebsiteData !== null) {
        interim = rawWebsiteData
      } else if (typeof rawWebsiteData === 'string') {
        try {
          interim = JSON.parse(rawWebsiteData)
        } catch (e) {
          console.error('⚠️ Failed to parse website_data JSON:', rawWebsiteData)
        }
      } else {
        console.warn(`⚠️ Unexpected type for website_data: ${typeof rawWebsiteData}`)
      }
      if (typeof interim.sitemap === 'string') {
        parsedWebsiteData.sitemap = interim.sitemap
      } else {
        console.warn('⚠️ Missing or non-string sitemap in website_data.')
      }
      if (typeof interim.summary === 'string') {
        parsedWebsiteData.summary = interim.summary
      } else {
        console.warn('⚠️ Missing or non-string summary in website_data.')
      }
    }
  } catch (e) {
    console.error('❌ Error fetching website_data:', e)
  }

  let pageRows: Array<{ url: string; page_data: any }>
  try {
    const result = await pool.query<any[]>(`SELECT url, page_data FROM pages`)
    pageRows = Array.isArray(result[0]) ? (result[0] as any[]) : []
    if (pageRows.length === 0) {
      console.warn('⚠️ No rows found in `pages` table.')
    }
  } catch (e) {
    console.error('❌ Error querying pages table:', e)
    throw new Error('Failed to fetch pages')
  }

  const totalsRaw: Record<string, number> = {}
  const fieldCountsRaw: Record<string, Record<string, number>> = {}

  for (const row of pageRows) {
    let parsedPageData: Record<string, any> | null = null
    try {
      if (typeof row.page_data === 'object' && row.page_data !== null) {
        parsedPageData = row.page_data
      } else if (typeof row.page_data === 'string') {
        parsedPageData = JSON.parse(row.page_data)
      }
    } catch (e) {
      console.warn(`⚠️ Skipping page ${row.url}: invalid JSON in page_data`, e)
      continue
    }
    if (!parsedPageData || typeof parsedPageData !== 'object') {
      console.warn(`⚠️ Skipping page ${row.url}: page_data is not an object`)
      continue
    }

    for (const [key, value] of Object.entries(parsedPageData)) {
      if (ignoreFields.includes(key)) continue
      if (!Array.isArray(value)) continue

      const count = value.length
      totalsRaw[key] = (totalsRaw[key] || 0) + count

      if (!fieldCountsRaw[key] || typeof fieldCountsRaw[key] !== 'object') {
        fieldCountsRaw[key] = {}
      }

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

  function printTable(
    rows: Array<Record<string, string | number>>,
    columns: string[]
  ) {
    const widths: Record<string, number> = {}
    for (const col of columns) {
      widths[col] = col.length
    }
    for (const row of rows) {
      for (const col of columns) {
        const cell = String(row[col] === undefined ? '' : row[col])
        widths[col] = Math.max(widths[col], cell.length)
      }
    }

    const header = columns
      .map((col) => col.padEnd(widths[col]))
      .join(' | ')
    const separator = columns
      .map((col) => ''.padEnd(widths[col], '-'))
      .join('-|-')

    console.log(header)
    console.log(separator)

    for (const row of rows) {
      const line = columns
        .map((col) => {
          const cell = String(row[col] === undefined ? '' : row[col])
          return cell.padEnd(widths[col])
        })
        .join(' | ')
      console.log(line)
    }
  }

  console.log('\nSitemap:', parsedWebsiteData.sitemap)
  console.log('Summary:', parsedWebsiteData.summary, '\n')

  console.log('Page Field Totals:')
  printTable(
    pageFieldTotals.map((entry) => ({
      field: entry.field,
      total: entry.total,
    })),
    ['field', 'total']
  )

  for (const field of Object.keys(fieldInterestCounts)) {
    console.log(`\n${field.charAt(0).toUpperCase() + field.slice(1)} Counts:`)
    printTable(
      fieldInterestCounts[field].map((entry) => ({
        label: entry.label,
        count: entry.count,
        percentage: entry.percentage,
      })),
      ['label', 'count', 'percentage']
    )
  }

  return {
    sitemap: parsedWebsiteData.sitemap,
    summary: parsedWebsiteData.summary,
    pageFieldTotals,
    fieldInterestCounts,
  }
}
