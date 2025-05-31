import { getPool } from '../db'
import mysql from 'mysql2/promise'

export interface ReportParams {
  db: string
  ignoreFields: string[]
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function getPageEmbedding(dbName: string, url: string): Promise<number[] | null> {
  return null
}

function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const dim = vectors[0].length
  const sum = new Array<number>(dim).fill(0)
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += vec[i]
    }
  }
  return sum.map((s) => s / vectors.length)
}

function sortLabelCounts(pairs: [string, number][]): [string, number][] {
  return pairs.sort(([aLabel, aCount], [bLabel, bCount]) => {
    if (bCount !== aCount) return bCount - aCount
    return aLabel.localeCompare(bLabel)
  })
}

export async function run({
  db,
  ignoreFields,
}: ReportParams): Promise<{
  sitemap: string
  summary: string
  pageFieldTotals: Record<string, number>
  fieldInterestCounts: Record<string, Record<string, number>>
  topInterests: string[]
  underservedInterests: string[]
  interestCentroidSims: {
    interestA: string
    interestB: string
    similarity: number
  }[]
  interestGapPairs: {
    interestA: string
    interestB: string
    similarity: number
  }[]
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

  const interestToPages: Record<string, string[]> = {}

  for (const row of pageRows) {
    const url: string = row.url
    const rawPageData = row.page_data
    let parsedPageData: Record<string, any>
    if (typeof rawPageData === 'object' && rawPageData !== null) {
      parsedPageData = rawPageData
    } else if (typeof rawPageData === 'string') {
      try {
        parsedPageData = JSON.parse(rawPageData)
      } catch {
        continue
      }
    } else {
      continue
    }

    for (const [key, value] of Object.entries(parsedPageData)) {
      if (ignoreFields.includes(key)) {
        continue
      }

      if (Array.isArray(value)) {
        const count = value.length
        totals[key] = (totals[key] || 0) + count

        if (key === 'interests') {
          for (const item of value) {
            if (
              item &&
              typeof item === 'object' &&
              'interest' in item &&
              typeof item.interest === 'string'
            ) {
              const rawLabel = item.interest.trim()
              if (rawLabel.startsWith('[') || rawLabel.startsWith('{')) {
                continue
              }
              if (!fieldInterestCounts[key]) {
                fieldInterestCounts[key] = {}
              }
              fieldInterestCounts[key][rawLabel] =
                (fieldInterestCounts[key][rawLabel] || 0) + 1

              if (!interestToPages[rawLabel]) {
                interestToPages[rawLabel] = []
              }
              interestToPages[rawLabel].push(url)
            }
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
    sortedFieldInterestCounts[field] = Object.fromEntries(
      sortLabelCounts(Object.entries(counts) as [string, number][])
    )
  }

  const interestCounts = sortedFieldInterestCounts['interests'] || {}

  const topInterests = Object.keys(interestCounts).slice(0, 5)

  const underservedInterests = Object.entries(interestCounts)
    .filter(([, cnt]) => cnt > 0)
    .sort(([aLabel, aCnt], [bLabel, bCnt]) => {
      if (aCnt !== bCnt) return aCnt - bCnt
      return aLabel.localeCompare(bLabel)
    })
    .map(([label]) => label)
    .slice(0, 5)

  const interestCentroids: Record<string, number[]> = {}
  for (const label of Object.keys(interestToPages)) {
    const urls = interestToPages[label]
    const vectors: number[][] = []
    for (const pageUrl of urls) {
      const emb = await getPageEmbedding(db, pageUrl)
      if (emb) {
        vectors.push(emb)
      }
    }
    if (vectors.length) {
      interestCentroids[label] = computeCentroid(vectors)
    }
  }

  const labels = Object.keys(interestCentroids)
  const sims: {
    interestA: string
    interestB: string
    similarity: number
  }[] = []

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]
      const b = labels[j]
      const vecA = interestCentroids[a]
      const vecB = interestCentroids[b]
      if (vecA.length === 0 || vecB.length === 0) continue
      const sim = cosineSimilarity(vecA, vecB)
      sims.push({ interestA: a, interestB: b, similarity: sim })
    }
  }

  const sortedSimsDesc = sims.slice().sort((x, y) => y.similarity - x.similarity)
  const sortedSimsAsc = sims.slice().sort((x, y) => x.similarity - y.similarity)

  const interestCentroidSims = sortedSimsDesc.slice(0, 5)
  const interestGapPairs = sortedSimsAsc.slice(0, 5)

  return {
    sitemap: parsedWebsiteData.sitemap,
    summary: parsedWebsiteData.summary,
    pageFieldTotals: sortedPageFieldTotals,
    fieldInterestCounts: sortedFieldInterestCounts,
    topInterests,
    underservedInterests,
    interestCentroidSims,
    interestGapPairs,
  }
}
