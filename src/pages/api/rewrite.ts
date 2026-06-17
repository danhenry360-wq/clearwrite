import type { APIRoute } from 'astro';

export const prerender = false;

// Primary: Claude Haiku 4.5 (via OpenRouter). Fallback: free Llama model.
const MODELS = [
  'anthropic/claude-haiku-4.5',
  'meta-llama/llama-3.3-70b-instruct:free',
];

const TONES: Record<string, string> = {
  neutral: 'neutral and plain — clear and unbiased, no extra flourish',
  professional: 'professional and polished, suitable for business and work',
  formal: 'formal and precise, suitable for official or academic writing',
  friendly: 'warm and friendly, approachable but still correct',
  casual: 'relaxed and conversational, like talking to a friend',
  confident: 'direct and confident, assertive without being aggressive',
};

function buildSystemPrompt(dialect: string, tone: string): string {
  const dialectName = dialect === 'UK' ? 'British (UK) English' : 'American (US) English';
  const toneDesc = TONES[tone] ?? TONES.neutral;
  return [
    `You are an expert editor. Rewrite the user's text into perfect, natural ${dialectName}.`,
    `Fix all grammar, spelling, punctuation, word choice and phrasing mistakes.`,
    `Use ${dialectName} spelling and conventions throughout.`,
    `Make the tone ${toneDesc}.`,
    `Keep the original meaning and all facts exactly. Do not add new ideas or remove information.`,
    `Match the length roughly — do not pad or over-shorten.`,
    `Output ONLY the rewritten text. No preamble, no quotes, no explanations, no notes.`,
  ].join(' ');
}

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const text = (body?.text ?? '').toString();
  const dialect = body?.dialect === 'UK' ? 'UK' : 'US';
  const tone = (body?.tone ?? 'neutral').toString().toLowerCase();

  if (!text.trim()) return json({ error: 'Please enter some text to polish.' }, 400);
  if (text.length > 12000) return json({ error: 'Text is too long (max ~12,000 characters).' }, 400);

  const apiKey = process.env.OPENROUTER_API_KEY || import.meta.env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: 'Server is missing OPENROUTER_API_KEY.' }, 500);

  const system = buildSystemPrompt(dialect, tone);

  let lastErr = 'Unknown error';
  for (const model of MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'ClearWrite',
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
        }),
      });

      if (!res.ok) {
        lastErr = `Model ${model} returned ${res.status}`;
        continue; // try next model
      }

      const data = await res.json();
      const out = data?.choices?.[0]?.message?.content?.trim();
      if (out) {
        return json({ result: out, model });
      }
      lastErr = `Model ${model} returned an empty response`;
    } catch (e: any) {
      lastErr = e?.message || 'Network error';
    }
  }

  return json({ error: `Could not polish the text. ${lastErr}.` }, 502);
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
