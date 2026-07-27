import { handleExtract, json, type Env } from '../../shared/extract'

type Context = { request: Request; env: Env }

export const onRequestPost = async ({ request, env }: Context): Promise<Response> =>
  handleExtract(request, env)

/** Toute autre méthode est refusée explicitement, plutôt qu'ignorée. */
export const onRequest = async ({ request, env }: Context): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405)
  return handleExtract(request, env)
}
