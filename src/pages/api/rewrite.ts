import type { APIRoute } from 'astro';

export const prerender = false;

// Free models only, in priority order. If one is rate-limited (429) or errors,
// the request automatically rolls to the next.
const MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-4-26b-a4b-it:free',
];

const TONES: Record<string, string> = {
  neutral: 'neutral and plain — clear and unbiased, no extra flourish',
  professional: 'professional and polished, suitable for business and work',
  formal: 'formal and precise, suitable for official or academic writing',
  friendly: 'warm and friendly, approachable but still correct',
  casual: 'relaxed and conversational, like talking to a friend',
  confident: 'direct and confident, assertive without being aggressive',
};

function langName(lang: string): string {
  return lang === 'UK' ? 'British (UK) English' : lang === 'FR' ? 'French' : 'American (US) English';
}

function buildSystemPrompt(lang: string, tone: string): string {
  const name = langName(lang);
  const conventions =
    lang === 'FR'
      ? 'Use standard French spelling, grammar, accents and punctuation conventions throughout.'
      : `Use ${name} spelling and conventions throughout.`;
  const toneDesc = TONES[tone] ?? TONES.neutral;
  return [
    `You are an expert editor. Rewrite the user's text into perfect, natural ${name}.`,
    `Fix all grammar, spelling, punctuation, word choice and phrasing mistakes.`,
    conventions,
    `Make the tone ${toneDesc}.`,
    `Keep the original meaning and all facts exactly. Do not add new ideas or remove information.`,
    `If the input is written in a different language, translate it accurately into ${name}.`,
    `Match the length roughly — do not pad or over-shorten.`,
    `Output ONLY the rewritten text. No preamble, no quotes, no explanations, no notes.`,
  ].join(' ');
}

// "Prompt-ready" mode: restructure rough notes into a clean LLM prompt.
function buildPromptSystem(lang: string): string {
  const name = langName(lang);
  return [
    `You are a prompt engineer. Turn the user's rough notes into a single, clear prompt that is ready to paste into an AI assistant.`,
    `Structure the output under these labels, each on its own line: "Context:", "Task:", "Constraints:".`,
    `Under Context, give the background the AI needs. Under Task, state plainly what the AI should do. Under Constraints, list any requirements, format, tone or limits as short lines starting with "- ".`,
    `Omit a section only if the notes truly contain nothing for it.`,
    `Preserve every fact and instruction the user gave. Do not invent requirements or add new scope.`,
    `Write in ${name}.`,
    `Output ONLY the structured prompt. No preamble, no explanation, no surrounding quotes or code fences.`,
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
  const dialect = ['UK', 'FR'].includes(body?.dialect) ? body.dialect : 'US';
  const tone = (body?.tone ?? 'neutral').toString().toLowerCase();
  const mode = body?.mode === 'prompt' ? 'prompt' : 'polish';

  if (!text.trim()) return json({ error: 'Please enter some text to polish.' }, 400);
  if (text.length > 12000) return json({ error: 'Text is too long (max ~12,000 characters).' }, 400);

  const apiKey = process.env.OPENROUTER_API_KEY || import.meta.env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: 'Server is missing OPENROUTER_API_KEY.' }, 500);

  const system = mode === 'prompt' ? buildPromptSystem(dialect) : buildSystemPrompt(dialect, tone);

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
