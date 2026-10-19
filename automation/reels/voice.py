"""Voiceover for AIFeed Reels: Kokoro-82M (Apache-2.0) neural TTS on CPU via ONNX Runtime. Free, no API, no key.

Model: the timestamped ONNX export (onnx-community/Kokoro-82M-v1.0-ONNX-timestamped, Apache-2.0), which outputs the
duration of every phoneme together with the waveform. Caption timings therefore come from the exact durations the audio
was generated from, not estimates. G2P: misaki (Kokoro's own G2P, Apache-2.0) with the espeak-ng fallback bundled by
espeakng-loader; every word token keeps its phonemes, so phoneme durations map straight to caption words.

Files live in AIFEED_KOKORO_DIR (default ~/.cache/aifeed-kokoro; the workflows cache it) and are downloaded once from
Hugging Face if missing. Voice: AIFEED_KOKORO_VOICE (default am_michael, approved by Javier), speed AIFEED_KOKORO_SPEED (default 1.05).
If anything is unavailable, make_reel renders the music-only Reel instead of failing.
"""
import os, re, shutil, sys, time, urllib.request
import numpy as np

REPO = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/main/'
MODEL_FILE = os.environ.get('AIFEED_KOKORO_MODEL', 'model.onnx')  # fp32; 'model_quantized.onnx' is ~4x smaller
VOICE = os.environ.get('AIFEED_KOKORO_VOICE', 'am_michael')
SPEED = float(os.environ.get('AIFEED_KOKORO_SPEED', '1.05'))
CACHE = os.environ.get('AIFEED_KOKORO_DIR') or os.path.join(os.path.expanduser('~'), '.cache', 'aifeed-kokoro')
SR = 24000
LEAD, TAIL = .15, .08  # seconds kept before the first / after the last phoneme of each segment
BANNED = re.compile(r'\b(daily|hand[- ]?edited|human[- ]?edited|edited by (a )?human|our editors?|curated by (our )?(team|editors|humans?))\b', re.I)
OUTRO = 'Follow AIFeed dot run.'


def _get(url, dst, timeout):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'aifeed-reels/1.0'}), timeout=timeout) as r, \
                    open(dst + '.part', 'wb') as f:
                shutil.copyfileobj(r, f, 1 << 20)
            os.replace(dst + '.part', dst)
            return True
        except Exception as e:
            print(f'kokoro download failed (try {attempt + 1}/4) {os.path.basename(dst)}:', str(e)[:120], file=sys.stderr)
            time.sleep(2 + 3 * attempt)
    return False


def voice_path(timeout=180, voice=None):
    """The model folder, with tokenizer.json, the ONNX model and the voice; '' if it can't be had."""
    voice = voice or VOICE
    need = [('tokenizer.json', 'tokenizer.json'), (f'voices/{voice}.bin', f'{voice}.bin'), (f'onnx/{MODEL_FILE}', MODEL_FILE)]
    if all(os.path.exists(os.path.join(CACHE, n)) for _, n in need):
        return CACHE
    if os.environ.get('AIFEED_KOKORO_DOWNLOAD', 'on').lower() in ('off', '0', 'false'):
        return ''
    os.makedirs(CACHE, exist_ok=True)
    for src, n in need:
        if not os.path.exists(os.path.join(CACHE, n)) and not _get(REPO + src, os.path.join(CACHE, n), timeout):
            return ''
    return CACHE


# ---------- script text (what is SAID; captions keep the original words) ----------
SAY = {'METR': 'meter', "METR's": "meter's", 'AIFeed': 'A.I. Feed', 'aifeed.run': 'A.I. Feed dot run', 'vs': 'versus', 'vs.': 'versus',
       'LLM': 'L.L.M.', 'LLMs': 'L.L.M.s', 'GenAI': 'gen A.I.', 'xAI': 'x A.I.', 'U.S.': 'U.S.'}
KEEP_CAPS = re.compile(r'^(?:[A-Z]{2,4}s?|[A-Z]+-?\d+[A-Z]*)$')  # acronyms (spelled out by the G2P), model names like GPT-5


def say_word(w):
    """Speech form of one caption word: fixes the G2P can't know, and no ALL-CAPS shouting for ordinary words."""
    core = re.sub(r'^[\u2018\u2019\u201c\u201d"\'(]+|[\u2018\u2019\u201c\u201d"\'),.!?;:]+$', '', w)
    pre, post = w[:w.find(core)] if core else '', w[w.find(core) + len(core):] if core else ''
    pre = re.sub(r'[\u2018\u2019\u201c\u201d"\'(]', '', pre); post = re.sub(r'[\u2018\u2019\u201c\u201d"\')]', '', post)
    c = core.replace('\u2019', "'")
    m = re.match(r'^([A-Za-z]+)\.([A-Z]{2,4})$', c)  # Character.AI -> Character A.I. (brand with a dotted acronym)
    if c in SAY:
        c = SAY[c]
    elif m:
        c = m.group(1) + ' ' + ''.join(ch + '.' for ch in m.group(2))
    elif c.isupper() and len(re.sub(r'[^A-Z]', '', c)) >= 5 and not KEEP_CAPS.match(c):
        c = c.capitalize()  # BREAKING -> Breaking (a word, not an acronym)
    c = c.replace('&', 'and').replace('%', ' percent')
    return pre + c + post


def say_sym(w):
    """Speech form of a caption token without letters/digits: '&' is said, dashes become a pause, the rest is dropped."""
    return 'and' if w == '&' else '' if w in '\u2014\u2013-' else w if re.fullmatch(r'[,.;:!?]+', w) else ''


def words_of(text):
    return [w for w in text.split() if re.search(r'\w', w)]


def spoken(text):
    return re.sub(r'\s+', ' ', ' '.join(say_word(w) if re.search(r'\w', w) else say_sym(w)
                                       for w in text.replace('\u2014', ' , ').replace('\u2013', ' , ').split())).replace(' ,', ',').strip()


def hook_text(headline):
    """The headline as a spoken opener: 'Why X' / 'How X' become "Here's why X." so it doesn't sound like a misread title."""
    h = re.sub(r'\s+', ' ', headline or '').strip()
    m = re.match(r'^(Why|How)\s+(.+)$', h)
    if m and not h.endswith('?'):
        h = f"Here's {m.group(1).lower()} {m.group(2)}"
    return h if re.search(r'[.?!][\u201d"\u2019\']?$', h) else h.rstrip(' .') + '.'


ACRONYMS = {'AI', 'US', 'UK', 'EU', 'UN', 'FBI', 'CIA', 'FTC', 'SEC', 'DOJ', 'CEO', 'CFO', 'CTO', 'GPU', 'GPUS', 'CPU', 'LLM', 'LLMS',
            'IPO', 'API', 'NASA', 'IBM', 'AMD', 'TSMC', 'AWS', 'GPT', 'AGI', 'VR', 'AR', 'EV', 'EVS', 'NYT', 'BBC', 'CNBC', 'META'}


def punch_speech(lines, headline=''):
    """The on-screen punch headline as the spoken hook: EXACTLY the displayed words, in order (the '/' and '*' markers are
    already gone), in natural casing so the TTS doesn't shout: each word takes its casing from the original headline when
    it appears there (Disney, Character.AI), known acronyms stay upper-case (spelled out by the G2P), the rest is lower."""
    words = ' '.join(l.strip() for l in lines).split()
    def key(w): return re.sub(r'[^0-9a-z]', '', w.lower())
    src = {}
    for hw in (headline or '').split():
        core = re.sub(r'^[^\w$]+|[^\w%]+$', '', hw.replace('\u2019', "'"))
        if core and key(core) not in src and not core.islower():
            src[key(core)] = core
    out = []
    for i, w in enumerate(words):
        m = re.match(r'^([^\w$]*)(.*?)([^\w%]*)$', w)
        pre, core, post = m.group(1), m.group(2), m.group(3)
        if key(core) in src:
            c = src[key(core)]
        elif re.sub(r'[^A-Z]', '', core.upper()) in ACRONYMS and core.isupper():
            c = core
        else:
            c = core.lower()
        if i == 0 and c[:1].islower():
            c = c[:1].upper() + c[1:]
        out.append(pre + c + post)
    t = ' '.join(out)
    return t if re.search(r'[.?!][\u201d"\u2019\']?$', t) else t + '.'


def script(headline, points, max_points=3, outro=True, exact_hook=False):
    """exact_hook: the hook text is spoken as given (the on-screen punch headline), only a final period is ensured."""
    segs = [] if headline is None else [('hook', (headline if re.search(r'[.?!][\u201d"\u2019\']?$', headline) else headline + '.') if exact_hook else hook_text(headline))]
    for i, p in enumerate(points[:max_points]):
        p = re.sub(r'\s+', ' ', p.replace('**', '').replace('__', '')).strip()
        segs.append((f'p{i + 1}', p if re.search(r'[.?!][\u201d"\u2019\']?$', p) else p + '.'))
    if outro:
        segs.append(('end', OUTRO))
    for _, t in segs:
        if BANNED.search(t):
            raise ValueError('banned wording in voiceover: ' + t)
    return segs


# ---------- synthesis ----------
_eng = {}


class Engine:
    def __init__(self, folder):
        import json, onnxruntime as ort
        import espeakng_loader
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        EspeakWrapper.set_library(espeakng_loader.get_library_path()); EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
        from misaki import en, espeak
        self.g2p = en.G2P(trf=False, british=False, fallback=espeak.EspeakFallback(british=False))
        self.vocab = json.load(open(os.path.join(folder, 'tokenizer.json')))['model']['vocab']
        so = ort.SessionOptions(); so.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
        self.sess = ort.InferenceSession(os.path.join(folder, MODEL_FILE), so, providers=['CPUExecutionProvider'])
        self.folder, self.voices = folder, {}

    def style(self, voice, n):
        if voice not in self.voices:
            p = os.path.join(self.folder, voice + '.bin')
            if not os.path.exists(p):
                voice_path(voice=voice)
            self.voices[voice] = np.fromfile(p, dtype=np.float32).reshape(-1, 1, 256)
        v = self.voices[voice]
        return v[min(n, len(v)) - 1]

    def say(self, text, voice=VOICE, speed=SPEED):
        """-> (audio float32 @24k, [(caption word, t0, t1)]) for one segment; t relative to the returned audio."""
        cap = words_of(text)
        spans, sp = [], []  # char span of each caption word inside the spoken string
        pos = 0
        for w in text.split():
            s = say_word(w) if re.search(r'\w', w) else say_sym(w)
            if not s:
                continue
            if sp:
                pos += 1
            if re.search(r'\w', w):
                spans.append((pos, pos + len(s)))
            sp.append(s); pos += len(s)
        said = ' '.join(sp)
        _, toks = self.g2p(said)
        ph, owner, cur = [], [], 0  # phoneme chars, and which caption word each belongs to (-1 = space/punctuation)
        for tk in toks:
            i = said.find(tk.text, cur) if tk.text else -1
            if i >= 0:
                cur = i + len(tk.text)
            wi = next((k for k, (a, b) in enumerate(spans) if i >= 0 and a <= i < b), -1)
            for c in (tk.phonemes or ''):
                if c in self.vocab:
                    ph.append(self.vocab[c]); owner.append(wi if re.match(r'\w', tk.text or '') or tk.text[:1] in '$' else -1)
            if tk.whitespace:
                ph.append(self.vocab[' ']); owner.append(-1)
        ph = ph[:510]; owner = owner[:510]
        wav, dur = self.sess.run(None, {'input_ids': np.array([[0, *ph, 0]], np.int64),
                                        'style': self.style(voice, len(ph)).astype(np.float32),
                                        'speed': np.array([speed], np.float32)})
        wav = np.asarray(wav, np.float32).ravel(); dur = np.asarray(dur, np.float64).ravel()
        edges = np.concatenate([[0], np.cumsum(dur)]) * (len(wav) / dur.sum())  # sample offset of every token boundary
        e = edges[1:]  # e[i] = start of phoneme i (index 0 = after the leading pad)
        words = []
        for k, w in enumerate(cap):
            idx = [i for i, o in enumerate(owner) if o == k]
            if idx:
                words.append([w, e[idx[0]], e[idx[-1] + 1]])
            else:  # a caption word with no phonemes of its own (e.g. a lone symbol): hang it on the previous word
                t = words[-1][2] if words else e[0]
                words.append([w, t, t])
        voiced0, voiced1 = e[0], e[len(ph)]
        a0 = max(0, int(voiced0 - LEAD * SR)); a1 = min(len(wav), int(voiced1 + TAIL * SR))
        wav = wav[a0:a1]
        # trim to the audible speech: the model books silence into the final punctuation token, which left up to ~2 s of
        # dead air before the next section. Keep 0.1 s before the first sound and 0.06 s after the last.
        env0 = np.sqrt(np.convolve(wav.astype(np.float64) ** 2, np.ones(120) / 120, 'same'))
        loud = np.where(env0 > .01)[0]
        if len(loud):
            b0 = max(0, loud[0] - int(.10 * SR)); b1 = min(len(wav), loud[-1] + int(.06 * SR))
            wav = wav[b0:b1]; a0 += b0
        out = [[w, max(0.0, (s - a0) / SR), max(0.0, min(len(wav) / SR, (t - a0) / SR))] for w, s, t in words]
        # words that follow a pause (the first word, and after , . ? etc.): take the onset from the waveform itself, since the
        # model starts sounding a little before its first phoneme's nominal start (measured 5-55 ms)
        env = np.sqrt(np.convolve(wav.astype(np.float64) ** 2, np.ones(120) / 120, 'same'))  # 5 ms RMS
        # Any word preceded by a real pause (>= 35 ms of near-silence): the model sometimes books part of a pause onto the
        # next word, so the onset is re-measured on the waveform (where speech resumes). Measured: fixes 100+ ms errors.
        q_ = env < .004
        for k, wd in enumerate(out):
            i = int(wd[1] * SR); lo_ = max(0, i - int(.18 * SR), int(out[k - 1][1] * SR) if k else 0)
            seg = q_[lo_:i + int(.04 * SR)]
            if not seg.any():
                continue
            # the last quiet run that ends before speech resumes near the nominal onset
            runs, start = [], None
            for j, v in enumerate(seg):
                if v and start is None: start = j
                if not v and start is not None: runs.append((start, j)); start = None
            runs = [r for r in runs if r[1] - r[0] >= int(.035 * SR)]
            if not runs:
                continue
            t0 = (lo_ + runs[-1][1]) / SR
            if -.15 < t0 - wd[1] < .04:
                wd[1] = min(t0, wd[2] - .02)
                if k and out[k - 1][2] > wd[1]:
                    out[k - 1][2] = wd[1]
        return wav, [tuple(x) for x in out]


def engine(folder):
    if folder not in _eng:
        _eng[folder] = Engine(folder)
    return _eng[folder]


_memo = {}


def synth(segs, path=None, speed=SPEED, gap=.25, voice=None):
    """{'audio': float32 mono @24k, 'segments': [{name, text, start, end, words: [(w, t0, t1)]}], 'seconds'}.
    start/end are the first word's onset and the last word's offset (absolute seconds): the spoken section boundaries."""
    path = path or voice_path()
    if not path:
        raise RuntimeError('no Kokoro model')
    voice = voice or VOICE
    eng = engine(path)
    out, t, res = [], 0.0, []
    for name, text in segs:
        key = (path, voice, text, speed)
        if key not in _memo:
            _memo[key] = eng.say(text, voice, speed)
        audio, rel = _memo[key]
        words = [(w, t + a, t + b) for w, a, b in rel]
        res.append({'name': name, 'text': text, 'start': words[0][1] if words else t, 'end': words[-1][2] if words else t + len(audio) / SR,
                    'words': words})
        out += [audio, np.zeros(int(gap * SR), np.float32)]; t += len(audio) / SR + gap
    a = np.concatenate(out).astype(np.float32)
    return {'audio': a, 'segments': res, 'seconds': len(a) / SR, 'voice': voice, 'speed': speed}


END_CARD = 1.9  # seconds of end card after the last point when the outro isn't spoken


def fit_duration(headline, candidates, path=None, lo=12.0, hi=18.0, end_hold=.5, voice=None, max_points=3, exact_hook=False):
    """Voiceover-driven length. candidates: self-contained points in story order. Every candidate is synthesized once
    (memoized), then the script with the MOST points that fits in hi wins (3, else 2, else 1), preferring the lead point and
    story order, at the normal pace and then a touch faster; a spoken outro is dropped (the end card still shows) before a
    point is. Too short pads the end card to lo. -> (vo, segs, total seconds)"""
    from itertools import combinations
    cands = [c for c in candidates if c][:6]
    best = None
    # story mode (no spoken headline): the lead point ("what happened") must open the voice, so every combination with it
    # is tried (most points first) before any without it
    passes = [(n, True) for n in range(min(max_points, len(cands)), 0, -1)] if headline is None else []
    passes += [(n, False) for n in range(min(max_points, len(cands)), 0, -1)]
    for n, lead_only in passes:
        combos = sorted((ix for ix in combinations(range(len(cands)), n) if 0 in ix or not lead_only), key=lambda ix: (0 not in ix, ix))
        for outro in (True, False):
            for ix in combos:
                for sp in (SPEED, SPEED * 1.06):
                    segs = script(headline, [cands[i] for i in ix], n, outro, exact_hook)
                    vo = synth(segs, path, sp, voice=voice)
                    total = vo['seconds'] + (end_hold if outro else END_CARD)
                    if best is None or total < best[2]:
                        best = (vo, segs, total)
                    if total <= hi:
                        return vo, segs, max(lo, total)
    if best is None:
        segs = script(headline, cands[:1] if headline is None else [], 1 if headline is None else 0, True, exact_hook); vo = synth(segs, path, SPEED, voice=voice); best = (vo, segs, vo['seconds'] + end_hold)
    return best


# ---------- captions ----------
DANGLE = {'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'by', 'at', 'from', 'its', 'their', 'our', 'is', 'are'}


def phrases(words, max_words=4, max_chars=22):
    """Group timed words into caption phrases (break at punctuation or size). [(words[(w,t0,t1)], start, end)]"""
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        text = ' '.join(x[0] for x in cur)
        nxt = words[i + 1][0] if i + 1 < len(words) else ''
        dangling = w[0].lower() in DANGLE and nxt and len(cur) <= max_words
        if not dangling and (re.search(r'[.,!?;:]$', w[0]) or len(cur) >= max_words or len(text) + 1 + len(nxt) > max_chars or not nxt):
            out.append(cur); cur = []
    res = []
    for i, ph in enumerate(out):
        end = out[i + 1][0][1] if i + 1 < len(out) else ph[-1][2] + .25
        res.append((ph, ph[0][1], end))
    return res
