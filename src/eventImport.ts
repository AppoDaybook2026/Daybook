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

/** Gemini accepte 50 Mo ; on reste bien en deçà pour la bande passante. */
const MAX_PDF_BYTES = 15_000_000
/** En dessous, on considère que le PDF est scanné (pas de texte exploitable). */
const MIN_USEFUL_TEXT = 200

/**
 * Toute l'analyse se fait sur le serveur (worker/index.ts) :
 *  - pas de CORS, puisque c'est le serveur qui va chercher la page ;
 *  - la clé Gemini reste côté serveur, jamais exposée au navigateur.
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

/** Encodage base64 par tranches : évite le débordement de pile sur gros fichiers. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** Lecture locale du PDF. Renvoie '' si le texte est absent ou inexploitable. */
async function readPdfTextLocally(bytes: Uint8Array): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const document = await pdfjs.getDocument({ data: bytes }).promise

    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 12); pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }
    return pages.join('\n').trim()
  } catch {
    // pdf.js indisponible (sous-processus bloqué, PDF protégé…) : le serveur prendra le relais.
    return ''
  }
}

export async function extractPdf(file: File): Promise<ImportedEvent> {
  if (file.size > MAX_PDF_BYTES) throw new Error('pdf-too-large')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const localText = await readPdfTextLocally(bytes)

  // Chemin rapide : le PDF contient du texte, rien d'autre que ce texte ne part.
  if (localText.length >= MIN_USEFUL_TEXT) {
    return askServer({ text: localText, source: file.name })
  }

  // Repli : PDF scanné ou lecture locale impossible — Gemini le lit lui-même.
  return askServer({ pdfBase64: toBase64(bytes), source: file.name })
}

export async function extractUrl(url: string): Promise<ImportedEvent> {
  return askServer({ url, source: url })
}
