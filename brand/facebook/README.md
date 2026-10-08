# AI Feed: Facebook Page brand graphics

Brand copy (Oct 8, 2026): name **AIFeed.run** · tagline **The AI news that matters.** · subline **Top AI stories, explained in 60 seconds.** · CTA **Free weekly AI brief at aifeed.run**. Never promise a number of stories per day.

| File | Size | What it is |
|---|---|---|
| `cover_v2.png` | 1702×630 | **The cover to upload.** 2.70:1, exactly 2× Facebook's recommended 851×315 and the same shape as the live desktop cover box (measured 2.696:1), so desktop shows the whole image with no crop, wherever Facebook anchors it. Text sits at x 607–1093, y 134–484: 21% padding top and 23% bottom. It stays visible in phone crops of 2.4:1 or 16:9, anchored left or centered. |
| `cover.png` | 1640×924 | First version (16:9). On the live desktop page Facebook showed only its top 608 px, so the bottom lines were cut. Kept for reference; don't upload. |
| `profile.png` | 1080×1080 | Profile picture. Vector rebuild of the @aifeed.run Instagram avatar on a full-bleed dark background, so the circle crop has no white corners. |
| `preview_live_crop.png` | | The measured live desktop crop: the old cover as Facebook showed it, then cover_v2 placed in the same box. |
| `preview_desktop.png` | | Mock desktop Page header in the measured live layout, with cover_v2. |
| `preview_mobile.png` | | cover_v2 in phone crops of 2.4:1 and 16:9, each anchored left and centered. |
| `preview_circle.png` | | Profile picture circle crop at 560/196/176/80/40 px, next to the Instagram avatar. |

## Measured live crop
Live screenshot (1024×594): cover box at x 271–936, y 30–276 (666×247 = 2.696:1). Facebook fills the box width (scale 0.406 for the 1640 px file) and anchors the top, so the visible part of the 1640×924 cover was y 0–608.

## Rebuilding
All images are rendered from HTML through the same headless-Chrome renderer as the post graphics (`automation/actions/renderer/server.js`, Poppins + Inter). `cover_v2.html` includes a fit check that returns HTTP 422 if text breaks the padding or width limits.

```bash
cd brand/facebook/src
./render.sh cover_v2.html ../cover_v2.png 1702 630
python3 profile_gen.py 1080 fs=54.5 ls=6.6 tx=129.5 base=346 rx=220 rls=5.3 rfs=23.5 rbase=386 && ./render.sh profile.html ../profile.png 1080 1080
```
