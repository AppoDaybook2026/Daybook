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

const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined

async function extractWithGemini(text: string, source: string): Promise<ImportedEvent> {
  if (!geminiApiKey) {
    throw new Error('Gemini API key not configured')
  }

  const prompt = `Extract event/deadline information from this text and return ONLY valid JSON (no markdown, no extra text):
{
  "name": "event name or title",
  "date": "YYYY-MM-DD format or empty string",
  "location": "location/venue or empty string",
  "category": "conference|training|publication",
  "presentationFormat": "in-person|online|hybrid or empty string",
  "fee": "cost or empty string"
}

Text to analyze:
${text}

Return only the JSON object, nothing else.`

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + geminiApiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })

  if (!response.ok) throw new Error(`Gemini error: ${response.status}`)

  const data = await response.json()
  const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const jsonMatch = textContent.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Could not parse Gemini response')

  const extracted = JSON.parse(jsonMatch[0])
  return {
    name: extracted.name ?? '',
    date: extracted.date ?? '',
    location: extracted.location ?? '',
    category: (extracted.category ?? 'conference') as DeadlineCategory,
    presentationFormat: extracted.presentationFormat ?? '',
    fee: extracted.fee ?? '',
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
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  return extractWithGemini(pages.join('\n'), file.name)
}

async function fetchEventPage(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (response.ok) return response.text()
  } catch { /* fallback */ }

  try {
    const proxied = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`)
    if (proxied.ok) {
      const json = await proxied.json()
      if (json.contents) return json.contents
    }
  } catch { /* fallback */ }

  throw new Error('Could not fetch page from any source. Try again or enter details manually.')
}

export async function extractUrl(url: string) {
  const html = await fetchEventPage(url)
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll('script, style, nav, footer').forEach((node) => node.remove())
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title
  const text = `${title}\n${document.body.textContent ?? ''}`
  return extractWithGemini(text, url)
}