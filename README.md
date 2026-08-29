# FieldProof

FieldProof helps solo contractors and small crews keep a clear job record. Photos,
punch items, and daily logs stay together in one project. The app works without a
signal and keeps its records on your device.

When you take a photo, FieldProof saves the image with its capture time and location,
when available. It also saves a file fingerprint. A later check can show whether the
saved photo has changed.

FieldProof is a working title. A trademark and domain check is still due.

## What it does

- Take and caption job-site photos.
- Check whether a saved photo still matches the file captured on site.
- Void a photo with a reason while keeping it in the job record.
- Track open and completed punch-list work.
- Add one daily log for each project day.
- Print a one-day work report or a full handoff packet.
- Back up project details, logs, punch lists, and photos in one ZIP file.
- Draft captions and daily logs with an optional Gemini key. The user reviews each draft.

Project records stay on the device during normal use. If the user asks Gemini for a
caption, FieldProof sends that selected photo to Google for the draft. A daily-record
request sends the notes and photo captions used for that draft. FieldProof does not
contact clients, place offers in reports, or require an account.

## WebMCP handoff check

On a compatible page, a browser assistant can use six FieldProof tools. It can:

- check the saved project photos;
- check the project for unfinished work, missing proof, and blank daily logs;
- suggest a proof photo for a completed punch item;
- draft a missing daily log;
- open the handoff packet; and
- explain which job-record changes FieldProof allows.

Suggested updates wait for the user in Handoff Review. FieldProof saves only the
updates the user selects. The tools cannot change captured photos, capture times,
locations, file fingerprints, or the user’s approval.

Use the sample Maple Street Kitchen project for the repeatable demo. It starts with one
workday that has two missing proof links and one missing daily record. The full sample
has three workdays, 18 photos, and 10 completed work items.

## WebMCP Challenge release

The pre-contest FieldProof baseline is commit
`fba0e80fecb770d0de994a56e8d1cd2d4586a17c`. The contest work adds the Workday
Ledger, six browser-native WebMCP tools, photo checks, visible Suggested Updates, and
the synthetic Maple Street Kitchen demo. See the [WebMCP guide](docs/webmcp.md) and
the [manual evaluation log](docs/webmcp-evals.md).

Live demo: https://fieldproof-miee.onrender.com

Public source: https://github.com/RadOrigin-LLC/fieldproof-webmcp

Build locally with `npm ci && npm run build`. Render deploys this static site from
`render.yaml`: it builds to `dist`, rewrites app routes to `index.html`, and sends the
`Origin-Agent-Cluster: ?1` header for the WebMCP document requirement.

Safety facts: WebMCP tools work only for the open project, tool output excludes client
and sensitive photo facts, and proposed record changes need human approval. The demo
uses synthetic records and generated images with recorded rights. Optional Gemini
writing help is separate from the WebMCP handoff path.

## Design

The interface borrows from paper field forms. It uses blueprint blue, paper white,
IBM Plex Sans for normal text, IBM Plex Mono for recorded details, and yellow for the
camera control. See `docs/DESIGN.md`.

## Stack

Vite 7 · React 19 · TypeScript · Tailwind 4 · Dexie · React Router 7 · fflate ·
vite-plugin-pwa · Vitest · Playwright

IndexedDB is the source of truth. The current app has no account system, server, or
telemetry. `docs/sync-design.md` covers possible cloud sync and team features.

## Development

```bash
npm install
npm run dev        # Start the development server
npm test           # Run unit and integration tests
npm run e2e        # Run the Playwright browser test
npm run build      # Build the PWA
```

## Docs

- `docs/prd.md`: product requirements
- `docs/plan.md`: build plan
- `docs/DESIGN.md`: design rules
- `docs/sync-design.md`: possible cloud sync model
- `docs/research-2026-07.md`: market research notes
