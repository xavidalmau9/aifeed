# AIFeed autopilot on GitHub Actions

The daily post (8:00am ET slot 1, 5:00pm ET slot 2) runs in GitHub Actions from `.github/workflows/autopilot.yml`. The pipeline code is `automation/actions/`. It follows the live n8n workflow: same feeds, prompts, caption builder, graphic HTML, text-fit check, 2-slide Instagram carousel (story graphic + `https://aifeed.run/images/aifeed_endslide.png`), then a 9:16 Instagram Story.

n8n is only a fallback. Import `automation/n8n/AIFeed_Autopilot.json`. Its schedule is **8:40am and 5:40pm America/New_York**, and it stops when `_data/slot-claims.json` shows that slot as `claimed` or `posted`.

## Secrets

Add these under the repo **Settings → Secrets and variables → Actions**. Nothing in this list belongs in a file.

| Secret | Required | Where the value comes from |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | [console.anthropic.com](https://console.anthropic.com) → API keys. Used as the `x-api-key` header. If it is missing the run logs a message and exits without posting. |
| `META_PAGE_TOKEN` | Yes | Long-lived Facebook Page token for page `1434982969687864`. Used for Instagram Graph (`17841442136197946`) and, if `fbEnabled` is turned on, Facebook. If it is missing the run exits without posting. |
| `META_APP_SECRET` | No | Meta app `1367205021940381` → App settings → Basic → App secret. When set, Graph calls also send `appsecret_proof` (HMAC-SHA256 of the page token). Leave it unset if the app does not require the proof. The n8n workflow does not send a proof. |
| `TELEGRAM_BOT_TOKEN` | No | @BotFather token. Failure alerts (and Story/Facebook failures) are skipped cleanly when this or the chat id is empty. |
| `TELEGRAM_CHAT_ID` | No | The chat that should receive alerts. The n8n JSON keeps this as the placeholder `__TELEGRAM_CHAT_ID__`; the real value stays in this secret (and in the n8n Telegram credential). |
| `AIFEED_GH_TOKEN` | No | Fine-grained PAT on `xavidalmau9/aifeed` with **Contents: Read and write**. Commits use it so `seo-build.yml` still runs. If it is unset, the job falls back to `GITHUB_TOKEN`. Pushes made with `GITHUB_TOKEN` do not trigger other workflows, so news pages, the sitemap, and thumbnails will not rebuild until some other push. |
| `LINKEDIN_ACCESS_TOKEN` | No | Member or organization token with permission to post. Ignored while `linkedinEnabled` is `false` in `automation/actions/config.json`. |

Non-secret ids and toggles live in `automation/actions/config.json` (`igUserId`, `fbPageId`, `metaAppId`, `graphVersion`, `fbEnabled`, `linkedinEnabled`, `anthropicModel`, `endCardUrl`, and the recorded `dedupDays` / `similarityThreshold`).

## Dry run

Actions → **AIFeed autopilot** → **Run workflow**:

- `slot`: `auto` (only runs 8:00-9:59 or 17:00-18:59 ET), `1`, or `2`
- `dry_run`: checked
- `take_over`: leave unchecked

The job does story selection, caption checks, and both renders. It does **not** write the claim file, commit, or call Instagram publish. If the slot was already posted, the log says a real run would skip, and the dry run still renders a preview. The feed PNG, story PNG, and both captions are uploaded as the `aifeed-dry-run` artifact.

A dry run still needs `ANTHROPIC_API_KEY` and `META_PAGE_TOKEN` (ranking, captions, and the recent Instagram captions used for dedup).

## Cutover

**Merging this PR turns on the 8:00 / 17:00 ET schedule.** The n8n workflow that is live today (`AIFeed Autopilot (8am #1 / 5pm #2 ET)`, 8:00 and 17:00, no claim check) must be deactivated or replaced by the fallback below **before the merge**, or both will post the same slot.

1. Add the secrets above. Do not commit them.
2. Run one **dry run** for slot `1` or `2` and compare the artifact with a recent post. (Before the merge, run `pipeline.js` locally with `DRY_RUN=1`; `workflow_dispatch` only works once the workflow is on `main`, and the post job always checks out `main`.)
3. Before merging, import `automation/n8n/AIFeed_Autopilot.json` into n8n (this replaces the 8:00/17:00 schedule with 8:40/17:40). Import `automation/n8n/AIFeed_Error_Alerts.json` and set it as the error workflow. Put the new bot token in the n8n Telegram credential. The chat id in the JSON is `__TELEGRAM_CHAT_ID__`; replace that placeholder in the n8n Config node with the real chat id (it is not stored in the repo copy).
4. Leave n8n **active** until Actions has posted on its own for a few days. n8n reads `_data/slot-claims.json` immediately after Config and stops when that slot is `claimed` or `posted`.
5. Confirm the Actions run at 8:00am ET posts, and the 8:40am n8n execution ends on "slot is claimed/posted" without publishing.
6. **Disable n8n** once you trust Actions: deactivate **AIFeed Autopilot** and **AIFeed Error Alerts** in n8n, and you can shut the machine off. Deactivate rather than deleting until you have seen a few Actions posts.

`take_over` on a manual run reclaims a slot left in `claimed` after a crash before publish. It does not override `posted` or an entry already in `_data/history.json`. Do not re-import `automation/AIFeed_Autopilot.json`; that older file is still the 8:00/17:00 workflow.

## Differences from the live n8n workflow

- Dry run uploads workflow artifacts. It does not send the PNGs or caption to Telegram.
- The feed image, `_posts/posts-index.json`, and `_data/history.json` land in one `Publish:` commit, so a crash cannot leave an image on the site without the history entry that blocks a second post. n8n writes those as three Contents API calls. The 9:16 story image is still its own commit.
- Actions claims `_data/slot-claims.json` at the start of a real run (after the slot is confirmed free) and sets `released` if it fails before that publish commit. `posted` is written after the Instagram carousel succeeds. n8n only reads the file.
- Actions also skips the slot when `history.json` already has that date and slot, which is how an n8n fallback post is not repeated.
- Graph calls include `appsecret_proof` only when `META_APP_SECRET` is set.
- LinkedIn runs only when `linkedinEnabled` is true, the author URN is a real person or organization URN, and `LINKEDIN_ACCESS_TOKEN` is set. n8n enables LinkedIn from the URN alone. Both are off today.
- Facebook, the Story, and LinkedIn run one after another. A Story or Facebook failure alerts and continues. A LinkedIn failure fails the run after the Story attempt.
- `dedupDays` and `similarityThreshold` are recorded in config. The checks that actually run are the live ones: normalized URL, Jaccard 0.6, 120-day title overlap, and the 90-day same-event model check.
- Scheduled runs accept 8:00-9:59 / 17:00-18:59 ET, so a run GitHub delays past the hour still posts. In EDT the 13:00 / 22:00 UTC cron is then a backup that stops at the claim/history check when the slot is done.
- A candidate whose article has no usable photo (missing, placeholder, not an image, under 15 KB, or not loading) is skipped for the next candidate. n8n would render it with the dead `source.unsplash.com` fallback (blank background).
- Graphics: hyphenated headline words (5-MINUTE, GPT-5) never split at the hyphen, and the Story shade is anchored to the text block so a long headline does not sit on a bright photo.
- The source hedge check is case-insensitive (Title Case RSS headlines such as "Considers" or "Hopes to" count) and also counts "hopes to", "wants to", "looks to".
- Missing `ANTHROPIC_API_KEY` or `META_PAGE_TOKEN` exits successfully with a log line and does not post. Telegram alerts do nothing when the bot token or chat id is empty.

## What the job posts

Instagram carousel (feed graphic + end card) and an Instagram Story. Facebook only when `fbEnabled` is `true`. LinkedIn only when `linkedinEnabled` is `true`, the author URN is a real `urn:li:person:` or `urn:li:organization:` value, and `LINKEDIN_ACCESS_TOKEN` is set. Website updates are a commit to `images/`, `_posts/posts-index.json`, and `_data/history.json` on `main`.
