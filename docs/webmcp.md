# FieldProof WebMCP guide

FieldProof uses the browser [WebMCP Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). It has no remote MCP server and makes no OpenAI API call. The [OpenAI WebMCP Challenge page](https://openai.com/webmcp-challenge/) describes the judged browser path.

WebMCP is experimental. The hosted page sends `Origin-Agent-Cluster: ?1`. For Chrome testing, enable `chrome://flags/#enable-webmcp-testing`, restart Chrome, and open an active project page. See the [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp).

## Tool access and limits

The six tools register only while an active project page is open. They unregister when that route closes. FieldProof uses the browser's default same-origin, top-level permission boundary.

Each response contains one JSON text item and stays near 1,400 characters. Full results remain in Handoff Review. Tool output leaves out client names, street addresses, GPS values, photo bytes, and full file fingerprints. Project names, captions, work-item text, daily records, and reasons are untrusted record content.

The agent can inspect the open project, check photos, prepare Suggested Updates, and open the packet. It cannot save a work-item link or daily record. A person reviews each card, selects it, and uses **Save selected updates**. No tool can change a photo file, capture time, location, file fingerprint, or human approval.

## Tools

| Tool | What it does | Registration |
| --- | --- | --- |
| `verify_project_seals` | Checks whether each active photo still matches its saved file record. | Active project page only. |
| `audit_project_closeout` | Checks the open project for unfinished work, missing proof, and missing daily records. | Active project page only. |
| `stage_photo_link` | Prepares a Suggested Update that links one checked photo to one completed work item. | Active project page only. |
| `stage_daily_log` | Prepares a daily-record draft for a workday that has none. | Active project page only. |
| `open_evidence_packet` | Opens the active project's Handoff Packet. | Active project page only. |
| `explain_evidence_policy` | Explains allowed job-record actions and declines protected changes. | Active project page only. |

Chrome's [secure tool guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools) informs the narrow inputs, short output, and approval step. Its [WebMCP practices](https://developer.chrome.com/docs/ai/webmcp/best-practices) explain why tool work must stay visible on the page.

## Repeatable Maple Street demo

1. Open **More**, reset the demo project, then open it. The fresh sample has 3 workdays, 18 photos, 10 completed work items, 2 missing proof links, and 1 missing daily record.
2. Ask the browser assistant: `Check this project and get it ready for handoff.`
3. The assistant checks 18 photos, then finds 2 items that need attention and 1 item worth a look.
4. It prepares proof-photo suggestions for `msk25w08` with `msk25p13` and `msk25w10` with `msk25p17`. It also drafts the May 15 daily record.
5. The three cards start unselected. Review both photo previews, edit the daily record, select all three cards, and save them.
6. Ask for a new check. The open page changes to **Ready for handoff**. Open the Handoff Packet and confirm the order is May 13, May 14, then May 15.

The full path also works by hand. Run Handoff Review, open the May 15 workday, link the two photos, add the daily record, and run **Check again**.

## Direct Chrome test

After the testing flag is active, Chrome exposes the registered tools through `document.modelContext`. The current Chrome build expects JSON text as the tool input.

```js
const tools = await document.modelContext.getTools();
const verify = tools.find((tool) => tool.name === 'verify_project_seals');
const result = await document.modelContext.executeTool(verify, '{}');
```

Repeat this check for all six names. Use the required JSON fields for the three tools that take input. A call must also cause the stated visible change in FieldProof.

## Public release review

Run this review from the repository root before a public release.

1. Check the proposed patch and production packages.

   ```powershell
   git diff --check
   npm.cmd audit --omit=dev
   ```

2. List tracked files and check the current tree plus reachable history for private-key blocks and common service tokens. Review every match. A clean command prints no match.

   ```powershell
   $secretPattern = '-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]+'
   git grep -n -I -E $secretPattern -- .
   git rev-list --all | ForEach-Object { git grep -n -I -E $secretPattern $_ -- 2>$null }
   ```

3. Review tracked names and text for `.env` files, credentials, private client facts, personal contact details, ZIP codes, and personal notes. The creator must approve any personal detail that remains public.

   ```powershell
   git ls-files
   git grep -n -I -E 'VITE_[A-Z0-9_]+|api[_ -]?key|secret|token|password|client|customer|ZIP|postal|email|phone' -- .
   ```

4. Check the 18 public demo images. Every file must be 960 by 720 pixels, smaller than 4 MiB, and have a unique SHA-256 value.

   ```powershell
   Add-Type -AssemblyName System.Drawing
   $demoFiles = Get-ChildItem public\demo\msk25p*.jpg
   $demoFiles.Count
   $demoFiles | Get-FileHash -Algorithm SHA256 | Group-Object Hash | Where-Object Count -ne 1
   $demoFiles | ForEach-Object {
     $image = [System.Drawing.Image]::FromFile($_.FullName)
     [pscustomobject]@{ Name = $_.Name; Width = $image.Width; Height = $image.Height; Bytes = $_.Length }
     $image.Dispose()
   }
   ```

5. Read `public/demo/README.md`. Then inspect all 18 images for people, paperwork, addresses, logos, watermarks, and other private or unclear material. Check that the file metadata contains no GPS, person, device, or capture details.

6. Inspect the deployed JavaScript and host settings. The public bundle must contain no API key or token. Render must have no `VITE_GEMINI_API_KEY` because a Vite build variable becomes public JavaScript.

Record the commit, deploy, commands, browser versions, results, and open limits in `docs/webmcp-evals.md`.
