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

/**
 * Toute l'extraction se fait sur le serveur (worker/index.ts) :
 *  - pas de CORS, puisque c'est le serveur qui va chercher la page ;
 *  - la clé Gemini reste côté serveur et n'est jamais exposée au navigateur.
 */
async function askServer(body: Record<string, unknown>): Promise<ImportedEvent> {
  const response = await fetch('/api/extract-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const reason = await response.json().catch(() => ({ error: `http-${response.status}` }))
    throw new Error((reason as { error?: string }).error ?? `http-${response.status}`)
  }
  return (await response.json()) as ImportedEvent
}

/** Le PDF est lu localement ; seul le texte extrait part vers le serveur. */
export async function extractPdf(file: File): Promise<ImportedEvent> {
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

  const text = pages.join('\n').trim()
  if (!text) throw new Error('pdf-has-no-text')
  return askServer({ text, source: file.name })
}

export async function extractUrl(url: string): Promise<ImportedEvent> {
  return askServer({ url, source: url })
}
