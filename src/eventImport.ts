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

async function extractWithGemini(text: string, source: string): Promise<ImportedEvent> {
  const response = await fetch('/api/extract-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source }),
  })

  if (!response.ok) throw new Error(`Extraction failed: ${response.status}`)
  return response.json()
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