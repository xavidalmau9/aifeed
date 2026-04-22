# AIFeed.run — Claude Project Instructions
**Last updated: April 22, 2026 (session 5)**

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

## ⚠️ CRITICAL RULES — READ BEFORE EVERY TASK ⚠️

These rules exist because of real mistakes that cost time and money. Do not skip them.

### 1. GRAPHIC GENERATION — MANDATORY CHECKLIST
**Before generating ANY graphic, in this exact order:**
1. `Read /Users/305partners/aifeed/GRAPHIC_SPEC.md` — every single time, no exceptions
2. Use the story's **existing background photo** if it already has one (e.g. if `imageUrl` contains `bg_pexels_*.jpg`, download that and use it — do not search Pexels for a new photo)
3. Only search Pexels for a new background if no background exists yet
4. Run md5 duplicate check against Background Registry before using any new photo
5. Render with `--window-size=1080,1500` + Pillow crop to 1350px

**Spec quick-ref (memorize these — they are non-negotiable):**
- **Pill**: `AIFEED.RUN • AI NEWS` — always this exact text, never just the category
- **Headline**: Three separate `<span>` elements — `.hw` (white), `.hp` (purple accent), `.hw` (white) — plus `.hu` purple underline bar underneath
- **Cards**: 3 cards, each with `position:relative`, emoji `.cv` at `top:10px` centered, label `.cl` at `top:66px` centered, colored border only: `.c1` purple `#a050ff`, `.c2` green `#32d76e`, `.c3` orange `#ff8c00` — NO value+label layout
- **Source bar**: `Source: NAME · domain.com` format — not just `domain.com`
- **Gradient overlay**: `rgba(4,2,14,.04) 0%, rgba(4,2,14,.65) 50%, rgba(4,2,14,.70) 100%` *(lightened Apr 21 — was .08/.86/.86, too dark)*

### 2. WEBSITE BODY TEXT — LinkedInCaption ONLY
- **`Caption` column = Instagram** — short, emojis, ⠀ spacers. NEVER use for website.
- **`LinkedInCaption` column = website** — always use this field for `body` in posts-index.json
- When Claude API is unavailable: apply `liToHtml()` to LinkedInCaption — never dump raw text
- `liToHtml()`: splits on `⠀` (U+2800), skips first segment (headline), skips Source: lines, wraps paragraphs in `<p>`, collects `#hashtags` → purple `<span style="color:#a050ff">` elements

### 3. EDITING n8n WORKFLOW JSON FILES
**Never use the Edit tool to modify JavaScript code inside a JSON `jsCode` string.**
The Edit tool does not handle JSON escaping — it will corrupt the file.
**Correct approach:** Use Python to `json.load()` → modify the `jsCode` string in memory → `json.dump()` back out. Always verify with `json.load()` after writing.

### 4. POSTS-INDEX.JSON CHANGES
After any edit to `_posts/posts-index.json`:
1. `git pull --rebase` first (the n8n publisher pushes commits — remote is often ahead)
2. If unstaged changes: `git stash → pull → git stash pop`
3. If stash pop conflicts with a file already on remote: move the file temporarily, pull, pop, restore
4. Commit and push

### 5. GOOGLE ANALYTICS
Tag ID: `G-38GGN8HYT6`. Installed in `<head>` of both `index.html` and `post.html`. Do not add again.

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

## Session 5 Changes (Apr 22, 2026)

### Videos — Fully Dynamic Pipeline (permanent fix)
- Created `videos/videos-index.json` — single source of truth for all videos (title, caption, source, sourceUrl, date)
- `index.html` now loads videos dynamically via `loadVideos()` fetching the index — **no more hardcoded video lists anywhere**
- Website publisher auto-discovers new `.mp4` files in `videos/` on GitHub at midnight and adds them to `videos-index.json`
- Publisher reads `caption_linkedin_[timestamp].txt` from Downloads when adding new videos — use the LinkedIn caption as-is, do NOT rewrite or summarize
- Video lightbox now shows title + LinkedIn caption + source below the player (`#lightbox-meta` div, `openLightbox(url, videoData)`)
- **Caption files live in `~/Downloads/` as `caption_linkedin_[timestamp].txt`** — always check there when a video has no description

### liToHtml() — Fixed for double-space captions
The fallback body parser now handles both `U+2800` (Braille blank) AND double-space-after-sentence separators. Also properly strips Source: lines, URLs, and hashtag-only lines without losing mid-sentence emphasis phrases.

**Rule:** When `liToHtml()` runs, it must:
1. Split only on double-spaces that follow `.!?` (sentence end) — never split on all double-spaces
2. Collect `#hashtags` to purple spans at the bottom
3. Never strip the hashtag paragraph — it must always appear

### Publisher — video caption auto-reader
When publisher discovers a new `.mp4` in `videos/`, it reads `~/Downloads/caption_linkedin_[ts].txt`:
- Line 1 → title (stripped trailing punctuation)
- All body lines (minus source, URLs, hashtag-only lines) → caption, joined as-is
- `Source: X` line → source name
- YouTube URL → sourceUrl

### posts-index.json — hashtags array
All posts now have a `hashtags: ["AINews", "Anthropic", ...]` array field extracted from the article body. This enables hashtag-based filtering on the website (future feature).

### Affiliate links registry (permanent)
| Tool | Affiliate URL | Notes |
|------|--------------|-------|
| ElevenLabs | `https://try.elevenlabs.io/qspw8v1gx7n0` | Active |
| HeadshotPro | `https://www.headshotpro.com/?via=aifeed` | Active |
| Beehiiv | `https://www.beehiiv.com/?via=ai-feed` | Active |
| AdCreative.ai | `https://free-trial.adcreative.ai/g944t536drtc` | 30% recurring — added Apr 21 |

**Never overwrite affiliate links with homepage URLs.** Check this table before editing any tool card.

### Pagination
- Stories: 15 per page (`POSTS_PER_PAGE = 15`)
- Videos: 4 per page (`VIDEOS_PER_PAGE = 4`)
- Category filter resets to page 1 on change

### AI Tools banner
Sticky banner between stats bar and stories section links to `#ai-tools`. Section header has `id="stories-top"`, tools section has `id="ai-tools"`.

### What NOT to do (additions)
- **Never hardcode video list in index.html** — always use `videos-index.json`
- **Never add videos to index with empty caption** — always check `~/Downloads/caption_linkedin_[ts].txt` first
- **Never paraphrase LinkedIn captions** — use the actual text as written (light editing for flow is OK, but keep the substance and tone)
- **Never strip hashtags when fixing post bodies** — hashtags must appear as purple spans at the bottom of every article
- **Never use the Edit tool on jsCode inside workflow JSON** — always Python json.load/dump

### Pending — to deploy in n8n (re-import both workflows)
1. `AIFeed Story Selector NEW.json` — broken connection fix, 3-term photo algorithm, auto-render PNG, 4 new nodes
2. `aifeed website publisher.json` — liToHtml() fix, video auto-discovery + caption reader, video index sync

---

## Session 4 Changes (Apr 20, 2026)

### Fixed — 5 posts with Instagram body text
Posts published Apr 17–19 had Instagram-style short captions as body text instead of proper article HTML. Root cause: the Website Publisher fallback (triggered when Anthropic API was out of credits) dumped `Caption` (Instagram field) directly as the body.

**Posts fixed** (body replaced with proper 5-paragraph article text + tags):
- `nvidias-oncetight-bond-with-gamers-cracking-20260419`
- `sam-altmans-project-world-looks-scale-20260418`
- `zuckerberg-reportedly-trades-headcount-for-compute-20260418`
- `beijing-brands-metas-manus-acquisition-conspiratorial-20260417`
- `anthropics-claude-opus-makes-big-leap-20260417`

### Fixed — Nvidia post had raw Pexels background
`nvidias-oncetight-bond-with-gamers-cracking-20260419` had `imageUrl: bg_pexels_1776621283733.jpg` (raw background, no branding). Created branded graphic `aifeed_nvidia.png` using the original background photo. Added to Background Registry.

### Fixed — Website Publisher workflow (`aifeed website publisher.json`)
Three bugs fixed in the `Fetch Build Push (APPROVED only)` code node:
1. **Field name**: Changed `item.json.Caption` → `item.json.LinkedInCaption` (with `Caption` as fallback). The website must ALWAYS use LinkedIn text, never Instagram text.
2. **Fallback body**: When Claude API fails, was dumping raw caption as `<p>raw text</p>`. Now runs `liToHtml()` which properly formats the caption into paragraphs and purple hashtag spans.
3. **Claude prompt**: Changed "INSTAGRAM CAPTION (for context)" → "LINKEDIN CAPTION (for context)".
4. **Added `liToHtml()`** function to the workflow code node. Splits on `⠀` (U+2800 Braille blank spacer used by Instagram/LinkedIn), skips first segment (headline), skips Source: lines and URLs, extracts hashtags to purple spans.

**To deploy:** In n8n → open "aifeed website publisher" → Settings → Import → select `/Users/305partners/Desktop/aifeed website publisher.json` (update in place, do NOT create a new workflow).

### GRAPHIC SPEC RULE (permanent — added to enforcement list)
**ALWAYS read `GRAPHIC_SPEC.md` before generating any graphic.** The spec defines pill content (`AIFEED.RUN • AI NEWS`), headline `.hw`/`.hp`/`.hu` color structure, card layout (emoji + label, absolute positioned, colored borders), and source format (`Source: NAME · domain.com`). Do NOT improvise from memory.

### Background Registry additions
| aifeed_nvidia.png | bg_pexels_1776621283733.jpg | unique (Pexels — GeForce GTX close-up, original story background) |

## Session 3 Changes (Apr 17, 2026)

### Website Image Bug — Root Cause and Fix

**Root cause:** The Story Selector workflow writes the raw Pexels URL to the `ImageURL` column in Google Sheets when marking a story APPROVED. The website publisher reads that column and uses it as `<img src>`. Pexels URLs are temporary/hotlink-blocked and not branded graphics.

**What the website needs:** A permanent URL hosted at `https://aifeed.run/images/` pointing to either the branded PNG graphic or the permanent background image.

**Fix applied (session 3):**
- Added new node **"Upload Pexels to GitHub"** (id: b1000050) between `Find Pending Row` and `Mark APPROVED` in the Story Selector workflow
- The new node downloads the chosen Pexels background image and uploads it to GitHub as `bg_pexels_[timestamp].jpg`
- Sets `imageUrl` to `https://aifeed.run/images/bg_pexels_[timestamp].jpg` (permanent)
- `Mark APPROVED` then stores this permanent URL in the sheet instead of the raw Pexels URL
- Fallback: if GitHub upload fails, uses original Pexels URL (workflow continues uninterrupted)

**Updated flow (stock photo):**
```
Find Pending Row → Upload Pexels to GitHub → Mark APPROVED → Send Approval Confirmation → Prep Graphic Data → ...
```

**4 posts manually fixed (Apr 17, 2026):**
- `beijing-brands-metas-manus-acquisition-conspiratorial-20260417` → `aifeed_china_manus.png`
- `anthropics-claude-opus-makes-big-leap-20260417` → `aifeed_anthropic.png`
- `sam-altmans-project-world-looks-scale-20260418` → `aifeed_sam_altman.png` (copied from "aifeed.run instagram posts" folder)
- `zuckerberg-reportedly-trades-headcount-for-compute-20260418` → `aifeed_zuckerberg.png` (copied from "aifeed.run instagram posts" folder)

**To deploy the workflow fix:**
1. Open n8n → Story Selector workflow
2. Settings → Import → select `/Users/305partners/Desktop/AIFeed Story Selector NEW.json`
3. **Do NOT activate the imported version as a new workflow** — update the existing one in-place to avoid duplicate Telegram webhooks
4. After import, verify the new "Upload Pexels to GitHub" node appears between "Find Pending Row" and "Mark APPROVED" and is connected correctly

**Manual override (while waiting for workflow fix):** If a new post has a Pexels URL showing, find the matching branded graphic in `~/Desktop/aifeed.run instagram posts/` or `~/Desktop/aifeed-images/`, copy it to `/Users/305partners/aifeed/images/`, update `imageUrl` in `_posts/posts-index.json`, commit and push.

---

## Session 2 Changes (Apr 17, 2026)

### Workflow Fixes (AIFeed Story Selector)
- **Critical broken connection** — `Get Selected Story` had NO outgoing connection. Fixed chain: `Get Selected Story → Fetch 4 Pexels Options → Prep Story Data`. This was why the workflow went silent after picking a story number — it fetched the story but had nowhere to send it.
- **webhookId reset** — Changed from hardcoded `"aifeed-selector-v2-webhook"` to a fresh UUID to clear Telegram webhook registration conflict after re-import.
- **4 photo options** — `Fetch 4 Pexels Options` now fetches `per_page=4`. Instructions show `img1`/`img2`/`img3`/`img4`/`custom`. Previously only 2 options.
- **"Here Is Your Next Story"** — Story List message no longer says "5PM Story Pick". Now just says "Here Is Your Next Story" since it runs at 8am, 5pm, and on-demand.
- **Custom photo message simplified** — "Custom photo uploaded!" no longer has "Captions coming" teaser since captions are already sent by that point.

### n8n Import Rule (CRITICAL)
When re-importing a workflow JSON into n8n, **it creates a NEW workflow** — it does NOT replace the existing one. If the old workflow is still active, you end up with two Telegram triggers on the same bot, causing a webhook conflict. Always:
1. Open the existing workflow in n8n
2. Use Settings → Import to update it in place
OR delete the old one before importing the new one.

### Telegram Trigger "Test Execution" Message
The message **"n8n can't listen for test executions at the same time as listening for production ones"** is NORMAL and NOT an error. It appears on the Telegram trigger node whenever the workflow is published. You cannot manually test Telegram triggers in the editor — test by sending a real Telegram message. Ignore this message always.

### Graphic Delivery
- **Always open the PNG immediately** after generating: `open /Users/305partners/aifeed/images/[filename].png`
- **aifeed-images folder** is symlinked to Desktop (`~/Desktop/aifeed-images → /Users/305partners/aifeed/images`) — all graphics accessible directly from Desktop for Instagram/LinkedIn posting.
- **Custom photos from user** — always check Desktop first (`ls -lt ~/Desktop/*.jpg` etc) before downloading from Pexels.

### Newsletter Copy
- Changed all newsletter sections in `index.html` and `post.html` from "daily" to "weekly" — the newsletter is weekly, not daily. Stories/posts remain daily.

### Background Registry
- Added `aifeed_china_manus.png` → `bg_china_lanterns.jpg` (custom photo from user, red Chinese lanterns with 福 characters)

---

## Affiliate Links Registry

These are the REAL affiliate links in the tools grid. When updating any tool card, always use the link from this table — never the tool's homepage directly.

| Tool | Affiliate Link | Commission | Status |
|------|---------------|-----------|--------|
| ElevenLabs | `https://try.elevenlabs.io/qspw8v1gx7n0` | — | Active |
| HeadshotPro | `https://www.headshotpro.com/?via=aifeed` | — | Active |
| Beehiiv | `https://www.beehiiv.com/?via=ai-feed` | — | Active |
| AdCreative.ai | `https://free-trial.adcreative.ai/g944t536drtc` | 30% recurring | Active — added Apr 21, 2026 |

**Writesonic, SurferSEO, Munch, HubSpot, Deep Art Effects, Perplexity, Claude.ai, n8n** — no affiliate links yet (using homepage URLs).

**Rule:** Never update a tool's URL to a non-affiliate homepage if an affiliate link exists in this table.

---

## What NOT to Do

- **Never generate a graphic without reading GRAPHIC_SPEC.md first** — every time, no exceptions
- **Never use `item.json.Caption` for website body text** — always `item.json.LinkedInCaption`
- **Never dump raw caption text as website body HTML** — always run through `liToHtml()` at minimum
- **Never use the Edit tool on JavaScript inside a JSON `jsCode` field** — use Python json.load/dump
- **Never search for a new Pexels background if the story already has one assigned** — use the existing `bg_pexels_*.jpg`
- **Never put just the category in the pill** — pill text is always `AIFEED.RUN • AI NEWS`
- **Never use a flat `<div>` with label+value layout for stat cards** — cards use absolute-positioned emoji (top:10px) + label (top:66px) with colored borders only
- **Never write just `domain.com` in the bottom bar source** — format is `Source: NAME · domain.com`
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
- **ALWAYS update `posts-index.json` imageUrl when pushing a new graphic** — after saving a new `.png` to `/Users/305partners/aifeed/images/`, the matching post entry in `_posts/posts-index.json` must have its `imageUrl` updated to `https://aifeed.run/images/[filename].png` before committing. Forgetting this means the website keeps showing the old Gemini-generated graphic even after the new one is on GitHub. This is a required step, not optional.
- **NEVER reuse a background photo across two graphics** — every single graphic must have a unique background. Before assigning any background file, run: `md5 /tmp/NEWFILE.jpg` and compare against all entries in the Background Registry below. If the md5 matches ANY existing entry, download a different Pexels photo and check again. This happened multiple times (test_bg3.jpg used 3x, bg_leak.jpg used 3x, bg_microsoft.jpg used 3x) and caused visible repeated backgrounds on the website.
- **MANDATORY: run duplicate check before every new graphic** — `python3 -c "import hashlib,os,glob; hashes={}; [hashes.setdefault(hashlib.md5(open(f,'rb').read()).hexdigest(),[]).append(os.path.basename(f)) for f in glob.glob('/tmp/bg_*.jpg')]; [print('DUP:',v) for v in hashes.values() if len(v)>1]"` — must show zero DUPs before running make_all_graphics.py.

---

## Background Photo Registry — EVERY graphic and its unique background file

**This is the source of truth. Every entry must have a unique md5. Do not reuse any background from this list.**

| Graphic file | Background file | md5 (first 8 chars) |
|---|---|---|
| aifeed_codex_anthropic.png | codex_bg.jpg | (from n8n) |
| aifeed_humans_loop.png | test_bg3.jpg | (from n8n) |
| aifeed_retail_393.png | retail_bg.jpg | (from n8n) |
| aifeed_runway_hollywood.png | hollywood_bg.jpg | (from n8n) |
| aifeed_ai_journalism.png | journalism_bg.jpg | (from n8n) |
| aifeed_agents_sdk.png | bg_agents2.jpg | abstract_network — unique |
| aifeed_vandermeer_download.png | bg_vandermeer.jpg | (from n8n) |
| aifeed_waypoint15.png | bg_waypoint.jpg | (from n8n) |
| aifeed_sycophantic.png | bg_sycophantic.jpg | unique |
| aifeed_ai_slop.png | bg_ai_slop.jpg | unique |
| aifeed_microsoft_3models.png | bg_microsoft.jpg | unique |
| aifeed_intuits_ai_agents.png | bg_intuit.jpg | unique |
| aifeed_slack_30ai.png | bg_slack.jpg | unique |
| aifeed_openclaw_500k.png | bg_openclaw.jpg | unique |
| aifeed_claudecode_leak.png | bg_claudeleak2.jpg | dark_abstract — unique |
| aifeed_meta_codereview.png | bg_metacode2.jpg | server_room — unique |
| aifeed_amazon_ceo.png | bg_amazon_ceo.jpg | unique |
| aifeed_cowork_graphic.png | bg_cowork.jpg | unique |
| aifeed_hassabis_graphic_v2.png | bg_hassabis2.jpg | cosmos_stars — unique |
| aifeed_openai_capitalism_v3.png | bg_openaisafety.jpg | dark_office — unique |
| aifeed_databricks_850m.png | bg_databricks2.jpg | urban_night — unique |
| aifeed_rebellions_400m.png | test_bg2.jpg | unique |
| aifeed_meta_texas_10b.png | test_bg.jpg | unique |
| aifeed_altman_graphic.png | bg_altman2.jpg | night_city — unique |
| aifeed_poke_graphic_v4.png | bg_poke.jpg | unique (Pexels 607812) |
| aifeed_googlemaps_gemini.png | bg_googlemaps.jpg | unique (Pexels 466685) |
| aifeed_firmus_5b_v2.png | bg_firmus.jpg | unique (Pexels 1181316) |
| aifeed_sciencecorp_brain.png | (unknown) | — |
| aifeed_hiro_graphic_v2.png | bg_hiro.jpg | unique |
| aifeed_apple_glasses_v3.png | bg_apple_glasses.jpg | unique |
| aifeed_gemma4_graphic.png | bg_gemma4.jpg | unique |
| aifeed_nyt.png | bg_nyt.jpg | yellow newspaper (Pexels 1907785) |
| aifeed_trinity.png | bg_arcee.jpg | unique (Pexels 3861458) |
| aifeed_google_opens_gemma.png | bg_gemmaopen.jpg | unique (Pexels 1181671) |
| aifeed_vcs_poured.png | bg_vcs.jpg | unique (Pexels 3184360) |
| aifeed_stanford_chatbots.png | bg_stanford.jpg | unique (Pexels 4101143) |
| aifeed_anthropic.png | bg_claudepop2.jpg | unique (Pexels 7947663, abstract tech/AI) |
| aifeed_federal_judge.png | bg_judge.jpg | unique (Pexels 5668858) |
| aifeed_bofa_agents.png | bg_bofa.jpg | unique (Pexels 3184339) |
| aifeed_listenlabs.png | bg_listenlabs.jpg | unique (Pexels 3184465) |
| aifeed_xai_cofounder.png | bg_xai.jpg | unique (Pexels 2264753) |

| aifeed_china_manus.png | bg_china1.jpg | unique (Pexels 3771837, red Chinese lanterns) |
| aifeed_anthropic_trillion.png | bg_anthropic_trillion.jpg | unique (Pexels 14820464 by jonathanborba, $100 bills scattered) |
| aifeed_nsa_mythos.png | bg_nsa_mythos.jpg | unique (Pexels 1089438, Matrix-style green code on black) |
| aifeed_nvidia.png | bg_pexels_1776621283733.jpg | unique (GeForce GTX close-up, original story-selected background) |

**When adding a new graphic:** download the background file, run md5, confirm it is NOT in this table, add it to the table, then generate.

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
