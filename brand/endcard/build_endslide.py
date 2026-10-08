# Rebuilds images/aifeed_endslide.png from the v1 card: repaints only the outdated text areas
# (card 2 + card 3 titles/subs, bottom tagline) and sets the new copy in the same font, size, color and position.
import subprocess, sys
import numpy as np
from PIL import Image
D = '/workspace/aifeed-endslide'
v1 = np.array(Image.open(f'images/aifeed_endslide_v1.png').convert('RGB')).astype(float)
out = v1.copy()
def vfill(x0, x1, y0, y1):
    # replace rows y0..y1 with a per-column linear blend of row y0-1 and row y1+1 (smooth background, no text)
    top, bot = out[y0-1, x0:x1], out[y1+1, x0:x1]
    for y in range(y0, y1+1):
        t = (y - (y0-1)) / ((y1+1) - (y0-1))
        out[y, x0:x1] = top*(1-t) + bot*t
CARDS = {2: (387, 692), 3: (717, 1022)}           # interior x-range (borders at 385-386/693-694 and 715-716/1023-1024)
for c, (a, b) in CARDS.items():
    vfill(a+4, b-3, 656, 697)                      # title band
    vfill(a+4, b-3, 701, 731)                      # sub band
vfill(300, 781, 988, 1038)                         # tagline band
NEW = [  # (text, weight, size, center x, baseline y, color)
    ('Top AI Stories', 700, 26, 539.5, 685, (50, 215, 110)),
    ('Curated',        200, 18, 539.5, 720, (110, 110, 130)),
    ('60-Second Reads',700, 26, 869.5, 685, (255, 140, 0)),
    ('Explained',      200, 18, 869.5, 720, (110, 110, 130)),
    ('The AI news that matters.', 300, 32, 540, 1021, (190, 190, 210)),
]
for i, (t, w, s, cx, by, col) in enumerate(NEW):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#000"/><text x="{cx}" y="{by}" text-anchor="middle" font-family="Poppins" font-weight="{w}" font-size="{s}" fill="#fff">{t}</text></svg>'
    html = ('<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@200;300;700&display=block" rel="stylesheet">'
            '<style>*{margin:0}html,body{width:1080px;height:1350px;background:#000;overflow:hidden}svg{display:block}</style></head><body>' + svg + '</body></html>')
    open('/tmp/index.html', 'w').write(html)
    r = subprocess.run(['curl', '-s', '-o', f'/tmp/mask{i}.png', '-w', '%{http_code}', '-F', 'files=@/tmp/index.html;filename=index.html',
                        '-F', 'width=1080', '-F', 'height=1350', '-F', 'waitDelay=1', 'http://127.0.0.1:3000/forms/chromium/screenshot/html'], capture_output=True, text=True)
    assert r.stdout == '200', r.stdout
    a = np.array(Image.open(f'/tmp/mask{i}.png').convert('L')).astype(float)[..., None] / 255
    out = out*(1-a) + np.array(col, float)*a
    ys, xs = np.where(a[..., 0] > .3); print(f'{t!r}: ink x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()}')
Image.fromarray(np.clip(out+.5, 0, 255).astype('uint8')).save(f'images/aifeed_endslide.png', optimize=True)
diff = np.abs(out - v1).max(-1) > 2
ys, xs = np.where(diff); print('changed pixels', int(diff.sum()), 'bbox x', xs.min(), xs.max(), 'y', ys.min(), ys.max())
