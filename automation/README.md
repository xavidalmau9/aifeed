# AIFeed autopilot (n8n) — source

The live publisher is GitHub Actions. See `ACTIONS_SETUP.md`. The n8n workflow to import as a fallback (8:50am / 5:50pm ET, same slot-claim file) is `n8n/AIFeed_Autopilot.json`, not the older JSON in this folder.

No secrets live here. Credentials (GitHub, Anthropic, Meta/Instagram, Telegram, LinkedIn) are stored only in n8n's
encrypted credential store on the automation box; the workflow JSON references them by id/name.

- `build.py` builds `AIFeed_Autopilot.json` (+ `AIFeed_Error_Alerts.json`) from the node code in `js/`.
  Run `python3 build.py`, then import with `n8n import:workflow --input=AIFeed_Autopilot.json` and activate.
- Schedule: `0 8,17 * * *` America/New_York (8am = #1 story, 5pm = best story not yet posted).

## Never-repeat rule (dedupe)
Every run loads the full posted history before choosing a story:
1. Website: `_posts/posts-index.json` (every story on aifeed.run). Required: if it cannot be loaded
   (GitHub API, raw, live site; each retried), the run stops and nothing is posted.
2. Instagram: last 100 @aifeed.run captions via Graph API (`Source:` URL + first line). Retried once; if it fails the
   run continues with website + log only.
3. Workflow log: `_data/history.json` (`posted[]`), written after each automated post.

Checks per candidate, cheapest first:
- same normalized source URL (no scheme/www/m./query/utm/trailing slash/amp),
- fuzzy title match (Jaccard >= 0.6 after stopwords, or >= 3 shared words with 60% overlap within 120 days),
- semantic same-event check (Claude, temperature 0): same company + same announcement/incident as any story posted
  in the last 90 days, regardless of outlet or headline. Unreadable verdict = stop; unsure = repeat.
Repeats are skipped and the next candidate (pool of up to 15) is used; if all are repeats, the run fails safely
through the error workflow and nothing is posted.

## Accuracy rule
The caption prompt requires hedges from the source (considers, plans, reportedly, in talks, sources say, may, up to)
to be kept, nothing invented, and currency kept as written ($15B, never "15 BILLION"). A deterministic gate
(`checkAccuracy` in `js/captions_lib.js`, run per candidate in Quality Checks and again in Layout Check) rejects copy
where the source title/description is hedged but the graphic headline, summary or IG hook is not, or where a money
amount lost its `$`. The best candidate's copy is regenerated once ("Claude Fix Accuracy"); if it still fails, the
next candidate is used.

## Renderer
`js/renderer_server.js` (deployed as `renderer/server.js`) returns HTTP 400 on missing/invalid bodies instead of crashing.
