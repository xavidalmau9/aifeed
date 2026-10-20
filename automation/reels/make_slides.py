#!/usr/bin/env python3
"""AIFeed carousel slides (IG 4:5, 1080x1350) + Story (9:16) in the approved Reel design.

Same look as the Reel cover: the story-themed scene full-bleed under a heavy dark overlay, the huge Anton punch
headline with its accent line in the category pill color, the outlined category pill top-left and the AIFeed.run logo
bottom-right. Slides: 1 = cover hook, 2..N = key points over a blurred/darkened crop of the same scene, last = CTA.

The scene is picked ONCE (scenes.pick_scene, the Reel's chain) and saved as <out>/scene.jpg; make_reel.py --scene reuses
that file, so the carousel, Story and Reel share one image and one Cloudflare call at most. Pass --scene to reuse an
existing scene file (no generation at all).

Grid safety: IG shows a 4:5 post as a 3:4 tile by trimming ~34px off each side (1013x1350 visible), so every element
keeps >= 80px side margins; top/bottom elements also stay >= 70px in.
Prints one JSON line: {slides: [...], story, scene, sceneSource, sceneLog, credit, punch, points}.
"""
import argparse, json, os, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_reel as mr  # noqa: E402
import scenes  # noqa: E402

FW, FH = 1080, 1350
X0, X1 = 80, 1000           # text column (inside the 3:4 grid crop, x 34-1046)
PILL_Y = 76
PUNCH_TOP, PUNCH_BOTTOM = 600, 1150
FILLER = 'Full story at aifeed.run.'


def scene_4x5(scene, y_frac=.30):
    """4:5 window of the 9:16 scene. Scenes are fitted with the subject in the upper half, so take the window from
    ~1/3 down: the subject lands in the top half of the slide, above the headline."""
    s = scene.convert('RGB').resize((FW, int(scene.height * FW / scene.width)), mr.Image.LANCZOS)
    top = int((s.height - FH) * y_frac)
    return s.crop((0, top, FW, top + FH))


def lowkey(img):
    return min(1.0, max(.2, float(np.asarray(img.convert('L')).mean()) / 95))


def cover_bg(scene):
    ph = mr.grade(scene_4x5(scene)); lk = lowkey(ph)
    dark = mr.vignette(Image.blend(ph, Image.new('RGB', ph.size, (0, 0, 0)), .42 * lk), .55 * lk)
    return mr.shade(dark, [(0, .5 * lk), (.14, .28 * lk), (.38, .4 * lk), (.52, .8), (.7, .93), (1, .97)], (0, 0, 0))


def point_bg(scene, k):
    """Key-point slides: the same scene, shifted per slide, blurred and crushed dark so large type reads cleanly."""
    ph = mr.grade(scene_4x5(scene, (.15, .45, .7, .3)[k % 4]))
    ph = scenes.lift(ph, 60)
    ph = ph.filter(ImageFilter.GaussianBlur(14))
    ph = mr.vignette(Image.blend(ph, Image.new('RGB', ph.size, (0, 0, 0)), .5), .5)
    return mr.shade(ph, [(0, .3), (.35, .35), (1, .55)], (0, 0, 0))


class Slides:
    def __init__(self, post, scene, credit='', src=''):
        self.post = post
        self.r = mr.Reel(post, None, scene, src, credit)  # pill, accent, punch lines, logo, CTA, banned-word check
        self.scene, self.credit = scene, credit
        self.accent = self.r.accent
        pts = [p for p in (mr.voice_points(post, max_points=3) or []) if p] or []
        if not pts:
            pts = [p for p in mr.key_points(post) if p != FILLER]
        self.points = pts[:3]
        if mr.BANNED.search(' '.join(self.points)):
            raise SystemExit('banned wording in carousel text')
        self.n = 1 + len(self.points) + 1

    def chrome(self, fr, i):
        """Pill top-left, logo bottom-right, slide counter top-right (not on the cover)."""
        mr.paste_alpha(fr, self.r.pill, X0, PILL_Y)
        mr.paste_alpha(fr, self.r.brand, X1 - self.r.brand.width + 20, FH - 70 - self.r.brand.height + 24)
        if i > 0:
            spr, ox, oy = mr.text_sprite(f'{i + 1}/{self.n}', mr.FONT('SemiBold', 34), mr.MUTED, shadow=True)
            mr.paste_alpha(fr, spr, X1 + 24 - spr.width, PILL_Y + 14 - oy)

    def cover(self):
        fr = cover_bg(self.scene).convert('RGBA')
        for (spr, ox, oy), x, y in mr.punch_sprites(self.r.punch, self.r.punch_pink, self.accent, x0=X0, x1=X1,
                                                    top=PUNCH_TOP, bottom=PUNCH_BOTTOM, cap=230):
            mr.paste_alpha(fr, spr, x - ox, y - oy)
        ImageDraw.Draw(fr).rectangle((X0, PUNCH_BOTTOM + 34, X0 + 200, PUNCH_BOTTOM + 44), fill=self.accent)
        self.chrome(fr, 0)
        swipe, ox, oy = mr.text_sprite('SWIPE', mr.FONT('Bold', 30), mr.WHITE, shadow=True)
        sy = FH - 70 - 40 + 8; mr.paste_alpha(fr, swipe, X0 - ox, sy - oy, .9)
        ax = X0 + swipe.width - 2 * 24 + 16; ay = sy + 11; dd = ImageDraw.Draw(fr)  # drawn arrow (no glyph dependency)
        dd.line((ax, ay, ax + 40, ay), fill=self.accent, width=5)
        dd.polygon([(ax + 40, ay - 10), (ax + 54, ay), (ax + 40, ay + 10)], fill=self.accent)
        if self.credit:
            spr, ox, oy = self.r.credit
            mr.paste_alpha(fr, spr, X0 - ox, FH - 70 - 40 - 44 - oy, .85)
        return fr.convert('RGB')

    def point(self, k):
        fr = point_bg(self.scene, k).convert('RGBA'); d = ImageDraw.Draw(fr)
        num, ox, oy = mr.text_sprite(f'0{k + 1}', mr.FONT('Anton', 200), self.accent, shadow=False)
        mr.paste_alpha(fr, num, X0 - ox, 300 - oy)
        y = 300 + (num.height - 2 * 24) + 50
        d.rectangle((X0, y, X0 + 140, y + 10), fill=self.accent)
        f, lines, lh = mr.fit(self.points[k], 'Bold', X1 - X0, FH - 200 - (y + 50), 84, 54, 1.14)
        yy = y + 50
        for line in lines:
            spr, ox, oy = mr.text_sprite(line, f, mr.WHITE)
            mr.paste_alpha(fr, spr, X0 - ox, yy - oy); yy += lh
        self.chrome(fr, k + 1)
        return fr.convert('RGB')

    def cta(self):
        fr = point_bg(self.scene, 3).convert('RGBA')
        lines = ['FOLLOW FOR', 'THE AI NEWS', 'THAT MATTERS.']
        for (spr, ox, oy), x, y in mr.punch_sprites(lines, 2, self.accent, x0=X0, x1=X1, top=330, bottom=850, cap=200):
            mr.paste_alpha(fr, spr, x - ox, y - oy)
        mr.paste_alpha(fr, self.r.cta, X0, 920)
        web, ox, oy = mr.text_sprite('Full story at aifeed.run', mr.FONT('Regular', 38), mr.MUTED, shadow=False)
        mr.paste_alpha(fr, web, X0 - ox, 1070 - oy)
        self.chrome(fr, self.n - 1)
        return fr.convert('RGB')

    def all(self):
        return [self.cover()] + [self.point(k) for k in range(len(self.points))] + [self.cta()]

    def story(self):
        return self.r.cover()  # the Reel's cover frame: 9:16, same scene, same headline


def build(post, feed_path, out_dir, photo=None, scene_path=None, scene_source='', scene_credit=''):
    os.makedirs(out_dir, exist_ok=True)
    if not post.get('punch') or not scenes.valid_punch(post.get('punch')):
        post = dict(post, punch=scenes.rule_punch(post.get('headline', '')))
    log = []
    if scene_path:
        img = Image.open(scene_path).convert('RGB'); src, credit = scene_source or 'shared', scene_credit
        log.append(f'{src}: reused {os.path.basename(scene_path)}')
    else:
        feed = Image.open(feed_path) if feed_path and os.path.exists(feed_path) else None
        img, credit, src = scenes.pick_scene(post, photo, feed, log)
        if src == 'story':
            credit = mr.clean(post.get('photoCredit') or '')
    scene_out = os.path.join(out_dir, 'scene.jpg')
    if not scene_path or os.path.abspath(scene_path) != os.path.abspath(scene_out):
        img.save(scene_out, quality=94)
    s = Slides(post, img, credit, src)
    names = []
    for i, im in enumerate(s.all()):
        p = os.path.join(out_dir, f'slide_{i + 1}.png'); im.save(p, optimize=True); names.append(p)
    story = os.path.join(out_dir, 'story.png'); s.story().save(story, optimize=True)
    return {'slides': names, 'story': story, 'scene': scene_out, 'sceneSource': src, 'sceneLog': log,
            'credit': credit, 'punch': post.get('punch'), 'points': s.points}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--post', required=True); ap.add_argument('--image', default=''); ap.add_argument('--out-dir', required=True)
    ap.add_argument('--photo', default=''); ap.add_argument('--punch', default='')
    ap.add_argument('--scene', default=''); ap.add_argument('--scene-source', default=''); ap.add_argument('--scene-credit', default='')
    a = ap.parse_args()
    post = json.load(open(a.post))
    if a.punch:
        post['punch'] = a.punch
    print(json.dumps(build(post, a.image, a.out_dir, a.photo or None, a.scene or None, a.scene_source, a.scene_credit)))
