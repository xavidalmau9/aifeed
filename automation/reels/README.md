# AIFeed.run Reels

`make_reel.py` turns one published story into a ~21s 1080x1920 H.264/AAC MP4: a hook (feed graphic + headline), 3 key points quoted from the story text, and the brand end card ("AIFeed.run / The AI news that matters."). Audio is an original ambient bed synthesized in numpy, so there's no licensing. Free tools only: Python, Pillow, numpy, ffmpeg. Fonts: Poppins (SIL Open Font License).

Autopilot hook (`automation/actions/lib/reels.js`, `pipeline.js`):
- `reelsEnabled`: renders the reel after the carousel and commits `videos/reels/<slug>.mp4` (served at https://aifeed.run/videos/reels/<slug>.mp4). Also sets `post.videoUrl`, so the LinkedIn post through Buffer goes out as a video. Dry runs save the mp4 as an artifact.
- `reelsPublishEnabled`: publishes an IG Reel (Graph API `media_type=REELS`, shared to the feed) and a FB Page video (`/videos` with `file_url`). Any failure only sends an alert.

## Scene sources (scenes.py)

Every Reel needs a dramatic, story-themed, text-free scene. `scenes.pick_scene` tries these in order and keeps the first one that passes its quality gate:

1. **cache**: a raw scene already rendered for this slug. Only active when `AIFEED_SCENE_CACHE` is set (samples and tests).
2. **cloudflare**: Workers AI flux-1-schnell. Only active when `AIFEED_SCENE_CF=on`, and only the live autopilot post sets that (`renderReel(..., { cloudflare: true })`). Dry runs, `reels-samples.yml`, `render_samples.js` and manual `make_reel.py` runs leave it off, so they can't drain the shared free 10k neurons/day. After a 429 or any other error there's no bright retry; the chain moves on.
3. **ovh**: OVHcloud AI Endpoints SDXL. It's anonymous (no account, key or card), allows 2 requests/min per IP, and takes a negative prompt against text and people. Dropped connections are retried. Disable with `AIFEED_SCENE_OVH=off`.
4. **generated**: Pollinations' keyless endpoint. It's unreliable (402 when busy). Disable with `AIFEED_SCENE_GEN=off`.
5. **library**: a bundled pre-made scene for the story's theme (`library/`, one per theme plus `default`). This step always succeeds. It comes before the photo tiers.
6. **story**: the story's own photo. It must be a real photo: not a screenshot and not posed people.
7. **openverse**: an Openverse scene search on the AI's scene keywords plus theme keywords (CC0, PDM, CC BY or CC BY-SA, credited in the caption).
8. **commons**: a Wikimedia Commons scene search on the same keywords. The photo tiers are only reached if the library is missing (or if `AIFEED_SCENE_ORDER` puts them earlier).

Photo sources reject posed people. That covers titles or file names like "visits", "meets", "Secretary", "portrait" and "handshake", plus a cheap skin-area heuristic.

## Hook-first + voiceover (make_reel.py, voice.py)

- **Frame 0 is the cover**: full-bleed scene, pill top-left, the full Anton punch headline, logo bottom-right. No fade-in or
  build; only a slow push-in runs across the whole Reel.
- **Voiceover**: Kokoro-82M (Apache-2.0) neural TTS on CPU via ONNX Runtime, free, no API or key. Timestamped ONNX export
  (onnx-community/Kokoro-82M-v1.0-ONNX-timestamped) + misaki G2P (Kokoro's own). Default voice `af_heart` at speed 1.05
  (`AIFEED_KOKORO_VOICE`, `AIFEED_KOKORO_SPEED`); files cached in `~/.cache/aifeed-kokoro` by the workflows.
  Script: the headline ("Why X" -> "Here's why X."), then 2-3 self-contained points (no dangling "these challenges",
  no repeats of the headline or each other), then "Follow AIFeed dot run." (dropped first if time is short).
- **Captions**: phrase-wise (3-4 words); word times come from the TTS model's own phoneme durations, with onsets after a
  pause re-measured on the waveform. Frames round to the nearest frame. Scene changes sit on spoken boundaries: the
  headline docks in the pause after the hook and is fully docked on the first point's first word; the end card lands on
  the outro's first word. Captions sit below the docked headline (y 1170-1470), inside the 3:4 band.
- **Length**: driven by the voiceover, 12-18 s (drops the 3rd point, then uses shorter points or a slightly faster pace).
- **Audio**: the voice over the bundled, code-synthesized music bed (royalty-free), ducked under speech.
  `AIFEED_REEL_MUSIC=off` drops the bed; `AIFEED_REEL_VOICE=off` (or Piper missing) renders the old music-only timeline.
- Tests: `python3 -m unittest test_voice` (Piper tests skip without the voice).
