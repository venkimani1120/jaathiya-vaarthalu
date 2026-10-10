# Jaathiya Vaarthalu (జాతియ వార్తలు) website

Telugu daily newspaper site: server-rendered public pages (English UI by default, with a Telugu option), e-paper archive, advertising and print-subscription pages, admin panel. The public design follows newspaperclub.com: hero carousel, icon value rows, card grids, promo bands, newsletter band, multi-column footer.
Stack: Node 22.13+, Express, SQLite via Node's built-in `node:sqlite`, no native modules and no frontend build step.

## Run locally
```bash
npm install
cp .env.example .env        # set SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed                # creates the admin user and starter categories
npm run dev                 # http://localhost:3000  (admin: /admin)
npm test                    # renders every public page against a test DB
```
For e-paper thumbnails install poppler: `sudo apt install poppler-utils`.

## What is included
- **Public:** home (hero carousel, card grids), article, category, search (Telugu trigram), e-paper by date, newsletter signup API, sitemap, news sitemap, RSS, robots.txt, Open Graph + NewsArticle JSON-LD.
- **Language:** English UI by default; the header toggle (`/lang/te`, `/lang/en`) stores a `lang` cookie and shows the UI in Telugu. Article text is shown as written (not machine-translated). Section (category) names follow the toggle: the English name is required, and the Telugu name is optional (if it is missing, the English name is shown).
- **Advertise (`/advertise`) and Subscribe (`/subscribe`):** ad sizes and subscription plans come from `config/site.json` (set `price` to show a price; `null` shows "Contact us for the price"). Their enquiry forms are stored in the database and listed in the admin **విచారణలు** (Enquiries) tab. Each new enquiry also sends an alert to staff. Set `NOTIFY_PROVIDER` in `.env` (the default `log` only prints the alert to the server console):
  - `smsgate` (**free SMS**): install the free *SMS Gateway for Android* app (sms-gate.app) on an Android phone with a SIM, switch on its Cloud server, and copy the username and password into `SMSGATE_USER` / `SMSGATE_PASSWORD`. SMS go to `NOTIFY_TO` from that phone's number and use its plan's SMS allowance. The phone must stay on and online.
  - `telegram` (**free**, no SIM): create a bot with @BotFather, have each staff member press *Start* on it, then set `TELEGRAM_BOT_TOKEN` and their chat ids in `TELEGRAM_CHAT_ID` (open `https://api.telegram.org/bot<token>/getUpdates` after they press Start to see the ids).
  - `msg91` or `twilio` (paid SMS gateways). For MSG91, create a DLT-approved Flow template, for example `New ##kind## enquiry: ##name##, ##phone##, ##option##, ##place##. Jaathiya Vaartalu`.
- **WhatsApp group feed:** news posted in your configured WhatsApp groups becomes **draft** articles (never published automatically). The first line of a message is the headline and the rest is the body. A photo sent within 10 minutes before or after the text becomes the story's image. Short chat ("ok", "👍") and old history are skipped. Editors check and publish the drafts as usual, and the admin **వాట్సాప్** tab lists every pulled message and its draft, with a "pull now" button. See *WhatsApp group feed setup* below.
- **Admin (`/admin`):** articles (create, edit, schedule, publish, unpublish, delete), image upload, e-paper PDF upload with thumbnail, sections (English name + optional Telugu name), ads, enquiries, users and roles, subscribers (+CSV), audit log.
- **Roles:** admin (everything), editor (articles, e-paper, categories, ads), reporter (own drafts only).
- **Ops:** `deploy/nginx.conf`, `deploy/pm2.config.js`, `deploy/backup.sh` (nightly SQLite + uploads), `Dockerfile` and `docker-compose.yml` (untested alternative).

## WhatsApp group feed setup
WhatsApp's official Business API cannot read ordinary group chats, so the feed uses **WAHA** (WhatsApp HTTP API, waha.devlike.pro). It is a free, self-hosted gateway that links to a WhatsApp number the same way WhatsApp Web does.

> **Risk:** WAHA is not an official WhatsApp product, and WhatsApp's terms do not allow automated clients. Use a **separate number** (not the office's main number) that only reads the groups, because WhatsApp can ban numbers it flags.

1. On the server, run WAHA on port 3001 (the site uses 3000), reachable only from the server itself:
   ```
   docker run -d --name waha --restart unless-stopped -p 127.0.0.1:3001:3000 \
     -e WAHA_API_KEY=<long-random-key> -v /srv/waha/sessions:/app/.sessions devlikeapro/waha
   ```
   Check the WAHA docs for the current environment variable names.
2. Open the WAHA dashboard (`http://localhost:3001/dashboard`, e.g. through an SSH tunnel), start the `default` session, and scan its QR code with the separate number (WhatsApp → Linked devices). Add that number to the reporters' group.
3. To find the group id, call `GET http://localhost:3001/api/default/groups` with the `X-Api-Key` header. The ids end in `@g.us`.
4. In `.env`, set `WAHA_URL=http://127.0.0.1:3001`, `WAHA_API_KEY`, `WHATSAPP_GROUPS`. Optionally also set `WHATSAPP_SENDERS` (only these reporters' numbers), `WHATSAPP_AUTHOR_EMAIL` (the user the drafts belong to) and `WHATSAPP_POLL_MINUTES`. Then restart the site.
5. Post a test story in the group, then click **ఇప్పుడే తెచ్చు** (pull now) in the admin **వాట్సాప్** tab.

## Deploy (Ubuntu server + GitHub Actions)
The site runs on its own Linux server (Ubuntu 22.04 or 24.04, 1 GB RAM is enough). GitHub Pages can't host it because it needs Node and a database. After the setup below, every push to `main` that passes the tests goes live automatically.

**1. Get a server and a domain.** Create an Ubuntu server (DigitalOcean, Hostinger VPS, AWS Lightsail, etc.) and note its IP. In your domain's DNS, add an `A` record pointing the domain (e.g. `news.example.com`) at that IP.

**2. Make a key for GitHub Actions** (on your computer):
```
ssh-keygen -t ed25519 -N "" -C "github-actions" -f ~/.ssh/jv_actions
```

**3. Set up the server** (from the project folder on your computer):
```
scp deploy/setup-server.sh root@<server-ip>:
ssh root@<server-ip> "DOMAIN=news.example.com ADMIN_EMAIL=you@example.com GHA_PUBKEY='$(cat ~/.ssh/jv_actions.pub)' bash setup-server.sh"
```
The first run stops and prints a **deploy key**. Add it on GitHub under the repo's Settings > Deploy keys > Add deploy key (read-only), then run the same `ssh` command again. The script installs Node 22, nginx, pm2, poppler, the firewall, HTTPS and the nightly backup, creates `.env` with a random session secret, and prints the admin login once. Write it down.

**4. Connect GitHub Actions.** In the repo, go to Settings > Secrets and variables > Actions:
- Secret `SSH_KEY`: the output of `cat ~/.ssh/jv_actions` (the private key).
- Variable `SSH_HOST`: the server IP.
- Variable `SSH_KNOWN_HOSTS`: the output of `ssh-keyscan <server-ip>`.
- Optional variables: `SSH_USER` (default `jv`) and `SSH_PORT` (default `22`).

Until `SSH_HOST` is set, the workflow only runs the tests. To deploy without a push, use Actions > Test and deploy > Run workflow. To deploy by hand, run `ssh jv@<server-ip> 'bash /srv/jaathiya-vaarthalu/deploy/deploy.sh'`.

**Notes**
- Change settings in the repo (for example `config/site.json`) and push. Edits made directly on the server are overwritten by the next deploy. Only `.env`, `data/` and `uploads/` live on the server alone.
- To change `.env`, run `ssh jv@<server-ip>`, edit `/srv/jaathiya-vaarthalu/.env`, then `pm2 reload jaathiya-vaarthalu --update-env`.
- Logs: `pm2 logs jaathiya-vaarthalu`. Backups go to `/var/backups/jaathiya-vaarthalu` (14 days). Set up rclone in `deploy/backup.sh` for copies off the server.
- Submit `/sitemap.xml` and `/news-sitemap.xml` in Google Search Console.

## Before launch
- Add the Telugu font files listed in `public/fonts/README.txt` (Inter for English is included).
- Fill in the real prices in `config/site.json` (`advertise.sizes[].price`, `subscription.plans[].price`).
- Replace `public/logo.png` with the final SVG logo if one is made (and a 1200x630 social image).
- Change the default admin password after first login (Users tab).

## Known limitations
- Sessions are kept in memory, so everyone is logged out when the app restarts.
- Only the "inline" ad slot is rendered on the public pages.
- Newsletter signups are collected, but there is no sending feature yet.
- Pages are sent as `Cache-Control: private` (they vary by the language cookie), so a CDN will not cache them.
- The admin panel is Telugu only.
- Not load-tested; the admin routes were syntax-checked but not exercised end to end.

## Troubleshooting
- `Cannot find module ... bcrypt_lib.node`: fixed by using `bcryptjs` (pure JavaScript, no native build). Delete `node_modules` and `package-lock.json`, then run `npm install` again.
- The app has no native modules (bcryptjs and node:sqlite are built in or pure JavaScript), so installs work on any Node 22.13+ including the latest.
