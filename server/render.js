// Server-rendered pages + SEO feeds. Reading works without JS; /js/site.js only drives the hero carousel.
// UI text comes from server/i18n.js: English by default, Telugu when the `lang=te` cookie is set.
const fs = require('fs');
const path = require('path');
const { LANGS, STR, langOf, pick } = require('./i18n');

const site = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'site.json'), 'utf8'));
const BASE = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PAGE = 20;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toDate = (d) => new Date(d.replace(' ', 'T') + 'Z'); // DB stores UTC "YYYY-MM-DD HH:MM:SS"
const href = (a) => `/article/${encodeURIComponent(a.slug)}`;
const abs = (p) => BASE + p;
const plain = (html, n = 160) => Array.from(String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
const pic = (a, cls = '', eager) => (a.image_path ? `<img class="${cls}" src="${esc(a.image_path)}" alt="" ${eager ? '' : 'loading="lazy" '}width="640" height="360">` : '');
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
// Section (category) names follow the UI language. English is the main name, so either language falls back to the other.
const secName = (o, f, L) => (o && (L === 'te' ? o[`${f}_te`] || o[`${f}_en`] : o[`${f}_en`] || o[`${f}_te`])) || '';
// Only same-site paths may be used as a redirect target
const safeBack = (p) => (typeof p === 'string' && /^\/(?![/\\])/.test(p) ? p : '/');

// Line icons (stroke = currentColor), used in the value rows and buttons
const ICON = {
  paper: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>',
  news: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  ad: '<path d="M3 10v4h3l7 4V6L6 10z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};
const icon = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const values = (l) => `<ul class="values">${l.map(([i, t, d]) => `<li>${icon(i, 'ic ic-lg')}<b>${t}</b><span>${d}</span></li>`).join('')}</ul>`;

function register(app, db) {
  const COLS = 'a.id, a.title, a.slug, a.summary, a.image_path, a.published_at, c.name_te AS category_te, c.name_en AS category_en';
  const FROM = 'FROM articles a LEFT JOIN categories c ON c.id = a.category_id';
  const cats = () => db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  const latest = (limit, offset = 0, cat) =>
    db.prepare(`SELECT ${COLS} ${FROM} WHERE a.status = 'published' ${cat ? 'AND c.slug = ?' : ''} ORDER BY a.published_at DESC LIMIT ? OFFSET ?`)
      .all(...(cat ? [cat] : []), limit, offset);
  const lastEdition = () => db.prepare('SELECT * FROM epaper_editions ORDER BY edition_date DESC LIMIT 1').get();

  // Per-request language helpers
  const ctx = (req) => {
    const L = langOf(req), T = STR[L];
    const fmt = (d) => (d ? toDate(d).toLocaleDateString(T.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
    const card = (a, h = 'h3', eager) => { const cat = secName(a, 'category', L); return `<article class="card"><a href="${href(a)}">${a.image_path ? pic(a, '', eager) : '<div class="ph" aria-hidden="true"></div>'}
<div class="card-body">${cat ? `<span class="cat">${esc(cat)}</span>` : ''}<${h}>${esc(a.title)}</${h}><span class="date">${fmt(a.published_at)}</span></div></a></article>`; };
    const grid = (l, h) => `<div class="grid">${l.map((a) => card(a, h)).join('')}</div>`;
    const secHead = (title, more) => `<div class="sec-head"><h2>${esc(title)}</h2>${more ? `<a class="more" href="${esc(more)}">${T.seeAll}</a>` : ''}</div>`;
    return { L, T, NAME: pick(site, 'name', L), fmt, grid, secHead, price: (p) => (p ? esc(p) : `<span class="ask">${T.askPrice}</span>`) };
  };

  function page(req, o) {
    const { L, T, NAME } = ctx(req);
    const brk = db.prepare(`SELECT title, slug FROM articles WHERE status = 'published' AND is_breaking = 1 ORDER BY published_at DESC LIMIT 8`).all();
    const tag = pick(site, 'tagline', L);
    const title = o.title ? `${o.title} | ${NAME}` : `${NAME}: ${tag}`;
    const desc = o.desc || T.defaultDesc(NAME, tag);
    // Marks the link for the current page (or, on an article, its section) for the active nav style
    const cur = (p) => (p === req.path || (o.section && p === `/category/${encodeURIComponent(o.section)}`) ? ' aria-current="page"' : '');
    const catLinks = cats().map((c) => { const p = `/category/${encodeURIComponent(c.slug)}`; return `<a href="${esc(p)}"${cur(p)}>${esc(secName(c, 'name', L))}</a>`; }).join('');
    const primary = [['/epaper', T.epaper], ['/advertise', T.advertise], ['/subscribe', T.subscribe]].map(([p, t]) => `<a href="${p}"${cur(p)}>${t}</a>`).join('');
    const here = req.originalUrl || req.path || '/';
    const toggle = `<a class="lang" href="/lang/${T.switchTo}?back=${encodeURIComponent(here)}" hreflang="${T.switchTo}" lang="${T.switchTo}" aria-label="${esc(T.switchAria)}" rel="nofollow">${icon('globe')}${T.switchLabel}</a>`;
    const search = (id) => `<form class="search" action="/search" role="search"><label class="sr" for="${id}">${T.search}</label><input id="${id}" name="q" type="search" minlength="3" placeholder="${T.searchPh}"><button aria-label="${T.search}">${icon('search')}</button></form>`;
    return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(abs(o.path || '/'))}">
${o.noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:site_name" content="${esc(NAME)}"><meta property="og:locale" content="${T.ogLocale}">
<meta property="og:type" content="${o.type || 'website'}"><meta property="og:title" content="${esc(o.title || NAME)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(abs(o.path || '/'))}">
<meta property="og:image" content="${esc(abs(o.image || '/logo.png'))}"><meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${esc(NAME)}" href="/rss.xml">
<link rel="icon" href="/logo.png">
<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/site.css">
<script src="/js/site.js" defer></script>
${o.ld ? jsonLd(o.ld) : ''}</head><body>
<a class="skip" href="#app">${T.skip}</a>
<div class="util"><div class="wrap"><span>${T.editorPub}: ${esc(pick(site, 'editor_publisher', L))}</span><span>RNI No. ${esc(site.rni_number)} · ${T.phone}: <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a> ${toggle}</span></div></div>
<header class="hdr"><div class="wrap hdr-in">
<a class="brand" href="/"><img class="logo" src="/logo.png" alt="${esc(NAME)}" width="160" height="80"></a>
<nav class="primary" aria-label="${T.mainMenu}">${primary}</nav>
${search('q1')}
<a class="btn cta" href="/epaper">${icon('paper')}${T.todaysPaper}</a>
${toggle.replace('class="lang"', 'class="lang lang-m"')}
<details class="menu"><summary aria-label="${T.menu}"><span></span><span></span><span></span></summary>
<div class="menu-panel">${search('q2')}<nav aria-label="${T.mobileMenu}">${primary}${catLinks}</nav></div></details>
</div>
<nav class="catnav" aria-label="${T.sections}"><div class="wrap">${catLinks}</div></nav></header>
${brk.length ? `<div class="ticker"><div class="wrap"><b>${T.breaking}</b>${brk.map((b) => `<a href="${href(b)}">${esc(b.title)}</a>`).join('')}</div></div>` : ''}
<main id="app">${o.body}</main>
<section class="band band-news" id="newsletter"><div class="wrap news-in">
<div><h2>${T.newsletterH}</h2><p>${T.newsletterP}</p></div>
<form class="news-form" method="post" action="/newsletter"><label class="sr" for="nl">${T.email}</label><input id="nl" name="email" type="email" required placeholder="${T.yourEmail}" autocomplete="email"><button>${T.join}</button></form>
</div></section>
<footer class="foot"><div class="wrap foot-grid">
<div><img class="logo" src="/logo.png" alt="${esc(NAME)}" width="120" height="60" loading="lazy"><p><b>${esc(NAME)}</b><br>${esc(tag)}, ${T.established} ${site.established}</p><p>RNI No. ${esc(site.rni_number)}</p></div>
<div><h3>${T.sections}</h3>${catLinks}</div>
<div><h3>${T.services}</h3><a href="/epaper">${T.epaper}</a><a href="/advertise">${T.advertiseWithUs}</a><a href="/subscribe">${T.printSub}</a><a href="/rss.xml">RSS</a></div>
<div><h3>${T.contact}</h3><p>${T.editorPub}: ${esc(pick(site, 'editor_publisher', L))}</p><p>${esc(pick(site, 'address', L))}</p><p>${T.phone}: <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a></p></div>
</div><div class="wrap foot-bottom">© ${new Date().getFullYear()} ${esc(NAME)}. ${T.rights}</div></footer>
</body></html>`;
  }

  // Pages differ by the `lang` cookie, so only the browser may cache them (a shared cache would mix languages)
  const send = (res, html, code = 200) => res.status(code).set('Cache-Control', 'private, max-age=60').set('Vary', 'Cookie').send(html);
  const notFound = (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    const { T } = ctx(req);
    send(res, page(req, { title: T.notFoundT, noindex: true, path: req.path, body: `<div class="wrap pad"><h1>${T.notFoundT}</h1><p>${T.notFoundP} <a href="/">${T.goHome}</a>.</p></div>` }), 404);
  };

  app.get('/lang/:code', (req, res) => {
    const code = LANGS.includes(req.params.code) ? req.params.code : 'en';
    res.set('Set-Cookie', `lang=${code}; Path=/; Max-Age=31536000; SameSite=Lax`).redirect(303, safeBack(req.query.back));
  });

  const adSlot = (T, slot) => {
    const ads = db.prepare(`SELECT image_path, link_url FROM ads WHERE slot = ? AND active = 1 AND (start_date IS NULL OR start_date <= date('now')) AND (end_date IS NULL OR end_date >= date('now'))`).all(slot);
    if (!ads.length) return '';
    const ad = ads[Math.floor(Math.random() * ads.length)];
    const img = `<img src="${esc(ad.image_path)}" alt="${T.adLabel}" loading="lazy">`;
    return `<div class="ad"><small>${T.adLabel}</small>${ad.link_url ? `<a href="${esc(ad.link_url)}" rel="sponsored noopener">${img}</a>` : img}</div>`;
  };

  const pager = (T, base, params, p, next) => {
    const url = (n) => esc(base + '?' + new URLSearchParams({ ...params, page: n }));
    return `<nav class="pager">${p > 1 ? `<a class="btn ghost" rel="prev" href="${url(p - 1)}">${T.prev}</a>` : '<span></span>'}${next ? `<a class="btn ghost" rel="next" href="${url(p + 1)}">${T.next}</a>` : ''}</nav>`;
  };
  const listing = (req, res, o) => {
    const { T, grid } = ctx(req);
    const p = Math.max(1, parseInt(req.query.page) || 1);
    const items = o.fetch(PAGE + 1, (p - 1) * PAGE), next = items.length > PAGE;
    const path_ = o.base + (p > 1 ? '?' + new URLSearchParams({ ...o.params, page: p }) : o.params.q ? '?' + new URLSearchParams(o.params) : '');
    send(res, page(req, { title: o.h1, path: path_, noindex: o.noindex,
      body: `<div class="pagehead"><div class="wrap"><h1>${esc(o.h1)}</h1></div></div><div class="wrap pad">${items.length ? grid(items.slice(0, PAGE), 'h2') : `<p>${T.emptySection}</p>`}${pager(T, o.base, o.params, p, next)}</div>` }));
  };

  // Hero carousel: the top stories, then an e-paper slide. Without JS it is a swipeable scroll-snap strip.
  const hero = (c, stories, e) => {
    const { L, T } = c;
    const slides = stories.map((a, i) => { const cat = secName(a, 'category', L), H = i === 0 ? 'h1' : 'h2'; return `<article class="slide">
<div class="slide-text">${cat ? `<span class="kicker">${esc(cat)}</span>` : ''}<${H}><a href="${href(a)}">${esc(a.title)}</a></${H}>
${a.summary ? `<p>${esc(a.summary)}</p>` : ''}<a class="btn light" href="${href(a)}" tabindex="-1">${T.readFull}</a></div>
<div class="slide-media">${a.image_path ? pic(a, '', i === 0) : `<div class="ph" aria-hidden="true">${icon('news', 'ic ic-xl')}</div>`}</div></article>`; });
    slides.push(`<article class="slide slide-promo">
<div class="slide-text"><span class="kicker">${T.epaper}</span><h2><a href="/epaper">${T.epSlideH}</a></h2>
<p>${esc(T.epSlideP(e && e.edition_date))}</p><a class="btn light" href="/epaper" tabindex="-1">${T.openEpaper}</a></div>
<div class="slide-media">${e && e.thumb_path ? `<img class="paper-thumb" src="${esc(e.thumb_path)}" alt="" loading="lazy" width="400">` : `<div class="ph" aria-hidden="true">${icon('paper', 'ic ic-xl')}</div>`}</div></article>`);
    const n = slides.length;
    return `<section class="hero" aria-roledescription="carousel" aria-label="${T.carousel}"><div class="wrap">
<div class="hero-track" tabindex="0">${slides.map((s, i) => s.replace('<article class="slide', `<article aria-roledescription="slide" aria-label="${T.slide(i + 1, n)}" class="slide`)).join('')}</div>
<div class="hero-ctl" hidden><button class="round prev" aria-label="${T.prevSlide}">‹</button><div class="dots">${slides.map((_, i) => `<button aria-label="${T.goSlide(i + 1)}"></button>`).join('')}</div><button class="round next" aria-label="${T.nextSlide}">›</button><button class="round pause" aria-label="${T.pause}" data-pause="${T.pause}" data-play="${T.play}">❚❚</button></div>
</div></section>`;
  };

  app.get('/', (req, res) => {
    const c = ctx(req), { L, T, NAME, grid, secHead } = c;
    const top = latest(15);
    if (!top.length) return send(res, page(req, { path: '/', body: `<div class="wrap pad"><p>${T.noNewsYet}</p></div>` }));
    // Lead story plus the next two stories that have photos go into the carousel
    const slides = [top[0], ...top.slice(1).filter((a) => a.image_path).slice(0, 2)];
    const rest = top.filter((a) => !slides.includes(a)).slice(0, 8);
    const e = lastEdition();
    const blocks = cats().map((cat) => ({ cat, items: latest(4, 0, cat.slug) })).filter((b) => b.items.length);
    send(res, page(req, { path: '/', image: top[0].image_path, body: `${hero(c, slides, e)}
<section class="wrap pad">${values(T.homeValues)}</section>
${rest.length ? `<section class="wrap pad">${secHead(T.latestNews)}${grid(rest)}</section>` : ''}
${e ? `<section class="band band-alt"><div class="wrap feature">${e.thumb_path ? `<img class="paper-thumb" src="${esc(e.thumb_path)}" alt="" loading="lazy" width="220">` : icon('paper', 'ic ic-xl')}
<div><span class="kicker">${T.epKicker}</span><h2>${esc(T.epH(e.edition_date))}</h2><p>${T.epP}</p><a class="btn" href="/epaper">${T.readEpaper}</a></div></div></section>` : ''}
${blocks.map((b) => `<section class="wrap pad">${secHead(secName(b.cat, 'name', L), `/category/${b.cat.slug}`)}${grid(b.items)}</section>`).join('')}
<section class="wrap pad"><div class="duo">
<a class="promo promo-brand" href="/advertise">${icon('ad', 'ic ic-lg')}<h2>${T.promoAdH}</h2><p>${T.promoAdP}</p><span class="btn light">${T.promoAdBtn}</span></a>
<a class="promo promo-gold" href="/subscribe">${icon('home', 'ic ic-lg')}<h2>${esc(T.promoSubH(NAME))}</h2><p>${T.promoSubP}</p><span class="btn">${T.promoSubBtn}</span></a>
</div></section>`,
      ld: { '@context': 'https://schema.org', '@type': 'NewsMediaOrganization', name: site.name_en, alternateName: site.name_te, url: BASE, logo: abs('/logo.png') } }));
  });

  app.get('/article/:slug', (req, res) => {
    const { L, T, fmt, grid, secHead } = ctx(req);
    const a = db.prepare(`SELECT a.*, c.name_te AS category_te, c.name_en AS category_en, c.slug AS cat_slug, u.name AS author FROM articles a LEFT JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id WHERE a.slug = ? AND a.status = 'published'`).get(req.params.slug);
    if (!a) return notFound(req, res);
    db.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').run(a.id);
    const related = db.prepare(`SELECT ${COLS} ${FROM} WHERE a.status = 'published' AND a.category_id = ? AND a.id != ? ORDER BY a.published_at DESC LIMIT 4`).all(a.category_id, a.id);
    const p = href(a), cat = secName(a, 'category', L);
    send(res, page(req, { title: a.title, desc: a.summary || plain(a.body), path: p, image: a.image_path, type: 'article', section: a.cat_slug,
      body: `<article class="wrap pad article">${cat ? `<a class="kicker" href="/category/${esc(a.cat_slug)}">${esc(cat)}</a>` : ''}<h1>${esc(a.title)}</h1>
${a.summary ? `<p class="standfirst">${esc(a.summary)}</p>` : ''}<p class="meta">${esc(a.author)} · ${fmt(a.published_at)}</p>${pic(a, 'cover', true)}<div class="article-body">${a.body}</div>${adSlot(T, 'inline')}</article>
${related.length ? `<section class="wrap pad">${secHead(T.moreNews, a.cat_slug && `/category/${a.cat_slug}`)}${grid(related)}</section>` : ''}`,
      ld: { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: a.title, mainEntityOfPage: abs(p), datePublished: toDate(a.published_at).toISOString(),
        dateModified: toDate(a.updated_at).toISOString(), inLanguage: 'te', ...(a.image_path && { image: [abs(a.image_path)] }),
        author: { '@type': 'Person', name: a.author || site.editor_publisher_en },
        publisher: { '@type': 'Organization', name: site.name_en, logo: { '@type': 'ImageObject', url: abs('/logo.png') } } } }));
  });

  app.get('/category/:slug', (req, res) => {
    const c = cats().find((x) => x.slug === req.params.slug);
    if (!c) return notFound(req, res);
    listing(req, res, { h1: secName(c, 'name', langOf(req)), base: `/category/${encodeURIComponent(c.slug)}`, params: {}, fetch: (l, o) => latest(l, o, c.slug) });
  });

  app.get('/search', (req, res) => {
    const { T } = ctx(req);
    const q = String(req.query.q || '').trim();
    if (Array.from(q).length < 3) return send(res, page(req, { title: T.search, path: '/search', noindex: true, body: `<div class="pagehead"><div class="wrap"><h1>${T.search}</h1></div></div><div class="wrap pad"><p>${T.searchMin}</p></div>` }));
    listing(req, res, { h1: T.searchH(q), base: '/search', params: { q }, noindex: true,
      fetch: (l, o) => db.prepare(`SELECT ${COLS} FROM articles_fts f JOIN articles a ON a.id = f.rowid LEFT JOIN categories c ON c.id = a.category_id WHERE articles_fts MATCH ? AND a.status = 'published' ORDER BY a.published_at DESC LIMIT ? OFFSET ?`).all(`"${q.replace(/"/g, '""')}"`, l, o) });
  });

  app.get('/epaper', (req, res) => {
    const { T } = ctx(req);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
    const eds = d ? db.prepare('SELECT * FROM epaper_editions WHERE edition_date = ?').all(d)
      : db.prepare('SELECT * FROM epaper_editions WHERE edition_date = (SELECT MAX(edition_date) FROM epaper_editions)').all();
    const shown = d || (eds[0] && eds[0].edition_date) || '';
    send(res, page(req, { title: T.epaper, path: '/epaper' + (d ? '?date=' + d : ''), noindex: !!d,
      body: `<div class="pagehead"><div class="wrap"><h1>${T.epaper}</h1><p>${T.epIntro}</p>
<form class="epform" action="/epaper"><label>${T.date} <input type="date" name="date" value="${esc(shown)}" required></label><button>${T.view}</button></form></div></div>
<div class="wrap pad">${eds.length ? `<div class="grid">${eds.map((x) => `<a class="card paper-card" href="${esc(x.pdf_path)}" target="_blank" rel="noopener">${x.thumb_path ? `<img src="${esc(x.thumb_path)}" alt="" loading="lazy" width="400">` : `<div class="ph" aria-hidden="true">${icon('paper', 'ic ic-xl')}</div>`}<div class="card-body"><span class="cat">${esc(x.edition_date)}</span><h2>${esc(x.edition_name)}</h2><span class="btn">${T.readPdf}</span></div></a>`).join('')}</div>` : `<p>${T.noEdition}</p>`}</div>` }));
  });

  // ---- advertise + print subscription (forms post to /enquiry in server/index.js) ----
  const enquiryForm = (c, kind, options, chosen, title) => {
    const { L, T } = c;
    return `<section class="band band-alt" id="enquiry"><div class="wrap enq">
<div><h2>${title}</h2><p>${T.enqP}</p>
<p class="callout">${icon('phone')}${T.callDirect} <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a></p></div>
<form class="card-form" method="post" action="/enquiry"><input type="hidden" name="kind" value="${kind}">
<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
<label for="f-name">${T.name}</label><input id="f-name" name="name" required maxlength="100" autocomplete="name">
<label for="f-phone">${T.phoneNo}</label><input id="f-phone" name="phone" type="tel" required pattern="[0-9+\\- ]{10,20}" autocomplete="tel">
<label for="f-email">${T.emailOpt}</label><input id="f-email" name="email" type="email" maxlength="200" autocomplete="email">
<label for="f-opt">${kind === 'advertise' ? T.adSize : T.plan}</label><select id="f-opt" name="option">${options.map((x) => `<option value="${esc(x.key)}" ${x.key === chosen ? 'selected' : ''}>${esc(pick(x, 'name', L))}</option>`).join('')}</select>
<label for="f-place">${kind === 'advertise' ? T.business : T.place}</label><input id="f-place" name="place" maxlength="200" ${kind === 'subscription' ? 'required' : ''}>
<label for="f-msg">${T.message}</label><textarea id="f-msg" name="message" rows="3" maxlength="2000"></textarea>
<div class="actions"><button>${T.send}</button></div></form></div></section>`;
  };

  app.get('/advertise', (req, res) => {
    const c = ctx(req), { L, T, NAME, secHead, price } = c;
    const sizes = site.advertise.sizes;
    send(res, page(req, { title: T.adTitle, path: '/advertise', desc: T.adDesc(NAME),
      body: `<section class="pagehead big"><div class="wrap"><span class="kicker">${T.adKicker}</span><h1>${esc(T.adH(NAME))}</h1>
<p>${T.adP}</p>
<div class="actions"><a class="btn" href="#enquiry">${T.send}</a><a class="btn ghost" href="tel:${esc(site.phone)}">${icon('phone')}${T.callUs}</a></div></div></section>
<section class="wrap pad">${values(T.adValues)}</section>
<section class="wrap pad">${secHead(T.chooseSize)}<div class="grid">${sizes.map((s) => `<article class="card size-card">
<div class="mock${s.key === 'web' ? ' mock-web' : ''}" aria-hidden="true"><span style="width:${+s.w}%;height:${+s.h}%"></span></div>
<div class="card-body"><h3>${esc(pick(s, 'name', L))}</h3><p>${esc(pick(s, 'desc', L))}</p><p class="price">${price(s.price)}</p><a class="btn" href="/advertise?size=${esc(s.key)}#enquiry">${T.pickSize}</a></div></article>`).join('')}</div></section>
${enquiryForm(c, 'advertise', sizes, req.query.size, T.adEnqH)}` }));
  });

  app.get('/subscribe', (req, res) => {
    const c = ctx(req), { L, T, NAME, secHead, price } = c;
    const plans = site.subscription.plans;
    send(res, page(req, { title: T.subTitle, path: '/subscribe', desc: T.subDesc(NAME),
      body: `<section class="pagehead big"><div class="wrap"><span class="kicker">${T.subKicker}</span><h1>${esc(T.subH(NAME))}</h1>
<p>${T.subP}</p>
<div class="actions"><a class="btn" href="#enquiry">${T.askSub}</a><a class="btn ghost" href="/epaper">${T.seeEpaper}</a></div></div></section>
<section class="wrap pad">${values(T.subValues)}</section>
<section class="wrap pad">${secHead(T.choosePlan)}<div class="grid grid-3">${plans.map((p) => `<article class="card plan-card"><div class="card-body">
<h3>${esc(pick(p, 'name', L))}</h3><p class="price">${price(p.price)}</p><p>${esc(pick(p, 'desc', L))}</p><a class="btn" href="/subscribe?plan=${esc(p.key)}#enquiry">${T.pickPlan}</a></div></article>`).join('')}</div></section>
${enquiryForm(c, 'subscription', plans, req.query.plan, T.subEnqH)}` }));
  });

  // Result page for the newsletter and enquiry forms (they redirect here)
  app.get('/thanks', (req, res) => {
    const { T } = ctx(req);
    const [h, p] = T.thanks[req.query.t] || T.thanks.enquiry;
    const back = ['advertise', 'subscribe'].includes(req.query.from) ? `/${req.query.from}#enquiry` : '/';
    send(res, page(req, { title: h, path: '/thanks', noindex: true,
      body: `<div class="wrap pad thanks">${icon(req.query.t === 'invalid' || req.query.t === 'limit' ? 'mail' : 'check', 'ic ic-xl')}<h1>${h}</h1><p>${p}</p><a class="btn" href="${back}">${back === '/' ? T.goHome : T.goBack}</a></div>` }));
  });

  // ---- SEO feeds (language independent) ----
  const xml = (res, body) => res.type('application/xml').set('Cache-Control', 'public, max-age=300').send('<?xml version="1.0" encoding="UTF-8"?>\n' + body);
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /lang/\nSitemap: ${abs('/sitemap.xml')}\nSitemap: ${abs('/news-sitemap.xml')}\n`));

  app.get('/sitemap.xml', (_req, res) => {
    const urls = [{ p: '/' }, { p: '/epaper' }, { p: '/advertise' }, { p: '/subscribe' }, ...cats().map((c) => ({ p: `/category/${encodeURIComponent(c.slug)}` })),
      ...db.prepare(`SELECT slug, updated_at FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 5000`).all().map((a) => ({ p: href(a), m: a.updated_at }))];
    xml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(abs(u.p))}</loc>${u.m ? `<lastmod>${toDate(u.m).toISOString()}</lastmod>` : ''}</url>`).join('')}</urlset>`);
  });

  app.get('/news-sitemap.xml', (_req, res) => {
    const items = db.prepare(`SELECT title, slug, published_at FROM articles WHERE status = 'published' AND published_at >= datetime('now', '-2 days') ORDER BY published_at DESC LIMIT 1000`).all();
    xml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${items.map((a) => `<url><loc>${esc(abs(href(a)))}</loc><news:news><news:publication><news:name>${esc(site.name_en)}</news:name><news:language>te</news:language></news:publication><news:publication_date>${toDate(a.published_at).toISOString()}</news:publication_date><news:title>${esc(a.title)}</news:title></news:news></url>`).join('')}</urlset>`);
  });

  app.get('/rss.xml', (_req, res) => {
    const items = db.prepare(`SELECT title, slug, summary, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 30`).all();
    xml(res, `<rss version="2.0"><channel><title>${esc(site.name_te)}</title><link>${BASE}</link><description>${esc(site.tagline_te)}</description><language>te</language>${items.map((a) => `<item><title>${esc(a.title)}</title><link>${esc(abs(href(a)))}</link><guid>${esc(abs(href(a)))}</guid><pubDate>${toDate(a.published_at).toUTCString()}</pubDate><description>${esc(a.summary)}</description></item>`).join('')}</channel></rss>`);
  });

  return { notFound };
}

module.exports = { register };
