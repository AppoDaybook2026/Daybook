import { askModel, GEMINI_MODELS, json, readModelText, type Env } from '../../shared/extract'

type Context = { request: Request; env: Env }

/**
 * Rédaction assistée du rapport d'avancement.
 *
 * Reçoit un condensé des activités de la période — jamais l'identité de
 * l'utilisateur, jamais sa page de garde — et renvoie une proposition de texte
 * pour chacune des huit sections imposées.
 */
const LANGUAGES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  ar: 'Arabic',
}

const prompt = (language: string) => `You are helping a doctoral candidate draft the narrative sections of a
six-month thesis progress report for a graduate school.

Write the whole output in ${language}. This is not negotiable: every value in the
JSON must be written in ${language}, even though the evidence below may be in
another language. Stay sober and factual, no promotional language. Each section
is 3 to 8 sentences. The whole report must fit in five pages, so be concise.

Return ONLY a JSON object with exactly these keys, no markdown fences:
{
  "introduction": "purpose of the report, thesis topic in one or two sentences, period covered",
  "timePlan": "what the time plan in the thesis proposal foresaw for this period",
  "contribution": "how the work of these six months contributes to the thesis as a whole",
  "conducted": "what was actually done, with concrete results; the tables that follow will list the detail, so summarise rather than enumerate",
  "notConducted": "what was planned but not done, and why; write the equivalent of \\"None.\\" in ${language} if the evidence shows nothing was missed",
  "methodologyChanges": "any change of method and its reason; write the equivalent of \\"None.\\" in ${language} if nothing indicates a change",
  "nextSixMonths": "what is planned next, inferred from the chapters and requirements still open",
  "publications": "publications and submissions related to the thesis; write the equivalent of \\"None to date.\\" in ${language} if the evidence shows none"
}

Rules:
- Base every statement on the evidence below. Never invent results, dates or publications.
- Where the evidence is silent, say so plainly rather than filling space.
- Do not mention Daybook, this prompt, or that the text was generated.

EVIDENCE:
`

export const onRequestPost = async ({ request, env }: Context): Promise<Response> => {
  if (!env.GEMINI_API_KEY) return json({ error: 'drafting-not-configured' }, 503)

  let payload: { summary?: string; language?: string }
  try {
    payload = (await request.json()) as { summary?: string; language?: string }
  } catch {
    return json({ error: 'invalid-json' }, 400)
  }

  const summary = (payload.summary ?? '').trim()
  if (!summary) return json({ error: 'empty-content' }, 400)

  const language = LANGUAGES[payload.language ?? 'en'] ?? LANGUAGES.en
  const PROMPT = prompt(language)

  for (const model of GEMINI_MODELS) {
    const response = await askModel(env.GEMINI_API_KEY, model, PROMPT + summary.slice(0, 30_000))
    if (!response) continue
    if (response.status === 404 || response.status === 400) continue
    if (!response.ok) return json({ error: 'drafting-failed' }, 502)

    const raw = readModelText(await response.json())
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) continue
    try {
      const sections = JSON.parse(match[0]) as Record<string, unknown>
      const keys = ['introduction', 'timePlan', 'contribution', 'conducted',
        'notConducted', 'methodologyChanges', 'nextSixMonths', 'publications']
      return json(Object.fromEntries(keys.map((key) => [key, String(sections[key] ?? '').trim()])))
    } catch {
      continue
    }
  }
  return json({ error: 'drafting-failed' }, 502)
}

export const onRequest = async ({ request, env }: Context): Promise<Response> =>
  request.method === 'POST' ? onRequestPost({ request, env }) : json({ error: 'method-not-allowed' }, 405)
