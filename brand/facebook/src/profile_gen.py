# Generates profile.html: a vector rebuild of the @aifeed.run Instagram avatar (geometry measured from the 500px IG image).
import sys, math, json, os
A = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'arcs.json')))
P = dict(fs=51.7, ls=11.0, tx=131, base=345, rfs=23, rls=4.6, rx=233, rbase=385)
for a in sys.argv[2:]:
    k, v = a.split('='); P[k] = float(v)
size = int(sys.argv[1]) if len(sys.argv) > 1 else 1080
PURPLE = '#6d3fe8'
def arc(cx, cy, r, a0=12, a1=168):
    x0 = cx + r*math.cos(math.radians(180-a0)); y0 = cy - r*math.sin(math.radians(180-a0))
    x1 = cx + r*math.cos(math.radians(180-a1)); y1 = cy - r*math.sin(math.radians(180-a1))
    return f'M{x0:.2f},{y0:.2f} A{r},{r} 0 0 1 {x1:.2f},{y1:.2f}'
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="{size}" height="{size}">
<rect width="500" height="500" fill="#0d0d19"/>
<g fill="none" stroke="{PURPLE}" stroke-linecap="round">
{''.join(f'<path d="{arc(250,A[k]['cy'],A[k]['R'],A[k]['a'],180-A[k]['a'])}" stroke-width="{A[k]['w']}" stroke-opacity="{min(A[k]['op'],1)}"/>' for k in ('outer','middle','inner'))}
</g>
<circle cx="249.5" cy="257.5" r="21.8" fill="{PURPLE}"/>
<text x="{P['tx']}" y="{P['base']}" font-family="Arimo" font-weight="700" font-size="{P['fs']}" letter-spacing="{P['ls']}" fill="#fcfcfc">AIFEED</text>
<text x="{P['rx']}" y="{P['rbase']}" font-family="Arimo" font-weight="400" font-size="{P['rfs']}" letter-spacing="{P['rls']}" fill="#7b5ad6">.run</text>
</svg>'''
open('profile.html', 'w').write(f'<!doctype html><html><head><meta charset="utf-8"><style>*{{margin:0;padding:0}}html,body{{width:{size}px;height:{size}px;overflow:hidden;background:#0d0d19}}svg{{display:block}}</style></head><body>{svg}</body></html>')
