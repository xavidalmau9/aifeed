# AIFeed.run Reels

`make_reel.py` turns one published story into a ~21s 1080x1920 H.264/AAC MP4: a hook (feed graphic + headline), 3 key points quoted from the story text, and the brand end card ("AIFeed.run / The AI news that matters."). Audio is an original ambient bed synthesized in numpy, so there's no licensing. Free tools only: Python, Pillow, numpy, ffmpeg. Fonts: Poppins (SIL Open Font License).

Autopilot hook (`automation/actions/lib/reels.js`, `pipeline.js`):
- `reelsEnabled`: renders the reel after the carousel and commits `videos/reels/<slug>.mp4` (served at https://aifeed.run/videos/reels/<slug>.mp4). Also sets `post.videoUrl`, so the LinkedIn post through Buffer goes out as a video. Dry runs save the mp4 as an artifact.
- `reelsPublishEnabled`: publishes an IG Reel (Graph API `media_type=REELS`, shared to the feed) and a FB Page video (`/videos` with `file_url`). Any failure only sends an alert.
