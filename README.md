# Jaathiya Vaarthalu (జాతియ వార్తలు) website

This is the website for a Telugu daily newspaper. It has news pages in English and Telugu, an e-paper archive, and advertising and print-subscription pages. The design follows newspaperclub.com: hero carousel, icon value rows, card grids, promo bands and a multi-column footer.

On this branch (`dyna-web-app-render`) the site is a **Node web app on Render** (`src/server.js`). It shows the news approved in the news desk app (`jaathiya-vaartalu-studio-app`) by reading the desk app's **MongoDB** directly, with photos from Cloudinary, plus the desk app's published e-papers. It reads the database again every 2 minutes, so an approved story is on the site within about 2 minutes. Sections, ads, paper details and any hand-written stories are still JSON files in `content/`. The only npm dependency is the `mongodb` driver. The static GitHub Pages build (`npm run build`) still works.

**To add or change content, see [`content/README.md`](content/README.md).**

## Run locally
```bash
npm install
cp .env.example .env   # put the read-only MONGODB_URI in .env (without it only content/ is shown)
npm run dev     # serves the site on http://localhost:3000 and restarts on every change
npm test        # checks a sample static build and the web app (with a stand-in database)
npm start       # what Render runs
npm run build   # static build into dist/ (set SITE_URL for the real address)
```
Needs Node 22 or newer.

## Deploy on Render

The steps below use the same MongoDB Atlas cluster as the desk app. The website only reads from it.

1. **Make a read-only database user.** In MongoDB Atlas, open the desk app's project → **Database Access** → **Add New Database User**. Choose password login, name it `jv-web-reader`, generate a password, and under **Database User Privileges** pick **Specific Privileges** → `read` on the desk app's database (the name after `.mongodb.net/` in the desk app's `MONGODB_URI`, e.g. `jaathiya`). Save it.
2. **Get the connection string.** In **Database** → **Connect** → **Drivers**, copy the `mongodb+srv://…` string, put in the new user and password, and add the database name before the `?`: `mongodb+srv://jv-web-reader:<password>@cluster0.xxxxx.mongodb.net/jaathiya?retryWrites=true&w=majority`.
3. **Allow Render to connect.** In **Network Access**, Render must be allowed. If the desk app on Render already connects, its entry (often `0.0.0.0/0`) covers this site too. If not, add the outbound IP addresses Render shows for this service under **Connect → Outbound**.
4. **Push this branch** to GitHub: `git push -u origin dyna-web-app-render`.
5. **Create the service from the Blueprint.** In the Render dashboard, choose **New → Blueprint**, connect the `jaathiya-vaarthalu` repo and pick the `dyna-web-app-render` branch. Render reads `render.yaml` and asks for `MONGODB_URI`. Paste the string from step 2 and click **Apply**.
   *Without the Blueprint:* **New → Web Service**, pick the repo and branch, Runtime **Node**, Build command `npm ci && npm test`, Start command `npm start`, Health check path `/healthz`, then add the environment variables listed in `render.yaml`.
6. **Wait for the deploy.** The build runs the tests. The service is live once `/healthz` answers `ok`, which needs a successful read of MongoDB. If the connection string is wrong, the deploy fails and the log says `MongoDB read failed`. Open `https://jaathiya-vaarthalu-web.onrender.com/`; an approved story in the desk app shows up within 2 minutes.
7. **Optional custom domain.** In the service's **Settings → Custom Domains**, add the domain and the DNS records Render shows. Then set the environment variable `SITE_URL` to `https://<the domain>` so canonical links, the sitemap and RSS use it.
8. **Search Console.** Submit `sitemap.xml` and `news-sitemap.xml` in Google Search Console.

Every push to `dyna-web-app-render` redeploys, including edits to `content/` (about 2 to 3 minutes). Render's free plan stops the service after 15 minutes without visitors, and the next visitor waits about a minute while it starts. For a public news site, use a paid instance type, which stays awake.

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | The desk app's database, with a read-only user. Required on Render. |
| `DESK_APP_URL` | The desk app's address. E-papers open in its reader at `/e/<link>`. |
| `NEWS_DAYS` | Days of approved news in the lists, search and sitemaps (default 90). Older stories still open by their link. |
| `REFRESH_SECONDS` | How often the database is read again (default 120, at least 30). |
| `SITE_URL` | The public address. Default: Render's `onrender.com` address. |

## Publish on GitHub Pages (static version)
The static site built from `content/` (and, with `NEWS_API_URL`, the desk app's public API) can still be published on Pages:

1. **Make Pages available.** Pages needs either a **public** repo or a paid GitHub plan (Pro, Team or Enterprise). E-paper PDFs on GitHub Releases are only readable by the public when the repo is public.
2. **Turn on Pages.** In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. **Publish.** Push to `main`. The *Build and publish* workflow tests the site, builds it and publishes it to `https://<user>.github.io/jaathiya-vaarthalu/`. Its first run shows the link.
4. **Optional custom domain.** In **Settings → Pages → Custom domain**, enter it (e.g. `jaathiyavaarthalu.com`) and add the DNS records GitHub shows, then tick **Enforce HTTPS**. The next build uses the new address automatically.
5. **Search Console.** Submit `sitemap.xml` and `news-sitemap.xml` in Google Search Console.

The workflow also runs **every hour**. The hourly run publishes stories whose `published_at` time has arrived, and starts and ends ads on their dates. Pull requests only run the tests and the build.

## What is included
- **Pages:** home (hero carousel, latest news, one block per section), article, section (20 stories per page), search, e-paper, advertise, subscribe and a 404 page. The build also writes `sitemap.xml`, `news-sitemap.xml`, `rss.xml`, `robots.txt`, Open Graph tags and NewsArticle JSON-LD.
- **Language:** every page is built twice: English at `/` and Telugu under `/te/`. The header toggle opens the same page in the other language, and each page links to its other-language version for Google (`hreflang`). Article text is shown as written. Section names follow the language, and if a section has no Telugu name its English name is used.
- **Search:** the build writes `search-index.json` (the newest 2,000 stories), and `public/js/search.js` searches it in the browser. Search needs JavaScript and at least 3 characters.
- **Advertise and Subscribe:** ad sizes and subscription plans come from `content/site.json`. The enquiry form opens WhatsApp to the paper's `whatsapp` number with the visitor's answers already typed, so staff get enquiries on the phone. There is also a call button.
- **E-paper:** PDFs live on GitHub Releases and `content/epaper.json` links to them. The page shows the latest edition with older editions listed below.

## Before launch
- Add the Telugu font files listed in `public/fonts/README.txt` (Inter for English is included).
- Fill in the real prices in `content/site.json` (`advertise.sizes[].price`, `subscription.plans[].price`).
- Replace `public/logo.png` with the final logo if one is made (and a 1200x630 social image).

## Known limitations
- There is no admin panel. Staff edit JSON files on GitHub, and each change goes live after a build of about 2 minutes.
- Enquiries go to WhatsApp and are not stored anywhere. There is no newsletter signup.
- Scheduled stories and ad dates are applied by the hourly build, so they can be up to an hour late. GitHub may delay scheduled runs at busy times.
- Without JavaScript, search doesn't work and the enquiry form opens WhatsApp with only its title.
- The 404 page is in English, because a static page can't tell which language the visitor was using.
- Only the `inline` ad slot is shown.
- A GitHub Pages site is limited to 1 GB and about 100 GB of traffic a month. Keep photos small and PDFs on Releases.
