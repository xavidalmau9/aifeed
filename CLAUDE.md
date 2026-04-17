# AIFeed.run — Claude Project Instructions
**Last updated: April 16, 2026**

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
- **Never let headline lines exceed 15 characters** — at 82px Poppins Bold, lines over 15 chars risk wrapping to an extra line, which pushes subtitle into cards. Hard cap: 15 chars per line.
- **Never use more than 3 headline lines** — 3 lines × 94px = 282px, leaving room for subtitle before cards at top:1130px. 4 lines = 376px, subtitle crowding guaranteed.
- **Never use font-size:28px for subtitle** — always use 33px/46px line-height to match n8n workflow exactly
- **Never use a different pill CSS than the canonical spec** — pill must always be: `height:52px; border-radius:26px; padding:0 28px; font-size:28px; background:linear-gradient(to right,#ff8c00,#a050ff)`. No other values.
- **Never render with Chrome headless at `--window-size=1080,1350`** — bar is cut. Always use `--window-size=1080,1500` + Pillow crop to 1350
- **Never move spec positions (headline, cards, bar) to fix Chrome rendering** — fix the viewport, not the layout
- **Always use `/tmp/make_all_graphics.py` as the single canonical script** — never create a second script with different CSS
- **Never use Google Fonts CDN `<link>` in Chrome headless HTML** — fonts will not load. Always use `@font-face` with `file:///tmp/poppins-*.woff2` local files. This was the root cause of the pill rendering wrong for months.
- **Always verify `/tmp/poppins-300.woff2`, `/tmp/poppins-400.woff2`, `/tmp/poppins-700.woff2` exist before running any graphic script** — if missing, re-download them (URLs in the Poppins Font section above)
- **Never use Google Fonts CDN `<link>` in Chrome headless** — Chrome headless cannot load external fonts from the CDN, causing Poppins to fall back to a system font and making the pill and all text render incorrectly. Always use local `@font-face` with `file://` URIs.

---

## Poppins Font — LOCAL FILES ONLY (CRITICAL)

**Chrome headless cannot load Google Fonts from the CDN.** Without Poppins, the pill renders in a system fallback font (Helvetica/Arial) at different dimensions — this is why the pill looked wrong even when the CSS values were correct.

**Step 1 — Download fonts to /tmp (run once, or verify they exist):**
```bash
curl -sL "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLDz8Z1xlFd2JQEk.woff2" -o /tmp/poppins-300.woff2
curl -sL "https://fonts.gstatic.com/s/poppins/v24/pxiEyp8kv8JHgFVrJJfecnFHGPc.woff2"    -o /tmp/poppins-400.woff2
curl -sL "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7Z1xlFd2JQEk.woff2" -o /tmp/poppins-700.woff2
# Verify: all three should be ~7-8KB
ls -la /tmp/poppins-*.woff2
```

**Step 2 — Use this FONT_CSS in every HTML template (replaces the Google Fonts `<link>`):**
```css
@font-face{font-family:'Poppins';font-weight:300;font-style:normal;src:url('file:///tmp/poppins-300.woff2') format('woff2')}
@font-face{font-family:'Poppins';font-weight:400;font-style:normal;src:url('file:///tmp/poppins-400.woff2') format('woff2')}
@font-face{font-family:'Poppins';font-weight:700;font-style:normal;src:url('file:///tmp/poppins-700.woff2') format('woff2')}
```

**NEVER use this in Chrome headless:**
```html
<!-- ❌ WRONG — CDN font will not load in headless -->
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;700&display=swap" rel="stylesheet">
```

The canonical script `/tmp/make_all_graphics.py` already has `FONT_CSS` set correctly. Any new script must do the same.

---

## Chrome Headless Rendering — CRITICAL FIX

**The bar at `bottom:0` is NEVER rendered when Chrome headless uses `--window-size=1080,1350`.**

Chrome headless clips content at ~y=1270px when window height = canvas height. The bottom bar sits at y=1282–1350 and is therefore invisible in any headless screenshot taken at 1080×1350.

**The fix — always use this when generating graphics programmatically:**
```bash
# Step 1: Render at 1500px tall so bottom:0 bar is within viewport
chromium --headless=new --no-sandbox --screenshot=/tmp/out.png \
  --window-size=1080,1500 --hide-scrollbars file:///tmp/graphic.html

# Step 2: Crop to exact spec size
python3 -c "
from PIL import Image
img = Image.open('/tmp/out.png')
img.crop((0, 0, 1080, 1350)).save('/path/to/final.png')
"
```

**Why:** The `.c` container is `position:absolute; height:1350px`. With a 1500px viewport, Chrome renders all 1350px including the bar. Then Pillow crops back to spec.

**NEVER move spec positions to work around this.** Do NOT push elements up. Do NOT change `top:670px`, `top:1130px`, or `bottom:0`. The fix is the viewport height — not the layout.

**This only applies to programmatic Chrome rendering.** Opening the HTML in a real browser (the normal n8n workflow) renders the bar correctly — no fix needed.

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

---

## Favicon

Inline SVG data URI in `<head>` of both `index.html` and `post.html` — brand dark (`#04020e`) rounded square with a subtle purple border ring and bold purple (`#a050ff`) lowercase **a** at 72px Arial Black. No external file needed.

```html
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%2304020e'/%3E%3Crect width='100' height='100' rx='18' fill='none' stroke='%23a050ff' stroke-width='4' stroke-opacity='0.4'/%3E%3Ctext x='50' y='76' font-family='Arial Black,Arial,sans-serif' font-weight='900' font-size='72' fill='%23a050ff' text-anchor='middle'%3Ea%3C/text%3E%3C/svg%3E">
```
