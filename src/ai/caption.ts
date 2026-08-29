/**
 * Caption draft: a sealed photo's pixels → one suggested caption.
 * The caption is mutable metadata (it was never part of the seal), so an
 * AI draft here is safe — and the human edits or discards it before saving.
 */
import { generateJson, type FilePart } from './gemini.ts';

const SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description:
        'One plain sentence a contractor would write: what work or condition the photo shows.',
    },
  },
  required: ['caption'],
} as const;

const PROMPT = `You caption job-site photos for a contractor's records.
Write ONE short, factual sentence describing the visible work or condition —
the way a tradesperson would put it in a report. Name the trade subject when
clear (e.g. "Rough-in plumbing complete in the north wall", "Water staining on
subfloor near the sill"). No speculation about causes, no opinions on quality,
no fluff.`;

export async function draftCaption(photo: FilePart): Promise<string> {
  const out = await generateJson<{ caption: string }>(PROMPT, [photo], SCHEMA);
  return out.caption.trim();
}
