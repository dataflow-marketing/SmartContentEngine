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
  htmlReport: string
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
          } else if ('label' in item && typeof (item as any).label === 'string') {
            label = ((item as any).label as string).trim()
          } else if (key in item && typeof (item as any)[key] === 'string') {
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

  let htmlReport = `
    <html>
      <head>
        <style>
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background-color: #f0f0f0; }
          caption { font-weight: bold; margin-bottom: 8px; }
        </style>
      </head>
      <body>
        <h1>Report</h1>
        <h2>Sitemap</h2>
        <p>${parsedWebsiteData.sitemap ? `<a href="${parsedWebsiteData.sitemap}">${parsedWebsiteData.sitemap}</a>` : 'N/A'}</p>
        <h2>Summary</h2>
        <p>${parsedWebsiteData.summary || 'N/A'}</p>

        <h2>Page Field Totals</h2>
        <table>
          <thead>
            <tr><th>Field</th><th>Total</th></tr>
          </thead>
          <tbody>
  `
  for (const { field, total } of pageFieldTotals) {
    htmlReport += `
            <tr>
              <td>${field}</td>
              <td>${total}</td>
            </tr>
    `
  }
  htmlReport += `
          </tbody>
        </table>
  `

  for (const field of Object.keys(fieldInterestCounts)) {
    htmlReport += `
        <h2>${field.charAt(0).toUpperCase() + field.slice(1)} Counts</h2>
        <table>
          <thead>
            <tr><th>Label</th><th>Count</th><th>Percentage (%)</th></tr>
          </thead>
          <tbody>
    `
    for (const { label, count, percentage } of fieldInterestCounts[field]) {
      htmlReport += `
            <tr>
              <td>${label}</td>
              <td>${count}</td>
              <td>${percentage}</td>
            </tr>
      `
    }
    htmlReport += `
          </tbody>
        </table>
    `
  }

  htmlReport += `
      </body>
    </html>
  `

  return {
    sitemap: parsedWebsiteData.sitemap,
    summary: parsedWebsiteData.summary,
    pageFieldTotals,
    fieldInterestCounts,
    htmlReport,
  }
}
