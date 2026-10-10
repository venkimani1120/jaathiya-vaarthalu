# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Jaathiya Vaarthalu (జాతియ వార్తలు): website for a Telugu daily newspaper. It has server-rendered public pages (English UI by default, with a Telugu option), an e-paper archive, advertising and print-subscription pages, and an admin panel. The public design follows newspaperclub.com. The stack is Node 22.13+, Express and SQLite through Node's built-in `node:sqlite`. There are **no native modules and no frontend build step**, so don't add dependencies that change either of those (for example, use `bcryptjs`, not `bcrypt`).

## Commands

```bash
npm install
cp .env.example .env   # SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, SITE_URL, PORT
npm run seed           # creates the admin user and starter categories
npm run dev            # node --watch on http://localhost:3000 (admin UI at /admin)
npm start              # production start (pm2 uses deploy/pm2.config.js)
npm test               # tests/render.smoke.js (every public page, in-memory DB) + tests/notify.test.js (SMS alerts) + tests/whatsapp.test.js (WhatsApp feed), the last two with a fake fetch
```

- All scripts load `.env` with `node --env-file=.env`, so the file must exist.
- There is no linter and no test framework. `npm test` is a single plain `node:assert` script, so to run one check, comment out the others or run just the part you need with `node --no-warnings tests/render.smoke.js`.
- E-paper thumbnails need poppler's `pdftoppm` on the PATH (`poppler-utils`). If it is missing, the upload still succeeds and the edition is saved without a thumbnail.

## Architecture

- **`server/index.js`**: the Express app. It sets up middleware (helmet, sessions, static files), the JSON API (`/api/...`), auth, every `/api/admin/...` route, the public form POSTs (`/newsletter` and `/enquiry`, which redirect with 303 to `/thanks?t=...`), and starts the scheduler. Public HTML pages are not defined here. They come from `require('./render').register(app, db)`, and its `notFound` handler is mounted last.
- **`server/render.js`**: every reader-facing HTML page (`/`, `/article/:slug`, `/category/:slug`, `/search`, `/epaper`, `/advertise`, `/subscribe`, `/thanks`), the language switch `/lang/:code`, plus `sitemap.xml`, `news-sitemap.xml`, `rss.xml` and `robots.txt`. Pages are built from template strings with the local `esc()` helper and the `page()` layout, which adds the header, nav, language toggle, breaking-news ticker, newsletter band, footer, Open Graph tags and JSON-LD. The only public JavaScript is `public/js/site.js`, which enhances the home hero carousel (it works as a scroll-snap strip without JS). Inline scripts are blocked by helmet's CSP, so any client JS must be a file under `public/js/`. `register(app, db)` takes `db` as a parameter so the smoke test can pass in an in-memory DB and a fake `app` that only implements `get`. Keep that interface: render routes may only use `app.get` and `res.status/set/type/send/json/redirect`.
- **`server/i18n.js`**: all public UI text in English (`en`, the default) and Telugu (`te`), keyed in `STR`. `langOf(req)` reads the `lang` cookie, and `pick(obj, field, lang)` chooses `field_en` or `field_te` (falling back to Telugu) for `config/site.json` entries. Section (category) names use `secName(o, field, L)` in `render.js` instead, because English is their main name: `name_en` is required, the Telugu `name_te` is optional, and each language falls back to the other. `name_te` is NOT NULL, so the API stores the English name there when no translation is given, and the admin form shows that field empty when it equals `name_en`. The JSON API returns `COALESCE(c.name_en, c.name_te)`. Inside `render.js`, `ctx(req)` returns the language, the strings `T`, and language-aware helpers, and `page(req, o)` needs `req`. Any new UI text must be added in both languages. Article text is not translated. Because pages vary by cookie they are sent as `Cache-Control: private` with `Vary: Cookie`, so do not make them `public`.
- **`server/db/client.js`**: opens `data/app.db` in WAL mode with foreign keys on, runs `schema.sql` on every start (all statements are `IF NOT EXISTS`), and exposes a small `db.prepare(sql).all/get/run` wrapper. Editing `CREATE TABLE IF NOT EXISTS` will not update a table that already exists, so a new column on an existing table also needs a guarded `ALTER` after the schema runs in `client.js` (the `hasCol` pattern, as used for `categories.name_en`). On every start, `client.js` also fills in missing English names for the starter sections listed in `server/db/starterCategories.js`.
- **Search**: `articles_fts` is an FTS5 table with the `trigram` tokenizer, kept in sync by triggers in `schema.sql`. Trigram matching needs queries of at least 3 characters, and both the API and `/search` enforce that.
- **Article lifecycle**: `status` is one of `draft`, `scheduled` or `published`. A publish time in the future sets `scheduled`, and `server/jobs/schedulePublisher.js` (node-cron, every minute) flips due rows to `published`. Public queries must always filter on `status = 'published'`. The smoke test checks that drafts return 404 and stay out of the sitemaps. Slugs are created once from the title and never change on edit. `slugify` keeps Telugu combining marks (`\p{M}`).
- **Times**: the database stores UTC strings in the form `YYYY-MM-DD HH:MM:SS` (`toDbTime` in `server/util.js`, `datetime('now')` in SQL). The display code converts them to the `Asia/Kolkata` time zone.
- **Roles**: `requireRole(...)` reloads the user from the database on every request. `admin` can do everything. `editor` handles articles, the e-paper, categories and ads. A `reporter` can only create and edit their own drafts (`canEdit` and `loadArticle` in `index.js`). Every admin change should call `audit(req, action, entity, id)`.
- **Input handling**: article bodies go through `cleanHtml` (sanitize-html) before they are stored. Uploads go through multer to `uploads/images` (JPG, PNG or WebP, 5 MB maximum) and `uploads/epaper` (PDF, 50 MB maximum). `tryDb` turns UNIQUE and FOREIGN KEY errors into 409 responses.
- **Admin UI**: `public/admin.html` and `public/js/admin.js` make up a vanilla-JS single-page app that calls the `/api/admin/*` routes. Tabs are chosen by role, and all UI text is in Telugu.
- **Site identity and offers**: the newspaper name (`name_en`/`name_te`), RNI number, editor/publisher, address and phone, plus the ad sizes (`advertise.sizes`) and subscription plans (`subscription.plans`), all come from `config/site.json`. Don't hard-code them. A `price` of `null` renders as "Contact us for the price".
- **Enquiries**: the `/advertise` and `/subscribe` forms are stored in the `enquiries` table, protected by a honeypot field (`website`) and a rate limit. Staff manage them in the admin Enquiries tab (`/api/admin/enquiries`). After the redirect, `server/notify.js` sends an alert to staff (SMS to the mobiles in `NOTIFY_TO`, default: `phone` in `site.json`) through `NOTIFY_PROVIDER`, using built-in `fetch`: `log` (default, console only), the free `smsgate` (real SMS from an Android phone running SMS Gateway for Android) and `telegram` (bot message to `TELEGRAM_CHAT_ID`), or the paid `msg91` and `twilio`. It never throws, and the result is stored in `enquiries.notify_status` (`sent`, `logged` or `failed`) and `notify_error`, which the Enquiries tab shows.
- **WhatsApp group feed**: `server/whatsapp.js` pulls the groups in `WHATSAPP_GROUPS` from a self-hosted WAHA gateway (`WAHA_URL`). It runs every `WHATSAPP_POLL_MINUTES` (`server/jobs/whatsappFeed.js`, off unless configured) or on "pull now" (`POST /api/admin/whatsapp/pull`). Each message is stored once in `wa_messages` (unique `wa_id`). Messages long enough become **draft** articles only, with photos paired by sender within 10 minutes. Media is always fetched from `WAHA_URL`, using only the path from the message, so a message can't make the server fetch another address. `tests/whatsapp.test.js` covers it with a fake gateway.
- **Ops**: `deploy/nginx.conf` (in production nginx serves `/uploads`), `deploy/pm2.config.js`, and `deploy/backup.sh` for a nightly backup of SQLite and uploads. The Docker files have not been tested.

## Design rules (from `design/DESIGN.md`)

- The look follows newspaperclub.com: white pages, bold sans headlines, pill buttons, a hero carousel, icon value rows, card grids, coloured promo bands and a dark footer. Build mobile first for low-end Android phones, and lazy-load images with explicit width and height.
- Fonts: Inter (self-hosted, `public/fonts/Inter-var.woff2`) for English, and Noto Sans Telugu when `<html lang="te">`. The `--font-*` and `--lh-*` tokens switch on `:root[lang="te"]`. Never use letter-spacing, ALL CAPS or justified text. Telugu mode uses a line height of 1.8 for body text and 1.5 for headlines.
- Colors come from the tokens in `public/css/tokens.css`, which has a copy in `design/tokens.css` (keep the two in sync). The palette is "royal light": light colours only, with no dark mode and no dark panels. It uses warm-white and parchment pages, lavender and cream tints for feature areas, royal violet for actions, gold for the main call to action and highlights, crimson only for breaking news, and emerald for status. Never use `--gold` for text: use `--gold-ink`. English h1/h2 and story titles use Playfair Display (`--font-display`). The current page and section get `aria-current="page"` in the nav (`cur()` in `page()`). 
- Ads reserve their height in advance and carry the label "ప్రకటన". The inline ad goes after paragraph 3.
- Use plain wording in both languages and the same word for the same action everywhere.

## Known limitations (from README)

- Sessions are stored in memory, so a restart logs everyone out.
- Only the `inline` ad slot is rendered.
- Newsletter signups are collected, but nothing sends newsletters yet.
- Pages are `private` because of the language cookie, so a CDN will not cache them.
- The admin panel is Telugu only.
- The admin routes have only been syntax-checked, not tested end to end.
