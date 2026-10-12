// AIFeed.run Instagram comment-to-DM webhook (Cloudflare Worker).
// Secrets (wrangler secret put): META_APP_SECRET, VERIFY_TOKEN, IG_ACCESS_TOKEN.
// Vars: IG_USER_ID, GRAPH_VERSION, ENABLED ("true" to send). KV binding: STATE.
// Inert unless ENABLED==="true" AND IG_ACCESS_TOKEN is set.

export const DM_TEXT =
  "Hey! 👋 Here's your free weekly AI brief from AIFeed.run, The AI news that matters. " +
  "Top AI stories, explained in 60 seconds, once a week in your inbox: " +
  "https://aifeed.run/subscribe/?utm_source=instagram&utm_medium=dm";
export const PUBLIC_REPLY = "Sent you a DM 📩";
export const matchesKeyword = (t) => /(^|[^a-z0-9])ai([^a-z0-9]|$)/i.test(t || "");

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function log(env, rec) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...rec });
  console.log(line);
  if (env.STATE) await env.STATE.put(`log:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, line,
    { expirationTtl: 90 * 86400 });
}
async function graph(env, path, body) {
  const r = await fetch(`https://graph.facebook.com/${env.GRAPH_VERSION || "v21.0"}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.IG_ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, error: j.error && j.error.message };
}

export async function handleComment(env, v) {
  const cid = v.id, text = v.text || "", from = (v.from || {}).id;
  if (!cid) return "no_id";
  if (from && from === env.IG_USER_ID) return "own_comment";
  if (v.parent_id) return "is_reply";
  if (!matchesKeyword(text)) return "no_keyword";
  const live = env.ENABLED === "true" && !!env.IG_ACCESS_TOKEN;
  if (!live) { await log(env, { ev: "match_inert", cid }); return "inert"; }
  const key = `done:${cid}`;
  if (env.STATE && (await env.STATE.get(key))) return "dup";
  if (env.STATE) await env.STATE.put(key, "1", { expirationTtl: 90 * 86400 });
  const dm = await graph(env, `${env.IG_USER_ID}/messages`,
    { recipient: { comment_id: cid }, message: { text: DM_TEXT } });
  let pub = { ok: false, skipped: true };
  if (dm.ok) pub = await graph(env, `${cid}/replies`, { message: PUBLIC_REPLY });
  await log(env, { ev: "reply", cid, media: (v.media || {}).id, dm: dm.ok ? "ok" : dm.error || dm.status,
    pub: pub.ok ? "ok" : pub.error || pub.status || "skipped" });
  return dm.ok ? "sent" : "dm_failed";
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health")
      return Response.json({ ok: true, live: env.ENABLED === "true" && !!env.IG_ACCESS_TOKEN });
    if (req.method === "GET") {
      const p = url.searchParams;
      if (p.get("hub.mode") === "subscribe" && env.VERIFY_TOKEN && p.get("hub.verify_token") === env.VERIFY_TOKEN)
        return new Response(p.get("hub.challenge") || "", { status: 200 });
      return new Response("forbidden", { status: 403 });
    }
    if (req.method !== "POST") return new Response("method", { status: 405 });
    const body = await req.text();
    const sig = (req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
    if (!env.META_APP_SECRET || !sig || !safeEqual(sig, await hmacHex(env.META_APP_SECRET, body)))
      return new Response("bad signature", { status: 401 });
    let data; try { data = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
    if (data.object !== "instagram") return new Response("ignored");
    const jobs = [];
    for (const e of data.entry || []) {
      if (env.IG_USER_ID && e.id && String(e.id) !== String(env.IG_USER_ID)) continue; // our account only
      for (const c of e.changes || []) if (c.field === "comments" && c.value) jobs.push(handleComment(env, c.value));
    }
    ctx.waitUntil(Promise.allSettled(jobs));
    return new Response("EVENT_RECEIVED");
  },
};
