# Simulates the measured live Facebook desktop crop: cover box at x271-936, y30-276 in the 1024x594 screenshot
# (666x247 px, 2.696:1). Facebook fills the box width and anchors the top (old 16:9 cover: visible y 0-608 of 924).
from PIL import Image, ImageDraw, ImageFont
import numpy as np
SHOT = '/home/box/agent-data/agents/50fac7ba-ff2e-4e22-922b-6a10c3efe543/assets/412c7cbf591b1622f1ac6c5cae638b0376a29102a5ef43bd1b6b28d350b64b7c.png'
D = '/workspace/aifeed-fb-brand'
BX0, BY0, BW, BH = 271, 30, 666, 247
REG = (192, 0, 1024, 440); Z = 2
shot = Image.open(SHOT).convert('RGB')
base = shot.crop(REG).resize(((REG[2]-REG[0])*Z, (REG[3]-REG[1])*Z), Image.LANCZOS)
def composite(cover_path):
    cov = Image.open(cover_path).convert('RGB')
    s = BW * Z / cov.width                          # fill width
    sc = cov.resize((BW*Z, round(cov.height*s)), Image.LANCZOS).crop((0, 0, BW*Z, BH*Z))  # top-anchored
    out = base.copy(); out.paste(sc, ((BX0-REG[0])*Z, (BY0-REG[1])*Z))
    # put Facebook's own overlays back (Edit cover photo button, Share-a-thought bubble)
    o = np.array(base); n = np.array(out)
    for (x0, y0, x1, y1) in [(834, 249, 922, 270), (283, 268, 354, 300)]:
        a = [(x0-REG[0])*Z, (y0-REG[1])*Z, (x1-REG[0])*Z, (y1-REG[1])*Z]
        blk = o[a[1]:a[3], a[0]:a[2]]; light = blk.mean(-1) > 150
        n[a[1]:a[3], a[0]:a[2]][light] = blk[light]
    return Image.fromarray(n), s
after, s2 = composite(f'{D}/cover_v2.png')
W, H = base.width, base.height
f = ImageFont.truetype('/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf', 26)
f2 = ImageFont.truetype('/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf', 20)
canvas = Image.new('RGB', (W, 2*H + 170), (24, 25, 26)); d = ImageDraw.Draw(canvas)
d.text((20, 18), 'BEFORE: live screenshot, cover.png 1640x924 (Facebook shows only cover y 0-608: the top 66%)', font=f, fill='white')
canvas.paste(base, (0, 60))
d.text((20, H + 88), f'AFTER: cover_v2.png 1702x630 in the same measured box ({BW}x{BH}, 2.70:1), scale {s2:.3f}: whole image visible, nothing cropped', font=f, fill='white')
canvas.paste(after, (0, H + 130))
# dashed outline of the measured visible box on both panels
for oy in (60, H + 130):
    x0, y0 = (BX0-REG[0])*Z, (BY0-REG[1])*Z + oy; x1, y1 = x0 + BW*Z, y0 + BH*Z
    for x in range(x0, x1, 16): d.line([(x, y0), (min(x+8, x1), y0)], fill='#ffd400', width=2); d.line([(x, y1), (min(x+8, x1), y1)], fill='#ffd400', width=2)
    for y in range(y0, y1, 16): d.line([(x0, y), (x0, min(y+8, y1))], fill='#ffd400', width=2); d.line([(x1, y), (x1, min(y+8, y1))], fill='#ffd400', width=2)
d.text((20, 2*H + 140), 'Yellow dashes = the measured visible cover box (screenshot x 271-936, y 30-276).', font=f2, fill='#b0b3b8')
canvas.save(f'{D}/preview_live_crop.png'); print('saved', canvas.size)
