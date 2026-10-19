"""Offline tests for the hook-first + voiceover Reel (python3 -m unittest test_voice). Piper-only tests skip without it."""
import os, unittest
import numpy as np
from PIL import Image
import make_reel as M
import voice
from test_scenes import textured

POST = {'slug': 'test-story', 'headline': 'Microsoft\u2019s new AI chip makes it less reliant on Nvidia\u2019s GPUs', 'category': 'Hardware',
        'punch': 'MICROSOFT / *BUILDS ITS OWN / AI CHIP',
        'summary': 'Microsoft unveiled a new AI accelerator designed in house for its Azure data centers. The chip targets inference workloads that now run on Nvidia hardware.',
        'body': '<p>The company says the part will ship in its own servers first, starting next year across several regions.</p>'}


def fake_vo(texts, wps=2.6, gap=.32):
    """voice.synth()-shaped result without Piper: words evenly timed at `wps` words/second."""
    t, segs = 0.0, []
    for name, text in texts:
        ws = voice.words_of(text); words = []
        for w in ws:
            words.append((w, t, t + .8 / wps)); t += 1 / wps
        segs.append({'name': name, 'text': text, 'start': segs and words[0][1] or 0.0, 'end': t, 'words': words}); t += gap
    for sg in segs:
        sg['start'] = sg['words'][0][1]
    return {'audio': np.zeros(int(t * voice.SR), np.float32), 'segments': segs, 'seconds': t}


def reel(vo=None, total=None):
    return M.Reel(POST, Image.new('RGB', (1080, 1350)), textured(1600, 1000, 80), 'The Verge', '', vo, total)


class HookFirst(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        segs = voice.script(POST['headline'], M.key_points(POST)[:2])
        cls.vo = fake_vo(segs); cls.r = reel(cls.vo, cls.vo['seconds'] + 1.2)

    def test_frame0_is_the_cover_with_the_full_headline(self):
        cov = np.asarray(self.r.cover()).astype(np.int16)
        for t in (0, .4):
            fr = np.asarray(self.r.frame(t)).astype(np.int16)
            band = np.abs(fr[M.PUNCH_TOP:M.PUNCH_BOTTOM] - cov[M.PUNCH_TOP:M.PUNCH_BOTTOM]).mean()
            self.assertLess(band, 6, f'headline band differs from the cover at t={t}')  # only the slow push-in moves
        fr0 = np.asarray(self.r.frame(0).convert('L')).astype(np.float32)
        self.assertGreater((fr0[M.PUNCH_TOP:M.PUNCH_BOTTOM] > 235).mean(), .05, 'no big white headline on frame 0')

    def test_no_fade_from_black(self):
        self.assertGreater(np.asarray(self.r.frame(0)).mean(), 20)

    def test_timeline_is_voice_driven(self):
        self.assertAlmostEqual(sum(d for _, d in self.r.scenes), self.r.total, places=4)
        self.assertEqual([n for n, _ in self.r.scenes][0], 'hook')
        self.assertEqual([n for n, _ in self.r.scenes][-1], 'end')

    def test_captions_in_safe_zone_and_clear_of_headline_and_logo(self):
        dock_bottom = max(y + spr.height - 48 for (spr, ox, oy), x, y in self.r.d_lines)
        self.assertLessEqual(dock_bottom, M.DOCK_BOTTOM + 2)
        self.assertTrue(self.r.captions)
        for t0, t1, items in self.r.captions:
            self.assertLess(t0, t1)
            for (w, ox, oy), _, x, y, ta, tb in items:
                gw, gh = w.width - 48, w.height - 48
                self.assertGreaterEqual(x, M.CAP_X0); self.assertLessEqual(x + gw, M.CAP_X1 + 2)
                self.assertGreater(y, dock_bottom + 20)
                self.assertLess(y + gh, M.SAFE_BOTTOM)  # logo row sits at SAFE_BOTTOM + 8
                self.assertTrue(t0 - 1e-6 <= ta <= t1)

    def test_caption_word_highlight_follows_audio(self):
        sg = self.vo['segments'][1]; w, ta, tb = sg['words'][1]
        fr = np.asarray(self.r.frame((ta + tb) / 2)).astype(np.int16)
        acc = np.array(self.r.accent)
        band = fr[M.CAP_TOP:M.CAP_TOP + 220, M.CAP_X0:M.CAP_X1]
        self.assertGreater((np.abs(band - acc).sum(2) < 40).sum(), 200, 'spoken word not drawn in the accent')

    def test_end_card_last(self):
        fr = self.r.frame(self.r.total - .05)
        self.assertEqual(fr.size, (1080, 1920))


class Script(unittest.TestCase):
    def test_script_shape_and_banned_words(self):
        s = voice.script('Big news', ['One.', 'Two', 'Three.', 'Four.'])
        self.assertEqual([n for n, _ in s], ['hook', 'p1', 'p2', 'p3', 'end'])
        self.assertTrue(all(t.endswith(('.', '?', '!')) for _, t in s))
        with self.assertRaises(ValueError):
            voice.script('Your daily AI briefing', ['x.'])
        with self.assertRaises(ValueError):
            voice.script('Headline', ['Hand-edited by our editors.'])
        self.assertNotRegex(voice.OUTRO, voice.BANNED)

    def test_spoken_normalization(self):
        self.assertEqual(voice.spoken('AI firm raises $5B, up 40% \u2014 fast'), 'A.I. firm raises 5 billion dollars, up 40 percent , fast')

    def test_phrases_are_short_and_ordered(self):
        ws = [(w, i * .4, i * .4 + .3) for i, w in enumerate('The chip targets inference workloads that now run on Nvidia hardware.'.split())]
        ph = voice.phrases(ws)
        self.assertEqual(sum(len(p[0]) for p in ph), len(ws))
        self.assertTrue(all(len(p[0]) <= 5 for p in ph))
        self.assertTrue(all(a[2] <= b[1] + 1e-9 for a, b in zip(ph, ph[1:])))
        self.assertNotIn(ph[0][0][-1][0].lower(), voice.DANGLE)

    def test_fit_duration_clamps_12_to_18(self):
        real = voice.synth
        H = 'A long headline about a chip that matters a lot to everyone'
        P = ['Point number one is here and it is long enough to matter.', 'Point two has a fair amount of detail too.', 'Point three closes it out.']
        S = ['Short one.', 'Short two.']
        try:
            voice.synth = lambda segs, path=None, ls=1.0, gap=.32: fake_vo(segs, 6.0 / ls, gap)  # fast talker: all 3, padded
            vo, segs, total = voice.fit_duration(H, P, path='x')
            self.assertEqual(len(segs), 5); self.assertEqual(total, 12.0)
            voice.synth = lambda segs, path=None, ls=1.0, gap=.32: fake_vo(segs, 2.4 / ls, gap)  # normal pace
            vo, segs, total = voice.fit_duration(H, P, path='x', short_points=S)
            self.assertGreaterEqual(total, 12); self.assertLessEqual(total, 18)
            self.assertGreaterEqual(len(segs) - 2, 2)
            voice.synth = lambda segs, path=None, ls=1.0, gap=.32: fake_vo(segs, 1.9 / ls, gap)  # slow: shorter points first
            vo, segs, total = voice.fit_duration(H, P, path='x', short_points=S)
            self.assertLessEqual(total, 18); self.assertEqual([t for _, t in segs[1:-1]], S)
        finally:
            voice.synth = real


class Brand(unittest.TestCase):
    def test_hardware_accent_is_bright(self):
        bg, fg = M.pill_colors('Hardware')
        self.assertNotEqual(bg, M._hex('#475569'))
        self.assertGreater(M.contrast(bg, (12, 12, 16)), 7)
        self.assertGreater(M.contrast(bg, fg), 4.5)

    def test_music_only_fallback_keeps_fixed_timeline(self):
        r = reel()
        self.assertEqual(r.scenes, M.SCENES); self.assertAlmostEqual(r.total, M.TOTAL)
        fr = np.asarray(r.frame(0).convert('L')).astype(np.float32)
        self.assertGreater((fr[M.PUNCH_TOP:M.PUNCH_BOTTOM] > 235).mean(), .05)  # hook-first in the fallback too


def _piper_voice():
    try:
        import piper  # noqa
    except Exception:
        return ''
    p = os.environ.get('AIFEED_PIPER_VOICE') or os.path.join(voice.CACHE, voice.VOICE + '.onnx')
    return p if os.path.exists(p) and os.path.exists(p + '.json') else ''


@unittest.skipUnless(_piper_voice(), 'piper-tts or the cached voice not available')
class PiperSynth(unittest.TestCase):
    def test_word_timings_from_alignments(self):
        vo = voice.synth([('hook', 'Microsoft builds its own chip.'), ('end', voice.OUTRO)], _piper_voice())
        self.assertGreater(vo['seconds'], 1.5)
        ws = vo['segments'][0]['words']
        self.assertEqual([w for w, _, _ in ws], ['Microsoft', 'builds', 'its', 'own', 'chip.'])
        self.assertTrue(all(a < b for _, a, b in ws))
        self.assertTrue(all(p[2] <= q[1] + 1e-6 for p, q in zip(ws, ws[1:])))
        self.assertLessEqual(ws[-1][2], vo['segments'][0]['end'] + 1e-6)
        self.assertGreater(np.abs(vo['audio']).max(), .05)


if __name__ == '__main__':
    unittest.main()
