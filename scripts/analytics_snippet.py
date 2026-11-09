#!/usr/bin/env python3
"""Shared Clarity + GA4 snippet for every HTML page the site serves.

Canonical copy: _includes/analytics.html (the homepage block, project
wx6ydd7938 and measurement id G-38GGN8HYT6). stage_pages stamps it into the
publish directory, and build_seo stamps it into generated story and hub pages.
Pages that already contain that block once are left unchanged, so neither tag
is loaded twice. A page can also opt in with the marker <!-- AIFEED_ANALYTICS -->.
"""
import os
import re

CLARITY_ID = "wx6ydd7938"
GA_ID = "G-38GGN8HYT6"
MARKER = "<!-- AIFEED_ANALYTICS -->"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = os.path.join(ROOT, "_includes", "analytics.html")

_SNIPPET = None

HEAD_RE = re.compile(r"<head(?:\s[^>]*)?>", re.I)
MARKER_RE = re.compile(r"[ \t]*<!-- AIFEED_ANALYTICS -->[ \t]*\n?")
CLARITY_BLOCK_RE = re.compile(
    r"[ \t]*<!-- Microsoft Clarity -->\s*"
    r"<script type=\"text/javascript\">\s*"
    r"\(function\(c,l,a,r,i,t,y\)\{\s*"
    r"c\[a\]=c\[a\]\|\|function\(\)\{\(c\[a\]\.q=c\[a\]\.q\|\|\[\]\)\.push\(arguments\)\};\s*"
    r"t=l\.createElement\(r\);t\.async=1;t\.src=\"https://www\.clarity\.ms/tag/\"\+i;\s*"
    r"y=l\.getElementsByTagName\(r\)\[0\];y\.parentNode\.insertBefore\(t,y\);\s*"
    r"\}\)\(window,\s*document,\s*\"clarity\",\s*\"script\",\s*\"[^\"]+\"\);\s*"
    r"</script>\s*",
    re.I,
)
GA_BLOCK_RE = re.compile(
    r"[ \t]*<!-- Google tag \(gtag\.js\) -->\s*"
    r"<script async src=\"https://www\.googletagmanager\.com/gtag/js\?id=[^\"]+\"></script>\s*"
    r"<script>\s*"
    r"window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];\s*"
    r"function gtag\(\)\{dataLayer\.push\(arguments\);\}\s*"
    r"gtag\('js',\s*new Date\(\)\);\s*"
    r"gtag\('config',\s*'[^']+'\);\s*"
    r"</script>\s*",
    re.I,
)
CLARITY_TAG_RE = re.compile(r"https://www\.clarity\.ms/tag/")
GA_TAG_RE = re.compile(r"https://www\.googletagmanager\.com/gtag/js\?id=" + re.escape(GA_ID))
GA_CONFIG_RE = re.compile(r"gtag\('config', '" + re.escape(GA_ID) + r"'\)")


def snippet_body():
    """Return the include with surrounding newlines removed, indent preserved."""
    global _SNIPPET
    if _SNIPPET is None:
        with open(INCLUDE, encoding="utf-8") as fh:
            body = fh.read().strip("\n")
        if CLARITY_ID not in body or GA_ID not in body:
            raise SystemExit("analytics include %s is missing Clarity or GA4 id" % INCLUDE)
        _SNIPPET = body
    return _SNIPPET


def _counts(html):
    return (
        len(CLARITY_TAG_RE.findall(html)),
        len(GA_TAG_RE.findall(html)),
        len(GA_CONFIG_RE.findall(html)),
    )


def inject(html):
    """Ensure html contains the shared snippet exactly once.

    Documents without a <head> (graphic cards, fragments) are returned unchanged.
    <header> is not treated as <head>.
    """
    if not isinstance(html, str) or not HEAD_RE.search(html):
        return html
    body = snippet_body()
    clarity, ga_src, ga_cfg = _counts(html)
    if (
        clarity == 1
        and ga_src == 1
        and ga_cfg == 1
        and html.count(body) == 1
        and MARKER not in html
    ):
        return html
    new = MARKER_RE.sub("", html)
    new = CLARITY_BLOCK_RE.sub("", new)
    new = GA_BLOCK_RE.sub("", new)
    if _counts(new) != (0, 0, 0):
        # Unrecognized copy is already there. Leave a single existing pair alone.
        if clarity >= 1 and ga_src >= 1 and MARKER not in html:
            return html
        if _counts(new)[0] >= 1 and _counts(new)[1] >= 1:
            return new
        return html
    match = HEAD_RE.search(new)
    if not match:
        return html
    return new[:match.end()] + "\n" + body + "\n" + new[match.end():]
