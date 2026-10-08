# AI Feed — Facebook Page brand graphics

| File | Size | What it is |
|---|---|---|
| `profile.png` | 1080×1080 | Profile picture. Vector rebuild of the @aifeed.run Instagram avatar (signal arcs + dot, AIFEED, .run) on a full-bleed dark background, so the circle crop has no white corners. |
| `cover.png` | 1640×924 | Cover photo. Gradient pill, `aifeed.run` wordmark (same CSS as the post graphics), tagline, and "Free weekly AI brief · aifeed.run". All content sits in x 475–1218, y 195–687: inside the desktop 1640×624 band, the mobile 2.4:1 band and the central 1280 px, and clear of the bottom-left profile-picture overlap. |
| `preview_desktop.png` | — | Mock desktop Page header (820×312 crop at 2×) plus the full cover with safe-zone guides. |
| `preview_mobile.png` | — | Mock Facebook app header: 2.4:1 crop and full 16:9. |
| `preview_circle.png` | — | Circle crop at 560/196/176/80/40 px in dark and light mode, next to the current Instagram avatar. |

## Rebuilding
Both images are rendered from HTML with the same headless-Chrome renderer the post graphics use (`automation/actions/renderer/server.js`, Poppins + Inter):

```bash
cd brand/facebook/src
./render.sh cover.html ../cover.png 1640 924
python3 profile_gen.py 1080 fs=54.5 ls=6.6 tx=129.5 base=346 rx=220 rls=5.3 rfs=23.5 rbase=386 && ./render.sh profile.html ../profile.png 1080 1080
```

`arcs.json` holds the arc geometry measured from the 500 px Instagram avatar (`fit_arcs.py`).
