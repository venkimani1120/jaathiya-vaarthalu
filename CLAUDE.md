# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Jaathiya Vaarthalu (జాతియ వార్తలు): static website for a Telugu daily newspaper, published on GitHub Pages. Public pages are in English by default with a Telugu version under `/te/`. There is an e-paper archive and there are advertising and print-subscription pages. The public design follows newspaperclub.com. There is **no server, no database and no npm dependencies**: content is JSON in `content/`, and `src/build.js` (plain Node 22+) renders it to HTML in `dist/`. Keep it dependency-free, and keep browser JS as plain files under `public/js/` (no frontend bundler).

## Commands

```bash
npm run dev     # build + serve dist/ on http://localhost:3000 (Pages-like: dir → index.html, /x → /x/, 404.html), rebuilds on changes
npm run build   # write dist/; SITE_URL sets the absolute address and base path (default http://localhost:3000)
npm test        # tests/build.test.js: builds fixture content into a temp dir with SITE_URL=https://example.github.io/jv/ and asserts on the files
```

- There is no linter and no test framework. `npm test` is a single plain `node:assert` script.
- `.github/workflows/pages.yml` runs the tests, builds with `SITE_URL` from `actions/configure-pages` (`base_url`) and deploys `main` to Pages. It runs on push, on PRs (test + build only), hourly (cron) and by hand.

## Architecture

- **`content/`**: everything editors change; `content/README.md` is the staff guide, so keep it in step with any format change. `site.json` (paper identity, `whatsapp` number, `advertise.sizes`, `subscription.plans`), `categories.json` (`slug`, `name_en` required, `name_te` optional), `articles/<slug>.json` (the file name is the slug and URL; NFC-normalised), `epaper.json` (`date`, `pdf` URL on GitHub Releases, optional `thumb`, `name`), `ads.json` (`slot`, `image`, `link`, `start`, `end`) and `images/`.
- **`src/content.js`**: `load(dir, now)` reads and validates all content and throws one error that lists every problem (bad JSON, missing fields, unknown section, missing local file), so a bad edit fails the Actions run instead of publishing. Times in content are India time (`YYYY-MM-DD HH:MM`; `toDate` appends `+05:30` unless a zone is given). Drafts (`"draft": true`) and stories with a future `published_at` are dropped here: that is the whole publishing lifecycle, and the hourly cron rebuild makes scheduled stories go live. Local paths (images, thumbs) are relative to `content/`; `https://` URLs pass through.
- **`src/render.js`**: `renderSite(data)` returns a `Map` of output file → contents for every page in both languages, plus `404.html`, `search-index.json`, `sitemap.xml`, `news-sitemap.xml`, `rss.xml` and `robots.txt`. Pages are template strings with the local `esc()` helper and the `page(L, o)` layout (header, nav, language toggle, breaking ticker, footer, canonical + `hreflang` alternates, Open Graph, JSON-LD). `o.path` is the site path without the language prefix, always with a trailing slash (`/advertise/`). **All links must go through `url(L, p)` (pages) or `asset(p)` (CSS, JS, images, feeds)**, because `SITE_URL` may contain a sub-path (`https://user.github.io/repo`); never write a bare `href="/..."`. The test checks every `href`/`src`/`action` on several pages for the base path. Ads are chosen at build time by date.
- **`src/i18n.js`**: all public UI text in English (`en`) and Telugu (`te`), keyed in `STR`; any new UI text must be added in both. `pick(obj, field, lang)` chooses `field_en`/`field_te` (falling back to Telugu) for `site.json` entries. Section names use `secName()` in `render.js` instead, because English is their main name and each language falls back to the other. Article text is not translated.
- **`src/build.js`**: loads content, renders, wipes `dist/`, copies `public/` (minus `.txt`) and `content/images/`, writes the files. `src/dev.js` is the local preview server (`node:http`).
- **Browser JS**: `public/js/site.js` runs the hero carousel (a scroll-snap strip without JS), preselects the size/plan from `?size=`/`?plan=` and, on submit of a `.wa-form`, writes the labelled field values into the hidden `text` input so the GET to `https://wa.me/<number>` opens WhatsApp with the enquiry typed. The visible fields have no `name`, so only `text` is sent. `public/js/search.js` fetches `search-index.json` and filters on the lower-cased `x` field (title + summary + body text). It gets its strings and links from `data-` attributes on `#search-results` and rebuilds the same card markup as `card()` in `render.js`; keep the two in step.
- **Article body** is HTML written by people with push access to the repo, and it is inserted as-is (no sanitiser). Treat repo write access as publishing rights.

## Design rules (from `design/DESIGN.md`)

- The look follows newspaperclub.com: white pages, bold sans headlines, pill buttons, a hero carousel, icon value rows, card grids, coloured promo bands and a dark footer. Build mobile first for low-end Android phones, and lazy-load images with explicit width and height.
- Fonts: Inter (self-hosted, `public/fonts/Inter-var.woff2`) for English, and Noto Sans Telugu when `<html lang="te">`. The `--font-*` and `--lh-*` tokens switch on `:root[lang="te"]`. Never use letter-spacing, ALL CAPS or justified text. Telugu mode uses a line height of 1.8 for body text and 1.5 for headlines.
- Colors come from the tokens in `public/css/tokens.css`, which has a copy in `design/tokens.css` (keep the two in sync). The palette is "royal light": light colours only, with no dark mode and no dark panels. It uses warm-white and parchment pages, lavender and cream tints for feature areas, royal violet for actions, gold for the main call to action and highlights, crimson only for breaking news, and emerald for status. Never use `--gold` for text: use `--gold-ink`. English h1/h2 and story titles use Playfair Display (`--font-display`). The current page and section get `aria-current="page"` in the nav (`cur()` in `page()`). 
- Ads reserve their height in advance and carry the label "ప్రకటన". The inline ad goes after paragraph 3.
- Use plain wording in both languages and the same word for the same action everywhere.

## Known limitations

- No admin panel: staff edit JSON on GitHub. No stored enquiries and no newsletter.
- Scheduling and ad dates have up to 1 hour of lag (hourly cron). Search and the full enquiry message need JS.
- `404.html` is English only. Only the `inline` ad slot is rendered.
- `docs/Future_Enhancement.md` describes the earlier server version and is out of date.
