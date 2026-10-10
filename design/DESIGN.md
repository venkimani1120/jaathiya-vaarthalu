# Jaathiya Vaarthalu: typography and UI design

**Visual reference:** newspaperclub.com (white pages, bold sans headlines, pill buttons, hero carousel,
icon value rows, card grids, coloured promo bands, dark multi-column footer).
**Language:** English UI by default with a Telugu toggle (`lang` cookie). Article text is shown as written.

**Audience:** Telugu readers, mostly on mid/low-end Android phones over patchy networks.
**Primary job:** read today's news fast, and find the print edition.

## Design idea
The site is a print newspaper's web edition, so the one memorable element is the
**"Today's paper" strip**: the front page of the day's e-paper, shown as a thumbnail
right under the lead story, one tap to open. Everything else stays quiet and fast.

## Color: "royal light" palette (tokens in tokens.css)
Light colours only: there is no dark mode and no dark panels. Text stays dark for readability.
| Name | Token | Hex | Use |
|---|---|---|---|
| Warm white | --paper | #FFFDF8 | page background |
| Parchment | --band | #F6F1E7 | alternate section bands, footer |
| Lavender | --lavender / --lavender-2 | #F1ECFB / #E7DEFA | top strip, hero, newsletter, advertise promo |
| Cream | --cream | #FBF3DC | gradient partner, subscribe promo |
| Ink | --ink | #2A2340 | text |
| Royal violet | --brand | #5B3FC4 | primary buttons, active states |
| Violet link | --link | #4B32B0 | links, section labels |
| Gold | --gold | #E2C15A | main call to action, section-heading bars, active underlines, focus rings (fill only) |
| Gold text | --gold-ink | #7D600F | kickers, prices, icons |
| Crimson | --crimson / --crimson-tint | #B42340 / #FDECEE | breaking-news strip only |
| Emerald | --green | #0E6B3A | "published" and success states |
Every text/background pair meets WCAG AA (4.5:1). Never use --gold for text; use --gold-ink.

## Typography
- **English (default):** Playfair Display (`--font-display`) for h1/h2 and story titles; Inter 400-800 for body and UI. Line height 1.65 body / 1.3 headlines.
- **Telugu (`<html lang="te">`):** Noto Sans Telugu 400-700 first, Inter as fallback. Telugu glyphs on English pages (e.g. Telugu article titles) also fall back to Noto through the font stack.
- Self-host WOFF2 subsets (Telugu + Latin), `font-display: swap`; keep fonts under ~150 KB total.
- **Line height in Telugu mode:** 1.8 body, 1.5 headlines. Tight leading clips stacked conjuncts (ద్ధ, క్ష్మ). The `--lh-*` tokens switch automatically.
- **Never** use letter-spacing, ALL CAPS, or justified text (it opens ugly gaps in Telugu).
- Line length about 60ch; article body 1.2rem on mobile.
- Scale: 0.83 / 1 / 1.2 / 1.44 / 1.73 / 2.07 rem on an 18px base.
- Test real headlines with long compound words to check wrapping, not placeholder text.

## Layout (mobile first, one column)
```
┌──────────────────────┐
│ జాతియ వార్తలు    ☰ 🔍 │  masthead (confirm against your logo)
├──────────────────────┤
│ ▌ breaking ticker     │  scrolls horizontally
├──────────────────────┤
│ [ lead image ]        │
│ Lead headline         │
│ summary · time        │
├──────────────────────┤
│ ┌──┐ Today's paper    │  e-paper strip: front-page thumbnail
│ └──┘ 1 Oct · Open     │
├──────────────────────┤
│ Latest (image + title rows)
│ Politics  → 3 items   │  category blocks
│ Sports    → 3 items   │
├──────────────────────┤
│ Newsletter · footer   │
└──────────────────────┘
```
- **Tablet/desktop:** lead story spans 2/3, latest list and a sidebar ad slot on the right; category blocks in 2-3 columns.
- **Alignment:** left-aligned everywhere.
- **Article page:** headline, byline + date, cover image, body at ~60ch, related stories, inline ad after paragraph 3 (not before the first paragraph).
- **Ads:** reserve slot height to prevent layout shift; label them "ప్రకటన".

## UI principles
1. **Speed is design.** Images lazy-load, WebP, explicit width/height. The one carousel (home hero) is a CSS scroll-snap strip that works without JS; `public/js/site.js` adds arrows, dots and autoplay, which pauses on hover/focus, has a pause button, and is off for reduced-motion users.
2. **Cards for stories:** rounded cards (16:9 image, category, headline, date) in an auto-fill grid. Section headings carry a short saffron bar.
3. **One accent per job:** royal violet for brand/actions, gold for highlights and the main call to action, crimson only for breaking news, emerald only for status.
4. **Motion:** none except the ticker scroll (paused on reduced-motion) and tap feedback.
5. **Accessibility:** visible focus, 44px tap targets, `<html lang>` matches the chosen language, alt text on images.
6. **Copy:** plain Telugu, sentence-style labels, same word for the same action everywhere (e.g., ప్రచురించు → "ప్రచురించబడింది").

## Masthead and footer (from the official letterhead)
- **Masthead text:** జాతియ వార్తలు, with the sub-line **తెలుగు దినపత్రిక** below it. Use the logo
  file itself (SVG or transparent PNG) in the header, not typed text; the logo has a custom outlined Telugu lettering.
- **Header strip (desktop):** Editor & Publisher: మామిడి రాజేష్ on the left, RNI No. APTEL/25/A5264 and phone on the right,
  as on the letterhead. On mobile, move these to the footer and keep only the logo and menu.
- **Footer (required for a registered newspaper):** RNI number, Editor & Publisher name, publishing centre (Narasaraopet),
  Guntur office address, phone, "Established 2025". All values live in `config/site.json`.
- **Logo:** the new logo (`public/logo.png`) is an India map with a torch, navy lettering and a saffron/green flame. It reads "JAATHIYA VAARTALU / NEWS" in English only. For a Telugu-first site, ask for a version with the Telugu wordmark జాతియ వార్తలు, since the letterhead logo is red with Telugu lettering.
