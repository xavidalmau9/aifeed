# AIFeed.run site audit, phase 1 (Nov 12, 2026)
Pages: https://aifeed.run/ and https://aifeed.run/news/how-ai-security-failures-are-endangering/
Evidence comes from live HTML (it matches repo main ff9acf85 byte for byte), headless Chromium at 390x844 and 1440x900, and the screenshots in before/.

## Ranked problems

1. **Once JavaScript runs, the article page has no H1 and no visible headline.**
   Evidence: the static HTML ships `<article class="seo-static"><h1>…`, but the JS view replaces it. In Playwright, `document.querySelectorAll('h1')` returns 0 elements after load. before/article-mobile.png goes straight from the date pill to the cover graphic, so the headline only exists as pixels inside the image.
   Fix: render the HTML H1, dek, date, read time and source line above the image (prototype/article.html). Keep one H1 per page. Server-render it and don't let JS replace it.

2. **Homepage story list is client-rendered. The static HTML links to almost no articles.**
   Evidence: live index.html has only 3 `href="/news/…"` links, and the lead headline "Security Flaws Across UK…" doesn't appear in the static HTML at all. Crawlers and link previews see an empty feed.
   Fix: have the GitHub Action write the latest ~12 stories into index.html as real `<a>` + `<h2>/<h3>` markup, then enhance with JS (filters, load more).

3. **Story headlines are baked into the Instagram graphics. Desktop cards show image text only, including "SWIPE →".**
   Evidence: before/home-desktop.png. The grid is all 4:5 carousel covers with no HTML headline, and "SWIPE →" (an Instagram carousel cue) appears on every card and on the article hero.
   Fix: every card gets an HTML headline + category + date (and summary on desktop). Keep the full 4:5 graphic uncropped, because cropping it would cut through baked text at the edges. Longer term: export a web cover without the "SWIPE" cue from the render pipeline.

4. **The fixed bottom banner covers content on every page.**
   Evidence: "Free weekly AI brief at aifeed.run · Subscribe free →" is position:fixed and sits over the Key Takeaways and story cards (before/*-mobile.png). It's also lowercase "aifeed.run", which breaks the full-name rule.
   Fix: remove the fixed bar. Use one inline newsletter card after the first 5 stories (home), one after the source card (article mobile), and a sticky sidebar card (article desktop).

5. **The newsletter embed on the article page renders as an empty box.**
   Evidence: before/article-mobile.png, "Free weekly AI brief…" card with a blank purple rectangle where the Beehiiv form (`data-beehiiv-form f9ece7d9…`, loaded by script injection) should be.
   Fix: a native HTML form that posts to the Beehiiv Magic Link already in index.html (`magic.beehiiv.com/v1/eb0b9508-…`, `?email=`). It has one email field + "Subscribe free", 48px tall, and always renders.

6. **The mobile homepage scrolls sideways.**
   Evidence: at 390px, `document.documentElement.scrollWidth` = 425. The overflow comes from the topic tag row (`.tag-research` … `.tag-safety` reach 471–891px) and the footer brand/tagline (424px). The topic row also cuts chips at the screen edge.
   Fix: wrap the chips to multiple rows and add `overflow-x:hidden` as a guard. The prototype measures 390/390 on both pages.

7. **Mobile visitors from Instagram/Facebook see no story above the fold.**
   Evidence: before/home-mobile-fold.png. A 3-line hero, tagline, email form and 3 social pills come first, and the first story starts below about 530px, behind the sticky bar.
   Fix: a short intro (H1 + one-line dek), wrapping topic chips, then the lead story's headline. In mockups/home-mobile-fold.png the lead headline is fully visible above the fold.

8. **Copy still mentions the old video format and is inconsistent with the brand.**
   Evidence: hero "Top AI stories, explained in 60 seconds." Article footer: "Follow @aifeed.run on Instagram for AI news in 60 seconds." The JS still has video cards/lightbox code (`renderVideos`, `<video>`). The logo is the lowercase wordmark "aifeed.run" in the header and footer.
   Fix: new copy, "Big AI stories in plain English, with the source on every one." Remove the video code paths. The wordmark reads AIFeed.run (AI purple / Feed orange / .run white), matching the wordmark on the graphics.

9. **Policy has no category color on the site, although it has 18 posts.**
   Evidence: no `.cat-Policy` rule in index.html or post.html (Security has 3 posts and no rule either), so those pills render unstyled. The taxonomy has 12 categories, and Industry (84 posts) dominates.
   Fix: add `--cat-policy` (#c4b5fd) and `--cat-security` to tokens.css. Show the 6 core topics as chips + "All topics".

10. **Tap targets are too small and the article page is heavy.**
    Evidence: social pills, pagination and category links measure 21–37px high. The article hero is a 1.03 MB PNG, although 720px WebP versions (20–60 KB) already exist in /thumbs.
    Fix: 44px minimum for every link/button (`--tap`). Category pills on cards are labels, not links, and topic navigation uses 40px chips. Use `/thumbs/*-720.webp` for the cover with `width/height` set.

## Design choices (one line each)
- **Story before chrome:** the lead headline is above the fold on mobile, so Instagram/Facebook visitors get what they tapped for right away.
- **HTML headlines everywhere:** this fixes SEO and readability, and text never sits over the graphics or the faces in them (e.g. the Jensen Huang cover).
- **Uncropped 4:5 graphics:** a crop would slice baked-in text at the edges. In lists they're small thumbnails next to the HTML text.
- **Inline newsletter cards instead of a fixed bar:** nothing covers the content, and the form is native so it always renders.
- **"Next story" + "More stories" at the end of each article, "More this week" rail on the home page:** each article leads into another to raise articles per visit.
- **Labeled Instagram/Facebook/LinkedIn buttons with the standard logos:** you can tell what each one is instantly.
- **Kept the brand:** the live palette (#09081a bg, #7c3aed/#a855f7 purple, #f97316 orange), Syne headlines and Inter body. Category colors are the live `.cat-*` values.
- **Spacing:** a 4px scale with 20/32/40px gutters, 12–24px card padding and at least 12px between text and every border (checked in QA).
- **Contrast:** body text 17.3:1, secondary 12.0:1, muted 6.7:1 on the background (WCAG AA+).
- **Article page:** a source card ("Read the full report on ZDNET") and the "Based on reporting by …" line credit the source without claiming any human editing.

## 404 page audit (phase 2)
Evidence: https://aifeed.run/this-page-does-not-exist/ returns HTTP 404 with repo `404.html` (2.3 KB). See before/404-mobile.png and before/404-desktop.png.
- **It's a dead end.** There's only a heading, one line and four underlined text links. There are no stories, topics, header, footer, brand wordmark or newsletter form, and most of the screen is empty.
- **The link targets are too small.** The text links are about 24px tall, under the 44px minimum. "Free weekly AI brief" links away to /subscribe/ instead of subscribing in place.
- **The type and copy don't match the site.** The H1 uses Poppins instead of the site's Syne/Inter, and the meta description reads "That page is not on aifeed.run" (lowercase).
- **Keep these:** the `noindex,follow` tag, the `/news/<slug>` → `/post.html?slug=` redirect script, and analytics.
- **Fix:** `prototype/404.html` has the site header, a hero with a compass icon, the H1 "This page isn't here.", a primary "Back to the homepage" button, topic chips, the 6 latest stories as real links, newsletter + follow cards, and the footer.
