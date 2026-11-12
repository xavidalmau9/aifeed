import json
CATS=['Models','Tools','Research','Business','Policy','Safety','Industry','Products','Hardware','Infrastructure','Health']
OPT={
 'a':('Signal (brief hues, vivid)','Uses the hue mapping from the brief: Models lime, Tools cyan, Policy purple, Safety red, Business blue, Research green. The other categories go to hues those six leave open. Bright and high-energy, closest to the IG look.',
   dict(Models='#a3e635',Tools='#22d3ee',Research='#34d399',Business='#60a5fa',Policy='#c084fc',Safety='#f87171',Industry='#fbbf24',Products='#f472b6',Hardware='#fb923c',Infrastructure='#818cf8',Health='#2dd4bf')),
 'b':('Spectrum (maximum separation)','Spreads the 11 categories evenly around the hue wheel, so neighbouring chips never look alike. Research becomes blue and Business amber. Red stays only on Safety/Security, so it still reads as a warning.',
   dict(Models='#c084fc',Tools='#2dd4bf',Research='#60a5fa',Business='#fbbf24',Policy='#f472b6',Safety='#f87171',Industry='#a3e635',Products='#fb923c',Hardware='#22d3ee',Infrastructure='#a5b4fc',Health='#4ade80')),
 'c':('Soft (brief hues, pastel)','Same hue mapping as Option A, one step lighter (Tailwind 300-level). It is calmer and more editorial, has the highest contrast, and the purple/orange brand gradient stays the loudest thing on the page.',
   dict(Models='#bef264',Tools='#67e8f9',Research='#6ee7b7',Business='#93c5fd',Policy='#d8b4fe',Safety='#fca5a5',Industry='#fde68a',Products='#f9a8d4',Hardware='#fdba74',Infrastructure='#a5b4fc',Health='#5eead4')),
}
def rgb(h): h=h.lstrip('#'); return [int(h[i:i+2],16) for i in (0,2,4)]
def lum(c):
    c=[x/255 for x in c]; c=[x/12.92 if x<=.03928 else ((x+.055)/1.055)**2.4 for x in c]; return .2126*c[0]+.7152*c[1]+.0722*c[2]
def cr(a,b): la,lb=lum(a),lum(b); return (max(la,lb)+.05)/(min(la,lb)+.05)
def mix(c,base,a): return [round(base[i]*(1-a)+c[i]*a) for i in range(3)]
BG=rgb('#09081a'); CARD=mix([255,255,255],BG,.04)  # card surface
res={}
for k,(name,why,pal) in OPT.items():
    rows=[]
    for c in CATS:
        col=rgb(pal[c]); fill=mix(col,CARD,.14)  # pill fill on card (worst case, lighter than page bg)
        rows.append((c,pal[c],round(cr(col,BG),1),round(cr(col,fill),1),'#%02x%02x%02x'%tuple(fill)))
    res[k]=dict(name=name,why=why,pal=pal,rows=rows)
    print(k,name,'min bg',min(r[2] for r in rows),'min fill',min(r[3] for r in rows))
json.dump(res,open('palettes.json','w'),indent=1)
