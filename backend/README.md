# Backend: `jaathiya-vaarthalu-api`

The website's data as a JSON API. It owns `content/` (sections, ads, paper details, hand-written stories, images) and reads the news approved in the news desk app (`jaathiya-vaartalu-studio-app`) and its published e-papers from the desk app's **MongoDB** (photos are Cloudinary URLs). The website ([`../frontend/`](../frontend/README.md)) renders every page from this API.

Its only npm dependency is the `mongodb` driver. It never writes to the database.

**Staff guide for editing content:** [`content/README.md`](content/README.md).

## Run locally
```bash
npm ci
cp .env.example .env    # put a read-only MONGODB_URI in it; without one only content/ is served
npm run dev             # http://localhost:4000, restarts when src/ or content/ changes
npm test                # content rules, desk news mapping and the API with a stand-in database
npm start               # what Render runs
```
Needs Node 22 or newer. From the repo root, `npm run dev` starts this and the website together.

## Environment

| Variable | Meaning |
|---|---|
| `PORT` | Set by Render (default 4000). |
| `MONGODB_URI` | The desk app's database, with a read-only user. Required on Render. |
| `NEWS_API_URL` | The desk app's public API (`/api/public/news`, `/api/public/epapers`), used only when there is no `MONGODB_URI`. Stories older than `NEWS_DAYS` can't be opened in this mode. |
| `DESK_APP_URL` | The desk app's address. Desk e-papers link to its reader at `/e/<link>`. |
| `NEWS_DAYS` | Days of approved news in `/api/site` (default 90). Older stories still open through `/api/news/<id>`. |
| `REFRESH_SECONDS` | How often the news source is read again (default 120, at least 30). |

With neither `MONGODB_URI` nor `NEWS_API_URL`, only `content/` is served.

## API
All `GET`; JSON is UTF-8 and gzipped when asked for. It only serves published data, so it can be public. The contract is also written at the top of `src/server.js`; keep the frontend's `src/api.js` and `tests/fixture.js` in step with it.

| Path | Returns |
|---|---|
| `/api/site` | `{ generatedAt, site, cats, articles, editions, ads, images }`: everything the pages need. Each article is `{ slug, title, summary, body, image, section, author, date, updated, breaking }` (`section` is a `cats` slug or `''`, dates are ISO), newest first. `images` lists the files under `content/images/`. |
| `/api/news/<id>` | One desk story by its 24-character Mongo id, same shape as an article, for stories older than `NEWS_DAYS`. 404 when it is missing, not approved or not yet due. |
| `/images/<path>` | A file from `content/images/`. |
| `/healthz` | `ok` once the news source has been read; 503 until then. |

## How it works
- **`src/content.js`**: `load()` reads and checks everything in `content/` and throws one error listing every problem (bad JSON, missing fields, unknown section, missing file). A mistake stops the start, so Render keeps the previous deploy live. Drafts and stories with a future `published_at` are left out until their time. Each desk story becomes an article (slug = its Mongo id, plain-text body escaped into paragraphs, Cloudinary photos resized), and each desk e-paper an edition that links to the desk app's reader.
- **`src/mongo.js`**: reads only the `news` (status `approved` or `published`), `epapers` (`published`, newest 60) and `users` (author names) collections.
- **`src/remote.js`**: the same data from the desk app's public API, for when there is no `MONGODB_URI`.
- **`src/server.js`**: reads the news source on start and every `REFRESH_SECONDS`, then builds and gzips `/api/site` once per refresh. If the news source fails, the last news is kept.

## On Render
Web service, Runtime **Node**, **Root Directory** `backend`, branch `main`, build command `npm ci && npm test`, start command `npm start`, **Health Check Path** `/healthz`. The settings are in [`../render.yaml`](../render.yaml).

Set the health check path: without it, a deploy that can't read MongoDB still goes live. With it, a wrong `MONGODB_URI` fails the deploy and the log says `News read failed`.

A push that changes anything under `backend/` (including `content/`) redeploys this service only, in about 2 to 3 minutes.
