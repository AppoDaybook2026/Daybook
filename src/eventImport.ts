import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DeadlineCategory } from './db'

export interface ImportedEvent {
  category: DeadlineCategory
  /** Nature de l'événement (conference, workshop, summer-school…). */
  eventType: string
  name: string
  /** Date limite à respecter. */
  date: string
  /** Date de l'événement lui-même. */
  eventDate: string
  location: string
  presentationFormat: string
  fee: string
  organizer: string
  source: string
}

/** Gemini accepte 50 Mo ; on reste bien en deçà pour la bande passante. */
const MAX_PDF_BYTES = 15_000_000
/** Au-delà, on privilégie l'extraction locale du texte pour éviter un gros envoi. */
const NATIVE_PDF_LIMIT = 8_000_000
/** En dessous, on considère le texte extrait localement comme inexploitable. */
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
    // ATTENTION : pdf.js transfère le tableau à son sous-processus, ce qui vide
    // l'original (longueur ramenée à 0). On lui donne donc une copie, sinon le
    // repli « envoyer le PDF au serveur » expédierait un fichier vide.
    const document = await pdfjs.getDocument({ data: bytes.slice() }).promise

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
  if (bytes.length === 0) throw new Error('pdf-empty-file')

  // Chemin principal : Gemini lit le PDF tel quel, avec sa mise en page, ses
  // tableaux et ses en-têtes. Nettement plus fiable qu'un texte aplati, et
  // fonctionne aussi sur les documents scannés.
  if (file.size <= NATIVE_PDF_LIMIT) {
    try {
      return await askServer({ pdfBase64: toBase64(bytes), source: file.name })
    } catch {
      // On tente la lecture locale ci-dessous avant d'abandonner.
    }
  }

  // Secours : extraction du texte dans le navigateur.
  const localText = await readPdfTextLocally(bytes)
  if (localText.length < MIN_USEFUL_TEXT) throw new Error('pdf-unreadable')
  return askServer({ text: localText, source: file.name })
}

export async function extractUrl(url: string): Promise<ImportedEvent> {
  return askServer({ url, source: url })
}
