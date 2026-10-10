# Jaathiya Vaarthalu (జాతియ వార్తలు) website

This is the static website for a Telugu daily newspaper, hosted free on GitHub Pages. It has news pages in English and Telugu, an e-paper archive, and advertising and print-subscription pages. The design follows newspaperclub.com: hero carousel, icon value rows, card grids, promo bands and a multi-column footer.

There is no server and no database. Stories, sections, e-paper editions and ads are JSON files in `content/`. A small Node script (`npm run build`) turns them into plain HTML pages in `dist/`, and GitHub Actions publishes those pages. The project has **no npm dependencies**.

**To add or change content, see [`content/README.md`](content/README.md).**

## Run locally
```bash
npm run dev     # builds the site and serves it on http://localhost:3000, rebuilding on every change
npm test        # builds a sample site into a temp folder and checks the pages
npm run build   # writes the site to dist/ (set SITE_URL for the real address)
```
Needs Node 22 or newer.

## Publish on GitHub Pages
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
