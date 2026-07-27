import { json, type Env } from '../../shared/extract'

/**
 * Point de contrôle : indique si le serveur voit bien la clé Gemini,
 * sans jamais la révéler. Sert à diagnostiquer sans deviner.
 */
export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> =>
  json({ ok: true, geminiConfigured: Boolean(env.GEMINI_API_KEY) })
