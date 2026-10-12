# Instagram comment-to-DM webhook (AIFeed.run, Meta app 1367205021940381)

Cloudflare Worker (free plan). When someone comments a message containing the word "AI" on @aifeed.run's own posts, it sends one private reply DM with the newsletter link, then posts "Sent you a DM 📩" publicly. Comments are deduped by comment id in KV, and a simple log is kept in KV (90-day TTL) and `wrangler tail`.

Safety: the Worker is inert unless `ENABLED="true"` AND the `IG_ACCESS_TOKEN` secret is set. While inert it only logs matches. Signature (X-Hub-Signature-256) is required on every POST. Until App Review passes, Meta only delivers events and allows replies for app-role users (admins, developers, testers).

## Deploy (one-time)
1. Free Cloudflare account: https://dash.cloudflare.com/sign-up
2. `npx wrangler login`
3. `npx wrangler kv namespace create STATE` and paste the id into wrangler.toml
4. Secrets (prompted, never echoed or committed):
   - `npx wrangler secret put META_APP_SECRET`
   - `npx wrangler secret put VERIFY_TOKEN` (any random string, also entered in Meta)
   - `npx wrangler secret put IG_ACCESS_TOKEN` (long-lived Page token with instagram_manage_messages and instagram_manage_comments)
5. `npx wrangler deploy` gives https://aifeed-ig-dm-webhook.<subdomain>.workers.dev
6. Turn on: set `ENABLED = "true"` in wrangler.toml and redeploy.

## Meta setup (NOT done yet)
- App → Webhooks → Instagram: callback URL = worker URL, verify token = VERIFY_TOKEN, subscribe field `comments`.
  https://developers.facebook.com/apps/1367205021940381/webhooks/
- Subscribe the Page to the app: `POST /{page-id}/subscribed_apps?subscribed_fields=feed` with the Page token (Instagram comment events for the linked IG account flow once the app is subscribed).
- App must be in Live mode to receive webhooks for real comments.

## Test
`node test.mjs` covers the handshake, signature, keyword, DM and public reply, dedupe, own comments, and the inert mode.

## Logs
`npx wrangler tail`, or `npx wrangler kv key list --binding STATE --prefix log:`
