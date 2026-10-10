// Renders every public page against an in-memory SQLite DB (needs Node 22.13+). Run: npm test
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const raw = new DatabaseSync(':memory:');
raw.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'schema.sql'), 'utf8'));
const db = { prepare: (q) => { const st = raw.prepare(q); return { all: (...a) => st.all(...a), get: (...a) => st.get(...a), run: (...a) => st.run(...a) }; } };
raw.exec(`INSERT INTO users(name,email,password_hash,role) VALUES('రాజేష్','a@b.c','x','admin');
INSERT INTO categories(name_te,name_en,slug) VALUES('క్రీడలు','Sports','sports');
INSERT INTO categories(name_te,name_en,slug) VALUES('Health','Health','health');
INSERT INTO articles(title,slug,summary,body,category_id,author_id,status,is_breaking,published_at)
 VALUES('భారత్ ఘన విజయం','భారత్-ఘన-విజయం','సారాంశం','<p>మొదటి పేరా</p>',1,1,'published',1,datetime('now'));
INSERT INTO articles(title,slug,summary,body,category_id,author_id,status,published_at)
 VALUES('డ్రాఫ్ట్ వార్త','draft','x','<p>y</p>',1,1,'draft',NULL);`);

const routes = {};
const { notFound } = require('../server/render.js').register({ get: (p, h) => (routes[p] = h) }, db);
const call = (p, req = {}) => {
  const r = { code: 200, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, type() { return this; },
    send(b) { this.body = b; return this; }, json(b) { this.body = JSON.stringify(b); return this; }, redirect(c, u) { this.code = c; this.location = u; return this; } };
  (routes[p] || notFound)({ query: {}, params: {}, headers: {}, path: p, ...req }, r);
  return r;
};
const te = { headers: { cookie: 'lang=te' } };

// English is the default UI language; article text stays as written
const home = call('/');
assert(home.body.includes('<html lang="en">'), 'English by default');
assert(home.body.includes('భారత్ ఘన విజయం</a></h1>') && home.body.includes('class="hero"') && home.body.includes('class="ticker"'));
assert(home.body.includes('>Sports<') && home.body.includes('/lang/te?back='), 'English category names + Telugu toggle');
// Telugu when the cookie is set
const homeTe = call('/', te);
assert(homeTe.body.includes('<html lang="te">') && homeTe.body.includes('>క్రీడలు<') && !homeTe.body.includes('>Sports<') && homeTe.body.includes('/lang/en?back='));
assert.strictEqual(call('/', { headers: { cookie: 'x=1; lang=te' } }).body.includes('<html lang="te">'), true, 'cookie among others');

const art = call('/article/:slug', { params: { slug: 'భారత్-ఘన-విజయం' } });
assert(art.code === 200 && art.body.includes('"@type":"NewsArticle"') && art.body.includes('rel="canonical"'));
assert.strictEqual(call('/article/:slug', { params: { slug: 'draft' } }).code, 404, 'drafts must not be public');
assert(call('/category/:slug', { params: { slug: 'sports' } }).body.includes('<h1>Sports</h1>'));
assert(call('/category/:slug', { params: { slug: 'sports' }, ...te }).body.includes('<h1>క్రీడలు</h1>'), 'section names follow the language');
assert(call('/category/:slug', { params: { slug: 'health' }, ...te }).body.includes('<h1>Health</h1>'), 'no Telugu name: falls back to English');
assert.strictEqual(call('/category/:slug', { params: { slug: 'nope' } }).code, 404);
assert(call('/search', { query: { q: 'విజయం' } }).body.includes('భారత్ ఘన విజయం'), 'Telugu trigram search');
assert(call('/search', { query: { q: 'ab' } }).body.includes('at least 3'));
assert(call('/search', { query: { q: 'ab' }, ...te }).body.includes('కనీసం 3'));

// advertise / subscribe / thanks
const adv = call('/advertise', { query: { size: 'half' } });
assert(adv.body.includes('Half page') && adv.body.includes('value="half" selected') && adv.body.includes('action="/enquiry"'));
assert(call('/advertise', te).body.includes('అర పేజీ'));
const sub = call('/subscribe');
assert(sub.body.includes('Monthly') && sub.body.includes('name="kind" value="subscription"'));
assert(call('/thanks', { query: { t: 'enquiry' } }).body.includes('Thank you!'));
assert(call('/thanks', { query: { t: 'invalid', from: 'advertise' } }).body.includes('href="/advertise#enquiry"'));

// language switch: sets the cookie, only redirects within the site
const sw = call('/lang/:code', { params: { code: 'te' }, query: { back: '/advertise?size=full' } });
assert(sw.code === 303 && sw.location === '/advertise?size=full' && /lang=te/.test(sw.headers['Set-Cookie']));
assert.strictEqual(call('/lang/:code', { params: { code: 'te' }, query: { back: '//evil.example' } }).location, '/', 'no open redirect');
assert.strictEqual(call('/lang/:code', { params: { code: 'te' }, query: { back: '/\\evil.example' } }).location, '/', 'no open redirect (backslash)');

assert(call('/sitemap.xml').body.includes('/article/') && !call('/sitemap.xml').body.includes('draft') && call('/sitemap.xml').body.includes('/advertise'));
assert(call('/news-sitemap.xml').body.includes('<news:title>భారత్ ఘన విజయం</news:title>'));
assert(call('/rss.xml').body.includes('<item>'));
assert.strictEqual(call('/api/nothing').code, 404);
console.log('all render checks passed');
