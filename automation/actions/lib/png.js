const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || !buf.slice(0, 8).equals(PNG_SIG)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function assertPng(buf, width, height, { minBytes, label }) {
  const size = pngSize(buf);
  const got = size ? `${size.width}x${size.height}` : 'not-png';
  if (!size || size.width !== width || size.height !== height || buf.length < minBytes) {
    throw new Error(`${label} invalid (png=${!!size}, ${got}, ${buf ? buf.length : 0} bytes)`);
  }
  if (buf.length > 8 * 1024 * 1024) throw new Error('PNG over 8MB Instagram limit');
  return size;
}

function assertFeedPng(buf) {
  return assertPng(buf, 1080, 1350, { minBytes: 60000, label: 'Rendered image' });
}

function assertStoryPng(buf) {
  return assertPng(buf, 1080, 1920, { minBytes: 60000, label: 'Story image' });
}

module.exports = { pngSize, assertPng, assertFeedPng, assertStoryPng };
