# AIFeed.run — Claude Project Instructions
**Last updated: May 11, 2026 (session 20)**

> Read this file at the start of every session. Rules here override everything.

---

## What This Project Is

AIFeed.run is an automated AI news brand. Daily: scrapes headlines → user picks via Telegram → generates branded graphics → posts to Instagram/LinkedIn → publishes to website.

- **Website:** https://aifeed.run (GitHub Pages, repo: `xavidalmau9/aifeed`)
- **Repo path:** `/Users/305partners/aifeed/`
- **Key files:** `index.html`, `post.html`, `_posts/posts-index.json`, `images/`, `graphics/`
- **n8n workflows:** `/Users/305partners/Desktop/n8n Workflows/` (cloud-hosted, not local)
- **Google Sheet:** `1BCTHLe5ExoFwLMnQuayVWsVI8hBKfD7u54FiHGv_7rs` ("AIFeed Posted Headlines")
- **Telegram bot token:** `8738655145:AAE1jUkC4n_Gq2jmyAsNQU_cQpJGDJFLuWA`
- **Telegram chat ID:** `7748417469`

---

## Current State (May 11, 2026 — session 20)

- **posts-index.json:** 88 posts
- **videos-index.json:** 22 videos
- **Story List:** ✅ DEPLOYED
- **Story Selector:** ⚠️ NEEDS RE-IMPORT — `AIFeed Story Selector NEW.json` on Desktop (May 8 version with urls.regular fix, Eastern timezone date, publish command)
- **Website publisher (n8n):** RETIRED — disabled
- **GitHub Action `publish-stories.yml`:** ✅ LIVE (midnight backup from Google Sheet)
- **GitHub Action `render-graphics.yml`:** ✅ LIVE (renders PNGs, saves pending_story.json, sends HTML to Telegram)
- **Video sync cron:** ✅ ACTIVE — 2pm daily

---

## PUBLISH FLOW — MANUAL APPROVAL ONLY (PERMANENT — never revert)

**Stories NEVER auto-publish. Locked May 6, 2026.**

1. User picks story (`1`–`10` in Telegram)
2. n8n builds HTML, uploads to `graphics/` on GitHub
3. GitHub Action renders PNG → saves `_data/pending_story.json` → sends HTML to Telegram: **"Reply publish to add to website"**
4. User opens HTML in Chrome, checks graphic
5. User replies **`publish`** in Telegram
6. Story Selector reads `pending_story.json`, adds to `posts-index.json`
7. Website live in ~10 min

**Telegram commands:** `1–10` pick | `regen` new photo | `publish` go live | `more` see 6–10

**render-graphics.yml must NEVER write to posts-index.json.** Only the Story Selector "publish" command may do this.

---

## n8n Workflows

| File (on Desktop) | Status | Notes |
|---|---|---|
| `AIFeed Story List NEW.json` | ✅ DEPLOYED | 19 feeds, 48hr window, all-time Sheet1 dedup |
| `AIFeed Story Selector NEW.json` | ⚠️ NEEDS RE-IMPORT | urls.regular fix, Eastern timezone, publish command |
| `aifeed website publisher.json` | RETIRED | Disabled in n8n |

**n8n rules:**
- Never use `fetch()` in Code nodes — always `this.helpers.httpRequest()`
- Always edit workflow JSON with Python `json.load/dump`, never the Edit tool on jsCode
- Always report file modification timestamp after editing (`ls -la`)
- n8n is cloud-hosted — cannot update via localhost

---

## Google Sheet Structure

**Spreadsheet:** `1BCTHLe5ExoFwLMnQuayVWsVI8hBKfD7u54FiHGv_7rs`
**7 columns only:** `Headline | Date | Caption | ImageURL | SourceURL | LinkedInCaption | Status`
- Caption = Instagram text; LinkedInCaption = website body text (always use LinkedInCaption)
- Never add Pexels or removed columns back

---

## Photo System

### n8n photo tiers (in order):
1. **Named person** → Wikipedia portrait (`/api/rest_v1/page/summary/{Name}` → `thumbnail.source`)
2. **Unsplash search** → use `photo.urls.regular` (direct CDN URL — no redirect)
3. **Hardcoded fallback** → `https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1080&h=1350&fit=crop&q=85&fm=jpg`

All photos must be **base64-embedded** in HTML before upload to GitHub. External URLs = black background in GitHub Action.

### Unsplash URL rules (CRITICAL):
- **CDN URLs** (`images.unsplash.com/photo-...?w=...`) → download directly with curl, **never convert to `/download?force=true`**
- **Bare page URLs** (`unsplash.com/photos/[id]` — no query params) → must convert to `/download?force=true`
- Always use `photo.urls.regular` from the API — this is already a CDN URL

### Wikimedia photo rules:
- **Thumbnail URLs are BLOCKED** (`/thumb/.../Npx-...`) — returns 2171 bytes regardless of headers
- **Original file URL works:** `https://upload.wikimedia.org/wikipedia/commons/[hash]/[filename]`
- Crop to 1080×1350 with Pillow after download
- **Sam Altman portrait:** `https://upload.wikimedia.org/wikipedia/commons/f/f8/Sam_Altman_TechCrunch_SF_2019_Day_2_Oct_3_%28cropped_3%29.jpg`

### Unsplash credentials:
- **Access Key:** `dINF0W5ORDZVQlce-BlLgncgVTfTJLlEvAWKBlxaSGQ`
- API: `GET https://api.unsplash.com/search/photos?query=...&orientation=portrait&per_page=3`
- Header: `Authorization: Client-ID dINF0W5ORDZVQlce-BlLgncgVTfTJLlEvAWKBlxaSGQ`

### Manual graphic fix procedure (when n8n photo embedding fails):
1. Download story-appropriate photo with curl from Unsplash CDN
2. Base64-encode and inject: `<img class="bg" src="data:image/jpeg;base64,...">`
3. Render PNG locally with puppeteer (already installed in `/Users/305partners/aifeed/`)
4. Copy PNG to `images/` and to Desktop
5. Add story to `posts-index.json` with correct imageUrl
6. Commit and push

---

## Branded Graphic Spec

**Canvas:** 1080×1350px | **Font:** Poppins (Google Fonts CDN in HTML)

**Colors:**
- Purple accent: `#a050ff`
- Orange accent: `#ff8c00`
- Background: `#04020e`
- White text: `#ffffff`
- Muted text: `#d2d2e1`

**Fixed layout:**
- Pill (top-left, y=44): `AIFEED.RUN  •  AI NEWS` — gradient orange→purple
- Headline block (y=670): 82px bold Poppins, line-height 94px — first line white, second purple, third white
- Purple underline bar: 54×5px
- Subtitle: 33px, color `#d2d2e1`
- 3 stat cards (y=1130): purple/green/orange borders, dark bg
- Footer bar (bottom, h=68): source left, `aifeed.run` logo right

**HTML structure:** `<div class="c"><img class="bg" src="data:image/jpeg;base64,..."><div class="ov">...</div>...</div>`

**AIFEED_META comment** must be embedded in every HTML:
```
<!-- AIFEED_META:{"headline":"...","liCaption":"...","sourceUrl":"...","date":"YYYY-MM-DD"} -->
```

---

## Website Post Format (MANDATORY)

Every entry in `posts-index.json` MUST have:

```json
{
  "id": "[slug]-YYYYMMDD",
  "slug": "[hyphenated-headline]",
  "headline": "...",
  "summary": "One sentence.",
  "body": "<p><strong>First sentence bold.</strong> Rest of paragraph.</p>...<p style=\"color:#8c8ca0;font-size:0.9em\">Source: Name · <a href=\"URL\" target=\"_blank\" rel=\"noopener\" style=\"color:#a050ff\">URL</a></p><p class=\"article-tags-inline\"><a href=\"index.html?tag=Tag\" class=\"article-tag\" style=\"color:#a050ff\">#Tag</a></p>",
  "category": "[see list below]",
  "hashtags": ["Tag1", "Tag2"],
  "imageUrl": "https://aifeed.run/images/[filename].png",
  "sourceUrl": "https://...",
  "publishedAt": "YYYY-MM-DDTHH:MM:SS.000-04:00",
  "isVideo": false
}
```

**Rules:**
- `body` = **exact LinkedIn caption text** — never summarize or shorten
- Source URL = proper `<a>` hyperlink, never plain text
- Hashtag spans = clickable `<a>` tags linking to `index.html?tag=...`
- `hashtags` array must be present for tag filtering to work

### Categories (must match exactly — each has a colored pill):
| Category | Color |
|---|---|
| Models | Orange |
| Tools | Green |
| Industry | Purple |
| Research | Blue |
| Products | Yellow |
| Business | Rose |
| Hardware | Cyan |
| Safety | Red |
| Health | Teal |
| Infrastructure | Indigo |

**Adding a new category:** Add `.cat-X` and `.tag-x` CSS to BOTH `index.html` AND `post.html`, and add a tag bar entry to `index.html`.

---

## Videos (PERMANENT RULES — never ask user about this)

- Branded videos in `~/Downloads/` as `aifeed_branded_*.mp4`
- LinkedIn captions at `~/Downloads/caption_linkedin_[timestamp].txt`
- Add: copy to `aifeed/videos/` → add entry to `videos-index.json` → commit & push
- Current count: **22 videos**
- Video sync cron: active at 2pm daily

---

## Caption Format (MANDATORY)

**Source line = full URL always:**
- ✅ `Source: CNBC · https://www.cnbc.com/full/url`
- ❌ `Source: CNBC · cnbc.com`

**Instagram:** Hook emoji → spacers between paragraphs → 4–5 punchy paragraphs → Source → 8–10 hashtags. 150–220 words.

**LinkedIn:** Bold opener → 5–6 analytical paragraphs → Source → 5–7 hashtags. 350–450 words.

---

## GitHub Actions

| Action | Purpose |
|---|---|
| `render-graphics.yml` | Renders PNGs from `graphics/*.html`, saves `pending_story.json`, sends HTML to Telegram |
| `publish-stories.yml` | Midnight publisher from Google Sheet (backup). Fixed 307 redirect bug May 2. |
| `fix-missing-images.yml` | Hourly: fills blank imageUrls in posts-index.json |

**render-graphics.yml photo logic:**
- Finds `<img class="bg" src="...">` in HTML
- If already base64 → skips download
- If CDN URL (`images.unsplash.com/photo-...?...`) → downloads directly with curl
- If bare Unsplash page URL (`unsplash.com/photos/[id]` only) → converts to `/download?force=true`
- Embeds photo as base64, renders PNG, saves pending_story.json

---

## What NOT To Do

- **Never auto-publish** — always require "publish" in Telegram
- **Never write to posts-index.json from render-graphics.yml** — only Story Selector publish command
- **Never use PNG delivery to Telegram** — HTML sendDocument only
- **Never use `fetch()` in n8n Code nodes** — always `this.helpers.httpRequest()`
- **Never use Pexels** — Unsplash or Wikimedia only
- **Never convert Unsplash CDN URLs to `/download?force=true`** — only bare page URLs need converting
- **Never use Wikimedia thumbnail URLs** — use original file URL only
- **Never summarize LinkedIn captions** — use exact text in post body
- **Never add a post without `hashtags` array and clickable links**
- **Never add a new category without CSS in both index.html + post.html + tag bar entry**
- **Never use `parseFloat()` on n8n data** — not applicable here but keep in mind
- **Never push API keys/tokens to repo**
- **Never use `toISOString()` for dates** — use Eastern timezone: `new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'})`
- **Never edit n8n workflow JSON with the Edit tool** — use Python json.load/dump

---

## Website Cache

`max-age=600` (10 min). If changes not visible: **Cmd+Shift+R** to hard refresh.

---

## Affiliate Links (in website footer/sidebar)

- ElevenLabs: `https://try.elevenlabs.io/qspw8v1gx7n0`
- HeadshotPro: `https://www.headshotpro.com/?via=aifeed`
- Beehiiv: `https://www.beehiiv.com/?via=ai-feed`
- Writesonic: `https://writesonic.com`
- Surfer SEO: `https://surferseo.com`
- Munch: `https://www.munch.studio`
- HubSpot AI: `https://hubspot.com/artificial-intelligence`
- Accreative: `https://accreative.ai`
- DeepArt Effects: `https://www.deeparteffects.com`
- Perplexity: `https://www.perplexity.ai`

---

## Favicon

Inline SVG in `<head>` — black rounded square with purple `a`. No external file.
