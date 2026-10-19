"""Voiceover for AIFeed Reels: free neural TTS (Piper, runs offline on CPU, no API, no key) + word timings for captions.

Voice: AIFEED_PIPER_VOICE (path to a .onnx Piper voice; default en_US-ryan-high in ~/.cache/aifeed-piper, downloaded once
from the rhasspy/piper-voices Hugging Face repo if missing; the workflow caches that folder). If Piper or the voice is
unavailable, make_reel renders the silent-voice (music-only) version instead of failing.
Word timings come from Piper's phoneme alignments (pip install 'piper-tts[alignment]'); without them, words are timed
proportionally to their length inside each sentence's audio.
"""
import os, re, shutil, sys, time, urllib.request
import numpy as np

VOICE = os.environ.get('AIFEED_PIPER_VOICE_NAME', 'en_US-ryan-high')
VOICE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/{lang}/{spk}/{q}/{name}.onnx'
CACHE = os.environ.get('AIFEED_PIPER_DIR') or os.path.join(os.path.expanduser('~'), '.cache', 'aifeed-piper')
SR = 22050
BANNED = re.compile(r'\b(daily|hand[- ]?edited|human[- ]?edited|edited by (a )?human|our editors?|curated by (our )?(team|editors|humans?))\b', re.I)
OUTRO = 'Follow AIFeed dot run.'


def voice_path(timeout=180):
    p = os.environ.get('AIFEED_PIPER_VOICE')
    if p:
        return p if os.path.exists(p) else ''
    p = os.path.join(CACHE, VOICE + '.onnx')
    if os.path.exists(p) and os.path.exists(p + '.json'):
        return p
    if os.environ.get('AIFEED_PIPER_DOWNLOAD', 'on').lower() in ('off', '0', 'false'):
        return ''
    lang, spk, q = VOICE.split('-', 2)
    u = VOICE_URL.format(lang=lang, spk=spk, q=q, name=VOICE)
    os.makedirs(CACHE, exist_ok=True)
    for ext in ('.json', ''):  # config first; the model file's presence marks a complete download
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(u + ext, headers={'User-Agent': 'aifeed-reels/1.0'}), timeout=timeout) as r, \
                        open(p + ext + '.part', 'wb') as f:
                    shutil.copyfileobj(r, f, 1 << 20)
                os.replace(p + ext + '.part', p + ext)
                break
            except Exception as e:
                print(f'piper voice download failed (try {attempt + 1}/4):', str(e)[:120], file=sys.stderr)
                time.sleep(2 + 3 * attempt)
        else:
            return ''
    return p


# ---------- script ----------
def spoken(text):
    """Text as it should be SAID (the caption keeps the original text)."""
    s = ' ' + text + ' '
    s = re.sub(r'\bAI\b', 'A.I.', s)
    s = re.sub(r'\bLLMs\b', 'L.L.M.s', s); s = re.sub(r'\bLLM\b', 'L.L.M.', s)
    s = re.sub(r'\$(\d+(?:\.\d+)?)\s*(billion|million|trillion)\b', r'\1 \2 dollars', s, flags=re.I)
    s = re.sub(r'\$(\d+(?:\.\d+)?)([BMK])\b', lambda m: m.group(1) + {'B': ' billion', 'M': ' million', 'K': ' thousand'}[m.group(2)] + ' dollars', s)
    s = re.sub(r'(?<!\w)[\u2018\u2019\u201c\u201d"\']|[\u2018\u2019\u201c\u201d"\'](?!\w)', '', s)  # quote marks, not apostrophes
    s = s.replace('%', ' percent').replace('&', ' and ').replace('\u2014', ', ').replace('\u2013', ', ')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def hook_text(headline, punch_sentence=''):
    """The hook: the headline, said plainly (a question only when the headline is one)."""
    h = re.sub(r'\s+', ' ', headline or '').strip().rstrip('.')
    if len(h) > 110 and punch_sentence:
        h = punch_sentence
    return h if re.search(r'[.?!][\u201d"\u2019\']?$', h) else h + '.'


def script(headline, points, punch_sentence='', max_points=3):
    segs = [('hook', hook_text(headline, punch_sentence))]
    for i, p in enumerate(points[:max_points]):
        p = re.sub(r'\s+', ' ', p).strip()
        segs.append((f'p{i + 1}', p if re.search(r'[.?!][\u201d"\u2019\']?$', p) else p + '.'))
    segs.append(('end', OUTRO))
    for _, t in segs:
        if BANNED.search(t):
            raise ValueError('banned wording in voiceover: ' + t)
    return segs


# ---------- synthesis ----------
_voice = {}


def load(path):
    if path not in _voice:
        from piper import PiperVoice
        try:
            _voice[path] = (PiperVoice.load(path, include_alignments=True), True)
        except Exception:
            _voice[path] = (PiperVoice.load(path), False)
    return _voice[path]


def words_of(text):
    return [w for w in text.split() if re.search(r'\w', w)]


def time_words(text, chunks, align_ok):
    """[(word, t0, t1)] for the caption words of `text` (seconds, relative to the segment audio start)."""
    words = words_of(text)
    spans, t, groups = [], 0.0, []
    for c in chunks:
        dur = len(c.audio_int16_bytes) / 2 / c.sample_rate
        al = getattr(c, 'phoneme_alignments', None) if align_ok else None
        if al:
            cur, pos = None, t
            for a in al:
                d = float(a.num_samples) / c.sample_rate
                if a.phoneme == ' ' or a.phoneme in ('^', '$', '_'):
                    if cur: groups.append(cur); cur = None
                elif re.match(r'^[.,!?;:\u2026"]$', a.phoneme):
                    pass
                else:
                    cur = [pos, pos + d] if cur is None else [cur[0], pos + d]
                pos += d
            if cur: groups.append(cur)
        spans.append((t, t + dur)); t += dur
    if groups and len(groups) == len(words):
        return [(w, g[0], g[1]) for w, g in zip(words, groups)]
    # fallback: proportional to word length over the voiced span of all chunks (trim ~0.12s lead/tail silence)
    t0, t1 = (spans[0][0] + .12, spans[-1][1] - .15) if spans else (0, 0)
    if groups:
        t0, t1 = groups[0][0], groups[-1][1]
    wts = np.array([len(re.sub(r'\W', '', w)) + 2 for w in words], np.float32)
    edges = t0 + np.concatenate([[0], np.cumsum(wts)]) / wts.sum() * max(.1, t1 - t0)
    return [(w, float(edges[i]), float(edges[i + 1])) for i, w in enumerate(words)]


_memo = {}


def _segment(v, align_ok, text, length_scale, path):
    """(audio float32 @22050, [(word, t0, t1)] relative) for one segment; memoized so fit_duration retries are cheap."""
    key = (path, text, length_scale)
    if key not in _memo:
        from piper import SynthesisConfig
        cfg = SynthesisConfig(length_scale=length_scale)
        chunks = list(v.synthesize(spoken(text), syn_config=cfg, include_alignments=True) if align_ok else v.synthesize(spoken(text), syn_config=cfg))
        audio = np.concatenate([c.audio_float_array for c in chunks]) if chunks else np.zeros(1, np.float32)
        sr = chunks[0].sample_rate if chunks else SR
        if sr != SR:  # alignments are in samples of the voice rate; time_words converts with each chunk's own rate
            audio = np.interp(np.arange(int(len(audio) * SR / sr)) * sr / SR, np.arange(len(audio)), audio).astype(np.float32)
        _memo[key] = (audio.astype(np.float32), time_words(text, chunks, align_ok))
    return _memo[key]


def synth(segs, path=None, length_scale=1.0, gap=.32):
    """Returns {'audio': float32 mono @22050, 'segments': [{name, text, start, end, words: [(w, t0, t1)]}], 'seconds'}.
    Timings are absolute (seconds from the start of the voiceover). Each segment is followed by `gap` of silence."""
    path = path or voice_path()
    if not path:
        raise RuntimeError('no Piper voice')
    v, align_ok = load(path)
    out, t, res = [], 0.0, []
    for name, text in segs:
        audio, rel = _segment(v, align_ok, text, length_scale, path)
        dur = len(audio) / SR
        res.append({'name': name, 'text': text, 'start': t, 'end': t + dur, 'words': [(w, t + a, t + b) for w, a, b in rel]})
        out += [audio, np.zeros(int(gap * SR), np.float32)]; t += dur + gap
    a = np.concatenate(out).astype(np.float32)
    return {'audio': a, 'segments': res, 'seconds': len(a) / SR}


def fit_duration(headline, points, punch_sentence='', path=None, lo=12.0, hi=18.0, end_hold=1.2, short_points=None):
    """Voiceover-driven length. Tries, in order, until VO + end hold <= hi: 3 points, 2 points, 2 shortened points
    (short_points: the same points cut at a clause boundary), 1 point, each at normal pace then slightly faster.
    Too short is padded on the end card (total = max(lo, VO + end hold))."""
    plans = [points[:3], points[:2]]
    if short_points:
        plans.append(short_points[:2])
    plans.append(points[:1])
    best = None
    for pts in plans:
        if not pts:
            continue
        for ls in (1.0, .93, .87):
            segs = script(headline, pts, punch_sentence, len(pts))
            vo = synth(segs, path, ls)
            total = vo['seconds'] + end_hold
            if best is None or total < best[2]:
                best = (vo, segs, total)
            if total <= hi:
                return vo, segs, max(lo, total)
    return best  # still long (very long headline): the caller renders it as is and reports the length


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
