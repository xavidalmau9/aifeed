# Fit arc geometry (center y, radius, end angle, stroke width, opacity) to the IG avatar via SDF rasterization.
import numpy as np, json
from PIL import Image
from scipy.optimize import minimize
o = np.array(Image.open('/workspace/aifeed-fb-brand/work/ig_avatar.jpg').convert('RGB')).astype(float)
BG = np.array([13,13,25.]); PU = np.array([109,63,232.])
Y0,Y1,X0,X1 = 135,265,115,385
yy,xx = np.mgrid[Y0:Y1,X0:X1].astype(float) + 0.0
target = o[Y0:Y1,X0:X1]
mask = ~((xx-249.5)**2+(yy-257.5)**2 < 26**2)  # exclude dot
def cover(cy,R,a,w):
    dx,dy = xx-250, cy-yy
    ang = np.degrees(np.arctan2(dy,dx))
    inside = (ang>=a)&(ang<=180-a)
    d_ring = np.abs(np.hypot(dx,dy)-R)
    ex = R*np.cos(np.radians(a)); ey = R*np.sin(np.radians(a))
    d_end = np.minimum(np.hypot(dx-ex,dy-ey), np.hypot(dx+ex,dy-ey))
    d = np.where(inside, d_ring, d_end)
    return np.clip(w/2 - d + 0.5, 0, 1)
def render(p):
    img = np.broadcast_to(BG,(Y1-Y0,X1-X0,3)).copy()
    for i in range(3):  # outer, middle, inner
        cy,R,a,w,op = p[i*5:i*5+5]
        c = cover(cy,R,a,w)[...,None]*op
        img = img*(1-c) + PU*c
    return img
def loss(p):
    return (((render(p)-target)**2).sum(-1)*mask).mean()
p0 = [267,107,14,19,.24, 246,73,13,18,.55, 216,38,5,18,1.0]
r = minimize(loss, p0, method='Powell', options={'maxiter':20000,'xtol':1e-3,'ftol':1e-4})
r = minimize(loss, r.x, method='Nelder-Mead', options={'maxiter':20000,'xatol':1e-3,'fatol':1e-3})
print('loss', loss(p0), '->', r.fun)
names=['outer','middle','inner']
out={names[i]:dict(zip(['cy','R','a','w','op'],[round(float(v),2) for v in r.x[i*5:i*5+5]])) for i in range(3)}
print(json.dumps(out,indent=1)); json.dump(out,open('arcs.json','w'))
