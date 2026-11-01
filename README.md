# Jaathiya Vaarthalu (జాతియ వార్తలు) website

This is the website for a Telugu daily newspaper. It has news pages in English and Telugu, an e-paper archive, and advertising and print-subscription pages. The design follows newspaperclub.com: hero carousel, icon value rows, card grids, promo bands and a multi-column footer.

On this branch (`dyna-web-app-render`) the site is **two Node services on Render**:

| Folder | Render service | What it does |
|---|---|---|
| `backend/` | `jaathiya-vaarthalu-api` | Owns the data: checks `backend/content/` (sections, ads, paper details, hand-written stories, images) and reads the news approved in the news desk app (`jaathiya-vaartalu-studio-app`) and its published e-papers straight from the desk app's **MongoDB** (photos on Cloudinary). Serves it all as a JSON API. The only npm dependency is the `mongodb` driver. |
| `frontend/` | `jaathiya-vaarthalu-web` | The public website: renders every page in English and Telugu from the API and serves the CSS, JS, fonts and logo. No npm dependencies and no database access. |

```
browser ──> frontend (pages, /images/ passed through) ──> backend /api/site, /api/news/<id>, /images/ ──> MongoDB + content/
```

Each service reads the one behind it every 2 minutes, so an approved story is on the site within about 4 minutes. The static GitHub Pages build (`npm run build`) still works: it renders the frontend's pages from a backend's API into `frontend/dist/`.

**To add or change content, see [`backend/content/README.md`](backend/content/README.md).**

## Run locally
```bash
npm run install:all                        # npm ci in backend/ and frontend/
cp backend/.env.example backend/.env       # put the read-only MONGODB_URI in it (without it only content/ is shown)
cp frontend/.env.example frontend/.env     # API_URL=http://localhost:4000
npm run dev     # backend on http://localhost:4000, website on http://localhost:3000; both restart on every change
npm test        # backend: content rules and the API (stand-in database); frontend: a sample static build and the web app (stand-in API)
npm run build   # static build into frontend/dist/ from the API at API_URL (set SITE_URL for the real address)
```
Each folder also has its own `npm start`, `npm run dev` and `npm test`; that is what Render runs.
Needs Node 22 or newer.

## Deploy on Render

The steps below use the same MongoDB Atlas cluster as the desk app. The website only reads from it.

1. **Make a read-only database user.** In MongoDB Atlas, open the desk app's project → **Database Access** → **Add New Database User**. Choose password login, name it `jv-web-reader`, generate a password, and under **Database User Privileges** pick **Specific Privileges** → `read` on the desk app's database (the name after `.mongodb.net/` in the desk app's `MONGODB_URI`, e.g. `jaathiya`). Save it.
2. **Get the connection string.** In **Database** → **Connect** → **Drivers**, copy the `mongodb+srv://…` string, put in the new user and password, and add the database name before the `?`: `mongodb+srv://jv-web-reader:<password>@cluster0.xxxxx.mongodb.net/jaathiya?retryWrites=true&w=majority`.
3. **Allow Render to connect.** In **Network Access**, Render must be allowed. If the desk app on Render already connects, its entry (often `0.0.0.0/0`) covers this site too. If not, add the outbound IP addresses Render shows for this service under **Connect → Outbound**.
4. **Push this branch** to GitHub: `git push -u origin dyna-web-app-render`.
5. **Create both services from the Blueprint.** In the Render dashboard, choose **New → Blueprint**, connect the `jaathiya-vaarthalu` repo and pick the `dyna-web-app-render` branch. Render reads `render.yaml`, which has two services, and asks for `MONGODB_URI`. Paste the string from step 2 and click **Apply**.
   *Without the Blueprint:* make two **New → Web Service**s from the repo and branch, Runtime **Node**, Build command `npm ci && npm test`, Start command `npm start`, Health check path `/healthz`: one with **Root Directory** `backend`, one with `frontend`. Add the environment variables listed for each in `render.yaml`.
6. **Point the website at the API.** If Render gave the API service a different address than `https://jaathiya-vaarthalu-api.onrender.com` (shown at the top of its page), set the website service's `API_URL` to it.
7. **Wait for the deploys.** Each build runs its tests. The API is live once its `/healthz` answers `ok`, which needs a successful read of MongoDB; if the connection string is wrong, the deploy fails and the log says `News read failed`. The website is live once it has read the API. Open `https://jaathiya-vaarthalu-web.onrender.com/`; an approved story in the desk app shows up within about 4 minutes.
8. **Optional custom domain.** In the website service's **Settings → Custom Domains**, add the domain and the DNS records Render shows. Then set its environment variable `SITE_URL` to `https://<the domain>` so canonical links, the sitemap and RSS use it. The API service needs no domain.
9. **Search Console.** Submit `sitemap.xml` and `news-sitemap.xml` in Google Search Console.

Every push to `dyna-web-app-render` redeploys the service whose folder changed: edits to `backend/content/` redeploy only the API (about 2 to 3 minutes). Render's free plan stops a service after 15 minutes without requests. The website's refreshes keep the API awake while the website is awake, but after a quiet spell the next visitor waits a minute or two while both start, and sees a "Starting" page meanwhile. For a public news site, use a paid instance type for both, which stays awake (and then `API_URL` can be the private address `http://jaathiya-vaarthalu-api:10000`).

| Service | Variable | Meaning |
|---|---|---|
| API | `MONGODB_URI` | The desk app's database, with a read-only user. Required on Render. |
| API | `NEWS_API_URL` | The desk app's public API, used instead when there is no `MONGODB_URI` (the Pages build). |
| API | `DESK_APP_URL` | The desk app's address. E-papers open in its reader at `/e/<link>`. |
| API | `NEWS_DAYS` | Days of approved news in the lists, search and sitemaps (default 90). Older stories still open by their link. |
| both | `REFRESH_SECONDS` | How often the database (API) or the API (website) is read again (default 120, at least 30). |
| website | `API_URL` | The API service's address. Required. |
| website | `SITE_URL` | The public address. Default: Render's `onrender.com` address. |

### The API
All `GET`, JSON, described at the top of `backend/src/server.js`: `/api/site` (everything the pages need: paper details, sections, stories, editions, ads, image list), `/api/news/<id>` (one desk story older than `NEWS_DAYS`), `/images/<path>` (files in `backend/content/images/`) and `/healthz`. It only serves published data, so it can be public.

## Publish on GitHub Pages (static version)
The static site can still be published on Pages. The workflow starts the backend inside the Actions run (from `backend/content/` and, with the `NEWS_API_URL` repo variable, the desk app's public API) and builds the frontend's pages from it into `frontend/dist/`:

1. **Make Pages available.** Pages needs either a **public** repo or a paid GitHub plan (Pro, Team or Enterprise). E-paper PDFs on GitHub Releases are only readable by the public when the repo is public.
2. **Turn on Pages.** In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. **Publish.** Push to `main`. The *Build and publish* workflow tests the site, builds it and publishes it to `https://<user>.github.io/jaathiya-vaarthalu/`. Its first run shows the link.
4. **Optional custom domain.** In **Settings → Pages → Custom domain**, enter it (e.g. `jaathiyavaarthalu.com`) and add the DNS records GitHub shows, then tick **Enforce HTTPS**. The next build uses the new address automatically.
5. **Search Console.** Submit `sitemap.xml` and `news-sitemap.xml` in Google Search Console.

The workflow also runs **every hour**. The hourly run publishes stories whose `published_at` time has arrived, and starts and ends ads on their dates. Pull requests only run the tests and the build.

## What is included
- **Pages:** home (hero carousel, latest news, one block per section), article, section (20 stories per page), search, e-paper, advertise, subscribe and a 404 page. The build also writes `sitemap.xml`, `news-sitemap.xml`, `rss.xml`, `robots.txt`, Open Graph tags and NewsArticle JSON-LD.
- **Language:** every page is built twice: English at `/` and Telugu under `/te/`. The header toggle opens the same page in the other language, and each page links to its other-language version for Google (`hreflang`). Article text is shown as written. Section names follow the language, and if a section has no Telugu name its English name is used.
- **Search:** the build writes `search-index.json` (the newest 2,000 stories), and `frontend/public/js/search.js` searches it in the browser. Search needs JavaScript and at least 3 characters.
- **Advertise and Subscribe:** ad sizes and subscription plans come from `backend/content/site.json`. The enquiry form opens WhatsApp to the paper's `whatsapp` number with the visitor's answers already typed, so staff get enquiries on the phone. There is also a call button.
- **E-paper:** PDFs live on GitHub Releases and `backend/content/epaper.json` links to them. The page shows the latest edition with older editions listed below.

## Before launch
- Add the Telugu font files listed in `frontend/public/fonts/README.txt` (Inter for English is included).
- Fill in the real prices in `backend/content/site.json` (`advertise.sizes[].price`, `subscription.plans[].price`).
- Replace `frontend/public/logo.png` with the final logo if one is made (and a 1200x630 social image).

## Known limitations
- There is no admin panel. Staff edit JSON files on GitHub, and each change goes live after a build of about 2 minutes.
- Enquiries go to WhatsApp and are not stored anywhere. There is no newsletter signup.
- Scheduled stories and ad dates are applied by the hourly build, so they can be up to an hour late. GitHub may delay scheduled runs at busy times.
- Without JavaScript, search doesn't work and the enquiry form opens WhatsApp with only its title.
- The 404 page is in English, because a static page can't tell which language the visitor was using.
- Only the `inline` ad slot is shown.
- A GitHub Pages site is limited to 1 GB and about 100 GB of traffic a month. Keep photos small and PDFs on Releases.
