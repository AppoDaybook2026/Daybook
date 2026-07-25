import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DeadlineCategory } from './db'

export interface ImportedEvent {
  category: DeadlineCategory
  name: string
  date: string
  location: string
  presentationFormat: string
  fee: string
  source: string
}

function normalizeDate(text: string) {
  const iso = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-2]?\d|3[01])\b/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const named = text.match(/\b(?:deadline|date|due)?\s*:?\s*((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+20\d{2})/i)
  if (!named) return ''
  const parsed = new Date(named[1].replace(/(st|nd|rd|th)/i, ''))
  if (Number.isNaN(parsed.getTime())) return ''
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${parsed.getFullYear()}-${month}-${day}`
}

export function inferEvent(text: string, source = ''): ImportedEvent {
  const clean = text.replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ')
  const lower = clean.toLowerCase()
  const category: DeadlineCategory = /training|workshop|course|summer school|formation/.test(lower)
    ? 'training'
    : /journal|publication|abstract submission|full paper|call for papers/.test(lower)
      ? 'publication'
      : 'conference'
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 4)
  const name = lines.find((line) => line.length < 180 && !/^(date|deadline|location|venue|fee|format)\b/i.test(line)) ?? ''
  const locationMatch = clean.match(/(?:location|venue|place)\s*[:\-]\s*([^\n|]{2,100})/i)
  const feeMatch = clean.match(/(?:fee|registration|cost)\s*[:\-]?\s*((?:USD|EUR|MAD|€|\$|£)?\s?[\d,.]+(?:\s?(?:USD|EUR|MAD))?)/i)
  const presentationFormat = /hybrid/i.test(clean) ? 'hybrid' : /online|virtual|zoom/i.test(clean) ? 'online' : /in.person|onsite|on-site/i.test(clean) ? 'in-person' : ''
  return {
    category, name, date: normalizeDate(clean),
    location: locationMatch?.[1].trim() ?? '',
    presentationFormat,
    fee: feeMatch?.[1].trim() ?? '',
    source,
  }
}

export async function extractPdf(file: File) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = new Uint8Array(await file.arrayBuffer())
  const document = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 12); pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
  }
  return inferEvent(pages.join('\n'), file.name)
}
async function fetchEventPage(url: string) {
  // Try multiple strategies to fetch the page:
  // 1. Direct fetch (works if target allows CORS or is same-origin)
  // 2. CORS proxy fallback (allorigins.win)
  // 3. Our Cloudflare Pages Function proxy (as last resort)

  // Strategy 1: Direct fetch
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (response.ok) return response.text()
  } catch { /* fallback */ }

  // Strategy 2: CORS proxy
  try {
    const proxied = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`)
    if (proxied.ok) {
      const json = await proxied.json()
      if (json.contents) return json.contents
    }
  } catch { /* fallback */ }

  // Strategy 3: Our Pages Function proxy (if available)
  try {
    const proxied = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`)
    if (proxied.ok) return proxied.text()
  } catch { /* all failed */ }

  throw new Error('Could not fetch page from any source. Try again or enter details manually.')
}

export async function extractUrl(url: string) {
  const html = await fetchEventPage(url)
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll('script, style, nav, footer').forEach((node) => node.remove())
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title
  return inferEvent(`${title}\n${document.body.textContent ?? ''}`, url)
}