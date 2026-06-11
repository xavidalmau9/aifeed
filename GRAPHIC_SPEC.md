# AIFeed.run Branded Graphic — Design Spec
**Last confirmed correct: May 26, 2026 — REBRAND v2 (editorial, no stat cards)**

This document is the canonical spec for the HTML graphic template used in the AIFeed Story Selector n8n workflow. Any future changes to the graphic must match this spec exactly. Do not deviate without explicit instruction.

## ⚠️ REBRAND NOTE (May 26, 2026)
The old design with 3 stat card pills at the bottom has been **permanently removed**. The new design is editorial/magazine style. Never add stat cards back unless explicitly instructed.

## ⛔ MANDATORY ELEMENTS — NEVER DROP (Jun 11, 2026)
Every graphic MUST include ALL of these. Do not omit any when copying a previous graphic forward as a template — dropping an established element is a regression:
1. **Top-left brand pill:** `AIFEED.RUN • AI NEWS`
2. **Category pill** (above the headline, in the story's category color) — see "Category pill" below. **This was being dropped; it is REQUIRED on every graphic.**
3. **Headline** (.hl) with one purple accent line
4. **Divider** (.divider)
5. **Subtitle** (.sub)
6. **Bottom bar:** `Source: … ` (left) + `aifeed.run` logo (right)

**Rule:** before rendering any graphic, verify all six are present. If a prior consistent element is missing from the template, restore it — never ship without it.

### Category pill (REQUIRED — matches the website category colors)
```css
.catpill{display:inline-block;border-radius:999px;padding:9px 20px;font-size:22px;
  font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:20px}
```
HTML: `<div class="catpill" style="background:<bg>;color:<txt>;border:1px solid <border>">CATEGORY</div>` as the FIRST child of `.content` (above `.hl`). Colors per category (match `index.html`/`post.html` `.cat-*`):
| Category | text | bg | border |
|---|---|---|---|
| Infrastructure | #818cf8 | rgba(99,102,241,.18) | rgba(99,102,241,.55) |
| Hardware | #22d3ee | rgba(6,182,212,.18) | rgba(6,182,212,.55) |
| Industry | #c084fc | rgba(168,85,247,.18) | rgba(168,85,247,.55) |
| Models | #fb923c | rgba(255,140,0,.18) | rgba(255,140,0,.55) |
| Tools | #4ade80 | rgba(50,215,110,.18) | rgba(50,215,110,.55) |
| Research | #60a5fa | rgba(56,130,246,.18) | rgba(56,130,246,.55) |
| Business | #fb7185 | rgba(244,63,94,.18) | rgba(244,63,94,.55) |
| Safety | #f87171 | rgba(239,68,68,.18) | rgba(239,68,68,.55) |

---

## Canvas

| Property | Value |
|----------|-------|
| Width | 1080px |
| Height | 1350px |
| Background (fallback) | `#04020e` (near-black) |
| Overflow | hidden on all containers |

---

## Fonts

**Poppins only — no other fonts.**

### ⚠️ CHROME HEADLESS: LOCAL FONTS ONLY — NEVER USE CDN

Chrome headless cannot load Google Fonts from the CDN. Using the `<link>` tag below in a headless script causes Poppins to silently fall back to Helvetica/Arial, making the pill and all text render incorrectly. This was the root cause of persistent pill size inconsistency.

**For the n8n workflow (real browser)** — CDN link is fine:
```html
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;700&display=swap" rel="stylesheet">
```

**For any Python/Chrome headless script** — ALWAYS use local @font-face:
```css
@font-face{font-family:'Poppins';font-weight:300;font-style:normal;src:url('file:///tmp/poppins-300.woff2') format('woff2')}
@font-face{font-family:'Poppins';font-weight:400;font-style:normal;src:url('file:///tmp/poppins-400.woff2') format('woff2')}
@font-face{font-family:'Poppins';font-weight:700;font-style:normal;src:url('file:///tmp/poppins-700.woff2') format('woff2')}
```

Download fonts once (verify ~7-8KB each):
```bash
curl -sL "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLDz8Z1xlFd2JQEk.woff2" -o /tmp/poppins-300.woff2
curl -sL "https://fonts.gstatic.com/s/poppins/v24/pxiEyp8kv8JHgFVrJJfecnFHGPc.woff2"    -o /tmp/poppins-400.woff2
curl -sL "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7Z1xlFd2JQEk.woff2" -o /tmp/poppins-700.woff2
```

| Weight | Usage |
|--------|-------|
| 700 (Bold) | Headline lines, pill badge, stat card values, logo |
| 400 (Regular) | Subtitle, stat card labels |
| 300 (Light) | Source attribution |

---

## Colors — EXACT VALUES ONLY

| Name | Hex | Usage |
|------|-----|-------|
| Purple | `#a050ff` | Accent headline line, pill right, card 1 border/value, logo "ai", underline |
| Orange | `#ff8c00` | Pill left, card 3 border/value, logo "feed" |
| Green | `#32d76e` | Card 2 border/value |
| Dark BG | `#04020e` | Canvas background |
| Card BG | `rgba(15,5,35,.82)` | Stat card fill |
| Subtitle | `#d2d2e1` | Subtitle text |
| Card label | `#b4b9c8` | Stat card label text |
| Source | `#8c8ca0` | Source attribution text |
| Bar BG | `rgba(0,0,4,.92)` | Bottom bar background |
| Logo white | `#ffffff` | Logo ".run" |

---

## Layout — FIXED PIXEL POSITIONS

All positions are absolute and must never change.

### Background Photo
```css
.bg {
  position: absolute;
  top: 0; left: 0;
  width: 1080px; height: 1350px;
  object-fit: cover;
  object-position: top center;   /* ALWAYS anchored to top — never center-vertically */
}
```

### Gradient Overlay
```css
.ov {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom,
    rgba(4,2,14,0.05) 0%,
    rgba(4,2,14,0.15) 25%,
    rgba(4,2,14,0.55) 50%,
    rgba(4,2,14,0.88) 70%,
    rgba(4,2,14,0.97) 85%,
    rgba(4,2,14,1.0)  100%);
  /* Cinematic heavy-bottom — updated May 26 rebrand */
}
```

### Pill Badge (top-left)
```css
.pill {
  position: absolute;
  top: 44px; left: 44px;
  background: linear-gradient(to right, #ff8c00, #a050ff);
  height: 52px; border-radius: 26px; padding: 0 28px;
  font-size: 28px; font-weight: 700; color: #fff;
  white-space: nowrap; letter-spacing: .3px;
}
```
Content: `AIFEED.RUN • AI NEWS`

### Content Block (replaces old Headline Block + Stat Cards)
```css
.content {
  position: absolute;
  bottom: 90px; left: 54px; right: 54px;
}

/* Category label */
.cat {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 16px; font-weight: 600;
  color: #a050ff; letter-spacing: 3.5px;
  text-transform: uppercase; margin-bottom: 22px;
}
.cat-line { width: 28px; height: 2px; background: #a050ff; flex-shrink: 0; }

/* Headline — LARGE, uppercase, tight */
.hl {
  font-size: 100px; font-weight: 900;
  line-height: 0.95; color: #fff;
  letter-spacing: -3px; margin-bottom: 28px;
  text-transform: uppercase;
}
.hl .accent { color: #a050ff; }   /* purple accent line */

/* Divider */
.divider {
  width: 60px; height: 3px;
  background: linear-gradient(to right, #a050ff, #ff8c00);
  border-radius: 2px; margin-bottom: 24px;
}

/* Subtitle */
.sub {
  font-size: 28px; font-weight: 300;
  color: rgba(255,255,255,0.70);
  line-height: 1.5; max-width: 860px;
}
```

**Headline line rules (enforced in Claude prompt):**
- Max **4 words** and **20 characters** per display line
- `line1`: words before key phrase (can be empty) — rendered white
- `accentLine`: 2–4 most impactful words (shown in purple, REQUIRED)
- `line2`: remaining words (can be empty) — rendered white

**Category values (Claude picks one):** Models / Tools / Industry / Research / Products / Business / Hardware / Safety / Health / Infrastructure

**⛔ STAT CARDS PERMANENTLY REMOVED** — Do not add `.cards`, `.card`, `.c1/.c2/.c3`, `.cv`, `.cl` back.

### Bottom Bar
```css
.bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 70px;
  background: rgba(0,0,4,0.96);
  display: flex; align-items: center;
  justify-content: space-between; padding: 0 54px;
}
.bsrc {
  font-size: 20px; font-weight: 300; color: #5a5a70;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 640px;
}
.blogo { font-size: 28px; font-weight: 700; white-space: nowrap; }
.bai { color: #a050ff; }   /* "ai" */
.bfd { color: #ff8c00; }   /* "feed" */
.brn { color: #ffffff; }   /* ".run" */
```

Logo HTML: `<span class="bai">ai</span><span class="bfd">feed</span><span class="brn">.run</span>`

---

## What NOT to Do

| ❌ Wrong | ✅ Correct |
|---------|-----------|
| `right: 230px` on logo | `right: 54px` |
| Font Syne or Inter | Poppins only |
| Purple `#a855f7` | `#a050ff` |
| Orange `#f97316` | `#ff8c00` |
| Green `#22c55e` | `#32d76e` |
| BG `#09081a` | `#04020e` |
| `object-position: center` | `object-position: top center` |
| `font-size: 90px` headline | `font-size: 82px` (90px wraps long phrases) |
| No `max-height` on `.hb` | `max-height: 455px` required |
| Headline line > 20 chars | Max 20 chars / 4 words per line |
| Source text with no max-width | `max-width: 700px` with ellipsis |
| Logo ".run" in purple | ".run" is white `#ffffff` |

---

## n8n Workflow Nodes That Use This Template

- **`Build & Send Graphic`** (node b1000039) — stock photo flow (Pexels img1/img2/skip)
- **`Build & Send Graphic Photo`** (node b1000042) — custom photo flow (user sends photo to Telegram)

Both nodes contain identical CSS. Any future changes must be applied to **both**.

Claude prompt for headline splitting lives in:
- **`Get Graphic Data`** (node b1000041-style, standard flow)
- **`Get Graphic Data Photo`** (node b1000041, photo flow)

---

## Custom Photo Flow — Image URL Logic (node b1000027)

**CRITICAL — do not revert this structure or the image will be blank.**

The correct order in `Process & Upload Photo`:
1. Get Telegram `file_path` via `getFile` API
2. Construct `telegramUrl` — **declare it OUTSIDE the try block**
3. **Immediately set `imageUrl = telegramUrl`** — this is the guaranteed fallback
4. Try to download the image (for GitHub base64 upload only)
5. Try GitHub upload — if successful, upgrade `imageUrl` to permanent GitHub URL
6. If download OR GitHub fails — `imageUrl` is already set from step 3, graphic still works

**The bug that caused blank images:** `telegramUrl` was declared inside the try block. If `fetch()` failed on the download, the outer catch fired and `imageUrl` stayed as `''`. Fix: always set `imageUrl = telegramUrl` before attempting the download.

**Also:** Use `this.helpers.httpRequest()` for the download (not `fetch()`) — more reliable in n8n.

---

## Verified Correct Preview

`/Users/305partners/Downloads/aifeed-preview.html` — standalone test file. Open in browser at 100% zoom to verify before re-importing workflow JSON.

---

## Chrome Headless Rendering — CRITICAL

**Problem:** Chrome headless with `--window-size=1080,1350` clips content at ~y=1270px. The bottom bar (`bottom:0` = y=1282–1350) is **never rendered**. This is a Chrome headless limitation, not a CSS bug.

**Wrong fix (DO NOT DO):** Moving headline to `top:580px`, cards to `top:1070px`, bar to `top:1190px` — produces wrong layout, everything looks pushed up.

**Correct fix:** Render at taller viewport, crop with Pillow.

```bash
# Render at 1500px tall (bar at y=1282 is well within viewport)
chromium --headless=new --no-sandbox --screenshot=/tmp/out.png \
  --window-size=1080,1500 --hide-scrollbars file:///tmp/graphic.html

# Crop back to spec: 1080×1350
python3 -c "
from PIL import Image
img = Image.open('/tmp/out.png')          # size: (1080, 1500)
img.crop((0, 0, 1080, 1350)).save('final.png')   # size: (1080, 1350)
"
```

**All spec positions stay unchanged:**
- Pill: `top:44px`
- Headline block: `top:670px`
- Stat cards: `top:1130px`
- Bottom bar: `bottom:0; height:68px`

The n8n workflow sends HTML to Telegram for manual browser screenshot — this fix only applies to programmatic/automated rendering.
