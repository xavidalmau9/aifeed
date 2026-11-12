# AIFeed.run redesign: build spec

**Audience:** the cloud agent implementing the redesign in `xavidalmau9/aifeed`. Phase 1 audit: `problems.md`.
**Reference build:** `prototype/index.html`, `prototype/article.html`, `prototype/404.html`, `prototype/tokens.css`. The component CSS is inlined in each page and its source is `src/site.css`. The generator is `src/build.py`.
**Mockups:** `mockups/*.png` (full page) and `mockups/*-fold.png` (first screen), at 390×844 and 1440×900.
**Audited against:** repo main `ff9acf85` (Nov 12, 2026), the live site, and the before screenshots in `before/`.

## 0. Rules that apply to everything
- Write the brand name as **AIFeed.run** in copy, titles, alt text and meta. The handle `@aifeed.run` and URLs stay lowercase.
- Never use the word "daily".
- Never claim human editing, editorial review or curation by people. The source credit line is "Based on reporting by {Outlet}".
- AIFeed.run publishes no videos or Reels. Remove video UI and copy ("explained in 60 seconds", the video grid and the lightbox).
- Never put text over images. Never crop the 4:5 story graphics, because they contain baked-in text.
- Nothing may touch or cross a container edge. Keep at least 12px between text and any card border.
- Every icon is a standard, instantly recognizable glyph. Brand icons are the official Instagram, Facebook and LinkedIn marks, which are already inline SVGs in the repo footer.

## 1. Design tokens (`tokens.css`, copy it verbatim to `/assets/tokens.css`)

### Colors
| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-2` / `--bg-3` | `#09081a` / `#0f0d28` / `#14113a` | Page background, raised surfaces, image placeholders |
| `--surface` / `--surface-hover` | `rgba(255,255,255,.04)` / `.07` | Card fills |
| `--border` / `--border-strong` | `rgba(255,255,255,.09)` / `rgba(168,85,247,.35)` | Card borders; the strong one is for newsletter, source and next-story cards |
| `--purple` / `--purple-2` | `#7c3aed` / `#a855f7` | Brand purple; links and accents (5.0:1 on bg) |
| `--orange` | `#f97316` | Eyebrows, the "Feed" in the wordmark (7.1:1) |
| `--green` | `#22c55e` | "Latest story" eyebrow, check icons |
| `--grad` | `linear-gradient(90deg,#f97316,#a855f7)` | Primary buttons only |
| `--text` / `--text-2` / `--muted` | `#f0eeff` / `#c9c6e6` / `#9592c0` | 17.3:1, 12.0:1, 6.7:1 on `--bg` |

**Category colors: variables only, pending Javier's pick.** Javier wants to **switch** the category palette. Build every category usage against the variables below and never hard-code a hex. Then the chosen option is a paste into `tokens.css`, and nothing else changes.

```css
:root{
  --cat-models:  /* option value */;  --cat-tools:   ;  --cat-research: ;  --cat-business: ;
  --cat-policy:  ;  --cat-safety:  ;  --cat-security: var(--cat-safety);
  --cat-industry: ;  --cat-products: ;  --cat-hardware: ;  --cat-infrastructure: ;  --cat-health: ;
}
```
- Every category has to work, and that includes **Policy** (18 posts) and **Security** (3), which have no live CSS today. Security always aliases Safety. Unknown categories fall back to `--purple-2`.
- **Pill recipe:** text is `var(--c)`, fill is `color-mix(in srgb,var(--c) 14%,transparent)` and border is `color-mix(in srgb,var(--c) 40%,transparent)`. Topic chips add an 8px dot in `var(--c)`.
- **The options are in `palettes/palettes.md`** (hex tokens, contrast table, IG-graphic changes) with renders in `palettes/option-{a,b,c}.png` and `palettes/compare.png`. A is Signal (the brief's hues, vivid), B is Spectrum (maximum separation) and C is Soft (the brief's hues, pastel). All of them pass AA: lowest on-bg ratio 6.6:1 and lowest text-on-fill 5.1:1.
- **Until Javier picks,** `prototype/tokens.css` keeps the live values (Models `#f97316`, Tools `#22c55e`, Industry `#a855f7`, Research `#38bdf8`, Products `#fbbf24`, Health `#14b8a6`, Infrastructure `#818cf8`, Business `#f43f5e`, Hardware `#06b6d4`, Safety/Security `#ef4444`, Policy `#c4b5fd`). These are placeholders only.
- When the palette changes, update GRAPHIC_SPEC.md and `graphics/_base_template.html` in the same PR so new IG graphics match (see palettes.md).

> **PENDING JAVIER: category palette** (option A, B or C). Don't merge category colors until he picks.

### Type
- Display font: **Syne** 700/800 (headlines, wordmark, section titles). Body font: **Inter** 400–700. Both are already used on the live site. Poppins stays graphics-only, as GRAPHIC_SPEC.md says.
- Scale (rem): xs .75 · sm .875 · base 1 · md 1.125 · lg 1.25 · xl 1.5 · 2xl `clamp(1.625rem,1.2rem+2vw,2.5rem)` · 3xl `clamp(1.875rem,1.3rem+2.6vw,3.25rem)`.
- Line height: headlines 1.08–1.2, body 1.65, article prose 1.7.
- Article H1: `clamp(1.625rem,1.1rem+2.2vw,2.75rem)`. Lead-story title: 1.5rem on mobile, 1.75rem at ≥1100px.
- Syne is very wide, so never put Syne headlines in narrow columns above these sizes. Add `overflow-wrap:break-word` to all headlines.

### Spacing, radii, shadow, layout
- Spacing is on a 4px base: `--s-1` 4 · 2 8 · 3 12 · 4 16 · 5 20 · 6 24 · 8 32 · 10 40 · 12 48 · 16 64.
- Page gutter is 20px below 768px, 32px from 768px and 40px from 1100px. Max width 1200px. Article measure 680px.
- Radii: `--r-sm` 8 · `--r-md` 12 (thumbnails, rows) · `--r-lg` 16 (cards) · `--r-pill` 999.
- `--shadow: 0 10px 30px rgba(0,0,0,.35)`, used for menus and overlays only. Cards are flat with borders.
- `--tap: 44px` is the minimum height and width of every interactive element. Topic chips are 40px, which is allowed only because they sit in a wrapping row with an 8px gap.
- Breakpoints: 700px (2-column cards, inline form), 1100px (desktop nav, home lead + rail, article sidebar).

## 2. Components
Class names below match the prototype CSS. Reuse them.

1. **Header (`.site-header`).**
   - Sticky, 60px tall, `rgba(9,8,26,.88)` with a 14px backdrop blur and a bottom border.
   - Contents: wordmark on the left. At ≥1100px, nav links (Latest `/news/`, Topics `/news/topics/`, Newsletter `/subscribe/`) and 44px social icon buttons. A "Subscribe" primary button with a mail icon is always shown and links to `#newsletter`.
   - **Wordmark (`.wordmark`)** is HTML text, Syne 800 at 1.375rem: `AI` in `--purple-2`, `Feed` in `--orange`, `.run` in `--text`. Its aria-label is "AIFeed.run home". It replaces the lowercase `aifeed.run` logo in the header and footer.
2. **Intro (home only).** An H1 "The AI news that matters." plus a one-line dek: "Big AI stories in plain English, with the source on every one." Remove the old hero email form, the "Live" badge and the hero social pills.
3. **Topic chips (`.chips`).**
   - Chips: All (active state is a white fill), Models, Tools, Policy, Safety, Business, Research, then "All topics" (`/news/topics/`).
   - Each chip has an 8px category-color dot.
   - The row wraps with `flex-wrap`. **Never use a horizontal scroller.** This fixes the 425px overflow found in the audit.
   - Links go to `/news/topics/{slug}/`, which `build_seo.py` already builds.
4. **Lead story (`.lead`).**
   - Mobile order: eyebrow "Latest story", then pill and date, then H2 headline (all in `.lead-head`), then the 4:5 graphic, then summary and a "Read the story →" ghost button (`.lead-tail`).
   - Desktop: a 300px image column next to the head and tail (`grid-template-areas: "img head" "img tail"`).
   - The image is decorative because the headline is already in HTML: `aria-hidden`, `tabindex=-1`.
5. **Story row (`.row`, the "More this week" rail and the 404 list).** An 84px 4:5 thumbnail, then the pill (a `<span>`, not a link) and date, an H3 headline link in Inter 600, and "via {Outlet}" in muted xs.
6. **Story card (`.card`).** Mobile is the same layout as a row with a 96px thumbnail. At ≥1100px it becomes a 3-column grid: full-width uncropped 4:5 image, meta, Syne 1.25rem title and the summary (`.card-sum`).
7. **Article header.** In order:
   - Breadcrumb (`Home › {Category}`, 44px links).
   - Meta row: pill, `<time>` with the full date, "• {n} min read" with a clock icon. Read time is word count ÷ 230, rounded, minimum 1.
   - **H1** = headline.
   - Dek `.art-dek` = summary.
   - Byline row `.art-by`: an "AI" gradient avatar, "AIFeed.run AI News", and "Based on reporting by **{Outlet}** ↗" linking to `sourceUrl`.
   - Share row: Copy link, LinkedIn share-offsite and Facebook sharer, each a 44px round icon button.
   - Then Key takeaways (`.kt`, left border in `--purple-2`), then the cover graphic (`.art-fig`, max 440px wide, centered, caption "Cover from the AIFeed.run post on Instagram."), then the body.
8. **Article body (`.prose`).**
   - 1.125rem/1.7, color `#dedcf3`, 1.15em paragraph spacing, max 680px measure.
   - The first `**…**` line renders as `.lede-b` (600 weight). Use `md_bold()` and strip any stray `**`.
   - After the body: the source card (`.source-card`, "Original reporting / Read the full report on {Outlet}" with an external-link icon), then hashtag chips (36px).
9. **Newsletter card (`.nl-card`, compact variant `.nl-compact`).**
   - Content: mail icon tile, eyebrow "Free newsletter", title "The week's top AI stories, every Sunday.", one line of copy, a **native form**, and "✓ Free. Unsubscribe anytime."
   - Form: `<form action="https://magic.beehiiv.com/v1/eb0b9508-1ffd-4fb1-a63c-e762fa86569c" method="get">` with `<input type="email" name="email" required autocomplete="email">` (48px tall, with a hidden `<label>`) and a "Subscribe free" button.
   - This is the same Magic Link `index.html` already uses (`BEEHIIV_SUBSCRIBE_URL + '?email='`). Keep the existing JS handler if it adds UTM or source tagging, but the form must work without JS.
   - **Remove the injected Beehiiv embed** (`data-beehiiv-form f9ece7d9…` / `loader.js`) from post.html, because it renders blank.
   - Placement: home goes after the lead and rail (desktop is a horizontal 3-column layout). Article mobile goes after the tags. Article desktop goes in the sidebar only. 404 goes in the sidebar, which stacks on mobile.
10. **Follow card (`.follow-card`).** Title "Follow AIFeed.run", the line "New stories land on Instagram, Facebook and LinkedIn first.", and three 48px labelled buttons with brand-color glyphs: @aifeed.run, Facebook, LinkedIn.
11. **Sticky sidebar (`.art-side > .side-sticky`, ≥1100px only).** 340px wide, `position:sticky; top:84px`, holding the newsletter card and follow card. The article grid is `minmax(0,680px) 340px`, `justify-content:space-between`, with a 64px gap.
12. **Next story / More stories.**
    - `.next`: the following story in date order. It is a single large link with a 96px thumbnail, the eyebrow "Next story →", the title in Syne and the meta.
    - Then "More stories": 6 `.card`s (the 6 newest, excluding the current and next story), plus "See all →" linking to `/news/`.
    - On the home page, the "More this week" rail shows stories 2–5.
13. **Footer (`.site-footer`).** Wordmark plus the line "The AI news that matters, with the source on every story.", then links (All stories, Topics, Newsletter, About, FAQ, Privacy) as 44px rows in 2 columns, then 44px social icons, then "© 2026 AIFeed.run".
14. **404 (`prototype/404.html`).**
    - Main column, in order:
      - Hero card with a compass icon tile, the eyebrow "Error 404", the H1 "This page isn't here." and the line "The link may be old or mistyped…".
      - Primary "Back to the homepage" button with a house icon, and a ghost "Browse all {N} stories →" button.
      - "Pick a topic" chips.
      - "Latest stories" with the 6 newest as real `.row` links.
    - Sidebar: newsletter card and follow card. It stacks under the main column on mobile and is sticky at 360px on desktop.
    - Keep `<meta name="robots" content="noindex,follow">`. Drop the `canonical` pointing at /404.html.
    - **Keep the existing `/news/<slug>` → `/post.html?slug=` redirect script and both analytics snippets exactly as they are.**

## 3. Repo change map (xavidalmau9/aifeed)
| Change | File(s) | Notes |
|---|---|---|
| Add tokens | new `assets/tokens.css` | Link it from index.html, post.html, 404.html, the hub pages, about/faq/subscribe. Add it to `stage_pages.py` if that script whitelists paths. |
| Shared component CSS | new `assets/site.css` (from `src/site.css`) | Replaces the inline `<style>` blocks. Delete `.video-*` and `.lightbox-*` rules in index.html (~lines 1203–1340) and the old `.cat-*` rules (index.html ~500–509, post.html equivalent). |
| Homepage markup | `index.html` | New header, intro, chips, lead + rail, newsletter band, cards, topics, follow, footer. Remove the hero form, social pills, `renderIgStrip`, the video section, `loadVideos()`/`renderVideos()` (~1901–2000), and the `#video-lightbox` markup (~1736). Change the meta description, OG and Twitter descriptions (lines 24/30/40) to drop "explained in 60 seconds". |
| **Static story list** | `scripts/build_seo.py` (new step) + `.github/workflows/seo-build.yml` | Write the latest 12 posts into index.html between markers `<!--LATEST:START-->…<!--LATEST:END-->`: lead = post 1, rail = posts 2–5, cards = posts 6–11 (plus 1 spare for the 404). Use the same HTML as the prototype. In the workflow, add `index.html` and `404.html` to `sparse-checkout` and to `git add`. Neither is in the trigger `paths`, so this can't start a loop. JS (`loadPosts`) may then hydrate filters and pagination but **must not clear** the static markup before data loads. |
| Article template | `post.html` + the `static` block in `scripts/build_seo.py` (~lines 142–155) | Output the full article header (§2.7), body, source card, newsletter, next story and more stories as static HTML. `loadPost()` must reuse or keep the `<h1>` (today it removes it, leaving 0 h1s). Replace "for AI news in 60 seconds" (line ~150 and post.html line ~728) with "Follow @aifeed.run on Instagram for the AI news that matters." Remove the Beehiiv loader injection and the `#sub-bar`. |
| Fixed bottom bar | `index.html` (~line 2436 `#sub-bar`), `post.html` (~line 931) | Delete the markup, its JS (`subBarClosed` localStorage) and its CSS. |
| 404 | `404.html` | Static page per `prototype/404.html`, with the latest 6 written by the same build step. Keep the redirect script and analytics. |
| Topic hubs | `build_seo.py` `hub_page()` | Use the same header, chips, cards and footer, and add the Policy and Security colors. |
| Video leftovers | `videos/`, `scripts/sync-videos.sh`, `.github/workflows/reels-samples.yml` | **Flag only.** Confirm with Javier or the aifeed.run agent before deleting; the site just stops reading `videos-index.json`. |
| Docs + IG pills | `CLAUDE.md`, `GRAPHIC_SPEC.md` (pill table, about lines 29–44), `graphics/_base_template.html` (lines 19 and 28) | Update to the chosen palette in the same PR so new graphics match. Never re-render published graphics. |

## 4. SEO
- **One `<h1>` per page, in the static HTML, and still present after JS runs.** Home: "The AI news that matters." Article: the headline. 404: "This page isn't here."
- Story titles on home, hubs and the 404 are real `<a href="/news/{slug}/">` inside `<h2>`/`<h3>`. Use absolute paths beginning with `/`. Pages currently rely on `<base href="/">`; keep it or switch everything to absolute paths, but don't mix the two.
- `<title>`: home "AIFeed.run AI News — The AI news that matters". Article "{Headline} | AIFeed.run".
- `meta description` = summary, ≤160 characters. Canonical is the absolute URL with a trailing slash.
- OG and Twitter tags: keep the existing tags. `og:image` stays the 1080×1350 PNG, which social previews need. `og:site_name` "AIFeed.run AI News".
- JSON-LD:
  - Keep and verify the existing `NewsArticle` + `BreadcrumbList` on article pages and `WebSite` + `NewsMediaOrganization` on home.
  - The NewsArticle needs `headline`, `description`, `image` (array: the PNG and `/thumbs/*-720.webp`), `datePublished` (= `publishedAt`), `dateModified`, `publisher` (Organization AIFeed.run with logo), `mainEntityOfPage`, and `isBasedOn`: the source URL.
  - **Don't add an `author` Person** or anything implying human editing. If `author` is required, use the Organization.
  - Breadcrumb: Home › {Category} › {Headline}.
- Internal links on every article: breadcrumb to the topic hub, next story, 6 more stories, and the footer to `/news/` and `/news/topics/`. Hubs link every story.
- Sitemap, feed and llms-full stay as built by `build_seo.py`. Add 404.html to nothing (it is noindex).

## 5. Performance
- Covers and thumbnails: `/thumbs/{name}-720.webp`, which already exist (20–60 KB vs a 1.03 MB PNG). Add `srcset="…-240.webp 240w, …-720.webp 720w"` and `sizes="(min-width:1100px) 300px, 96px"` on rows and cards. The article cover uses `sizes="(min-width:1100px) 440px, 100vw"`. Fall back to `imageUrl` if no thumbnail exists (`thumb()` in build_seo.py already does this).
- Every `<img>` has `width="720" height="900"` (4:5) and CSS `aspect-ratio:4/5`, so layout doesn't jump.
- The above-the-fold image (lead story, article cover) gets `fetchpriority="high"` and no lazy loading. All others get `loading="lazy" decoding="async"`.
- Fonts:
  - Self-host Syne 700/800 and Inter (the variable latin woff2 in `prototype/fonts/`) with `font-display:swap`.
  - Preload `syne` and `inter` woff2 with `<link rel="preload" as="font" type="font/woff2" crossorigin>`.
  - Remove the Google Fonts `<link>`s, preconnects and unused weights (Syne 400/600, Inter 300).
- Lighter pages: removing the video and lightbox code, the sub-bar and the Beehiiv loader cuts JS. Target LCP < 2.5s on Moto G Power / Slow 4G in Lighthouse mobile.

## 6. Accessibility
- **Tap targets ≥44×44px** for every link, button and input (`--tap`). Exceptions: inline links inside prose and headline text, and topic chips (40px, wrapped, with an 8px gap). Category pills on cards are non-interactive `<span>`s.
- **Contrast is AA or better.** Text 17.3:1, text-2 12.0:1, muted 6.7:1, purple-2 links 5.0:1. Category pill text must be ≥4.5:1 on both the page bg and its own fill. All three palette options meet this (lowest 5.1:1; see palettes/palettes.md). Button text on `--grad` is white at 600 weight.
- Decorative thumbnails next to an HTML headline get `aria-hidden="true" tabindex="-1"` on the link. The `alt` keeps the headline for standalone use.
- Visible focus: add `:focus-visible{outline:2px solid var(--purple-2);outline-offset:3px}` (not in the prototype, required in the build).
- Landmarks: `header`, `nav[aria-label]`, `main#main`, `aside`, `footer`. Add a "Skip to content" link. Every form field has a `<label>` (visually hidden is fine).
- Respect `prefers-reduced-motion` for any transitions.

## 7. Acceptance criteria (testable)
Run each check with Playwright Chromium at **390×844 (isMobile)** and **1440×900**, on `/`, `/news/how-ai-security-failures-are-endangering/`, a topic hub, and `/this-page-does-not-exist/`.

1. `document.documentElement.scrollWidth === innerWidth` (no horizontal scroll) at 390 and 1440.
2. `document.querySelectorAll('h1').length === 1` **3s after load** (after JS), and its text matches the page H1 in §4.
3. With JavaScript disabled, the homepage shows ≥12 story links (`a[href^="/news/"]` inside `h2`/`h3`) and the article shows the H1, summary, body, source link and next story.
4. No element with `position:fixed` taller than 0 sits at the bottom of the viewport. The `#sub-bar` and `.video-lightbox` selectors don't exist.
5. `grep -ri "60 seconds\|daily\|videos-index\|lightbox" index.html post.html 404.html` returns nothing in visible copy or JS. The brand name appears as "AIFeed.run" in all visible text, except the `@aifeed.run` handle and URLs.
6. Every `a, button, input` outside prose and headlines has a bounding box height ≥44px (chips ≥40px).
7. At 390px, the lead-story headline on `/` is fully inside the first 844px viewport.
8. Each newsletter form is a `<form>` whose `action` starts with `https://magic.beehiiv.com/v1/eb0b9508-1ffd-4fb1-a63c-e762fa86569c`, with an `input[type=email][name=email][required]`. Submitting `test@example.com` opens Beehiiv's confirm page (manual check). No `data-beehiiv-form` script is on the page.
9. Every story `<img>` has `width`, `height` and a `.webp` src from `/thumbs/` (when one exists). Only the first image on the page lacks `loading="lazy"`.
10. axe-core reports zero "serious" or "critical" violations, including color-contrast.
11. Gap check: for every card, button, pill and chip, every text line's client rect sits ≥12px from the container's left and right edges (or ≥ its padding if smaller). The script is `src/qa.py`.
12. The Rich Results Test (or `schema.org` validator) shows valid NewsArticle and BreadcrumbList on the article, with no `author` Person.
13. `/news/<slug>` without a trailing slash still lands on the story (the 404 redirect script still works).
14. Policy and Security pills are colored (computed `color` ≠ the default text color). `grep -E "#[0-9a-f]{6}" ` over the category CSS finds hex values only in `tokens.css`.
15. Lighthouse mobile scores Performance ≥85, Accessibility ≥95 and SEO 100 on the article page.

## 8. Open items
- **Category palette:** pending Javier's choice of option A, B or C (palettes/palettes.md, §1).
- **Video leftovers:** whether to delete `videos/`, `sync-videos.sh` and `reels-samples.yml`, or just stop reading them.
- **Pill and wordmark on the graphics:** the "SWIPE →" cue on carousel covers shows up on the web. A web-cover export without it would be cleaner (pipeline change, optional).
- **Analytics:** keep the existing Clarity and GA snippets via `_includes/analytics.html` / `inject_analytics()`.
