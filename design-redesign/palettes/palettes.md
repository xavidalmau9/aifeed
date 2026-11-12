# AIFeed.run category palette options (pending Javier's pick)

Javier wants to **switch** the category palette. This file has three options. Each covers every live category: Models, Tools, Research, Business, Policy, Safety (Security uses the Safety color), Industry, Products, Hardware, Infrastructure and Health. Category counts in `_posts/posts-index.json`: Industry 84, Business 37, Safety 30, Research 23, Policy 18, Models 17, Tools 17, Products 17, Hardware 11, Infrastructure 8, Health 6, Security 3.

**Renders:** `option-a.png`, `option-b.png` and `option-c.png` use the same frame (home mobile fold at 390×844, plus a panel showing every category as card pills and topic chips, plus the contrast table). `compare.png` puts all three side by side.

**How chips are drawn (same for every option):** the text uses the category color. The fill is that color at 14% over the card surface (`#121124`), and the border is the color at 40%. Topic chips use an 8px dot in the color plus the label, so the category never depends on color alone.

**Contrast method:** WCAG 2.x relative luminance. "On bg" means the color on the page background `#09081a`. "On fill" means pill text on its own pill fill, using the worst case (the pill on a card, which is lighter than the page). **Every value passes AA (4.5:1) for normal text.** The pills are 11px bold uppercase, so AA small-text is the right bar to use.


## Option A: Signal (brief hues, vivid)
Uses the hue mapping from the brief: Models lime, Tools cyan, Policy purple, Safety red, Business blue, Research green. The other categories go to hues those six leave open. Bright and high-energy, closest to the IG look.

```css
:root{
  --cat-models:#a3e635;
  --cat-tools:#22d3ee;
  --cat-research:#34d399;
  --cat-business:#60a5fa;
  --cat-policy:#c084fc;
  --cat-safety:#f87171;
  --cat-industry:#fbbf24;
  --cat-products:#f472b6;
  --cat-hardware:#fb923c;
  --cat-infrastructure:#818cf8;
  --cat-health:#2dd4bf;
  --cat-security:#f87171; /* = Safety */
}
```

| Category | Hex | On bg #09081a | Pill fill (14% on card) | Text on fill | IG pill: text on 18% fill over #04020e |
|---|---|---|---|---|---|
| Models | `#a3e635` | 13.1:1 | `#273026` | 9.1:1 | 9.8:1 |
| Tools | `#22d3ee` | 10.9:1 | `#152d3f` | 7.9:1 | 8.5:1 |
| Research | `#34d399` | 10.3:1 | `#182d34` | 7.5:1 | 8.1:1 |
| Business | `#60a5fa` | 7.8:1 | `#1e2741` | 5.8:1 | 6.4:1 |
| Policy | `#c084fc` | 7.5:1 | `#2b2241` | 5.6:1 | 6.2:1 |
| Safety | `#f87171` | 7.2:1 | `#331f2e` | 5.5:1 | 6.0:1 |
| Industry | `#fbbf24` | 11.9:1 | `#332a23` | 8.4:1 | 9.1:1 |
| Products | `#f472b6` | 7.5:1 | `#321f38` | 5.7:1 | 6.2:1 |
| Hardware | `#fb923c` | 8.7:1 | `#332426` | 6.5:1 | 7.1:1 |
| Infrastructure | `#818cf8` | 6.6:1 | `#222341` | 5.1:1 | 5.6:1 |
| Health | `#2dd4bf` | 10.6:1 | `#172d39` | 7.7:1 | 8.3:1 |

Lowest values: 6.6:1 on bg and 5.1:1 on fill. **AA passes for all of them.**


## Option B: Spectrum (maximum separation)
Spreads the 11 categories evenly around the hue wheel, so neighbouring chips never look alike. Research becomes blue and Business amber. Red stays only on Safety/Security, so it still reads as a warning.

```css
:root{
  --cat-models:#c084fc;
  --cat-tools:#2dd4bf;
  --cat-research:#60a5fa;
  --cat-business:#fbbf24;
  --cat-policy:#f472b6;
  --cat-safety:#f87171;
  --cat-industry:#a3e635;
  --cat-products:#fb923c;
  --cat-hardware:#22d3ee;
  --cat-infrastructure:#a5b4fc;
  --cat-health:#4ade80;
  --cat-security:#f87171; /* = Safety */
}
```

| Category | Hex | On bg #09081a | Pill fill (14% on card) | Text on fill | IG pill: text on 18% fill over #04020e |
|---|---|---|---|---|---|
| Models | `#c084fc` | 7.5:1 | `#2b2241` | 5.6:1 | 6.2:1 |
| Tools | `#2dd4bf` | 10.6:1 | `#172d39` | 7.7:1 | 8.3:1 |
| Research | `#60a5fa` | 7.8:1 | `#1e2741` | 5.8:1 | 6.4:1 |
| Business | `#fbbf24` | 11.9:1 | `#332a23` | 8.4:1 | 9.1:1 |
| Policy | `#f472b6` | 7.5:1 | `#321f38` | 5.7:1 | 6.2:1 |
| Safety | `#f87171` | 7.2:1 | `#331f2e` | 5.5:1 | 6.0:1 |
| Industry | `#a3e635` | 13.1:1 | `#273026` | 9.1:1 | 9.8:1 |
| Products | `#fb923c` | 8.7:1 | `#332426` | 6.5:1 | 7.1:1 |
| Hardware | `#22d3ee` | 10.9:1 | `#152d3f` | 7.9:1 | 8.5:1 |
| Infrastructure | `#a5b4fc` | 9.9:1 | `#272941` | 7.1:1 | 7.8:1 |
| Health | `#4ade80` | 11.4:1 | `#1b2f30` | 8.1:1 | 8.7:1 |

Lowest values: 7.2:1 on bg and 5.5:1 on fill. **AA passes for all of them.**


## Option C: Soft (brief hues, pastel)
Same hue mapping as Option A, one step lighter (Tailwind 300-level). It is calmer and more editorial, has the highest contrast, and the purple/orange brand gradient stays the loudest thing on the page.

```css
:root{
  --cat-models:#bef264;
  --cat-tools:#67e8f9;
  --cat-research:#6ee7b7;
  --cat-business:#93c5fd;
  --cat-policy:#d8b4fe;
  --cat-safety:#fca5a5;
  --cat-industry:#fde68a;
  --cat-products:#f9a8d4;
  --cat-hardware:#fdba74;
  --cat-infrastructure:#a5b4fc;
  --cat-health:#5eead4;
  --cat-security:#fca5a5; /* = Safety */
}
```

| Category | Hex | On bg #09081a | Pill fill (14% on card) | Text on fill | IG pill: text on 18% fill over #04020e |
|---|---|---|---|---|---|
| Models | `#bef264` | 15.1:1 | `#2b312c` | 10.2:1 | 10.9:1 |
| Tools | `#67e8f9` | 13.7:1 | `#1f3041` | 9.3:1 | 10.1:1 |
| Research | `#6ee7b7` | 13.0:1 | `#203038` | 8.9:1 | 9.7:1 |
| Business | `#93c5fd` | 11.0:1 | `#252b42` | 7.7:1 | 8.4:1 |
| Policy | `#d8b4fe` | 11.2:1 | `#2f2942` | 7.8:1 | 8.6:1 |
| Safety | `#fca5a5` | 10.4:1 | `#342735` | 7.4:1 | 8.1:1 |
| Industry | `#fde68a` | 15.9:1 | `#343031` | 10.5:1 | 11.2:1 |
| Products | `#f9a8d4` | 10.9:1 | `#33273c` | 7.7:1 | 8.4:1 |
| Hardware | `#fdba74` | 11.7:1 | `#342a2e` | 8.2:1 | 8.9:1 |
| Infrastructure | `#a5b4fc` | 9.9:1 | `#272941` | 7.1:1 | 7.8:1 |
| Health | `#5eead4` | 13.4:1 | `#1e303c` | 9.2:1 | 9.9:1 |

Lowest values: 9.9:1 on bg and 7.1:1 on fill. **AA passes for all of them.**


## Trade-offs at a glance
- **Option A (Signal):** matches the brief's hue mapping exactly. It's the most vivid and closest to the punchy IG graphics. The downside is that Research (emerald), Health (teal) and Tools (cyan) sit close together in hue, and Models (lime) and Research (green) are neighbours. The chip labels and dots carry the difference, but at a glance they are the least separable of the three.
- **Option B (Spectrum):** the best separation between categories, with every chip a distinct hue. It drops the brief's mapping, though: Models becomes violet, Business amber and Research blue. That has the least continuity with what's live today.
- **Option C (Soft):** the brief's hue mapping in 300-level pastels. It has the highest contrast of the three (minimum 9.9:1 on bg) and is calmer, so the headlines and the orange-to-purple brand gradient lead. On the bright IG photos the pills will read softer than today's. It has the same hue-neighbour caveat as A, slightly reduced because the lightness differs.
- **My recommendation:** C for the website (readability and the brand gradient lead), with A's exact hexes used on the IG graphics if Javier wants more punch there. The hues stay the same, so the system still reads as one. If Javier wants a single palette everywhere, pick B for clarity or A for energy.

## What the IG graphics need in order to follow a palette
New graphics pick up the colors once these are updated. Already published PNGs keep the old pill colors, and they should not be re-rendered (published posts are never edited).
1. **`GRAPHIC_SPEC.md`, section "Category pill (REQUIRED — matches the website category colors)", around lines 29–44.** This is the per-category table (`text`, `bg rgba(...,.18)`, `border rgba(...,.55)`). It is the source of truth that the graphic-writing step copies inline into every `graphics/*.html`. Replace each row with the chosen hex as text, the same RGB at `.18` as bg and at `.55` as border. Add missing rows for **Policy**, **Security** (= Safety), **Products** and **Health**; the spec table has no rows for them today.
2. **`graphics/_base_template.html`.** Line 19 sets the default `.catpill` (currently the Infrastructure indigo `#818cf8`), and line 28 has the inline Safety example (`#f87171`). Update both to the chosen palette.
3. **`.github/workflows/render-graphics.yml`.** This only renders whatever `graphics/*.html` contains (Puppeteer → PNG). It sets no colors, so no change is needed. I found no other renderer that hard-codes pill colors. `automation/reels/make_reel.py` has category colors but belongs to the retired Reels pipeline, so leave it alone.
4. **The story-graphic author** (the step that writes each `graphics/aifeed_*.html` from GRAPHIC_SPEC.md; see CLAUDE.md, "Category pill (REQUIRED)") reads the spec, so it follows step 1 automatically. If the n8n flow `automation/n8n/AIFeed_Autopilot.json` carries its own copy of the pill table, update it too. I searched it and found no pill hex values, but that is worth a second look by the aifeed.run agent.
5. **Website:** only the `--cat-*` variables in `tokens.css` change (see SPEC.md §1). Also delete the old `.cat-*` rules in `index.html` and `post.html`.
6. **Transition:** for a few weeks, older covers will show old-color pills baked into the image, next to new-color HTML pills. That's acceptable because each pill stays legible. Since the HTML pill sits next to the image rather than on it, the mismatch is visible but not confusing.
