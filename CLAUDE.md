# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Jaathiya Vaarthalu (జాతియ వార్తలు): website for a Telugu daily newspaper. Public pages are in English by default with a Telugu version under `/te/`. There is an e-paper archive and there are advertising and print-subscription pages. The public design follows newspaperclub.com.

On the `dyna-web-app-render` branch it is **two Node services on Render** (`render.yaml`, one per folder via `rootDir`):

- **`backend/`** (`jaathiya-vaarthalu-api`): owns all data. Checks `backend/content/` (JSON) and reads approved news and published e-papers from the news desk app's **MongoDB** (separate repo `jaathiya-vaartalu-studio-app`; photos on Cloudinary), and serves them as a JSON API. Its only npm dependency is `mongodb`; keep it that way.
- **`frontend/`** (`jaathiya-vaarthalu-web`): the public website. Renders every page from the backend API and serves `public/`. No npm dependencies and no database access; keep it that way. Browser JS stays plain files under `frontend/public/js/` (no framework, no bundler).

The two only talk over HTTP; never `require()` across the folders (each is deployed from its own root). The static build (`frontend/src/build.js` → `frontend/dist/`, GitHub Pages) still works and shares all templates.

## Commands

```bash
npm run install:all   # npm ci in backend/ and frontend/
npm run dev           # scripts/dev.js: backend on :4000 and frontend on :3000 (API_URL=http://localhost:4000), each with its own .env, restarting on changes
npm test              # both suites (below)
npm run build         # frontend static build into frontend/dist/ from the API at API_URL; SITE_URL sets the absolute address and base path
```

- In each folder: `npm start` (what Render runs), `npm run dev`, `npm test`. Env: `render.yaml`, `backend/.env.example`, `frontend/.env.example`.
- Tests: `backend/tests/content.test.js` (content rules, desk news mapping, `fetchRemote`), `backend/tests/server.test.js` (API with a stand-in db), `frontend/tests/build.test.js` (static build of `tests/fixture.js` API data from a stand-in backend, `SITE_URL=https://example.github.io/jv/`), `frontend/tests/server.test.js` (web app with a stand-in backend).
- There is no linter and no test framework: plain `node:assert` scripts.
- `.github/workflows/pages.yml` runs both test suites, starts the backend inside the run (content/ plus the desk app's public API from the `NEWS_API_URL` repo variable, skipped on PRs), waits for its `/healthz`, builds the frontend against it with `SITE_URL` from `actions/configure-pages` (`base_url`) and deploys `main` to Pages. It runs on push, on PRs (test + build only), hourly (cron) and by hand.

## Architecture

### Backend (`backend/`)

- **`content/`**: everything editors change; `content/README.md` is the staff guide, so keep it in step with any format change. `site.json` (paper identity, `whatsapp` number, `advertise.sizes`, `subscription.plans`), `categories.json` (`slug`, `name_en` required, `name_te` optional), `articles/<slug>.json` (the file name is the slug and URL; NFC-normalised), `epaper.json` (`date`, `pdf` URL on GitHub Releases, optional `thumb`, `name`), `ads.json` (`slot`, `image`, `link`, `start`, `end`) and `images/`.
- **`src/content.js`**: `load(dir, now, remote)` reads and validates all content and throws one error that lists every problem (bad JSON, missing fields, unknown section, missing local file), so a bad edit fails the deploy (the API won't start) instead of publishing. Times in content are India time (`YYYY-MM-DD HH:MM`; `toDate` appends `+05:30` unless a zone is given). Drafts (`"draft": true`) and stories with a future `published_at` are dropped here: that is the whole publishing lifecycle, and the periodic refresh makes scheduled stories go live. Local paths (images, thumbs) are relative to `content/`; `https://` URLs pass through. Each desk story goes through `remoteArticle()` (slug = Mongo id, plain-text body **escaped** into `<p>`s because reporters are not repo writers, Cloudinary URLs get a `c_limit,w_1280,f_auto,q_auto` transform, desk sections via `DESK_SECTION`) and each edition becomes `{ date, link: <app>/e/<shareSlug>, name }` (`link` instead of `pdf`).
- **`src/mongo.js`**: `connect(uri)` → `{ fetchFromMongo({ days, base }), findNews(id), close }`. Reads only the collections `news` (status `approved`/`published`; date = `reviewedAt || createdAt`), `epapers` (`published`) and `users` (author names). `toItem()` gives the same shape as the desk app's `GET /api/public/news`, so `remoteArticle()` maps both.
- **`src/remote.js`**: `fetchRemote(base, { days })` reads the desk app's public API (`GET /api/public/news?days=&page=`, 200 per page; `GET /api/public/epapers`; 3 tries, 2-minute timeout). Used instead of MongoDB when `NEWS_API_URL` is set and `MONGODB_URI` is not (the Pages build); then `/api/news/<id>` always 404s.
- **`src/server.js`**: `createServer({ contentDir, db, days, deskUrl })` returns `{ server, refresh }`. `refresh()` (on start, then every `REFRESH_SECONDS`) calls `db.fetchFromMongo()` and `load()` and pre-serialises (and gzips) `/api/site`; if the news source fails it keeps the last news. **The API contract** (documented at the top of the file; keep `frontend/src/api.js` and `frontend/tests/fixture.js` in step): `GET /api/site` → `{ generatedAt, site, cats, articles, editions, ads, images }`, where each article is `{ slug, title, summary, body, image, section, author, date, updated, breaking }` (`toJson()`: the `cat` object becomes its `section` slug, dates ISO) and `images` lists the files under `content/images/`; `GET /api/news/<24-hex id>` → one desk story (only if approved and due), else 404; `GET /images/<path>`; `/healthz` is 503 until the first news read succeeds (so a bad deploy doesn't go live). A content error stops the start.

### Frontend (`frontend/`)

- **`src/api.js`**: `connect(apiUrl)` → `{ fetchSite(), findNews(id, cats), image(rel) }` (3 tries, 2-minute timeout; 404 → null). `fromApi()` turns `/api/site` back into what `render.js` uses: `Date`s, and `a.cat` = the `cats` entry for `a.section`.
- **`src/render.js`**: `createSite(data)` returns `routes` (output file → function that renders it) for every page in both languages, plus `404.html`, `search-index.json`, `sitemap.xml`, `news-sitemap.xml`, `rss.xml` and `robots.txt`, and `article(L, a)` for old stories. `renderSite()` = every route rendered, for the static build. Pages are template strings with the local `esc()` helper and the `page(L, o)` layout (header, nav, language toggle, breaking ticker, footer, canonical + `hreflang` alternates, Open Graph, JSON-LD). `o.path` is the site path without the language prefix, always with a trailing slash (`/advertise/`). **All links must go through `url(L, p)` (pages) or `asset(p)` (CSS, JS, images, feeds)**, because `SITE_URL` may contain a sub-path (`https://user.github.io/repo`); never write a bare `href="/..."`. The build test checks every `href`/`src`/`action` on several pages for the base path. Ads are chosen at render time by date.
- **`src/i18n.js`**: all public UI text in English (`en`) and Telugu (`te`), keyed in `STR`; any new UI text must be added in both. `pick(obj, field, lang)` chooses `field_en`/`field_te` (falling back to Telugu) for `site.json` entries. Section names use `secName()` in `render.js` instead, because English is their main name and each language falls back to the other. Article text is not translated.
- **`src/server.js`**: `createServer({ siteUrl, api, publicDir })` returns `{ server, refresh }`. It listens at once; `refresh()` (on start, then every `REFRESH_SECONDS`) calls `api.fetchSite()` and `createSite()`, swaps in the new site and clears the page cache (max 2000 pages, rendered on first request); if the API fails it keeps the last site. Until the first read, `/healthz` and pages are 503. Stories older than `NEWS_DAYS` are looked up via `api.findNews` (misses cached too). It serves Pages-like paths (`/x` → `/x/`, `404.html`), `public/`, passes `/images/*` through to the backend (so pages keep one origin), and gzips text.
- **`src/build.js`**: `buildAll({ apiUrl, outDir, siteUrl, now })` fetches `/api/site`, `build()` renders, wipes `dist/`, copies `public/` (minus `.txt`) and writes the pages, then downloads every file in `images` from the API. An API failure fails the build.
- **Browser JS**: `public/js/site.js` runs the hero carousel (a scroll-snap strip without JS), preselects the size/plan from `?size=`/`?plan=` and, on submit of a `.wa-form`, writes the labelled field values into the hidden `text` input so the GET to `https://wa.me/<number>` opens WhatsApp with the enquiry typed. The visible fields have no `name`, so only `text` is sent. `public/js/search.js` fetches `search-index.json` and filters on the lower-cased `x` field (title + summary + body text). It gets its strings and links from `data-` attributes on `#search-results` and rebuilds the same card markup as `card()` in `render.js`; keep the two in step.
- **Article body** from `content/articles/` is HTML written by people with push access to the repo, and it is inserted as-is (no sanitiser). Treat repo write access as publishing rights.

## Design rules (from `design/DESIGN.md`)

- The look follows newspaperclub.com: white pages, bold sans headlines, pill buttons, a hero carousel, icon value rows, card grids, coloured promo bands and a dark footer. Build mobile first for low-end Android phones, and lazy-load images with explicit width and height.
- Fonts: Inter (self-hosted, `frontend/public/fonts/Inter-var.woff2`) for English, and Noto Sans Telugu when `<html lang="te">`. The `--font-*` and `--lh-*` tokens switch on `:root[lang="te"]`. Never use letter-spacing, ALL CAPS or justified text. Telugu mode uses a line height of 1.8 for body text and 1.5 for headlines.
- Colors come from the tokens in `frontend/public/css/tokens.css`, which has a copy in `design/tokens.css` (keep the two in sync). The palette is "royal light": light colours only, with no dark mode and no dark panels. It uses warm-white and parchment pages, lavender and cream tints for feature areas, royal violet for actions, gold for the main call to action and highlights, crimson only for breaking news, and emerald for status. Never use `--gold` for text: use `--gold-ink`. English h1/h2 and story titles use Playfair Display (`--font-display`). The current page and section get `aria-current="page"` in the nav (`cur()` in `page()`). 
- Ads reserve their height in advance and carry the label "ప్రకటన". The inline ad goes after paragraph 3.
- Use plain wording in both languages and the same word for the same action everywhere.

## Known limitations

- No admin panel on this site: news is managed in the desk app, other content is JSON on GitHub. No stored enquiries and no newsletter.
- The web app: news, scheduling and ad dates lag up to twice `REFRESH_SECONDS` (API refresh + website refresh); Render's free plan sleeps after 15 idle minutes, and a waking website shows a 503 "Starting" page until the API answers. The static build: up to 1 hour (hourly cron). Search and the full enquiry message need JS.
- Desk-app stories older than `NEWS_DAYS` leave the lists (the web app still opens them by id; the static build 404s). Desk e-papers have no thumbnail.
- `404.html` is English only. Only the `inline` ad slot is rendered.
- `docs/Future_Enhancement.md` describes the earlier server version and is out of date.
