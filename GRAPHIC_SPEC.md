# AIFeed.run Branded Graphic — Design Spec
**Last confirmed correct: April 2026**

This document is the canonical spec for the HTML graphic template used in the AIFeed Story Selector n8n workflow. Any future changes to the graphic must match this spec exactly. Do not deviate without explicit instruction.

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

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;700&display=swap" rel="stylesheet">
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
    rgba(4,2,14,.08) 0%,
    rgba(4,2,14,.86) 50%,
    rgba(4,2,14,.86) 100%);
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

### Headline Block
```css
.hb {
  position: absolute;
  top: 670px; left: 54px; right: 54px;
  max-height: 455px;   /* CRITICAL — prevents overflow into stat cards */
  overflow: hidden;
}
.hl {
  font-size: 82px; font-weight: 700; line-height: 94px;
  display: block;
}
.hw { color: #ffffff; }   /* white lines */
.hp { color: #a050ff; }   /* purple accent line */
.hu {                      /* purple underline bar */
  display: block;
  width: 54px; height: 5px;
  background: #a050ff; border-radius: 3px; margin-top: 8px;
}
.sub {
  font-size: 33px; font-weight: 400;
  color: #d2d2e1; line-height: 46px; margin-top: 22px;
}
```

**Headline line rules (enforced in Claude prompt):**
- Max **4 words** and **20 characters** per display line
- `line1`: 2–4 words before the key phrase (can be empty)
- `accentLine`: 2–4 most impactful words (shown in purple)
- `line2`: 2–4 remaining words (can be empty if leftover exceeds 20 chars)

### Stat Cards
```css
.cards {
  position: absolute;
  top: 1130px; left: 54px;   /* FIXED — never move */
  display: flex; gap: 27px;
}
.card { width: 312px; height: 112px; border-radius: 14px; border: 2px solid; }
.c1 { border-color: #a050ff; }
.c2 { border-color: #32d76e; }
.c3 { border-color: #ff8c00; }
.cv { font-size: 44px; font-weight: 700; top: 10px; }   /* value */
.cl { font-size: 24px; font-weight: 400; color: #b4b9c8; top: 66px; }  /* label */
```

### Bottom Bar
```css
.bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 68px;
  background: rgba(0,0,4,.92);
}
/* Source — LEFT side */
.bsrc {
  position: absolute; left: 54px; top: 20px;
  font-size: 26px; font-weight: 300; color: #8c8ca0;
  white-space: nowrap;
  max-width: 700px; overflow: hidden; text-overflow: ellipsis;
}
/* Logo — RIGHT side, flush at 54px margin */
.blogo {
  position: absolute; right: 54px; top: 19px;
  font-size: 30px; font-weight: 700;
}
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
