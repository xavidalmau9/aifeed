import os, unittest
import make_reel as m
import voice


class V3(unittest.TestCase):
    def test_flags_default_off(self):
        os.environ.pop('AIFEED_REEL_TEMPLATE', None); os.environ.pop('AIFEED_HOOK_STYLE', None)
        self.assertNotEqual(m.reel_template(), 'v3'); self.assertEqual(m.hook_style(), '')
        os.environ['AIFEED_HOOK_STYLE'] = 'b'; self.assertEqual(m.hook_style(), 'B')
        os.environ['AIFEED_HOOK_STYLE'] = 'Z'; self.assertEqual(m.hook_style(), '')
        os.environ.pop('AIFEED_HOOK_STYLE')

    def test_share_prompt_every_category(self):
        for cat in m.PILL_COLORS:
            p = m.share_prompt(cat)
            self.assertTrue(p and len(p) <= 60, cat)
        self.assertEqual(m.share_prompt('nope'), m.SHARE_DEFAULT)
        self.assertNotIn('daily', m.FOLLOW_LINE.lower())

    def test_valid_hook(self):
        self.assertTrue(m.valid_hook('IS AI ALREADY / *COSTING / AMEX JOBS?', 'B'))
        self.assertFalse(m.valid_hook('IS AI ALREADY / *COSTING / AMEX JOBS', 'B'))
        self.assertFalse(m.valid_hook('AMEX CUTS / *5% OF STAFF / TO PREPARE?', 'A'))
        self.assertFalse(m.valid_hook('ONE LINE ONLY', 'A'))

    def test_pick_hook_fallback(self):
        post = {'punch': 'AMEX CUTS / *5% OF STAFF / TO PREPARE FOR AI', 'hooks': {'B': 'bad hook no question'}}
        punch, st = m.pick_hook(post, 'B')
        self.assertEqual(punch, post['punch']); self.assertEqual(st, '')
        post['hooks']['B'] = 'IS AI ALREADY / *COSTING / AMEX JOBS?'
        self.assertEqual(m.pick_hook(post, 'B'), (post['hooks']['B'], 'B'))

    def test_takeaway(self):
        self.assertEqual(m.takeaway_text({'takeaway': 'Short and useful takeaway here.'}), 'Short and useful takeaway here.')

    def test_speech_casing(self):
        s = voice.punch_speech(["THE BROWSER", "IS AI'S BIGGEST", "GAP"])
        self.assertIn("AI's", s)
        self.assertIn('billion', voice.say_word('$40B'))


if __name__ == '__main__':
    unittest.main()
