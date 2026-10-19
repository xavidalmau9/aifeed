"""Offline tests for the hook-first + voiceover Reel (python3 -m unittest test_voice). Kokoro tests skip without the model."""
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
    """voice.synth()-shaped result without the TTS model: words evenly timed at `wps` words/second."""
    t, segs = 0.0, []
    for name, text in texts:
        ws = voice.words_of(text); words = []
        for w in ws:
            words.append((w, t, t + .8 / wps)); t += 1 / wps
        segs.append({'name': name, 'text': text, 'start': words[0][1], 'end': words[-1][2], 'words': words}); t += gap
    return {'audio': np.zeros(int(t * voice.SR), np.float32), 'segments': segs, 'seconds': t, 'voice': 'fake', 'speed': 1.0}


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

    def test_sections_change_exactly_at_spoken_boundaries(self):
        sg = {x['name']: x for x in self.vo['segments']}
        self.assertAlmostEqual(self.r.cuts[1], sg['p1']['start'], places=6)            # points start on the first word's onset
        self.assertAlmostEqual(self.r.cuts[-1] + M.END_FADE, sg['end']['start'], places=6)  # end card lands on the outro onset
        hook_end, p1 = sg['hook']['end'], sg['p1']['start']
        big = np.asarray(self.r.frame(hook_end - 1 / M.FPS).convert('L'))[1400:1480, 80:700]
        docked = np.asarray(self.r.frame(p1).convert('L'))[1400:1480, 80:700]
        self.assertGreater((big > 235).mean(), .02)   # still the big headline until the hook's last word ends
        self.assertLess((docked > 235).mean(), .01)   # fully docked by the first point's first word

    def test_caption_onset_rounds_to_the_nearest_frame(self):
        sg = self.vo['segments'][1]; _, ta, _ = sg['words'][2]
        acc = np.array(self.r.accent)
        def lit(t):
            fr = np.asarray(self.r.frame(t)).astype(np.int16)[M.CAP_TOP:M.CAP_TOP + 260, M.CAP_X0:M.CAP_X1]
            return (np.abs(fr - acc).sum(2) < 40).sum()
        f = round(ta * M.FPS)  # the frame nearest the onset already shows the word lit, the one before shows the previous word
        self.assertGreater(lit(f / M.FPS), 200)

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

    def test_spoken_text(self):
        self.assertEqual(voice.spoken('BREAKING: METR\u2019s \u201cAI\u201d deal \u2014 up 40% & more'), "Breaking: meter's AI deal, up 40 percent and more")
        self.assertEqual(voice.say_word('GPT-5'), 'GPT-5'); self.assertEqual(voice.say_word('NASA'), 'NASA')
        self.assertEqual(voice.hook_text('Why AI Isn\u2019t Ready to Tackle Our Genomes'), "Here's why AI Isn\u2019t Ready to Tackle Our Genomes.")
        self.assertEqual(voice.hook_text('It started to \u201cplay.\u201d'), 'It started to \u201cplay.\u201d')

    def test_voice_points_skip_dangling_and_duplicates(self):
        post = {'headline': 'OpenAI is building a humanoid robot, but the body is not the real challenge', 'summary': '',
                'body': '<p>OpenAI is developing a humanoid robot, with CEO Sam Altman confirming the company will build one. '
                        'To solve these challenges, OpenAI is recruiting heavily for robotics roles. '
                        'Altman said the humanoid form makes sense because the world is designed for people. '
                        'The bill would require independent audits of every frontier lab in the country. '
                        'OpenAI wants a working demo of its robot by 2027, with cognition as the focus. '
                        'OpenAI wants a working robot demo by 2027 and cognition is its main focus.</p>'}
        pts = M.voice_points(post)
        self.assertEqual(pts, ['Altman said the humanoid form makes sense because the world is designed for people.',
                               'OpenAI wants a working demo of its robot by 2027, with cognition as the focus.'])

    def test_phrases_are_short_and_ordered(self):
        ws = [(w, i * .4, i * .4 + .3) for i, w in enumerate('The chip targets inference workloads that now run on Nvidia hardware.'.split())]
        ph = voice.phrases(ws)
        self.assertEqual(sum(len(p[0]) for p in ph), len(ws))
        self.assertTrue(all(len(p[0]) <= 5 for p in ph))
        self.assertTrue(all(a[2] <= b[1] + 1e-9 for a, b in zip(ph, ph[1:])))
        self.assertNotIn(ph[0][0][-1][0].lower(), voice.DANGLE)

    def test_fit_duration_prefers_most_points_that_fit(self):
        real = voice.synth
        H = 'A long headline about a chip that matters a lot to everyone'
        P = ['Point number one is here and it is long enough to matter a great deal to people.', 'Point two has a fair amount of detail too.',
             'Point three closes it out with a very long sentence that keeps on going and going.', 'Short four.']
        try:
            voice.synth = lambda segs, path=None, sp=1.0, gap=.3, voice=None: fake_vo(segs, 6.0 * sp, gap)  # fast: 3 points, padded
            vo, segs, total = voice.fit_duration(H, P, path='x')
            self.assertEqual([t for _, t in segs[1:-1]], P[:3]); self.assertEqual(total, 12.0)
            voice.synth = lambda segs, path=None, sp=1.0, gap=.3, voice=None: fake_vo(segs, 2.6 * sp, gap)  # normal pace
            vo, segs, total = voice.fit_duration(H, P, path='x')
            self.assertGreaterEqual(total, 12); self.assertLessEqual(total, 18); self.assertGreaterEqual(len(segs) - 2, 2)
            self.assertEqual(segs[1][1], P[0])  # keeps the lead point when it can
            voice.synth = lambda segs, path=None, sp=1.0, gap=.3, voice=None: fake_vo(segs, 1.7 * sp, gap)  # slow: shorter combo
            vo, segs, total = voice.fit_duration(H, P, path='x')
            self.assertLessEqual(total, 18); self.assertGreaterEqual(len(segs) - 2, 1)
        finally:
            voice.synth = real


class Brand(unittest.TestCase):
    def test_default_voice_is_am_michael(self):
        if 'AIFEED_KOKORO_VOICE' not in os.environ:
            self.assertEqual(voice.VOICE, 'am_michael')

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


def _kokoro():
    try:
        import misaki, onnxruntime  # noqa
    except Exception:
        return ''
    os.environ.setdefault('AIFEED_KOKORO_DOWNLOAD', 'off')  # tests never download the model
    return voice.voice_path()


@unittest.skipUnless(_kokoro(), 'Kokoro (misaki/onnxruntime) or the cached model not available')
class KokoroSynth(unittest.TestCase):
    def test_word_timings_come_from_model_durations(self):
        vo = voice.synth([('hook', 'Microsoft builds its own AI chip.'), ('p1', 'It ships in 2027, at $5 billion.'), ('end', voice.OUTRO)], _kokoro())
        a = vo['audio']; sg = vo['segments']
        self.assertEqual([w for w, _, _ in sg[0]['words']], ['Microsoft', 'builds', 'its', 'own', 'AI', 'chip.'])
        self.assertEqual([w for w, _, _ in sg[1]['words']], ['It', 'ships', 'in', '2027,', 'at', '$5', 'billion.'])
        for s in sg:
            ws = s['words']
            self.assertTrue(all(x[1] < x[2] for x in ws)); self.assertTrue(all(p[2] <= q[1] + 1e-6 for p, q in zip(ws, ws[1:])))
            self.assertAlmostEqual(s['start'], ws[0][1]); self.assertAlmostEqual(s['end'], ws[-1][2])
            i0 = int(s['start'] * voice.SR)  # the audio is (near) silent before each section's first word and voiced right after
            self.assertLess(np.abs(a[max(0, i0 - 1200):i0 - 240]).max(initial=0), .05)
            self.assertGreater(np.abs(a[i0:i0 + 2400]).max(), .05)


if __name__ == '__main__':
    unittest.main()
