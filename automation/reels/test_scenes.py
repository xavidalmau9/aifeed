"""Offline tests for scenes.py (no network): python3 -m unittest test_scenes"""
import io, json, os, shutil, tempfile, unittest
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
    a *= np.array([.75, .95, 1.25], np.float32)  # a cool colour cast, like a real low-key scene (not greyscale)
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
            self.assertIn('story: ', str(e.exception))
            self.assertNotIn('cloudflare-bright', str(e.exception))  # no bright retry after an HTTP error
        finally:
            scenes.cloudflare = real; del os.environ['AIFEED_SCENE_ORDER']

    def test_refuses_when_nothing_usable(self):
        os.environ['AIFEED_SCENE_ORDER'] = 'story'
        try:
            with self.assertRaises(SystemExit):
                scenes.pick_scene({'headline': 'x'}, None, None, [])
        finally:
            del os.environ['AIFEED_SCENE_ORDER']


def skin_photo(w=1200, h=800):
    """A textured photo with a large skin-tone area (a posed person/portrait stand-in)."""
    a = np.asarray(textured(w, h)).astype(np.float32)
    a[150:650, 400:800] = (205, 150, 120)
    a += np.random.default_rng(3).normal(0, 4, a.shape)
    return Image.fromarray(a.clip(0, 255).astype('uint8'))


class Env:
    """Set/clear env vars for one test."""
    def __init__(self, **kv): self.kv, self.old = kv, {}
    def __enter__(self):
        for k, v in self.kv.items():
            self.old[k] = os.environ.get(k)
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v
    def __exit__(self, *a):
        for k, v in self.old.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v


class Patch:
    def __init__(self, **fns): self.fns, self.old = fns, {}
    def __enter__(self):
        for k, f in self.fns.items(): self.old[k] = getattr(scenes, k); setattr(scenes, k, f)
    def __exit__(self, *a):
        for k, f in self.old.items(): setattr(scenes, k, f)


class CloudflareQuota(unittest.TestCase):
    def test_cloudflare_is_off_unless_the_flag_is_on(self):
        with Env(AIFEED_SCENE_CF=None, CF_ACCOUNT_ID='x', CF_API_TOKEN='y'):
            img, why = scenes.cloudflare({'headline': 'x'})
            self.assertIsNone(img); self.assertIn('off', why)
        for v in ('off', '0', '', 'false'):
            with Env(AIFEED_SCENE_CF=v):
                self.assertFalse(scenes.cf_enabled())
        with Env(AIFEED_SCENE_CF='on', CF_ACCOUNT_ID=None, CF_API_TOKEN=None):
            self.assertTrue(scenes.cf_enabled())
            self.assertIn('no CF_', scenes.cloudflare({'headline': 'x'})[1])

    def test_on_429_no_bright_retry_and_the_second_generator_is_next(self):
        calls = []
        def cf(post, timeout=90, bright=False):
            calls.append(('cf', bright)); return None, 'HTTP 429 daily free allocation used up'
        def ov(post, **k):
            calls.append(('ovh',)); return textured(1024, 1024, mean=80), ''
        with Patch(cloudflare=cf, ovh=ov), Env(AIFEED_SCENE_ORDER=None, AIFEED_SCENE_CACHE=None, AIFEED_SCENE_CF='on'):
            log = []
            img, credit, src = scenes.pick_scene({'headline': 'x', 'slug': 's'}, None, None, log)
        self.assertEqual(src, 'ovh'); self.assertEqual(calls, [('cf', False), ('ovh',)])
        self.assertTrue(log[0].startswith('cloudflare: HTTP 429'))

    def test_default_order_generators_before_photos_library_last(self):
        o = scenes.DEFAULT_ORDER.split(',')
        self.assertLess(o.index('cloudflare'), o.index('ovh')); self.assertLess(o.index('ovh'), o.index('generated'))
        self.assertLess(o.index('generated'), o.index('story')); self.assertEqual(o[-1], 'library')
        self.assertLess(o.index('openverse'), o.index('commons')); self.assertNotIn('feed', o)

    def test_cache_is_used_only_when_set(self):
        d = tempfile.mkdtemp()
        try:
            textured(1024, 1024).save(os.path.join(d, 'my-slug_cloudflare.jpg'))
            boom = lambda *a, **k: (_ for _ in ()).throw(AssertionError('must not generate'))
            with Patch(cloudflare=boom, ovh=boom, generated=boom), Env(AIFEED_SCENE_CACHE=d, AIFEED_SCENE_ORDER=None):
                img, credit, src = scenes.pick_scene({'headline': 'x', 'slug': 'my-slug'}, None, None, [])
            self.assertEqual(src, 'cache')
            with Env(AIFEED_SCENE_CACHE=None, AIFEED_SCENE_ORDER='cache,library'):
                img, credit, src = scenes.pick_scene({'headline': 'x', 'slug': 'my-slug'}, None, None, [])
            self.assertEqual(src, 'library')
        finally:
            shutil.rmtree(d)


class SecondGenerator(unittest.TestCase):
    def test_ovh_retries_dropped_connections_then_returns_the_image(self):
        buf = io.BytesIO(); textured(1024, 1024).save(buf, 'PNG')
        n = {'i': 0}
        class R:
            def read(self): return buf.getvalue()
        def urlopen(req, timeout=0):
            n['i'] += 1
            if n['i'] < 3: raise ConnectionResetError('Remote end closed connection without response')
            body = json.loads(req.data)
            assert 'text' in body['negative_prompt'] and 'photorealistic' in body['prompt']
            return R()
        real = scenes.urllib.request.urlopen; scenes.urllib.request.urlopen = urlopen
        try:
            img, why = scenes.ovh({'headline': 'Why AI isn\u2019t ready to tackle our genomes'}, wait=0)
        finally:
            scenes.urllib.request.urlopen = real
        self.assertEqual(why, ''); self.assertEqual(img.size, (1024, 1024)); self.assertEqual(n['i'], 3)

    def test_ovh_can_be_disabled(self):
        with Env(AIFEED_SCENE_OVH='off'):
            self.assertEqual(scenes.ovh({'headline': 'x'})[1], 'disabled')

    def test_sdxl_prompt_is_the_theme_scene_plus_short_style(self):
        p = scenes.sdxl_prompt({'headline': 'FBI arrests OpenAI employee'})
        self.assertIn('lone man silhouette', p); self.assertIn('photorealistic', p); self.assertNotIn('no text', p)
        for k in ('text', 'letters', 'watermark', 'logo', 'face', 'portrait'):
            self.assertIn(k, scenes.SDXL_NEG)


class PosedPhotos(unittest.TestCase):
    def test_posed_titles_are_rejected(self):
        for t in ('File:Secretary_Perdue_Visits_APHIS_20170505.jpg', 'Minister meets CEO at summit', 'Official portrait of the CEO',
                  'Handshake at the signing ceremony', 'Governor tours the new data center', 'Founder speaks at keynote'):
            self.assertTrue(scenes.posed_reason(None, t), t)
        for t in ('Data center server racks.jpg', 'DNA gel electrophoresis under UV light', 'Stock exchange screens at night'):
            self.assertEqual(scenes.posed_reason(None, t), '', t)

    def test_story_photo_with_a_posed_file_name_is_rejected(self):
        d = tempfile.mkdtemp()
        try:
            f = os.path.join(d, 'Secretary_of_State_Peter_Kyle_visits_Anthropic_in_San_Francisco._%2854098999333%29.jpg')
            textured(1400, 900).save(f)
            with Env(AIFEED_SCENE_ORDER='story,library'):
                log = []
                img, credit, src = scenes.pick_scene({'headline': 'Anthropic gives third-party auditors access', 'slug': 'a'}, f, None, log)
            self.assertEqual(src, 'library'); self.assertIn('posed/people photo', log[0])
        finally:
            shutil.rmtree(d)

    def test_graphics_charts_and_scans_are_not_scenes(self):
        for t in ('AFM height map of a silicon wafer', 'Stock chart 2024', 'Neural network texture pattern', 'Data center diagram'):
            self.assertIn('graphic', scenes.posed_reason(None, t), t)

    def test_greyscale_photos_are_not_trusted(self):
        grey = textured(1200, 800).convert('L').convert('RGB')
        self.assertIn('greyscale', scenes.photo_gate(grey))

    def test_photo_search_results_must_match_the_scene(self):
        self.assertTrue(scenes.relevant('data center server racks', 'Racks in the Amravati data center'))
        self.assertTrue(scenes.relevant('hidden microphone conference room', 'microphone on a conference table'))
        self.assertFalse(scenes.relevant('financial distress trader charts red', 'Office at night, Pittsburgh'))
        self.assertFalse(scenes.relevant('DNA helix glitch digital', 'Monopoly with real money'))

    def test_skin_heuristic_rejects_people_but_not_scenes(self):
        self.assertGreater(scenes.skin_fraction(skin_photo()), .02)
        self.assertLess(scenes.skin_fraction(textured(1200, 800)), .02)
        self.assertIn('people in frame', scenes.photo_gate(skin_photo()))
        self.assertEqual(scenes.photo_gate(textured(1200, 800)), '')

    def test_posed_story_photo_falls_through_to_the_library(self):
        skin_photo().save('/tmp/_story_photo.jpg')
        with Env(AIFEED_SCENE_ORDER='story,library'):
            log = []
            img, credit, src = scenes.pick_scene({'headline': 'FBI arrests OpenAI employee', 'slug': 'x'}, '/tmp/_story_photo.jpg', None, log)
        self.assertEqual(src, 'library'); self.assertIn('people in frame', log[0]); self.assertEqual(credit, '')

    def test_openverse_skips_posed_results_and_builds_a_credit(self):
        good = io.BytesIO(); textured(1400, 900).save(good, 'JPEG')
        api = {'results': [
            {'title': 'Secretary visits the lab', 'url': 'https://x/posed.jpg', 'width': 2000, 'license': 'by', 'license_version': '2.0', 'creator': 'A'},
            {'title': 'server room racks', 'url': 'https://x/ok.jpg', 'width': 2000, 'license': 'by-sa', 'license_version': '2.0',
             'creator': 'Jane Doe', 'foreign_landing_url': 'https://flickr.com/p/1', 'tags': [{'name': 'datacenter'}]}]}
        fetched = []
        class R:
            def __init__(self, b): self.b = b
            def read(self): return self.b
        def urlopen(req, timeout=0):
            u = req.full_url
            if 'api.openverse.org' in u:
                return io.BytesIO(json.dumps(api).encode())
            fetched.append(u); return R(good.getvalue())
        real = scenes.urllib.request.urlopen; scenes.urllib.request.urlopen = urlopen
        try:
            img, credit = scenes.openverse(['server room'])
        finally:
            scenes.urllib.request.urlopen = real
        self.assertEqual(fetched, ['https://x/ok.jpg'])
        self.assertEqual(credit, 'Photo: Jane Doe / CC BY-SA 2.0 via Openverse (https://flickr.com/p/1)')


class Library(unittest.TestCase):
    def test_every_theme_and_default_has_a_bundled_scene_that_passes_the_gate(self):
        man = json.load(open(os.path.join(scenes.LIB_DIR, 'library.json')))
        keys = {e['key'] for e in man['scenes']}
        self.assertEqual(len(scenes.THEME_KEYS), len(scenes.THEMES))
        for k in scenes.THEME_KEYS + ['default']:
            self.assertIn(k, keys)
        self.assertGreaterEqual(len(man['scenes']), 12)
        for e in man['scenes']:
            img = Image.open(os.path.join(scenes.LIB_DIR, e['file'])).convert('RGB')
            self.assertEqual(scenes.gate(img), '', e['file'])
            self.assertEqual(scenes.gate(scenes.fit_portrait(img)), '', e['file'])
            self.assertTrue(e.get('prompt'), e['file'])

    def test_library_matches_the_story_theme(self):
        self.assertEqual(scenes.theme_key({'headline': 'Why AI isn\u2019t ready to tackle our genomes'}), 'genome')
        self.assertEqual(scenes.theme_key({'headline': 'Weather is nice'}), 'default')
        img, why = scenes.library({'headline': 'CoreWeave credit default swaps hit distress levels', 'slug': 'a'})
        self.assertEqual(why, ''); self.assertIsNotNone(img)

    def test_whole_chain_offline_ends_in_the_library(self):
        off = lambda *a, **k: (None, 'HTTP 503')
        with Patch(cloudflare=off, ovh=off, generated=off, openverse=lambda q: (None, ''), commons=lambda q: (None, '')), \
                Env(AIFEED_SCENE_ORDER=None, AIFEED_SCENE_CACHE=None, AIFEED_SCENE_CF='off'):
            log = []
            img, credit, src = scenes.pick_scene({'headline': 'FBI arrests OpenAI employee', 'slug': 'x'}, None, None, log)
        self.assertEqual(src, 'library'); self.assertEqual(img.size, (1080, 1920)); self.assertEqual(credit, '')


if __name__ == '__main__':
    unittest.main()
