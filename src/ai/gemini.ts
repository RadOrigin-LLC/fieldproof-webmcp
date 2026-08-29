/**
 * Gemini client — every AI call in the app goes through this file.
 * BYO key saved by the user under More → Writing help.
 * Hard boundary: AI drafts words. It never touches timestamps, GPS,
 * hashes, or photo bytes at rest — the seal is untouchable.
 */
import { deleteMeta, getMeta, setMeta } from '../data/repo.ts';

const MODEL = 'gemini-flash-lite-latest';
const KEY_META = 'gemini_api_key';

export async function getGeminiKey(): Promise<string | null> {
  return (await getMeta<string>(KEY_META)) || null;
}

export async function setGeminiKey(key: string | null): Promise<void> {
  if (key === null) await deleteMeta(KEY_META);
  else await setMeta(KEY_META, key);
}

export async function isAiConfigured(): Promise<boolean> {
  return (await getGeminiKey()) !== null;
}

export interface FilePart {
  mimeType: string;
  bytes: Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** One structured-output call. Photos go up for one inference, never stored. */
export async function generateJson<T>(
  prompt: string,
  files: FilePart[],
  schema: object,
): Promise<T> {
  const key = await getGeminiKey();
  if (!key) throw new Error('No AI key configured. Add one under More → AI drafts.');

  const parts: unknown[] = [{ text: prompt }];
  for (const f of files) {
    parts.push({ inlineData: { mimeType: f.mimeType, data: toBase64(f.bytes) } });
  }

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.2,
          },
        }),
      },
    );
  } catch {
    throw new Error('No connection — AI drafts need a signal. Everything else still works.');
  }

  if (res.status === 429) throw new Error('AI quota reached — try again in a minute.');
  if (res.status === 400 || res.status === 403)
    throw new Error('The AI key was rejected. Check it under More → AI drafts.');
  if (!res.ok) throw new Error(`AI call failed (${res.status}).`);

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('The AI returned nothing usable.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('The AI response was not valid JSON.');
  }
}
