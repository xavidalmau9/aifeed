# AIFeed Autopilot: one-time setup

What it does: every day at **8:00am ET** it posts the #1 ranked AI story and at **5:00pm ET** the #2 story (or the next one if #2 was already used or fails checks). Each post goes to Instagram (2-slide carousel: story graphic + end card, short caption, plus a 9:16 Story), LinkedIn (2-image post, long caption) and aifeed.run (`_posts/posts-index.json`). No approvals and no Telegram menus. Telegram only messages you when something breaks.

Files in this folder:
- `AIFeed_Autopilot.json`: the main n8n workflow (import it)
- `AIFeed_Error_Alerts.json`: the error-alert workflow (import it)
- `docker-compose.gotenberg.yml`: the free renderer that turns the graphic HTML into a PNG
- `js/`: readable copies of the code inside the workflow (for reference only)
- `sample_render.png`: an example of the auto-generated graphic

---

## 1. Rotate the leaked keys first (10 min)
The old workflow files on your Desktop contain real keys in plain text. Treat them as compromised.
1. **GitHub**: Settings → Developer settings → revoke the old token. Create a **fine-grained token** that works only on `xavidalmau9/aifeed` with **Contents: Read and write**.
2. **Anthropic**: console.anthropic.com → API Keys → delete the old key and create a new one.
3. **Telegram**: message @BotFather → `/revoke` → choose the bot → copy the new token.
4. **Unsplash**: revoke or regenerate the key (the new workflow doesn't use it).
5. Delete or archive the old JSON files on your Desktop, and deactivate the old "Story List" and "Story Selector" workflows in n8n.

## 2. Instagram Business account + Facebook Page (10 min)
1. In the Instagram app: Settings → Account type and tools → switch to a **Professional account (Business)**.
2. Create a Facebook Page for AIFeed.run if you don't have one.
3. Link them: Meta Business Suite → Settings → Accounts → Instagram accounts → connect @aifeed.run to the Page.

## 3. Meta app + long-lived token (20 min)
1. Go to developers.facebook.com → My Apps → **Create app**. Pick type **Business**, then add the **Instagram Graph API** (Facebook Login for Business) product.
2. Open **Graph API Explorer**, select your app, and use "Get User Access Token" with these permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
3. Exchange it for a long-lived (60-day) user token:
   `GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN`
4. Get a **Page token that doesn't expire** with `GET /me/accounts?access_token=LONG_USER_TOKEN` and copy the `access_token` of the AIFeed Page.
5. Get your IG account ID with `GET /PAGE_ID?fields=instagram_business_account&access_token=PAGE_TOKEN`. That `id` goes into **Config → igUserId**.
6. Your own app works in Development mode for your own accounts, so App Review isn't needed. Keep the app owner as the admin of the Page and IG account.
7. *Better long-term:* in Business Settings → System Users, create a system user, assign it the Page and the app, and generate a token that never expires.

Instagram limits: at most 100 API posts per 24h (you'll use 2), JPEG/PNG, 4:5 ratio is fine (1080×1350).

## 4. LinkedIn developer app (15 min, plus waiting for approval)
1. Go to linkedin.com/developers → **Create app** and link it to the AIFeed.run company page.
2. Products tab: add **Share on LinkedIn** (gives `w_member_social`, posts as you personally, instant) and **Sign In with LinkedIn using OpenID Connect**.
3. To post **as the AIFeed.run Page**, request **Community Management API**. That gives `w_organization_social` and needs approval, which can take days. Until it's approved, post as yourself.
4. Under Auth, add the redirect URL that n8n shows on its LinkedIn credential screen (`https://<your-n8n>/rest/oauth2-credential/callback`).
5. In **Config**, set `linkedinAuthorUrn`:
   - Personal posts: `urn:li:person:<id>`. Get the id from `GET https://api.linkedin.com/v2/userinfo` (the `sub` field).
   - Page posts: `urn:li:organization:<number from the page admin URL>`.
6. LinkedIn tokens expire after about 60 days. Reconnect the n8n credential when the error alert says LinkedIn returned 401.

## 5. n8n setup (15 min)
1. **Timezone**: the workflow's settings are already America/New_York. Also set the instance timezone: on self-hosted n8n set the env var `GENERIC_TIMEZONE=America/New_York`; on n8n Cloud go to Admin panel → Timezone.
2. **Renderer (free)**:
   - *Self-hosted n8n (recommended):* run `docker-compose.gotenberg.yml` next to n8n and keep `renderUrl = http://gotenberg:3000`.
   - *n8n Cloud:* Gotenberg must be reachable from the internet. Host it on a free container service (e.g. a Render/Koyeb/Fly.io free instance) behind basic auth, and point `renderUrl` at it. Free tiers can cold-start for 30–60s, which the 60s timeout and retry cover.
   - Alternatives: the community node `n8n-nodes-puppeteer` (self-hosted only, heavier), or a hosted HTML→image API (htmlcsstoimage's free tier is about 50/month, which is too few for 60 posts a month).
3. **Create the credentials** (Credentials → New):
   | Name in workflow | n8n type | Value |
   |---|---|---|
   | GitHub aifeed (fine-grained PAT) | GitHub API | new fine-grained token |
   | Anthropic x-api-key | Header Auth | Name `x-api-key`, Value = new Anthropic key |
   | Meta IG long-lived token (access_token) | Query Auth | Name `access_token`, Value = Page/system-user token |
   | LinkedIn OAuth2 | LinkedIn OAuth2 API | client ID and secret from the LinkedIn app; tick "Organization support" if posting as the Page |
   | Telegram AIFeed bot (NEW token) | Telegram API | new bot token |
4. Import `AIFeed_Error_Alerts.json`, put your Telegram chat ID in the Telegram node, pick the credential, and save.
5. Import `AIFeed_Autopilot.json`. Open each red node and choose the matching credential. In **Config**, fill in `igUserId` and `linkedinAuthorUrn`, and check that `branch` is your Pages branch.
6. Workflow Settings → **Error workflow** = "AIFeed Error Alerts".
7. Do one test run with **Execute workflow** (it really posts, so do it once). Then switch the workflow **Active**.

## 6. Website
- **One-time step:** commit `images/aifeed_endslide.png` (in this folder; 1080×1350, the "FOLLOW / AI News Delivered by AI" card) to the repo's `images/` folder, so it is public at `https://aifeed.run/images/aifeed_endslide.png` (= Config → `endCardUrl`). Every Instagram carousel and LinkedIn post uses it as slide 2. Open that URL in a browser to confirm it loads before the first run.
- Images are committed to `images/` in the repo and served at `https://aifeed.run/images/...`. Instagram fetches the image from that public URL, so the workflow waits 90s and retries until the URL is live.
- `_data/history.json` is created automatically on the first run. It stores every posted URL and headline and is used for duplicate checks.

---

## How "no approval" stays safe (automatic checks)
1. **Dedup**: the link (with tracking tags removed) is compared to every past post. Titles are compared by word overlap against the last 30 days. Claude is also told to skip any story about the same event as a recent post.
2. **Freshness**: stories must be under 36h old and the source link must actually load.
3. **Fact check**: captions are written only from the article text. Claude marks unsupported, opinion, rumor or unsafe stories, and those are rejected. A second source check then verifies every caption sentence against the article text (see `ACTIONS_SETUP.md`, "Source fact check").
4. **Format checks**: word counts, Instagram's 2,200-character limit, 3–6 hashtags, a source line, headline length that fits the graphic, and a real 1080×1350 PNG.
5. **Fallback**: if a story fails any check, the next story (up to 3) is used automatically. If all fail, nothing posts and you get a Telegram alert.

## Known limitations
- Hashtags in LinkedIn posts appear as plain text (LinkedIn's own clickable hashtag format isn't used).
- If an article has no og:image, the fallback photo service may not work, so set a default AIFeed background image instead.
- Instagram flow: two child containers (`is_carousel_item=true`) → CAROUSEL container (children + caption) → polls `status_code` every 15s until FINISHED (gives up after 12 tries / ERROR / EXPIRED, with a Telegram alert) → `media_publish`. Both slides must stay 4:5 (1080×1350).
- LinkedIn multi-image posts need at least 2 images; if LinkedIn ever rejects them, switch `content` in "LI Create Post" back to a single `media` image.
- **Instagram Story:** after the carousel publishes, a 1080×1920 Story version (`*_story.png`, also committed to `images/`) is posted as `media_type=STORIES` (polls `status_code` until FINISHED, then `media_publish`). If any Story step fails, the run continues (LinkedIn still posts) and you get a Telegram alert from the "Story Failed Alert" node, which uses the same Telegram credential plus Config → `telegramChatId`.
- **The API cannot add link stickers, mentions, polls, music or 'share post' stickers to Stories.** API stories are a flat image only. To send people to the post or newsletter, rely on the profile link-in-bio, or add a sticker manually in the app when needed.
- Reels are a phase-2 upgrade.
