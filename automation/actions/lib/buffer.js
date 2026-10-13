// LinkedIn via Buffer's GraphQL API (https://api.buffer.com). Posts only to the AIFeed.run LinkedIn page channel.
const BUFFER_API = 'https://api.buffer.com';

const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status } }
    ... on MutationError { message }
  }
}`;

function bufferLinkedinEnabled(cfg, env) {
  return Boolean(cfg.bufferLinkedinEnabled && /^[a-f\d]{24}$/.test(cfg.bufferLinkedinChannelId || '') && env.BUFFER_API_KEY);
}

// LinkedIn caption + aifeed.run story link (inserted above the Source/CTA block).
function bufferLinkedinText(liCaption, storyUrl) {
  const blocks = String(liCaption || '').split(/\n\n/);
  const i = blocks.findIndex(b => /^Source:/.test(b));
  const link = 'Read the full story: ' + storyUrl;
  if (!blocks.some(b => b.includes(storyUrl))) {
    if (i >= 0) blocks.splice(i, 0, link); else blocks.push(link);
  }
  let text = blocks.join('\n\n');
  if (/\bdaily\b/i.test(text)) text = text.replace(/\bdaily\b/gi, 'weekly');
  if (text.length > 2990) text = text.slice(0, 2985).replace(/\s+\S*$/, '') + '…';
  return text;
}

async function bufferGraphql(apiKey, query, variables) {
  const res = await fetch(BUFFER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) throw new Error('Buffer HTTP ' + res.status + ' ' + JSON.stringify(json.errors || json).slice(0, 300));
  return json.data;
}

// imageUrls: public image URLs (feed graphic, end card). videoUrl: optional public mp4; when set it is posted as a LinkedIn video.
async function bufferLinkedinPost({ cfg, env, text, imageUrls = [], videoUrl = '', altText = '' }) {
  const assets = videoUrl
    ? [{ video: { url: videoUrl } }]
    : imageUrls.map(url => ({ image: { url, metadata: { altText: altText || 'AIFeed.run story graphic' } } }));
  const data = await bufferGraphql(env.BUFFER_API_KEY, CREATE_POST, {
    input: {
      channelId: cfg.bufferLinkedinChannelId,
      schedulingType: 'automatic',
      mode: 'shareNow',
      needsApproval: false,
      text,
      assets
    }
  });
  const r = data && data.createPost;
  if (!r || r.__typename !== 'PostActionSuccess') throw new Error('Buffer createPost ' + (r && r.__typename) + ': ' + (r && r.message));
  return r.post;
}

module.exports = { bufferLinkedinEnabled, bufferLinkedinText, bufferLinkedinPost, CREATE_POST };
