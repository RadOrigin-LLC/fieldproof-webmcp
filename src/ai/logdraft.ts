/**
 * Daily-log draft: rough notes (+ today's photo captions for context) →
 * a clean narrative paragraph. Words only — the human reads and edits
 * before anything is saved.
 */
import { generateJson } from './gemini.ts';

const SCHEMA = {
  type: 'object',
  properties: {
    body: {
      type: 'string',
      description: 'The polished daily log entry, 1-2 short paragraphs, plain prose.',
    },
  },
  required: ['body'],
} as const;

export async function draftDailyLog(
  roughNotes: string,
  photoCaptions: string[],
): Promise<string> {
  const context =
    photoCaptions.length > 0
      ? `\n\nCaptions from today's sealed photos (context only):\n- ${photoCaptions.join('\n- ')}`
      : '';
  const prompt = `You write daily construction logs for a small contractor.
Turn the rough notes below into a clean, professional log entry: plain prose,
past tense, first person plural ("we"), 1-2 short paragraphs. Keep every fact
from the notes; add NOTHING that isn't in the notes or captions. No headings,
no bullet points, no corporate filler.

Rough notes:
${roughNotes}${context}`;
  const out = await generateJson<{ body: string }>(prompt, [], SCHEMA);
  return out.body.trim();
}
