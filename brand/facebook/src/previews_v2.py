# Previews for cover_v2 (1702x630): desktop box measured from the live page (2.70:1, full fill, top-anchored),
# and phone boxes 2.4:1 and 16:9 with the cover cropped left-anchored and centered.
import base64, subprocess
D = '/workspace/aifeed-fb-brand'
b64 = lambda p: 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
COVER, PROF = b64(f'{D}/cover_v2.png'), b64(f'{D}/profile.png')
CW, CH = 1702, 630
HEAD = '''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=block" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#18191a;font-family:Inter,sans-serif;color:#e4e6eb}
h2{font:700 30px Inter;color:#fff;margin-bottom:6px}.note{font:400 20px Inter;color:#b0b3b8;margin-bottom:22px}
.cov{background-image:url(COVER);background-repeat:no-repeat}
.pp{border-radius:50%;background:url(PROF) center/cover;position:absolute}
.btn{display:inline-block;padding:12px 22px;border-radius:8px;font:600 20px Inter;margin-right:10px}
</style></head><body>'''.replace('COVER', COVER).replace('PROF', PROF)
def render(name, html, w, h):
    p = f'{D}/src/preview_{name}.html'; open(p, 'w').write(html)
    r = subprocess.run(['./render.sh', p, f'{D}/preview_{name}.png', str(w), str(h)], capture_output=True, text=True); print(r.stdout.strip(), r.stderr.strip())

# Desktop: live layout measured from the screenshot. Box 2.696:1, profile picture BELOW the cover (no overlap).
BW = 1640; BH = round(BW / 2.696)
desk = HEAD + f'''<div style="padding:40px">
<h2>Desktop: Facebook Page header, measured live layout</h2>
<div class="note">Cover box 2.70:1 (measured from the live page). cover_v2 is 2.70:1 too, so it fills the box with nothing cropped, wherever Facebook anchors it.</div>
<div style="position:relative;width:{BW}px;height:{BH+330}px;background:#fff;border-radius:0 0 16px 16px">
  <div class="cov" style="position:absolute;left:0;top:0;width:{BW}px;height:{BH}px;background-size:{BW}px auto;background-position:0 0;border-radius:0 0 16px 16px"></div>
  <div style="position:absolute;right:30px;top:{BH-70}px;background:#fff;color:#050505;border-radius:8px;padding:10px 18px;font:600 22px Inter">📷 Edit cover photo</div>
  <div style="position:absolute;left:44px;top:{BH+30}px;width:290px;height:290px;border-radius:50%;background:#fff"></div>
  <div class="pp" style="left:50px;top:{BH+36}px;width:278px;height:278px"></div>
  <div style="position:absolute;left:380px;top:{BH+50}px;color:#050505"><div style="font:700 56px Inter">AI Feed</div><div style="font:400 26px Inter;color:#65676b;margin-top:8px">Media/news company</div></div>
  <div style="position:absolute;right:40px;top:{BH+70}px"><span class="btn" style="background:#0866ff;color:#fff">Follow</span><span class="btn" style="background:#e4e6eb;color:#050505">Message</span></div>
</div></div></body></html>'''
render('desktop', desk, 1720, 40+50+50+BH+330+40)

# Mobile: phone 430 pt wide, shown 2x (860 px). Image fills box height; cropped on the right (left-anchored) or both sides (centered).
def phone(title, ratio, anchor):
    bw = 860; bh = round(bw / ratio); s = bh / CH; iw = round(CW * s)
    off = 0 if anchor == 'left' else -round((iw - bw) / 2)
    return f'''<div style="flex:none;margin-right:40px">
<div style="font:600 22px Inter;color:#fff;margin-bottom:14px">{title}</div>
<div style="position:relative;width:900px;height:1000px;border-radius:70px;background:#000;padding:20px">
 <div style="position:relative;width:860px;height:960px;border-radius:52px;overflow:hidden;background:#242526">
  <div style="height:90px;background:#18191a;display:flex;align-items:center;justify-content:space-between;padding:0 40px;font:600 28px Inter;color:#fff"><span>9:41</span><span>●●● ▮</span></div>
  <div class="cov" style="width:{bw}px;height:{bh}px;background-size:{iw}px {bh}px;background-position:{off}px 0"></div>
  <div style="position:absolute;left:24px;top:{90+bh-80-8}px;width:296px;height:296px;border-radius:50%;background:#242526"></div>
  <div class="pp" style="left:32px;top:{90+bh-80}px;width:280px;height:280px"></div>
  <div style="position:absolute;left:40px;top:{90+bh+220}px"><div style="font:700 60px Inter;color:#fff">AI Feed</div>
   <div style="margin-top:24px"><span class="btn" style="background:#0866ff;color:#fff;font-size:28px;padding:16px 60px">Follow</span><span class="btn" style="background:#3a3b3c;color:#e4e6eb;font-size:28px;padding:16px 50px">Message</span></div></div>
 </div></div></div>'''
mob = HEAD + '''<div style="padding:40px;width:3880px"><h2>Mobile: Facebook app (430 pt wide phone, shown 2×), cover_v2 in every likely phone crop</h2>
<div class="note">Facebook documents the phone cover as 2.4:1 (Help Center) or 640×360 = 16:9 (Business Help Center), and says it "left aligns". Each shape is shown left-anchored and centered. The profile picture overlaps the cover by 40 pt.</div>
<div style="display:flex">''' + phone('2.4:1, left-anchored', 2.4, 'left') + phone('2.4:1, centered', 2.4, 'center') + phone('16:9, left-anchored', 16/9, 'left') + phone('16:9, centered', 16/9, 'center') + '</div></div></body></html>'
render('mobile', mob, 3880, 40+50+60+50+1000+60)
