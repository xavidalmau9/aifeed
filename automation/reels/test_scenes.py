"""Offline tests for scenes.py (no network): python3 -m unittest test_scenes"""
import os, unittest
import numpy as np
from PIL import Image
import scenes


def photo_like(w, h, mean=90, seed=0):
    rng = np.random.default_rng(seed)
    base = np.linspace(mean - 40, mean + 40, w)[None, :, None].repeat(h, 0).repeat(3, 2)
    return Image.fromarray((base + rng.normal(0, 10, (h, w, 3))).clip(0, 255).astype('uint8'))


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

    def test_rule_punch_keeps_subject(self):
        self.assertTrue(scenes.rule_punch(self.HEADLINES[0]).startswith('COREWEAVE'))
        self.assertIn('NVIDIA', scenes.rule_punch(self.HEADLINES[2]))


class Theme(unittest.TestCase):
    def test_theme_matches_story_not_category(self):
        self.assertIn('trader', scenes.theme_for({'headline': 'CoreWeave credit default swaps hit distress levels'})[0])
        self.assertIn('DNA', scenes.theme_for({'headline': 'Why AI isn\u2019t ready to tackle our genomes'})[0])
        self.assertIn('microphone', scenes.theme_for({'headline': 'YouTube Music will label AI singers'})[0])

    def test_llm_prompt_and_keywords_take_priority(self):
        post = {'headline': 'x', 'scenePrompt': 'a lighthouse in a storm', 'sceneKeywords': ['lighthouse storm']}
        self.assertTrue(scenes.scene_prompt(post).startswith('a lighthouse in a storm'))
        self.assertIn('no recognizable real person', scenes.scene_prompt(post))
        self.assertEqual(scenes.scene_keywords(post)[0], 'lighthouse storm')

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

    def test_fit_portrait_is_9x16(self):
        for w, h in ((1280, 720), (720, 1280), (1000, 1000)):
            self.assertEqual(scenes.fit_portrait(photo_like(w, h)).size, (1080, 1920))


class Cascade(unittest.TestCase):
    def test_falls_through_to_story_photo_when_generation_off(self):
        os.environ['AIFEED_SCENE_GEN'] = 'off'; os.environ['AIFEED_SCENE_ORDER'] = 'generated,story'
        try:
            path = '/tmp/_scene_test.jpg'; photo_like(1280, 720).save(path)
            log = []
            img, credit, src = scenes.pick_scene({'headline': 'x'}, path, None, log)
            self.assertEqual(src, 'story'); self.assertEqual(img.size, (1080, 1920)); self.assertIn('generated: disabled', log)
        finally:
            del os.environ['AIFEED_SCENE_GEN']; del os.environ['AIFEED_SCENE_ORDER']

    def test_refuses_when_nothing_usable(self):
        os.environ['AIFEED_SCENE_ORDER'] = 'story'
        try:
            with self.assertRaises(SystemExit):
                scenes.pick_scene({'headline': 'x'}, None, None, [])
        finally:
            del os.environ['AIFEED_SCENE_ORDER']


if __name__ == '__main__':
    unittest.main()
