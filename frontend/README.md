# Frontend: `jaathiya-vaarthalu-web`

The public website. It renders every page in English (at `/`) and Telugu (under `/te/`) from the [backend API](../backend/README.md), and serves the CSS, JS, fonts and logo in `public/`. It has no npm dependencies and no database access: all data comes from the API over HTTP.

The design follows newspaperclub.com (hero carousel, icon value rows, card grids, promo bands, multi-column footer). The rules are in [`../design/DESIGN.md`](../design/DESIGN.md).

## Run locally
```bash
npm ci
cp .env.example .env    # API_URL=http://localhost:4000 (a running backend)
npm run dev             # http://localhost:3000, restarts when src/ or public/ changes
npm test                # a static build and the web app, both against a stand-in API
npm start               # what Render runs
```
Needs Node 22 or newer. From the repo root, `npm run dev` starts this and the backend together.

## Environment

| Variable | Meaning |
|---|---|
| `PORT` | Set by Render (default 3000). |
| `API_URL` | The backend service, e.g. `https://jaathiya-vaarthalu-api.onrender.com`. Required. |
| `SITE_URL` | The public address, used for canonical links, the sitemap and RSS. Default: Render's `onrender.com` address. Set it when a custom domain is added. |
| `REFRESH_SECONDS` | How often the API is read again (default 120, at least 30). |

## Pages
- **Home:** hero carousel, the day's news, one block per section, the latest e-paper and promo bands.
- **Sections** (`/category/<slug>/`): the day's stories in that section, 20 per page.
- **Today's news:** the home and section pages show only today's news (India time). Until something is published today, they show the latest day that has news, with a note saying so.
- **Old news** (`/old-news/`): a date filter and the earlier days with their story counts. Each day is at `/old-news/<YYYY-MM-DD>/`, with links to the earlier and later day. It covers the backend's `NEWS_DAYS` (90 days).
- **News Bulletin** (`/bulletin/`): the day's top 10 stories (breaking first) in a video-style player: each story's photo and headline as a slide, with play/pause, previous/next, a progress bar, speed, captions, a playlist and lock-screen controls (`public/js/bulletin.js`). Past days are at `/bulletin/<YYYY-MM-DD>/`, with the same date filter as Old news. A story with an `audio` URL is played aloud; until the voice reader (Azure text-to-speech in the backend) is added, each story stays up for its caption's reading time. Without JavaScript the slides are a swipeable strip and the playlist links to the stories.
- **Article** (`/article/<slug>/`): stories older than `NEWS_DAYS` are looked up by their id, so old links keep working.
- **E-paper** (`/epaper/`): the latest edition, a date filter and older editions. Each date is at `/epaper/<YYYY-MM-DD>/`. PDFs open from GitHub Releases, and desk editions in the desk app's reader.
- **Search** (`/search/`): searches `search-index.json` (the newest 2,000 stories) in the browser. Needs JavaScript and at least 3 characters.
- **Advertise and Subscribe:** sizes and plans come from the backend's `site.json`. The enquiry form opens WhatsApp to the paper's number with the visitor's answers typed in.
- **Also:** `404.html` (English only), `sitemap.xml`, `news-sitemap.xml`, `rss.xml` and `robots.txt`, plus Open Graph tags and NewsArticle JSON-LD on every page.

A date with no news or edition shows a "nothing on this date" page that search engines don't index. Without JavaScript, the date filter still works: the server redirects `?date=` to the day's page.

## Code
- **`src/api.js`**: reads `/api/site` and `/api/news/<id>` from the backend (3 tries, 2-minute timeout) and turns dates back into `Date`s.
- **`src/render.js`**: every page as a template string. `createSite()` returns a map of output file → render function, for both languages. All links go through `url()` or `asset()`, because `SITE_URL` may contain a sub-path; never write a bare `href="/..."`.
- **`src/i18n.js`**: all UI text, in English and Telugu. Add any new text in both. Article text is shown as written.
- **`src/server.js`**: reads the API on start and every `REFRESH_SECONDS`, renders a page on its first request and keeps up to 2,000 until the next refresh. If the API fails, the last site is kept. `/healthz` and the pages answer 503 ("Starting") until the first read. `/images/*` is passed through to the backend so pages keep one address.
- **`src/build.js`**: the optional static build (below).
- **`public/js/site.js`**: the hero carousel, the date filter and the WhatsApp enquiry form. **`public/js/search.js`**: search. **`public/js/bulletin.js`**: the news bulletin player. Plain browser JS, no framework or bundler.
- **`public/css/tokens.css`**: colours, fonts and sizes ("royal light" palette). Keep it in step with `../design/tokens.css`.
- **`public/fonts/`**: Inter (English) and Playfair Display are included. The Telugu font files to add are listed in `public/fonts/README.txt`.

## Static build (optional)
```bash
API_URL=http://localhost:4000 SITE_URL=https://example.com npm run build
```
This renders every page from a running backend into `dist/` and downloads the images from it. Nothing publishes it automatically: the site is served by the Render web service. A static copy only has day pages for dates that have news or editions.

## On Render
Web service, Runtime **Node**, **Root Directory** `frontend`, branch `main`, build command `npm ci && npm test`, start command `npm start`, **Health Check Path** `/healthz`, and `API_URL` set to the backend's address. The settings are in [`../render.yaml`](../render.yaml).

A push that changes anything under `frontend/` redeploys this service only. Free instances sleep after 15 idle minutes, so after a quiet spell the first visitor sees the "Starting" page for a minute or two while this service and the API wake up.
