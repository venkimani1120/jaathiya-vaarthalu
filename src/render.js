// Page templates. src/build.js calls renderSite() once and writes every returned file to dist/.
// Every page is built in English (at /) and Telugu (under /te/); the toggle links to the same page in the other language.
// Reading works without JS; /js/site.js drives the hero carousel and the WhatsApp enquiry form, /js/search.js runs search.
const { LANGS, STR, pick } = require('./i18n');
const { isUrl } = require('./content');

const PAGE = 20;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (html, n = 160) => Array.from(String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
// Section (category) names follow the UI language. English is the main name, so either language falls back to the other.
const secName = (o, f, L) => (o && (L === 'te' ? o[`${f}_te`] || o[`${f}_en`] : o[`${f}_en`] || o[`${f}_te`])) || '';
const istDay = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // "YYYY-MM-DD"

// Line icons (stroke = currentColor), used in the value rows and buttons
const ICON = {
  paper: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>',
  news: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  ad: '<path d="M3 10v4h3l7 4V6L6 10z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  chat: '<path d="M4 20l1.5-4A8 8 0 1 1 8 18.5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};
const icon = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const values = (l) => `<ul class="values">${l.map(([i, t, d]) => `<li>${icon(i, 'ic ic-lg')}<b>${t}</b><span>${d}</span></li>`).join('')}</ul>`;

// Site path ("/advertise/") → output file ("advertise/index.html")
const fileOf = (p) => decodeURIComponent(p).replace(/^\//, '') + (p.endsWith('/') ? 'index.html' : '');

function renderSite({ site, cats, articles, editions, ads, siteUrl, now = new Date() }) {
  // SITE_URL may include a sub-path (GitHub Pages project sites live at https://<user>.github.io/<repo>)
  const BASE = new URL(siteUrl.replace(/\/?$/, '/'));
  const BP = BASE.pathname.replace(/\/$/, ''); // '' or '/repo'
  const ORIGIN = BASE.origin;
  const asset = (p) => (isUrl(p) ? p : `${BP}/${p.replace(/^\//, '')}`);
  const absAsset = (p) => (isUrl(p) ? p : ORIGIN + asset(p));
  const url = (L, p) => BP + (L === 'te' ? '/te' : '') + p;
  const absUrl = (L, p) => ORIGIN + url(L, p);
  const artPath = (a) => `/article/${encodeURIComponent(a.slug)}/`;
  const catPath = (c) => `/category/${encodeURIComponent(c.slug)}/`;
  const latestIn = (slug) => articles.filter((a) => a.cat && a.cat.slug === slug);
  const brk = articles.filter((a) => a.breaking).slice(0, 8);
  const lastEdition = editions[0];
  const today = istDay(now);
  // WhatsApp needs the number with its country code; a 10-digit Indian mobile gets 91 in front
  const waNum = ((d) => (d.length === 10 ? '91' + d : d))(String(site.whatsapp || site.phone).replace(/\D/g, ''));

  // Per-language helpers
  const ctx = (L) => {
    const T = STR[L];
    const u = (p) => url(L, p);
    const fmt = (d) => (d ? d.toLocaleDateString(T.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
    const fmtDay = (s) => (s ? fmt(new Date(`${s}T12:00:00+05:30`)) : '');
    const pic = (a, cls = '', eager) => (a.image ? `<img class="${cls}" src="${esc(asset(a.image))}" alt="" ${eager ? '' : 'loading="lazy" '}width="640" height="360">` : '');
    const card = (a, h = 'h3', eager) => { const cat = secName(a.cat, 'name', L); return `<article class="card"><a href="${esc(u(artPath(a)))}">${a.image ? pic(a, '', eager) : '<div class="ph" aria-hidden="true"></div>'}
<div class="card-body">${cat ? `<span class="cat">${esc(cat)}</span>` : ''}<${h}>${esc(a.title)}</${h}><span class="date">${fmt(a.date)}</span></div></a></article>`; };
    const grid = (l, h) => `<div class="grid">${l.map((a) => card(a, h)).join('')}</div>`;
    const secHead = (title, more) => `<div class="sec-head"><h2>${esc(title)}</h2>${more ? `<a class="more" href="${esc(u(more))}">${T.seeAll}</a>` : ''}</div>`;
    return { L, T, u, NAME: pick(site, 'name', L), fmt, fmtDay, pic, grid, secHead, price: (p) => (p ? esc(p) : `<span class="ask">${T.askPrice}</span>`) };
  };

  // o.path is the page's site path without the language prefix, e.g. "/advertise/"
  function page(L, o) {
    const { T, u, NAME } = ctx(L);
    const tag = pick(site, 'tagline', L);
    const title = o.title ? `${o.title} | ${NAME}` : `${NAME}: ${tag}`;
    const desc = o.desc || T.defaultDesc(NAME, tag);
    // Marks the link for the current page (or, on an article, its section) for the active nav style
    const cur = (p) => (p === o.path || (o.section && p === catPath(o.section)) ? ' aria-current="page"' : '');
    const catLinks = cats.map((c) => `<a href="${esc(u(catPath(c)))}"${cur(catPath(c))}>${esc(secName(c, 'name', L))}</a>`).join('');
    const primary = [['/epaper/', T.epaper], ['/advertise/', T.advertise], ['/subscribe/', T.subscribe]].map(([p, t]) => `<a href="${u(p)}"${cur(p)}>${t}</a>`).join('');
    const toggle = `<a class="lang" href="${esc(url(T.switchTo, o.path))}" hreflang="${T.switchTo}" lang="${T.switchTo}" aria-label="${esc(T.switchAria)}">${icon('globe')}${T.switchLabel}</a>`;
    const search = (id) => `<form class="search" action="${u('/search/')}" role="search"><label class="sr" for="${id}">${T.search}</label><input id="${id}" name="q" type="search" minlength="3" placeholder="${T.searchPh}"><button aria-label="${T.search}">${icon('search')}</button></form>`;
    const alt = o.noindex ? '' : LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(absUrl(l, o.path))}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${esc(absUrl('en', o.path))}">`;
    return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(absUrl(L, o.path))}">${alt}
${o.noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:site_name" content="${esc(NAME)}"><meta property="og:locale" content="${T.ogLocale}">
<meta property="og:type" content="${o.type || 'website'}"><meta property="og:title" content="${esc(o.title || NAME)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(absUrl(L, o.path))}">
<meta property="og:image" content="${esc(absAsset(o.image || 'logo.png'))}"><meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${esc(NAME)}" href="${asset('rss.xml')}">
<link rel="icon" href="${asset('logo.png')}">
<link rel="stylesheet" href="${asset('css/tokens.css')}"><link rel="stylesheet" href="${asset('css/site.css')}">
<script src="${asset('js/site.js')}" defer></script>${(o.scripts || []).map((s) => `<script src="${asset(s)}" defer></script>`).join('')}
${o.ld ? jsonLd(o.ld) : ''}</head><body>
<a class="skip" href="#app">${T.skip}</a>
<div class="util"><div class="wrap"><span>${T.editorPub}: ${esc(pick(site, 'editor_publisher', L))}</span><span>RNI No. ${esc(site.rni_number)} · ${T.phone}: <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a> ${toggle}</span></div></div>
<header class="hdr"><div class="wrap hdr-in">
<a class="brand" href="${u('/')}"><img class="logo" src="${asset('logo.png')}" alt="${esc(NAME)}" width="160" height="80"></a>
<nav class="primary" aria-label="${T.mainMenu}">${primary}</nav>
${search('q1')}
<a class="btn cta" href="${u('/epaper/')}">${icon('paper')}${T.todaysPaper}</a>
${toggle.replace('class="lang"', 'class="lang lang-m"')}
<details class="menu"><summary aria-label="${T.menu}"><span></span><span></span><span></span></summary>
<div class="menu-panel">${search('q2')}<nav aria-label="${T.mobileMenu}">${primary}${catLinks}</nav></div></details>
</div>
<nav class="catnav" aria-label="${T.sections}"><div class="wrap">${catLinks}</div></nav></header>
${brk.length ? `<div class="ticker"><div class="wrap"><b>${T.breaking}</b>${brk.map((b) => `<a href="${esc(u(artPath(b)))}">${esc(b.title)}</a>`).join('')}</div></div>` : ''}
<main id="app">${o.body}</main>
<footer class="foot"><div class="wrap foot-grid">
<div><img class="logo" src="${asset('logo.png')}" alt="${esc(NAME)}" width="120" height="60" loading="lazy"><p><b>${esc(NAME)}</b><br>${esc(tag)}, ${T.established} ${site.established}</p><p>RNI No. ${esc(site.rni_number)}</p></div>
<div><h3>${T.sections}</h3>${catLinks}</div>
<div><h3>${T.services}</h3><a href="${u('/epaper/')}">${T.epaper}</a><a href="${u('/advertise/')}">${T.advertiseWithUs}</a><a href="${u('/subscribe/')}">${T.printSub}</a><a href="${asset('rss.xml')}">RSS</a></div>
<div><h3>${T.contact}</h3><p>${T.editorPub}: ${esc(pick(site, 'editor_publisher', L))}</p><p>${esc(pick(site, 'address', L))}</p><p>${T.phone}: <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a></p></div>
</div><div class="wrap foot-bottom">© ${now.getFullYear()} ${esc(NAME)}. ${T.rights}</div></footer>
</body></html>`;
  }

  // Ads are chosen when the site is built; the hourly rebuild starts and ends them on their dates
  const liveAds = (slot) => ads.filter((a) => a.slot === slot && a.active !== false && (!a.start || a.start <= today) && (!a.end || a.end >= today));
  const adSlot = (T, slot) => {
    const l = liveAds(slot);
    if (!l.length) return '';
    const ad = l[Math.floor(Math.random() * l.length)];
    const img = `<img src="${esc(asset(ad.image))}" alt="${T.adLabel}" loading="lazy">`;
    return `<div class="ad"><small>${T.adLabel}</small>${ad.link ? `<a href="${esc(ad.link)}" rel="sponsored noopener">${img}</a>` : img}</div>`;
  };

  // Hero carousel: the top stories, then an e-paper slide. Without JS it is a swipeable scroll-snap strip.
  const hero = (c, stories, e) => {
    const { L, T, u, pic, fmtDay } = c;
    const slides = stories.map((a, i) => { const cat = secName(a.cat, 'name', L), H = i === 0 ? 'h1' : 'h2', h = esc(u(artPath(a))); return `<article class="slide">
<div class="slide-text">${cat ? `<span class="kicker">${esc(cat)}</span>` : ''}<${H}><a href="${h}">${esc(a.title)}</a></${H}>
${a.summary ? `<p>${esc(a.summary)}</p>` : ''}<a class="btn light" href="${h}" tabindex="-1">${T.readFull}</a></div>
<div class="slide-media">${a.image ? pic(a, '', i === 0) : `<div class="ph" aria-hidden="true">${icon('news', 'ic ic-xl')}</div>`}</div></article>`; });
    slides.push(`<article class="slide slide-promo">
<div class="slide-text"><span class="kicker">${T.epaper}</span><h2><a href="${u('/epaper/')}">${T.epSlideH}</a></h2>
<p>${esc(T.epSlideP(e && fmtDay(e.date)))}</p><a class="btn light" href="${u('/epaper/')}" tabindex="-1">${T.openEpaper}</a></div>
<div class="slide-media">${e && e.thumb ? `<img class="paper-thumb" src="${esc(asset(e.thumb))}" alt="" loading="lazy" width="400">` : `<div class="ph" aria-hidden="true">${icon('paper', 'ic ic-xl')}</div>`}</div></article>`);
    const n = slides.length;
    return `<section class="hero" aria-roledescription="carousel" aria-label="${T.carousel}"><div class="wrap">
<div class="hero-track" tabindex="0">${slides.map((s, i) => s.replace('<article class="slide', `<article aria-roledescription="slide" aria-label="${T.slide(i + 1, n)}" class="slide`)).join('')}</div>
<div class="hero-ctl" hidden><button class="round prev" aria-label="${T.prevSlide}">‹</button><div class="dots">${slides.map((_, i) => `<button aria-label="${T.goSlide(i + 1)}"></button>`).join('')}</div><button class="round next" aria-label="${T.nextSlide}">›</button><button class="round pause" aria-label="${T.pause}" data-pause="${T.pause}" data-play="${T.play}">❚❚</button></div>
</div></section>`;
  };

  const home = (L) => {
    const c = ctx(L), { T, u, NAME, grid, secHead, fmtDay } = c;
    const top = articles.slice(0, 15);
    if (!top.length) return page(L, { path: '/', body: `<div class="wrap pad"><p>${T.noNewsYet}</p></div>` });
    // Lead story plus the next two stories that have photos go into the carousel
    const slides = [top[0], ...top.slice(1).filter((a) => a.image).slice(0, 2)];
    const rest = top.filter((a) => !slides.includes(a)).slice(0, 8);
    const e = lastEdition;
    const blocks = cats.map((cat) => ({ cat, items: latestIn(cat.slug).slice(0, 4) })).filter((b) => b.items.length);
    return page(L, { path: '/', image: top[0].image, body: `${hero(c, slides, e)}
<section class="wrap pad">${values(T.homeValues)}</section>
${rest.length ? `<section class="wrap pad">${secHead(T.latestNews)}${grid(rest)}</section>` : ''}
${e ? `<section class="band band-alt"><div class="wrap feature">${e.thumb ? `<img class="paper-thumb" src="${esc(asset(e.thumb))}" alt="" loading="lazy" width="220">` : icon('paper', 'ic ic-xl')}
<div><span class="kicker">${T.epKicker}</span><h2>${esc(T.epH(fmtDay(e.date)))}</h2><p>${T.epP}</p><a class="btn" href="${u('/epaper/')}">${T.readEpaper}</a></div></div></section>` : ''}
${blocks.map((b) => `<section class="wrap pad">${secHead(secName(b.cat, 'name', L), catPath(b.cat))}${grid(b.items)}</section>`).join('')}
<section class="wrap pad"><div class="duo">
<a class="promo promo-brand" href="${u('/advertise/')}">${icon('ad', 'ic ic-lg')}<h2>${T.promoAdH}</h2><p>${T.promoAdP}</p><span class="btn light">${T.promoAdBtn}</span></a>
<a class="promo promo-gold" href="${u('/subscribe/')}">${icon('home', 'ic ic-lg')}<h2>${esc(T.promoSubH(NAME))}</h2><p>${T.promoSubP}</p><span class="btn">${T.promoSubBtn}</span></a>
</div></section>`,
      ld: { '@context': 'https://schema.org', '@type': 'NewsMediaOrganization', name: site.name_en, alternateName: site.name_te, url: absUrl('en', '/'), logo: absAsset('logo.png') } });
  };

  const article = (L, a) => {
    const { T, u, fmt, pic, grid, secHead } = ctx(L);
    const related = a.cat ? latestIn(a.cat.slug).filter((x) => x !== a).slice(0, 4) : [];
    const p = artPath(a), cat = secName(a.cat, 'name', L);
    return page(L, { title: a.title, desc: a.summary || plain(a.body), path: p, image: a.image, type: 'article', section: a.cat,
      body: `<article class="wrap pad article">${cat ? `<a class="kicker" href="${esc(u(catPath(a.cat)))}">${esc(cat)}</a>` : ''}<h1>${esc(a.title)}</h1>
${a.summary ? `<p class="standfirst">${esc(a.summary)}</p>` : ''}<p class="meta">${a.author ? `${esc(a.author)} · ` : ''}${fmt(a.date)}</p>${pic(a, 'cover', true)}<div class="article-body">${a.body}</div>${adSlot(T, 'inline')}</article>
${related.length ? `<section class="wrap pad">${secHead(T.moreNews, catPath(a.cat))}${grid(related)}</section>` : ''}`,
      ld: { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: a.title, mainEntityOfPage: absUrl(L, p), datePublished: a.date.toISOString(),
        dateModified: a.updated.toISOString(), inLanguage: 'te', ...(a.image && { image: [absAsset(a.image)] }),
        author: { '@type': 'Person', name: a.author || site.editor_publisher_en },
        publisher: { '@type': 'Organization', name: site.name_en, logo: { '@type': 'ImageObject', url: absAsset('logo.png') } } } });
  };

  // A section's stories, 20 per page: /category/x/, /category/x/page/2/, ...
  const category = (L, c) => {
    const { T, u, grid } = ctx(L);
    const all = latestIn(c.slug), pages = Math.max(1, Math.ceil(all.length / PAGE)), h1 = secName(c, 'name', L);
    const at = (n) => catPath(c) + (n > 1 ? `page/${n}/` : '');
    return Array.from({ length: pages }, (_, i) => {
      const n = i + 1, items = all.slice(i * PAGE, n * PAGE);
      const pager = `<nav class="pager">${n > 1 ? `<a class="btn ghost" rel="prev" href="${esc(u(at(n - 1)))}">${T.prev}</a>` : '<span></span>'}${n < pages ? `<a class="btn ghost" rel="next" href="${esc(u(at(n + 1)))}">${T.next}</a>` : ''}</nav>`;
      return [at(n), page(L, { title: h1, path: at(n),
        body: `<div class="pagehead"><div class="wrap"><h1>${esc(h1)}</h1></div></div><div class="wrap pad">${items.length ? grid(items, 'h2') : `<p>${T.emptySection}</p>`}${pager}</div>` })];
    });
  };

  // Results come from /search-index.json in the browser (public/js/search.js); the strings it needs ride on data- attributes
  const searchPage = (L) => {
    const { T, u } = ctx(L);
    const names = Object.fromEntries(cats.map((c) => [c.slug, secName(c, 'name', L)]));
    return page(L, { title: T.search, path: '/search/', noindex: true, scripts: ['js/search.js'],
      body: `<div class="pagehead"><div class="wrap"><h1 id="search-h">${T.search}</h1></div></div>
<div class="wrap pad" id="search-results" data-index="${asset('search-index.json')}" data-article="${esc(u('/article/'))}" data-locale="${T.locale}" data-sections="${esc(JSON.stringify(names))}"
 data-min="${esc(T.searchMin)}" data-busy="${esc(T.searching)}" data-none="${esc(T.noResults)}" data-heading="${esc(T.searchH('%s'))}" data-title="${esc(`${T.searchH('%s')} | ${pick(site, 'name', L)}`)}">
<p class="search-msg">${T.searchMin}</p><noscript><p>${T.searchNoJs}</p></noscript><div class="grid"></div></div>` });
  };

  const epaper = (L) => {
    const { T, u, fmtDay } = ctx(L);
    const latest = editions.filter((x) => x.date === (lastEdition && lastEdition.date));
    const older = editions.slice(latest.length);
    return page(L, { title: T.epaper, path: '/epaper/',
      body: `<div class="pagehead"><div class="wrap"><h1>${T.epaper}</h1><p>${T.epIntro}</p></div></div>
<div class="wrap pad">${latest.length ? `<div class="grid">${latest.map((x) => `<a class="card paper-card" href="${esc(asset(x.pdf))}" target="_blank" rel="noopener">${x.thumb ? `<img src="${esc(asset(x.thumb))}" alt="" loading="lazy" width="400">` : `<div class="ph" aria-hidden="true">${icon('paper', 'ic ic-xl')}</div>`}<div class="card-body"><span class="cat">${esc(fmtDay(x.date))}</span><h2>${esc(x.name || T.epaper)}</h2><span class="btn">${T.readPdf}</span></div></a>`).join('')}</div>` : `<p>${T.noEdition}</p>`}
${older.length ? `<h2>${T.epArchive}</h2><ul class="archive">${older.map((x) => `<li><a href="${esc(asset(x.pdf))}" target="_blank" rel="noopener">${esc(fmtDay(x.date))}${x.name ? ` · ${esc(x.name)}` : ''}</a></li>`).join('')}</ul>` : ''}
</div>` });
  };

  // Enquiry form → WhatsApp. site.js writes every filled-in field into the hidden "text" field before the form opens
  // wa.me; without JS the chat still opens with the form's title. The fields have no name, so only "text" is sent.
  const enquiryForm = (c, kind, options, param, title) => {
    const { L, T } = c;
    return `<section class="band band-alt" id="enquiry"><div class="wrap enq">
<div><h2>${title}</h2><p>${T.enqP}</p>
<p class="callout">${icon('phone')}${T.callDirect} <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a></p></div>
<form class="card-form wa-form" method="get" action="https://wa.me/${waNum}" target="_blank" rel="noopener"><input type="hidden" name="text" value="${esc(title)}">
<label for="f-name">${T.name}</label><input id="f-name" required maxlength="100" autocomplete="name">
<label for="f-opt">${kind === 'advertise' ? T.adSize : T.plan}</label><select id="f-opt" data-param="${param}">${options.map((x) => `<option value="${esc(x.key)}">${esc(pick(x, 'name', L))}</option>`).join('')}</select>
<label for="f-place">${kind === 'advertise' ? T.business : T.place}</label><input id="f-place" maxlength="200" ${kind === 'subscription' ? 'required' : ''}>
<label for="f-msg">${T.message}</label><textarea id="f-msg" rows="3" maxlength="2000"></textarea>
<div class="actions"><button>${icon('chat')}${T.sendWa}</button></div></form></div></section>`;
  };

  const advertise = (L) => {
    const c = ctx(L), { T, u, NAME, secHead, price } = c;
    const sizes = site.advertise.sizes;
    return page(L, { title: T.adTitle, path: '/advertise/', desc: T.adDesc(NAME),
      body: `<section class="pagehead big"><div class="wrap"><span class="kicker">${T.adKicker}</span><h1>${esc(T.adH(NAME))}</h1>
<p>${T.adP}</p>
<div class="actions"><a class="btn" href="#enquiry">${T.send}</a><a class="btn ghost" href="tel:${esc(site.phone)}">${icon('phone')}${T.callUs}</a></div></div></section>
<section class="wrap pad">${values(T.adValues)}</section>
<section class="wrap pad">${secHead(T.chooseSize)}<div class="grid">${sizes.map((s) => `<article class="card size-card">
<div class="mock${s.key === 'web' ? ' mock-web' : ''}" aria-hidden="true"><span style="width:${+s.w}%;height:${+s.h}%"></span></div>
<div class="card-body"><h3>${esc(pick(s, 'name', L))}</h3><p>${esc(pick(s, 'desc', L))}</p><p class="price">${price(s.price)}</p><a class="btn" href="${esc(u('/advertise/'))}?size=${esc(s.key)}#enquiry">${T.pickSize}</a></div></article>`).join('')}</div></section>
${enquiryForm(c, 'advertise', sizes, 'size', T.adEnqH)}` });
  };

  const subscribe = (L) => {
    const c = ctx(L), { T, u, NAME, secHead, price } = c;
    const plans = site.subscription.plans;
    return page(L, { title: T.subTitle, path: '/subscribe/', desc: T.subDesc(NAME),
      body: `<section class="pagehead big"><div class="wrap"><span class="kicker">${T.subKicker}</span><h1>${esc(T.subH(NAME))}</h1>
<p>${T.subP}</p>
<div class="actions"><a class="btn" href="#enquiry">${T.askSub}</a><a class="btn ghost" href="${u('/epaper/')}">${T.seeEpaper}</a></div></div></section>
<section class="wrap pad">${values(T.subValues)}</section>
<section class="wrap pad">${secHead(T.choosePlan)}<div class="grid grid-3">${plans.map((p) => `<article class="card plan-card"><div class="card-body">
<h3>${esc(pick(p, 'name', L))}</h3><p class="price">${price(p.price)}</p><p>${esc(pick(p, 'desc', L))}</p><a class="btn" href="${esc(u('/subscribe/'))}?plan=${esc(p.key)}#enquiry">${T.pickPlan}</a></div></article>`).join('')}</div></section>
${enquiryForm(c, 'subscription', plans, 'plan', T.subEnqH)}` });
  };

  // GitHub Pages serves 404.html for any missing address. It can't tell the language, so it is English.
  const notFound = () => {
    const { T, u } = ctx('en');
    return page('en', { title: T.notFoundT, noindex: true, path: '/', body: `<div class="wrap pad"><h1>${T.notFoundT}</h1><p>${T.notFoundP} <a href="${u('/')}">${T.goHome}</a>.</p></div>` });
  };

  // ---- build every page ----
  const out = new Map();
  const put = (L, p, html) => out.set(fileOf((L === 'te' ? '/te' : '') + p), html);
  for (const L of LANGS) {
    put(L, '/', home(L));
    for (const a of articles) put(L, artPath(a), article(L, a));
    for (const c of cats) for (const [p, html] of category(L, c)) put(L, p, html);
    put(L, '/search/', searchPage(L));
    put(L, '/epaper/', epaper(L));
    put(L, '/advertise/', advertise(L));
    put(L, '/subscribe/', subscribe(L));
  }
  out.set('404.html', notFound());

  // Search index: newest first, the text to match is lower-cased once here
  out.set('search-index.json', JSON.stringify(articles.slice(0, 2000).map((a) => ({
    u: encodeURIComponent(a.slug) + '/', t: a.title, c: a.cat ? a.cat.slug : '', d: a.date.toISOString(), i: a.image ? asset(a.image) : '',
    x: `${a.title} ${a.summary} ${plain(a.body, 5000)}`.toLowerCase(),
  }))));

  // ---- SEO feeds (language independent) ----
  const xml = (body) => '<?xml version="1.0" encoding="UTF-8"?>\n' + body;
  out.set('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${absAsset('sitemap.xml')}\nSitemap: ${absAsset('news-sitemap.xml')}\n`);
  const pages = ['/', '/epaper/', '/advertise/', '/subscribe/', ...cats.map(catPath)];
  const urls = LANGS.flatMap((L) => [...pages.map((p) => ({ p: absUrl(L, p) })), ...articles.slice(0, 5000).map((a) => ({ p: absUrl(L, artPath(a)), m: a.updated }))]);
  out.set('sitemap.xml', xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((x) => `<url><loc>${esc(x.p)}</loc>${x.m ? `<lastmod>${x.m.toISOString()}</lastmod>` : ''}</url>`).join('')}</urlset>`));
  const recent = articles.filter((a) => now - a.date <= 2 * 864e5).slice(0, 1000);
  out.set('news-sitemap.xml', xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${recent.map((a) => `<url><loc>${esc(absUrl('en', artPath(a)))}</loc><news:news><news:publication><news:name>${esc(site.name_en)}</news:name><news:language>te</news:language></news:publication><news:publication_date>${a.date.toISOString()}</news:publication_date><news:title>${esc(a.title)}</news:title></news:news></url>`).join('')}</urlset>`));
  out.set('rss.xml', xml(`<rss version="2.0"><channel><title>${esc(site.name_te)}</title><link>${esc(absUrl('en', '/'))}</link><description>${esc(site.tagline_te)}</description><language>te</language>${articles.slice(0, 30).map((a) => `<item><title>${esc(a.title)}</title><link>${esc(absUrl('en', artPath(a)))}</link><guid>${esc(absUrl('en', artPath(a)))}</guid><pubDate>${a.date.toUTCString()}</pubDate><description>${esc(a.summary)}</description></item>`).join('')}</channel></rss>`));
  return out;
}

module.exports = { renderSite };
