/**
 * Daybook — Worker serveur.
 *
 * Deux rôles :
 *   1. POST /api/extract-event  → va chercher la page ou reçoit le texte d'un
 *      PDF, puis demande à Gemini d'en extraire les champs de l'événement.
 *   2. tout le reste            → sert l'application React (fichiers statiques).
 *
 * Pourquoi côté serveur : le CORS est une règle imposée par le NAVIGATEUR.
 * Un serveur qui va chercher une page n'y est pas soumis. Et la clé Gemini
 * reste ici, elle n'est jamais envoyée au navigateur.
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  GEMINI_API_KEY?: string
}

interface ExtractRequest {
  url?: string
  text?: string
  /** PDF encodé en base64, quand la lecture locale n'a pas abouti. */
  pdfBase64?: string
  source?: string
}

interface ExtractedEvent {
  category: 'conference' | 'training' | 'publication'
  name: string
  date: string
  location: string
  presentationFormat: string
  fee: string
  source: string
}

/* ------------------------------------------------------------------ */
/* Garde-fous réseau (anti-SSRF)                                       */
/* ------------------------------------------------------------------ */

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '')
    if (h === '::1' || h === '::') return true
    if (/^f[cd]/.test(h)) return true
    if (/^fe[89ab]/.test(h)) return true
    return false
  }
  return false
}

function validateTarget(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.port && url.port !== '80' && url.port !== '443') return null
  if (url.username || url.password) return null
  if (isPrivateHost(url.hostname)) return null
  return url
}

/* ------------------------------------------------------------------ */
/* Récupération et nettoyage de la page                                */
/* ------------------------------------------------------------------ */

const MAX_TEXT = 24_000

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

async function fetchPageText(target: URL): Promise<string> {
  const response = await fetch(target.toString(), {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DaybookEventImport/1.0)',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en,fr;q=0.8',
    },
  })
  if (!response.ok) throw new Error(`upstream ${response.status}`)

  const contentType = response.headers.get('content-type') ?? ''
  const body = await response.text()
  if (!contentType.includes('html') && !body.includes('<')) return body.slice(0, MAX_TEXT)

  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const ogTitle = body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const heading = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = htmlToText(ogTitle?.[1] ?? heading?.[1] ?? titleMatch?.[1] ?? '')

  return `${title}\n\n${htmlToText(body)}`.slice(0, MAX_TEXT)
}

/* ------------------------------------------------------------------ */
/* Extraction par Gemini                                               */
/* ------------------------------------------------------------------ */

// Les noms de modèles évoluent ; on essaie du plus récent au plus ancien et
// on passe au suivant si l'API répond 404 (modèle inconnu).
const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
]

const PROMPT_HEADER = `You extract structured data about an academic or professional event (conference, call for papers, training, job/PhD vacancy, scholarship) from raw page text.

Return ONLY a JSON object, no markdown fences, no commentary, with exactly these keys:
{
  "name": "the event or position title, concise",
  "date": "the single most important upcoming deadline or event date, strict YYYY-MM-DD, or \\"\\" if none is stated",
  "location": "city and/or country, or the institution, or \\"\\"",
  "category": "one of: conference, training, publication",
  "presentationFormat": "one of: in-person, online, hybrid, or \\"\\"",
  "fee": "registration fee or salary as written, or \\"\\""
}

Rules:
- Prefer a submission/application deadline over the event date itself.
- If several dates appear, choose the one the reader must act on.
- Never invent information. Use "" when the text does not state it.
- category: use "publication" for calls for papers and journal special issues,
  "training" for courses, schools and workshops, "conference" otherwise
  (including PhD and job vacancies).

Page text:
`

/**
 * Extrait le texte de la réponse, quelle que soit la forme renvoyée :
 * Interactions API (output_text ou steps[].modelOutput) ou l'ancienne
 * generateContent (candidates[].content.parts).
 */
function readModelText(data: unknown): string {
  const root = data as {
    output_text?: string
    outputText?: string
    steps?: { modelOutput?: { content?: { text?: { text?: string } | string }[] } }[]
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }

  if (typeof root.output_text === 'string' && root.output_text) return root.output_text
  if (typeof root.outputText === 'string' && root.outputText) return root.outputText

  const pieces: string[] = []
  for (const step of root.steps ?? []) {
    for (const content of step.modelOutput?.content ?? []) {
      if (typeof content.text === 'string') pieces.push(content.text)
      else if (content.text?.text) pieces.push(content.text.text)
    }
  }
  if (pieces.length) return pieces.join('\n')

  for (const candidate of root.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) pieces.push(part.text)
    }
  }
  return pieces.join('\n')
}

async function askModel(apiKey: string, model: string, prompt: string): Promise<Response | null> {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }

  // Point d'entrée actuel : Interactions API.
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: prompt }),
      signal: AbortSignal.timeout(25_000),
    })
    if (response.ok || (response.status !== 404 && response.status !== 400)) return response
  } catch {
    return null
  }

  // Repli : ancien point d'entrée generateContent.
  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(25_000),
      },
    )
  } catch {
    return null
  }
}

/**
 * Lecture du PDF par Gemini lui-même (vision native) : fonctionne aussi sur
 * les PDF scannés, qui ne contiennent aucun texte sélectionnable.
 */
async function askModelWithPdf(apiKey: string, model: string, pdfBase64: string): Promise<Response | null> {
  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
              // La consigne se place après le document (recommandation Google).
              { text: PROMPT_HEADER + '(see the attached PDF)' },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(40_000),
      },
    )
  } catch {
    return null
  }
}

function parseModelJson(raw: string): Partial<ExtractedEvent> | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as Partial<ExtractedEvent>
  } catch {
    return null
  }
}

async function callGemini(
  apiKey: string,
  input: { text?: string; pdfBase64?: string },
): Promise<Partial<ExtractedEvent> | null> {
  for (const model of GEMINI_MODELS) {
    const response = input.pdfBase64
      ? await askModelWithPdf(apiKey, model, input.pdfBase64)
      : await askModel(apiKey, model, PROMPT_HEADER + (input.text ?? ''))

    if (!response) continue
    if (response.status === 404 || response.status === 400) continue // modèle inconnu
    if (!response.ok) return null

    const parsed = parseModelJson(readModelText(await response.json()))
    if (parsed) return parsed
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Filet de sécurité : extraction par motifs si Gemini est indisponible */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function heuristicExtract(text: string): Partial<ExtractedEvent> {
  const iso = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-2]?\d|3[01])\b/)
  let date = ''
  if (iso) {
    date = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  } else {
    const named = text.match(
      /\b([0-3]?\d)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d{2})\b/i,
    )
    const named2 = text.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+([0-3]?\d)(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i,
    )
    if (named) date = `${named[3]}-${MONTHS[named[2].toLowerCase().slice(0, 3)]}-${named[1].padStart(2, '0')}`
    else if (named2) date = `${named2[3]}-${MONTHS[named2[1].toLowerCase().slice(0, 3)]}-${named2[2].padStart(2, '0')}`
  }

  const lower = text.toLowerCase()
  // Limites de mots obligatoires : sans elles, « information » contient
  // « formation » et « discourse » contient « course ».
  const category: ExtractedEvent['category'] =
    /\b(call for papers|special issue|abstract submission|full paper|journal)\b/.test(lower)
      ? 'publication'
      : /\b(training|workshop|summer school|winter school|course|formation)\b/.test(lower)
        ? 'training'
        : 'conference'

  const firstLine = text.split('\n').map((line) => line.trim()).find((line) => line.length > 8 && line.length < 200)

  return {
    name: firstLine ?? '',
    date,
    location: text.match(/(?:location|venue|place|city)\s*[:\-]\s*([^\n|]{2,80})/i)?.[1]?.trim() ?? '',
    category,
    presentationFormat: /hybrid/i.test(text)
      ? 'hybrid'
      : /online|virtual|remote|zoom/i.test(text)
        ? 'online'
        : /in.person|on.site/i.test(text)
          ? 'in-person'
          : '',
    fee: text.match(/(?:fee|registration|cost|salary)\s*[:\-]?\s*((?:USD|EUR|MAD|€|\$|£)\s?[\d,. ]+)/i)?.[1]?.trim() ?? '',
  }
}

/* ------------------------------------------------------------------ */
/* Route /api/extract-event                                            */
/* ------------------------------------------------------------------ */

const CATEGORIES = new Set(['conference', 'training', 'publication'])
const FORMATS = new Set(['in-person', 'online', 'hybrid'])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function handleExtract(request: Request, env: Env): Promise<Response> {
  let payload: ExtractRequest
  try {
    payload = (await request.json()) as ExtractRequest
  } catch {
    return json({ error: 'invalid-json' }, 400)
  }

  const source = payload.source ?? payload.url ?? ''
  const pdfBase64 = payload.pdfBase64
  let text = (payload.text ?? '').trim()

  if (!text && !pdfBase64 && payload.url) {
    const target = validateTarget(payload.url)
    if (!target) return json({ error: 'invalid-url' }, 400)
    try {
      text = await fetchPageText(target)
    } catch {
      return json({ error: 'fetch-failed' }, 502)
    }
  }

  if (!text && !pdfBase64) return json({ error: 'empty-content' }, 400)
  text = text.slice(0, MAX_TEXT)

  const key = env.GEMINI_API_KEY
  if (pdfBase64 && !key) {
    // Sans clé, on ne sait pas lire un PDF côté serveur : on le dit clairement.
    return json({ error: 'pdf-needs-gemini' }, 503)
  }

  const fromModel = key ? await callGemini(key, { text, pdfBase64 }) : null
  if (!fromModel && pdfBase64) return json({ error: 'pdf-unreadable' }, 502)
  const result = fromModel ?? heuristicExtract(text)

  const category = String(result.category ?? '').toLowerCase()
  const format = String(result.presentationFormat ?? '').toLowerCase()

  const event: ExtractedEvent = {
    name: String(result.name ?? '').trim().slice(0, 300),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(result.date ?? '')) ? String(result.date) : '',
    location: String(result.location ?? '').trim().slice(0, 200),
    category: (CATEGORIES.has(category) ? category : 'conference') as ExtractedEvent['category'],
    presentationFormat: FORMATS.has(format) ? format : '',
    fee: String(result.fee ?? '').trim().slice(0, 100),
    source,
  }

  return json(event)
}

/* ------------------------------------------------------------------ */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/extract-event') {
      if (request.method !== 'POST') {
        return json({ error: 'method-not-allowed' }, 405)
      }
      return handleExtract(request, env)
    }

    // Diagnostic : indique si la clé est bien vue par le serveur (sans la révéler).
    if (url.pathname === '/api/health') {
      return json({ ok: true, geminiConfigured: Boolean(env.GEMINI_API_KEY) })
    }

    // Toute autre adresse /api/... n'existe pas : on le dit, plutôt que de
    // renvoyer l'application et de laisser croire à une réponse valide.
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not-found' }, 404)
    }

    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404) return response

    // Repli application monopage : réservé aux navigations. Un fichier absent
    // (script, image, feuille de style) garde son 404, ce qui rend les erreurs
    // de déploiement immédiatement lisibles.
    const wantsHtml = request.headers.get('accept')?.includes('text/html')
    if (request.method === 'GET' && wantsHtml) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request))
    }
    return response
  },
}
