"""Offline tests for scenes.py (no network): python3 -m unittest test_scenes"""
import os, unittest
import numpy as np
from PIL import Image
import scenes


def photo_like(w, h, mean=90, seed=0):
    rng = np.random.default_rng(seed)
    base = np.linspace(mean - 40, mean + 40, w)[None, :, None].repeat(h, 0).repeat(3, 2)
    return Image.fromarray((base + rng.normal(0, 10, (h, w, 3))).clip(0, 255).astype('uint8'))


def textured(w, h, mean=90, seed=0):
    """photo_like plus coarse texture that survives downscaling (real photos have structure at every scale)."""
    rng = np.random.default_rng(seed)
    coarse = np.asarray(Image.fromarray(rng.normal(128, 25, (h // 16, w // 16)).clip(0, 255).astype('uint8')).resize((w, h), Image.BICUBIC)).astype(np.float32) - 128
    a = np.asarray(photo_like(w, h, mean, seed)).astype(np.float32) + coarse[:, :, None]
    return Image.fromarray(a.clip(0, 255).astype('uint8'))


class Punch(unittest.TestCase):
    HEADLINES = ['CoreWeave credit default swaps hit distress levels as investors sour on AI debt',
                 'Why AI Isn\u2019t Ready to Tackle Our Convoluted Genomes',
                 'Nvidia must work with Chinese AI companies on safety, Jensen Huang tells CNBC',
                 'FBI arrests Saudi OpenAI employee who allegedly planted recording device in conference room',
                 'Gemini can now make your phone calls for you']

    def test_rule_punch_is_valid_caps_3_to_4_lines_one_accent(self):
        for h in self.HEADLINES:
            p = scenes.rule_punch(h)
            self.assertTrue(scenes.valid_punch(p), p)
            lines = p.split(' / ')
            self.assertIn(len(lines), (3, 4), p)
            self.assertEqual(p, p.upper())

    def test_repeated_root_words_are_rejected(self):
        self.assertEqual(scenes.repeated_roots('COREWEAVE / CREDIT STRESS / *HITS DISTRESS / LEVELS'), ['DISTRESS'])
        self.assertEqual(scenes.repeated_roots('AI MODELS / *AI FAILS'), ['AI'])
        self.assertEqual(scenes.repeated_roots('NVIDIA / *TAGS / TAGGED'), ['TAGGED'])
        self.assertFalse(scenes.valid_punch('COREWEAVE / CREDIT STRESS / *HITS DISTRESS / LEVELS'))
        self.assertFalse(scenes.valid_punch('AI MODELS / *AI FAILS'))
        for ok in ('COREWEAVE / *CREDIT SWAPS / HIT DISTRESS / OVER DEBT', 'OPENAI EMPLOYEE / *ARRESTED FOR / HIDDEN DEVICE / IN BOARDROOM',
                   'YOUTUBE MUSIC / *TAGS AI-MADE / SONGS WITH / NEW LABELS', 'RATE / *GENERATE / IN THE / FOR THE'):
            self.assertTrue(scenes.valid_punch(ok), ok)

    def test_rule_punch_never_repeats_a_root(self):
        p = scenes.rule_punch('AI startups say AI agents will replace AI interns at scale')
        self.assertEqual(scenes.repeated_roots(p), [], p)
        self.assertTrue(scenes.valid_punch(p), p)

    def test_rule_punch_keeps_subject(self):
        self.assertTrue(scenes.rule_punch(self.HEADLINES[0]).startswith('COREWEAVE'))
        self.assertIn('NVIDIA', scenes.rule_punch(self.HEADLINES[2]))


class Theme(unittest.TestCase):
    def test_theme_matches_story_not_category(self):
        self.assertIn('trader', scenes.theme_for({'headline': 'CoreWeave credit default swaps hit distress levels'})[0])
        self.assertIn('DNA', scenes.theme_for({'headline': 'Why AI isn\u2019t ready to tackle our genomes'})[0])
        self.assertIn('microphone', scenes.theme_for({'headline': 'YouTube Music will label AI singers'})[0])

    def test_curated_theme_wins_over_llm_scene(self):
        p = scenes.scene_prompt({'headline': 'Why AI isn\u2019t ready to tackle our genomes', 'scenePrompt': 'a small DNA model on a shelf'})
        self.assertTrue(p.startswith('a colossal glowing cyan DNA'))
        f = scenes.scene_prompt({'headline': 'FBI arrests OpenAI employee', 'scenePrompt': 'a conference room table'})
        self.assertIn('lone man silhouette', f); self.assertIn('no furniture', f)

    def test_llm_prompt_and_keywords_take_priority(self):
        post = {'headline': 'x', 'scenePrompt': 'a lighthouse in a storm', 'sceneKeywords': ['lighthouse storm']}
        self.assertTrue(scenes.scene_prompt(post).startswith('a lighthouse in a storm'))
        self.assertIn('no recognizable real person', scenes.scene_prompt(post))
        self.assertEqual(scenes.scene_keywords(post)[0], 'lighthouse storm')

    def test_text_prone_llm_scene_is_replaced_by_theme_scene(self):
        for bad in ('a man at a lectern in a press room', 'a laptop on a desk with a glowing screen', 'a newspaper headline on a table',
                    'a street sign at night', 'monitors showing stock numbers'):
            p = scenes.scene_prompt({'headline': 'CoreWeave credit default swaps hit distress levels', 'scenePrompt': bad})
            self.assertTrue(p.startswith(scenes.theme_for({'headline': 'CoreWeave credit default swaps hit distress levels'})[0]), bad)
        self.assertTrue(scenes.scene_prompt({'headline': 'x', 'scenePrompt': 'a vintage microphone in a beam of light'}).startswith('a vintage microphone'))

    def test_prompts_carry_strong_text_negatives_and_no_text_prone_subjects(self):
        for k in ('no text', 'no letters', 'no numbers', 'no signage', 'no lecterns', 'no laptops', 'no logos', 'no watermark'):
            self.assertIn(k, scenes.STYLE)
        for _, subject, _ in scenes.THEMES:
            self.assertIsNone(scenes.TEXT_PRONE.search(subject), subject)
        self.assertIsNone(scenes.TEXT_PRONE.search(scenes.DEFAULT_THEME[0]))

    def test_bright_variant_keeps_subject_and_negatives(self):
        post = {'headline': 'Why AI isn\u2019t ready to tackle our genomes'}
        b = scenes.scene_prompt(post, bright=True)
        self.assertIn('DNA', b); self.assertIn('fragmenting', b); self.assertIn('bright', b); self.assertNotIn('low-key', b); self.assertIn('no text', b)

    def test_no_category_generic_queries(self):
        for _, _, q in scenes.THEMES:
            self.assertNotIn('laboratory scientist computer', q)


class Gate(unittest.TestCase):
    def test_gate(self):
        self.assertEqual(scenes.gate(photo_like(1200, 800)), '')
        flat = Image.fromarray(np.linspace(0, 255, 1200)[None, :, None].repeat(800, 0).repeat(3, 2).astype('uint8'))
        self.assertIn('not photographic', scenes.gate(flat))
        self.assertIn('too dark', scenes.gate(photo_like(1200, 800, mean=4)))
        self.assertIn('too small', scenes.gate(photo_like(300, 200)))
        busy = Image.fromarray(np.random.default_rng(1).integers(0, 255, (800, 1200, 3)).astype('uint8'))
        self.assertIn('too busy', scenes.gate(busy))

    def dark(self, k):
        return Image.fromarray((np.asarray(textured(1024, 1024, mean=110)).astype(np.float32) * k).astype('uint8'))

    def test_lift_rescues_a_dark_generated_scene(self):
        dark = self.dark(.12)
        self.assertTrue(scenes.gate(dark))  # rejected as-is
        self.assertEqual(scenes.gate(scenes.lift(dark)), '')

    def test_lift_gain_is_capped(self):
        dark = self.dark(.12); a = np.asarray(dark).astype(np.float32) / 255
        out = np.asarray(scenes.lift(dark)).astype(np.float32) / 255
        bound = np.power(np.minimum(1, a * scenes.MAX_STRETCH), scenes.MIN_GAMMA) + 2 / 255
        self.assertTrue((out <= bound).all())
        self.assertGreaterEqual(scenes.MIN_GAMMA, .6); self.assertLessEqual(scenes.MAX_STRETCH, 1.5)

    def test_near_black_is_not_lifted(self):
        nb = self.dark(.05)
        self.assertIs(scenes.lift(nb), nb)
        self.assertTrue(scenes.gate(scenes.lift(nb)))

    def test_square_scene_subject_sits_above_headline(self):
        sq = np.zeros((1024, 1024, 3), np.uint8); sq[462:562, 462:562] = 255  # bright subject at the image center
        out = np.asarray(scenes.fit_portrait(Image.fromarray(sq)).convert('L')).astype(np.float32)
        ys = np.where(out[:, 540] > 200)[0]
        self.assertLess(ys.max(), 880)  # headline band starts at y 900
        self.assertLess(abs(ys.mean() - 1920 * .27), 40)

    def test_photo_gate_rejects_screenshots(self):
        shot = np.full((900, 1200, 3), 120, np.uint8); shot[100:160, 100:1100] = 30; shot[400:420, 200:900] = 240
        shot = Image.fromarray(shot)
        shot = Image.fromarray((np.asarray(shot).astype(np.float32) + np.random.default_rng(2).normal(0, 1, (900, 1200, 3))).clip(0, 255).astype('uint8'))
        self.assertEqual(scenes.photo_gate(textured(1200, 800)), '')
        self.assertTrue(scenes.photo_gate(shot))

    def test_fit_portrait_is_9x16(self):
        for w, h in ((1280, 720), (720, 1280), (1000, 1000)):
            self.assertEqual(scenes.fit_portrait(photo_like(w, h)).size, (1080, 1920))


class Cascade(unittest.TestCase):
    def test_falls_through_to_story_photo_when_generation_off(self):
        os.environ['AIFEED_SCENE_GEN'] = 'off'; os.environ['AIFEED_SCENE_ORDER'] = 'generated,story'
        try:
            path = '/tmp/_scene_test.jpg'; textured(1280, 720).save(path)
            log = []
            img, credit, src = scenes.pick_scene({'headline': 'x'}, path, None, log)
            self.assertEqual(src, 'story'); self.assertEqual(img.size, (1080, 1920)); self.assertIn('generated: disabled', log)
        finally:
            del os.environ['AIFEED_SCENE_GEN']; del os.environ['AIFEED_SCENE_ORDER']

    def test_cloudflare_dark_scene_is_lifted_then_retried_bright_before_fallback(self):
        calls = []
        real = scenes.cloudflare
        def fake(post, timeout=90, bright=False):
            calls.append(bright)
            return (textured(1024, 1024, mean=80) if bright else Image.new('RGB', (1024, 1024), (2, 2, 2))), ''
        scenes.cloudflare = fake; os.environ['AIFEED_SCENE_ORDER'] = 'cloudflare,story'
        try:
            log = []
            img, credit, src = scenes.pick_scene({'headline': 'x'}, None, None, log)
            self.assertEqual(calls, [False, True]); self.assertEqual(src, 'cloudflare-bright'); self.assertEqual(credit, '')
            self.assertTrue(log[0].startswith('cloudflare: '))
        finally:
            scenes.cloudflare = real; del os.environ['AIFEED_SCENE_ORDER']

    def test_screenshot_story_photo_is_not_used_as_fallback(self):
        real = scenes.cloudflare
        scenes.cloudflare = lambda post, timeout=90, bright=False: (None, 'HTTP 500')
        os.environ['AIFEED_SCENE_ORDER'] = 'cloudflare,story'
        shot = np.full((900, 1200, 3), 120, np.uint8); shot[100:160, 100:1100] = 30
        Image.fromarray(shot).save('/tmp/_shot.png')
        try:
            with self.assertRaises(SystemExit) as e:
                scenes.pick_scene({'headline': 'x'}, '/tmp/_shot.png', None, [])
            self.assertIn('cloudflare-bright', str(e.exception))
        finally:
            scenes.cloudflare = real; del os.environ['AIFEED_SCENE_ORDER']

    def test_refuses_when_nothing_usable(self):
        os.environ['AIFEED_SCENE_ORDER'] = 'story'
        try:
            with self.assertRaises(SystemExit):
                scenes.pick_scene({'headline': 'x'}, None, None, [])
        finally:
            del os.environ['AIFEED_SCENE_ORDER']


if __name__ == '__main__':
    unittest.main()
