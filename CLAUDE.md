# AIFeed.run — Claude Project Instructions
**Last updated: April 2026**

> This file is read by Claude at the start of every session. Update it whenever significant decisions are made.

---

## What This Project Is

AIFeed.run is an automated AI news brand. Every day it:
1. Scrapes AI headlines, scores them, picks the best 5
2. Fetches stock photos, generates branded graphics
3. Posts to Instagram/LinkedIn with captions
4. Publishes articles to the website

- **Website:** https://aifeed.run (GitHub Pages, repo: `xavidalmau9/aifeed`)
- **Repo files:** `index.html`, `post.html`, `_posts/posts-index.json`, `images/`
- **n8n workflows:** on Desktop at `/Users/305partners/Desktop/AIFeed *.json`
- **Google Sheet:** `1BCTHLe5ExoFwLMnQuayVWsVI8hBKfD7u54FiHGv_7rs` ("AIFeed Posted Headlines")
- **Telegram bot token:** `8738655145:AAE1jUkC4n_Gq2jmyAsNQU_cQpJGDJFLuWA`
- **Telegram chat ID:** `7748417469`

---

## n8n Workflows (all JSON files live on Desktop)

| File | Purpose | Trigger |
|------|---------|---------|
| `AIFeed Story List NEW.json` | Scrapes RSS feeds, scores headlines with Claude, writes top 5 to Staging tab, sends Telegram menu | Scheduled daily |
| `AIFeed Story Selector NEW.json` | Telegram bot — user picks story 1-5, fetches Pexels photos, generates branded HTML graphic, writes captions, marks APPROVED in sheet | Telegram webhook |
| `AIFeed Website Publisher NEW.json` | Reads approved rows from Sheet1, calls Claude for article body, pushes to `_posts/posts-index.json` on GitHub | Scheduled daily |
| `AIFeed Sheet Setup (run once).json` | One-time setup — creates Staging tab, adds columns to Sheet1 | Manual |
| `AIFeed Auto Story.json` | Alternate auto-approval flow | — |
| `AIFeed Viral Story Monitor.json` | Monitors for viral AI stories | — |

### Credentials used across workflows
- `googleSheetsOAuth2Api` → id `Pn4GHALjOUe1z0lv`
- `telegramApi` → id `Ga8Ugfyy9ba2yvSy`
- GitHub token: in workflow code (kept local, never push to GitHub)
- Anthropic API key: in workflow code (kept local, never push to GitHub)

---

## Google Sheet Structure

**Sheet1** (posted headlines) columns:
`Date | Headline | SourceURL | Caption | ImageURL | LinkedInCaption | AltImageURL | Status`

**Staging** tab columns:
`Rank | Headline | Link | Score | Reason`

**Status values:** `PENDING_GRAPHIC` → `APPROVED`

---

## Story Selector Bot — How It Works

User interacts via Telegram:
1. Daily: bot sends 5 headlines to choose from
2. User replies `1`–`5` → bot fetches 2 Pexels photo options + sends them
3. User replies `img1`, `img2`, or `skip` → generates branded HTML graphic + Instagram/LinkedIn captions
4. User can reply `custom` → bot asks for a photo → user sends photo → custom photo flow runs
5. HTML graphic sent as `.html` file via Telegram → user opens in browser, screenshots at 100% zoom

### Custom Photo Flow (node: Process & Upload Photo — b1000027)
1. Gets Telegram file path via `getFile` API
2. Constructs `telegramUrl` — **declared OUTSIDE the try block**
3. **Immediately sets `imageUrl = telegramUrl`** — guaranteed fallback before any download attempt
4. Downloads photo using `this.helpers.httpRequest()` (not `fetch()`) — for GitHub base64 only
5. Tries GitHub upload — if successful, upgrades `imageUrl` to permanent GitHub URL
6. If download OR GitHub fails — Telegram URL already set, graphic still works

**CRITICAL:** `telegramUrl` must be declared outside the try block and `imageUrl` must be set from it immediately in step 3. If this is not done, any download failure will leave `imageUrl = ''` and the graphic will have a blank background. This was the bug that caused blank images — do not revert this structure.

---

## Branded HTML Graphic — THE SPEC

**See `GRAPHIC_SPEC.md` in this repo for the full canonical spec.**

Quick reference:

### Fonts
Poppins ONLY — weights 300, 400, 700. Never Syne, never Inter.

### Colors
| | Hex |
|-|-----|
| Purple | `#a050ff` |
| Orange | `#ff8c00` |
| Green | `#32d76e` |
| Dark BG | `#04020e` |
| Card BG | `rgba(15,5,35,.82)` |
| Subtitle text | `#d2d2e1` |
| Card labels | `#b4b9c8` |
| Source text | `#8c8ca0` |
| Bar BG | `rgba(0,0,4,.92)` |

### Fixed Pixel Positions (1080×1350px canvas)
- Pill badge: `top:44px; left:44px`
- Headline block `.hb`: `top:670px; left:54px; right:54px; max-height:455px`
- Headline font: `82px / line-height:94px` (NOT 90px — 90px wraps long phrases)
- Stat cards: `top:1130px; left:54px` — 3 cards, 312×112px each, gap:27px
- Bottom bar: `bottom:0; height:68px`
- Source text: `left:54px; max-width:700px` with `text-overflow:ellipsis`
- Logo: `right:54px` (NOT 230px — 230px collides with long source domains)

### Logo
```html
<span class="bai">ai</span><span class="bfd">feed</span><span class="brn">.run</span>
```
"ai" = purple, "feed" = orange, ".run" = white

### Headline line rules
Each display line: **max 4 words, max 20 characters**. At 82px font, more than ~22 chars wraps.

### n8n nodes that contain the template
- `Build & Send Graphic` (id: b1000039) — stock photo flow
- `Build & Send Graphic Photo` (id: b1000042) — custom photo flow
- Both must always be identical. Any CSS change goes in both.

---

## What NOT to Do

- **Never push workflow JSON files to GitHub** — they contain API keys
- **Never use `right:230px` for the logo** — use `right:54px`
- **Never use 90px font** for headlines — use 82px
- **Never omit `max-height:455px`** on `.hb` — subtitle will overflow into stat cards
- **Never use wrong colors** (#a855f7 for purple, #f97316 for orange, #22c55e for green, #09081a for bg — all wrong)
- **Never use Syne or Inter** — Poppins only
- **Never set `object-position:center`** on background image — always `top center`
- **Never let headline lines exceed 20 characters** — enforce in Claude prompt

---

## Preview / Testing

Test file: `/Users/305partners/Downloads/aifeed-preview.html`
Open in browser at **100% zoom** (Cmd+0). Canvas is exactly 1080×1350.
Screenshot with browser devtools at 100% → save as PNG for posting.

---

## Website Publisher

Reads Sheet1 rows where `Status = APPROVED`, calls Claude claude-3-haiku for article body, merges with existing `_posts/posts-index.json`, pushes to GitHub. Runs nightly.

Post format in posts-index.json:
```json
{
  "id": "slug-YYYYMMDD",
  "slug": "short-slug",
  "headline": "...",
  "summary": "...",
  "body": "<p>...</p>",
  "category": "Models|Tools|Industry|Research|Products",
  "imageUrl": "https://aifeed.run/images/...",
  "sourceUrl": "...",
  "publishedAt": "ISO date",
  "isVideo": false
}
```
