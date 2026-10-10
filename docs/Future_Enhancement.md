# Future enhancement: reusable newsroom library for other organisations

Status: plan, not started. Written 2026-10-10.

> **Out of date on the `static-setup` branch.** This plan was written for the server version (Express, SQLite, admin panel). The static GitHub Pages version has no server or database, so its file references and phases no longer apply as written.

## Goal

Turn this codebase into a reusable, versioned library so other newspapers and organisations can run their own site with their own name, logo, colours, fonts, languages, sections, features and home-page layout.

- **Deployment model:** every tenant runs on its **own host server with its own database**. There is no shared multi-tenant runtime.
- Jaathiya Vaartalu becomes tenant #1, and its site must render the same after every phase.
- The project rules stay: Node 22.13+, Express, `node:sqlite`, no native modules and no frontend build step.

## What is tied to one paper today

| Where | What is hard-coded |
|---|---|
| `server/render.js:7-8` | `config/site.json` and `SITE_URL` are read once when the module loads |
| `server/db/client.js` | Schema changes are made with `hasCol` + `ALTER` guards, which don't scale as the schema grows |
| `public/css/tokens.css` | The "royal light" palette and the font files |
| `server/render.js`, `public/js/admin.js` | `/logo.png` in 7 places |
| `server/i18n.js` | Only `en` and `te`; India-specific labels (RNI, Editor & Publisher) |
| `server/render.js` | The `Asia/Kolkata` time zone, `inLanguage: 'te'`, the language in the news sitemap, and the RSS feed using `name_te` |
| `server/render.js` `/` handler | A fixed home layout, nav and footer; e-paper, ads, subscribe, newsletter and ticker are always on |
| `public/js/admin.js` | Admin UI text is Telugu only |

## Target structure

```
newsroom/                      ← the library (one repo, versioned)
  packages/core/               server, auth, admin API, scheduler, migrations
  packages/widgets/            hero, card-grid, ticker, value-row, promo-duo, epaper-feature,
                               newsletter-band, enquiry-form, ad-slot, pager, header, footer
  packages/theme/              base.css + per-widget CSS (tokens only), theme → CSS generator
  packages/i18n/               base strings en/te/…
  starter/                     template for a new tenant
  deploy/                      nginx, pm2, backup templates

jaathiya-vaartalu-site/        ← one small repo per tenant, deployed on its own server
  package.json                 depends on @newsroom/core@^1.4
  tenant/tenant.json           identity, languages, timezone, features, home layout, offers
  tenant/theme.json            colours, fonts, radius
  tenant/strings.json          text overrides
  tenant/brand/                logo, favicon, OG image
  tenant/widgets/              optional custom widgets
  server.js                    require('@newsroom/core').start({ dir: __dirname + '/tenant' })
  .env                         SESSION_SECRET, SITE_URL, ADMIN_*, PORT
```

Packages are npm workspaces of plain CommonJS, so there is still no build step.

Each process serves exactly one tenant, and the tenant folder is loaded once at startup. Module-level config in `render.js` stays valid, as long as it comes from the tenant folder instead of `config/site.json`. `register(app, db)` keeps its shape, with the tenant config added as a parameter.

Each server keeps its own `data/app.db`, `uploads/`, nginx site, pm2 process and `backup.sh`, as today.

## 1. Tenant config (`tenant.json`, which replaces `site.json`)

```json
{
  "id": "jaathiya-vaartalu",
  "name": { "en": "Jaathiya Vaartalu", "te": "జాతియ వార్తలు" },
  "tagline": { "en": "Telugu Daily Newspaper", "te": "తెలుగు దినపత్రిక" },
  "languages": ["en", "te"], "defaultLanguage": "en",
  "contentLanguage": "te", "timezone": "Asia/Kolkata",
  "contact": { "phone": "9989716940", "address": { "en": "…", "te": "…" } },
  "legal": { "rni": "APTEL/25/A5264", "editorPublisher": { "en": "Mamidi Rajesh", "te": "మామిడి రాజేష్" }, "established": 2025 },
  "features": { "epaper": true, "advertise": true, "subscribe": true,
                "newsletter": true, "breakingTicker": true, "search": true,
                "rss": true, "languageSwitch": true, "adSlots": ["inline"] },
  "home": [ { "widget": "hero", "stories": 3 }, { "widget": "valueRow" },
            { "widget": "latestGrid", "count": 8 }, { "widget": "epaperFeature" },
            { "widget": "sectionBlocks", "perSection": 4 }, { "widget": "promoDuo" } ],
  "advertise": { "sizes": [] },
  "subscription": { "plans": [] }
}
```

- `advertise.sizes` and `subscription.plans` move across unchanged from `site.json`.
- `legal` is optional, so organisations outside Indian print can leave it out.

## 2. Widget contract

```js
// packages/widgets/latestGrid.js
module.exports = {
  name: 'latestGrid',
  data: (ctx, props) => ctx.q.latest(props.count ?? 8),   // reads only published rows
  render: (ctx, props, items) => `<section class="wrap pad">${ctx.secHead(ctx.T.latestNews)}${ctx.grid(items)}</section>`,
  css: 'latestGrid.css',   // may use tokens only, no literal colours
  js: null,                // optional enhancer file, e.g. hero → carousel.js
};
```

- **`ctx`:** holds what `ctx(req)` returns today (`L`, `T`, `esc`, `fmt`, `grid`, `secHead`), plus `tenant` and the query helpers. Public queries keep the `status = 'published'` filter.
- **Pages:** the home page renders the tenant's `home` array. `page()` becomes header and footer widgets with slots for the main content.
- **Custom widgets:** a tenant can add its own in `tenant/widgets/*.js`. They go into the same registry.
- **CSS:** at startup, the server joins the CSS files of the widgets in use and serves the result, cached, as `/css/site.<hash>.css`. This needs no build step.
- **JS:** stays as files only, so helmet's CSP is unchanged. `site.js` becomes a small loader that starts the enhancers named in `data-widget` attributes.

## 3. Theming

- `theme.json` holds the colour tokens, fonts per language, radius and shadow. It produces the `:root` variables in `/theme.css`.
- **Contrast check at startup:** check the key pairs (ink on paper, white on brand, link on paper, gold-ink on cream). If any pair is below WCAG AA (4.5:1), refuse to start.
- **Rules for every tenant** stay in `base.css`:
  - no letter-spacing, no ALL CAPS, no justified text
  - Telugu line heights
  - lazy-loaded images with explicit width and height
  - ads reserve their height
- **Fonts:** a tenant chooses from the bundled fonts or ships its own WOFF2 files. Per-script rules (`:root[lang=te]`) are driven by the tenant's languages, so Hindi or Tamil needs only a font stack.
- **Brand assets:** the logo, favicon and OG image are served from `/brand/*` out of the tenant folder.

## 4. Feature flags

- A disabled feature's routes are not registered at all.
- The flags also filter:
  - nav and footer links
  - sitemap entries
  - home widgets
  - admin tabs
  - admin API routes

## 5. Languages

- Base strings live in `packages/i18n`. A tenant's `strings.json` overrides individual keys, such as promo copy or the ad label.
- Each tenant chooses its own languages and default language. New UI text must still be added in every supported language.
- The admin panel moves into the same string system, because it is Telugu only today.

## 6. Embeddable widgets (optional)

These are only needed if other websites should show a tenant's news:

- `/embed/latest?section=sports` pages that render in iframes. Each tenant has an allowlist (`frame-ancestors`) of sites that may embed them.
- An `embed.js` web component, e.g. `<news-widget type="latest">`, that reads from `/api/articles`, with CORS allowed per tenant.

## Needed because each tenant has its own server and DB

1. **Versioned DB migrations.**
   - Replace the `hasCol` + `ALTER` guards in `client.js` with numbered files (`migrations/0001_init.sql`, `0002_categories_name_en.sql`, …) and a `schema_version` table.
   - Each migration runs once inside a transaction, and the server checks the schema version at startup.
   - The baseline migration matches the current schema, so existing databases are left as they are.
2. **Distribution.**
   - Publish `@newsroom/*` to a private npm registry (e.g. GitHub Packages), or install from git tags (`github:<org>/newsroom#v1.4.0`).
   - Use semver: breaking changes to config or widgets bump the major version and come with an upgrade note.
3. **Config validation at startup.** If `tenant.json` or `theme.json` is invalid, the server refuses to start and names the bad field. A small hand-written validator avoids adding a dependency.
4. **A command for new tenants.** `npx @newsroom/core init my-paper` copies the starter template, so a new paper means editing four JSON files and a logo.
5. **Rolling out updates to all servers.** A short script or GitHub Action per tenant repo runs `npm update`, then `npm test`, then a deploy over SSH. Backups run nightly on each server with `backup.sh`.
6. **A test harness every tenant can use.**
   - Move `tests/render.smoke.js` into core as `newsroom test`.
   - It renders every page with the tenant's config against an in-memory database.
   - Each tenant's CI then catches broken config or custom widgets before they deploy.

## Phases

Each phase ends with `npm test` passing and Jaathiya Vaartalu's HTML unchanged except where intended.

0. **Safety net:** HTML snapshots of every public page in the smoke test, plus basic admin API tests (those routes have never been tested end to end).
1. **Config:** move `config/site.json`, the logo and the hard-coded `Asia/Kolkata`/`te` values into a `tenant/` folder, and point the server at it.
2. **Theme:** generate CSS from `theme.json` and add the contrast check.
3. **Widgets:** split `render.js` into widget modules, build the home page from config, and split the CSS per widget.
4. **Feature flags:** add them across routes, nav, footer, sitemap, admin tabs and the admin API.
5. **Migrations:** switch to numbered migrations with a baseline that matches the current schema.
6. **Packaging:**
   - split into the library repo and the Jaathiya Vaartalu site repo
   - the starter template and the `init` command
   - publish v1.0
7. **Second tenant:** build a test tenant with different colours, features off and a custom widget, on its own server, to prove the setup works.
8. **Later:** embeddable widgets.

## Rules that change

- `CLAUDE.md`:
  - `register(app, db)` gains the tenant config as a parameter
  - "Site identity comes from `config/site.json`" becomes "from `tenant/tenant.json`"
  - the `hasCol` pattern is replaced by numbered migrations
- `design/DESIGN.md`: the palette becomes the default theme. The platform-wide typography and layout rules stay.

## Open question

- **Database engine:** will every tenant use SQLite? Supporting a different engine (e.g. Postgres) for some tenants would need a database adapter layer in core and is a much bigger change.
