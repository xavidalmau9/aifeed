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
        self.assertEqual(voice.say_word('$40B'), '40 billion dollars')



class MoneySpeech(unittest.TestCase):
    """Amounts are said the way people say them: '$40B' -> '40 billion dollars', never 'forty dollars billion'."""
    def test_compact_amounts(self):
        cases = {'$40B': '40 billion dollars', '$1.5B': '1.5 billion dollars', '$500K': '500 thousand dollars',
                 '$300M': '300 million dollars', '$2T': '2 trillion dollars', '$40b': '40 billion dollars',
                 '\u00a3134M': '134 million pounds', '\u20ac2B': '2 billion euros', '$1,200M': '1200 million dollars',
                 '$40B,': '40 billion dollars,', '($40B)': '40 billion dollars'}
        for k, v in cases.items():
            self.assertEqual(voice.say_word(k), v, k)

    def test_spoken_sentences(self):
        self.assertEqual(voice.spoken('OpenAI raises $40B.'), 'OpenAI raises 40 billion dollars.')
        self.assertEqual(voice.spoken('UK funds $134M lab'), 'UK funds 134 million dollars lab')
        self.assertEqual(voice.spoken('It costs $336 million to build.'), 'It costs 336 million dollars to build.')
        self.assertEqual(voice.spoken('a $1.2 billion deal'), 'a 1.2 billion dollars deal')
        self.assertEqual(voice.spoken('worth $5 trillion.'), 'worth 5 trillion dollars.')
        for t in ('$40B', '$336 million', '$1.5B', '$500K', '$2T'):
            self.assertNotIn('$', voice.spoken(t)); self.assertTrue(voice.spoken(t).endswith('dollars'), t)

    def test_plain_dollars_untouched(self):
        self.assertEqual(voice.spoken('It costs $40.'), 'It costs $40.')  # the G2P reads '$40' as 'forty dollars'
        self.assertEqual(voice.say_words(['$40', 'apps']), ['$40', 'apps'])

    def test_word_mapping_kept(self):  # one spoken string per caption word, so caption timing stays per word
        toks = 'raised $336 million, then $2B'.split()
        self.assertEqual(voice.say_words(toks), ['raised', '336', 'million dollars,', 'then', '2 billion dollars'])


class VoiceSafety(unittest.TestCase):
    def test_sane_durations(self):
        import numpy as np
        good = np.array([1., 2., 3.])
        self.assertTrue((voice.sane_durations(good, 3) == good).all())
        for bad in ([1., float('nan'), 2.], [1., float('inf'), 1.], [-1., 2., 3.], [0., 0., 0.], [1., 2.], [1., 1e18, 1.]):
            d = voice.sane_durations(np.array(bad), 3)
            self.assertEqual(len(d), 3); self.assertTrue(np.isfinite(d).all() and d.sum() > 0)

    def test_budget(self):
        b = voice.Budget(max_synth=2, max_s=100)
        self.assertFalse(b.over()); voice._synth_count[0] += 2; self.assertTrue(b.over())
        self.assertTrue(voice.Budget(max_synth=50, max_s=0).over())

    def test_attempts_change_speed_then_voice(self):
        tries = m.voice_attempts(voice)
        self.assertEqual(tries[0], (voice.VOICE, voice.SPEED))
        self.assertEqual(tries[1][0], voice.VOICE); self.assertNotEqual(tries[1][1], voice.SPEED)
        self.assertNotEqual(tries[2][0], voice.VOICE)
        os.environ['AIFEED_KOKORO_FALLBACK_VOICE'] = 'off'
        try:
            self.assertEqual(len(m.voice_attempts(voice)), 2)
        finally:
            del os.environ['AIFEED_KOKORO_FALLBACK_VOICE']

    def test_retry_then_raise(self):
        calls = []
        def fit(voice, speed, budget):
            calls.append((voice, speed))
            if len(calls) < 2:
                raise OverflowError('Python int too large to convert to C ssize_t')
            return ('vo', 'segs', 9.0)
        self.assertEqual(m.voice_retry(voice, fit), ('vo', 'segs', 9.0)); self.assertEqual(len(calls), 2)
        def bad(**kw): raise ValueError('nope')
        with self.assertRaises(RuntimeError):
            m.voice_retry(voice, bad)

    def test_fit_duration_capped(self):  # a fake synth: every script too long -> stops at the cap with the best so far
        real, n = voice.synth, [0]
        def fake(segs, path=None, speed=1.0, gap=.25, voice=None):
            n[0] += 1; voice_mod._synth_count[0] += 1
            return {'audio': None, 'segments': [], 'seconds': 30.0 + len(segs), 'voice': 'x', 'speed': speed}
        voice_mod = voice
        voice.synth = fake
        try:
            vo, segs, total = voice.fit_duration(None, ['a b c.'] * 6, lo=12, hi=18, max_points=4,
                                                 budget=voice.Budget(max_synth=5, max_s=100))
            self.assertLessEqual(n[0], 5); self.assertGreater(total, 18)
            vo, segs, total = voice.fit_v3('Hook here.', ['one two three four five six.'] * 3, hi=10,
                                           budget=voice.Budget(max_synth=3, max_s=100))
            self.assertLessEqual(n[0], 5 + 4)
        finally:
            voice.synth = real


if __name__ == '__main__':
    unittest.main()
