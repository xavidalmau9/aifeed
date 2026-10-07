// Validates the 1080x1920 Story PNG and prepares its GitHub commit.
const cfg = $('Config').first().json;
const P = $('Validate PNG + Prep Commits').first().json;
const buf = await this.helpers.getBinaryDataBuffer(0, 'png');
const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
if (!isPng || w !== 1080 || h !== 1920 || buf.length < 60000) throw new Error(`Story image invalid (png=${isPng}, ${w}x${h}, ${buf.length} bytes)`);
const storyName = P.pngName.replace(/\.png$/, '_story.png');
return [{ json: { storyName, storyBase64: buf.toString('base64'), storyUrl: `${cfg.siteUrl}/images/${storyName}` } }];
