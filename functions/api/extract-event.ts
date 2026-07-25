type RequestData = {
  text: string
  source: string
}

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const geminiApiKey = context.env.VITE_GEMINI_API_KEY as string | undefined
  if (!geminiApiKey) {
    return new Response('Gemini API key not configured', { status: 500 })
  }

  try {
    const { text, source } = await context.request.json<RequestData>()

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

    if (!response.ok) {
      return new Response(`Gemini error: ${response.status}`, { status: 502 })
    }

    const data = await response.json()
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const jsonMatch = textContent.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      return new Response('Could not parse Gemini response', { status: 502 })
    }

    const extracted = JSON.parse(jsonMatch[0])

    return new Response(
      JSON.stringify({
        name: extracted.name ?? '',
        date: extracted.date ?? '',
        location: extracted.location ?? '',
        category: (extracted.category ?? 'conference'),
        presentationFormat: extracted.presentationFormat ?? '',
        fee: extracted.fee ?? '',
        source,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
}