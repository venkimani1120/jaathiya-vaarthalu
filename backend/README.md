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
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | An Azure Speech resource's key and region (e.g. `centralindia`), for the news bulletin's voice. |
| `CLOUDINARY_URL` | `cloudinary://<api key>:<api secret>@<cloud name>`, where the bulletin's MP3s are kept. The voice is on only when this and both Azure values are set. |
| `AZURE_TTS_VOICE` | The voice (default `te-IN-ShrutiNeural`; `te-IN-MohanNeural` is the male voice). Changing it voices the bulletin again. |
| `BULLETIN_DAILY_CHARS` | The most characters voiced in a day (default 20000), a spending limit. |

With neither `MONGODB_URI` nor `NEWS_API_URL`, only `content/` is served.

## API
All `GET`; JSON is UTF-8 and gzipped when asked for. It only serves published data, so it can be public. The contract is also written at the top of `src/server.js`; keep the frontend's `src/api.js` and `tests/fixture.js` in step with it.

| Path | Returns |
|---|---|
| `/api/site` | `{ generatedAt, site, cats, articles, editions, ads, images }`: everything the pages need. Each article is `{ slug, title, summary, body, image, section, author, date, updated, breaking }` (`section` is a `cats` slug or `''`, dates are ISO), newest first. Stories in a day's news bulletin also have `script` (what the reader says) and `audio` (its MP3 URL, `''` until voiced); both are missing when the voice is off. `images` lists the files under `content/images/`. |
| `/api/news/<id>` | One desk story by its 24-character Mongo id, same shape as an article, for stories older than `NEWS_DAYS`. 404 when it is missing, not approved or not yet due. |
| `/images/<path>` | A file from `content/images/`. |
| `/healthz` | `ok` once the news source has been read; 503 until then. |

## How it works
- **`src/content.js`**: `load()` reads and checks everything in `content/` and throws one error listing every problem (bad JSON, missing fields, unknown section, missing file). A mistake stops the start, so Render keeps the previous deploy live. Drafts and stories with a future `published_at` are left out until their time. Each desk story becomes an article (slug = its Mongo id, plain-text body escaped into paragraphs, Cloudinary photos resized), and each desk e-paper an edition that links to the desk app's reader.
- **`src/mongo.js`**: reads only the `news` (status `approved` or `published`), `epapers` (`published`, newest 60) and `users` (author names) collections.
- **`src/remote.js`**: the same data from the desk app's public API, for when there is no `MONGODB_URI`.
- **`src/bulletin.js`** and **`src/tts.js`**: the news bulletin's voice. See below.
- **`src/server.js`**: reads the news source on start and every `REFRESH_SECONDS`, then builds and gzips `/api/site` once per refresh. If the news source fails, the last news is kept.

## News bulletin voice
The website's `/bulletin/` page plays each story's audio. After every refresh, in the background so the API is never held up:

1. `pick()` takes the current day's bulletin: up to 10 stories, breaking news first, then newest first. This must match `bulletinOf()` in `frontend/src/render.js`.
2. `script()` writes what the reader says: the headline, the summary, then whole opening sentences, up to 600 characters (the dateline the website adds is left out). The story text is read as written.
3. A story whose script has no MP3 yet is read by Azure (`te-IN` neural voice, 600 ms pause between headline, summary and text) and the MP3 is uploaded to Cloudinary as `jaathiya/bulletin/<hash>.mp3`. The hash covers the voice and the script, so a story is voiced again only when its text changes. On start, the existing files are listed once, so a restart voices nothing twice.
4. `/api/site` then carries `script` and `audio` for those stories, and the website picks them up on its next refresh (within about 4 minutes).

Only the current day is voiced. Earlier days keep the audio they got while they were current. A failed story is logged (`Bulletin: story … not voiced`) and tried again on the next refresh. At most 10 files are made per run, and no more than `BULLETIN_DAILY_CHARS` characters a day. A day of 10 stories is about 6,000 characters, so a month is about 180,000.

**Set it up:**
1. **Azure:** in the Azure portal, create a **Speech service** resource. Choose a region near India (e.g. Central India) and the free F0 tier to start. From **Keys and Endpoint**, copy **Key 1** and the **Location/Region**.
2. **Cloudinary:** in the Cloudinary console, go to **Settings → API Keys** and copy the **API environment variable** (`cloudinary://…`). It can be the desk app's account; the files go in their own `jaathiya/bulletin/` folder.
3. **Render:** on `jaathiya-vaarthalu-api`, go to **Environment** and set `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` and `CLOUDINARY_URL`, then save. The start log then says `bulletin voice on`.

## On Render
Web service, Runtime **Node**, **Root Directory** `backend`, branch `main`, build command `npm ci && npm test`, start command `npm start`, **Health Check Path** `/healthz`. The settings are in [`../render.yaml`](../render.yaml).

Set the health check path: without it, a deploy that can't read MongoDB still goes live. With it, a wrong `MONGODB_URI` fails the deploy and the log says `News read failed`.

A push that changes anything under `backend/` (including `content/`) redeploys this service only, in about 2 to 3 minutes.
