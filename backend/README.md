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
| `CLOUDINARY_URL` | `cloudinary://<api key>:<api secret>@<cloud name>`, where the bulletin's audio is kept. The voice is on only when this and a speech key are set. |
| `GEMINI_API_KEY` | A Google AI Studio API key, for the news bulletin's voice (Gemini text-to-speech). |
| `GEMINI_TTS_MODEL` | Default `gemini-3.8-flash-tts` (`gemini-3.8-flash-lite-tts` is cheaper). |
| `GEMINI_TTS_VOICE` | One of Gemini's voices (default `Kore`). |
| `GEMINI_TTS_STYLE` | The reading instruction put in front of each script (default: read like a calm, clear Telugu TV news anchor). |
| `TTS_PROVIDER` | `gemini` (default) or `azure`. |
| `BULLETIN_VOICE` | `off` turns voicing off even when the keys are set. Use it in a local `.env`: it shares the live site's daily quota. |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_TTS_VOICE` | Azure speech instead of Gemini: a Speech resource's key and region (e.g. `centralindia`), and the voice (default `te-IN-ShrutiNeural`). |

Changing the speech service, model, voice or style makes new files for the current day's bulletin (10 conversions).
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
3. A story with no file yet is read aloud and uploaded to Cloudinary as `jaathiya/bulletin/<story id>-<voice>`. The name comes from the story and the voice settings, never from its text. **A story that's already in Cloudinary is always played from there and never converted again**, even after it's edited (the caption shows the edited text). To voice an edited story again, delete its file in Cloudinary's Media Library (`jaathiya/bulletin/<story id>-…`). Before converting anything, the API lists the folder again. So files made earlier, before a restart, or by another copy of the API (for example local development) are picked up instead of converted. When every story in the bulletin already has a file, Cloudinary isn't asked at all.
   - **Gemini** (default): the style instruction, then the headline, summary and text on separate lines, in Telugu (`te-IN`). Gemini returns WAV audio. It's kept as WAV, and listeners get it as MP3, because Cloudinary converts it when the address ends in `.mp3`. If the free tier's rate limit answers 429, the run stops and the rest is voiced on the next refresh.
   - **Azure**: a `te-IN` neural voice through SSML, with 600 ms pauses between the parts, straight to MP3.
4. `/api/site` then carries `script` and `audio` for those stories, and the website picks them up on its next refresh (within about 4 minutes).

Only the current day is voiced. Earlier days keep the audio they got while they were current. A failed story is logged (`Bulletin: story … not voiced`) and tried again on the next refresh. At most 10 files are made per run, and no more than `BULLETIN_DAILY_CHARS` characters a day. A day of 10 stories is about 6,000 characters, so a month is about 180,000.

**Set it up:**
1. **Gemini:** at [Google AI Studio](https://aistudio.google.com), sign in with a Google account and click **Get API key → Create API key**. On the free tier, AI Studio shows the model's rate limits, and Google may use the text sent to improve its products. To use Azure instead, create a **Speech service** resource in the Azure portal (Central India, free F0 tier) and copy **Key 1** and the region.
2. **Cloudinary:** in the Cloudinary console, go to **Settings → API Keys** and copy the **API environment variable** (`cloudinary://…`). It can be the desk app's account; the files go in their own `jaathiya/bulletin/` folder.
3. **Render:** on `jaathiya-vaarthalu-api`, go to **Environment** and set `GEMINI_API_KEY` and `CLOUDINARY_URL` (or, for Azure, `TTS_PROVIDER=azure`, `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`), then save. The start log then says `bulletin voice: Gemini gemini-3.8-flash-tts, Kore`.

## On Render
Web service, Runtime **Node**, **Root Directory** `backend`, branch `main`, build command `npm ci && npm test`, start command `npm start`, **Health Check Path** `/healthz`. The settings are in [`../render.yaml`](../render.yaml).

Set the health check path: without it, a deploy that can't read MongoDB still goes live. With it, a wrong `MONGODB_URI` fails the deploy and the log says `News read failed`.

A push that changes anything under `backend/` (including `content/`) redeploys this service only, in about 2 to 3 minutes.
