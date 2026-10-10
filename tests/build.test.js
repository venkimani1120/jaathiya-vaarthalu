// Builds a sample site into a temp folder and checks the pages. Run: npm test
// SITE_URL has a sub-path (/jv), like a GitHub Pages project site, so every link must carry it.
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../src/build');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-test-'));
const content = path.join(tmp, 'content'), out = path.join(tmp, 'dist');
const now = new Date('2026-10-10T06:00:00Z'); // 11:30 in India
const json = (f, v) => { fs.mkdirSync(path.dirname(path.join(content, f)), { recursive: true }); fs.writeFileSync(path.join(content, f), JSON.stringify(v)); };

fs.cpSync(path.join(ROOT, 'content', 'site.json'), path.join(content, 'site.json'));
json('categories.json', [{ slug: 'sports', name_en: 'Sports', name_te: 'క్రీడలు' }, { slug: 'health', name_en: 'Health' }]);
json('articles/భారత్-ఘన-విజయం.json', { title: 'భారత్ ఘన విజయం', summary: 'సారాంశం', body: '<p>మొదటి పేరా</p>', section: 'sports', author: 'రాజేష్', published_at: '2026-10-10 09:00', breaking: true, image: 'images/win.jpg' });
json('articles/draft-story.json', { title: 'డ్రాఫ్ట్ వార్త', body: '<p>y</p>', section: 'sports', published_at: '2026-10-09 09:00', draft: true });
json('articles/later-story.json', { title: 'తర్వాత వార్త', body: '<p>y</p>', section: 'sports', published_at: '2026-10-10 18:00' });
json('articles/health-tip.json', { title: 'Health tip', body: '<p>x</p>', section: 'health', published_at: '2026-10-01 08:00' });
for (let i = 1; i <= 21; i++) json(`articles/old-${i}.json`, { title: `Old ${i}`, body: '<p>o</p>', section: 'sports', published_at: `2026-09-${String(i).padStart(2, '0')} 08:00` });
json('epaper.json', [{ date: '2026-10-09', pdf: 'https://github.com/x/y/releases/download/epaper-2026-10-09/main.pdf' }, { date: '2026-10-10', pdf: 'https://github.com/x/y/releases/download/epaper-2026-10-10/main.pdf', name: 'Main' }]);
json('ads.json', [{ slot: 'inline', image: 'images/ad.jpg', link: 'https://shop.example', end: '2026-12-31' }, { slot: 'inline', image: 'images/old-ad.jpg', end: '2026-01-01' }]);
fs.mkdirSync(path.join(content, 'images'));
for (const f of ['win.jpg', 'ad.jpg', 'old-ad.jpg']) fs.writeFileSync(path.join(content, 'images', f), 'x');

const r = build({ contentDir: content, outDir: out, siteUrl: 'https://example.github.io/jv/', now });
assert.strictEqual(r.articles, 23, 'draft and future stories are skipped');
const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
const has = (f) => fs.existsSync(path.join(out, f));

// English home, Telugu home
const home = read('index.html');
assert(home.includes('<html lang="en">') && home.includes('భారత్ ఘన విజయం</a></h1>') && home.includes('class="hero"') && home.includes('class="ticker"'));
assert(home.includes('>Sports<') && home.includes('href="/jv/te/"'), 'English section names + toggle to the Telugu home');
const homeTe = read('te/index.html');
assert(homeTe.includes('<html lang="te">') && homeTe.includes('>క్రీడలు<') && !homeTe.includes('>Sports<') && homeTe.includes('href="/jv/"'));

// Every local link and asset carries the sub-path
for (const f of ['index.html', 'te/index.html', 'advertise/index.html', 'epaper/index.html', 'search/index.html', '404.html']) {
  const bad = [...read(f).matchAll(/(?:href|src|action)="(\/[^"]*)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('/jv/'));
  assert.deepStrictEqual(bad, [], `${f}: links without the /jv base path`);
}

// Article
const art = read('article/భారత్-ఘన-విజయం/index.html');
assert(art.includes('"@type":"NewsArticle"') && art.includes('rel="canonical" href="https://example.github.io/jv/article/%E0%B0%AD'));
assert(art.includes('hreflang="te"') && art.includes('src="/jv/images/win.jpg"') && art.includes('aria-current="page">Sports<'));
assert(art.includes('href="https://shop.example"') && !art.includes('old-ad.jpg'), 'only ads inside their dates');
assert(has('te/article/భారత్-ఘన-విజయం/index.html') && has('images/win.jpg'));
assert(!has('article/draft-story') && !has('article/later-story'), 'drafts and future stories are not built');

// Sections, with pages of 20 and the language fallback
assert(read('category/sports/index.html').includes('<h1>Sports</h1>') && read('category/sports/index.html').includes('href="/jv/category/sports/page/2/"'));
assert(read('category/sports/page/2/index.html').includes('rel="prev" href="/jv/category/sports/"'));
assert(read('te/category/sports/index.html').includes('<h1>క్రీడలు</h1>'));
assert(read('te/category/health/index.html').includes('<h1>Health</h1>'), 'no Telugu name: falls back to English');

// Search index: published stories only
const idx = JSON.parse(read('search-index.json'));
assert(idx.length === 23 && idx[0].t === 'భారత్ ఘన విజయం' && idx[0].x.includes('మొదటి పేరా') && !idx.some((a) => /డ్రాఫ్ట్|తర్వాత/.test(a.t)));
assert(read('te/search/index.html').includes('data-article="/jv/te/article/"') && read('search/index.html').includes('js/search.js'));

// Advertise / subscribe: WhatsApp enquiry
const adv = read('advertise/index.html');
assert(adv.includes('Half page') && adv.includes('action="https://wa.me/919989716940"') && adv.includes('data-param="size"') && adv.includes('?size=half#enquiry'));
assert(read('te/advertise/index.html').includes('అర పేజీ') && read('subscribe/index.html').includes('Monthly'));

// E-paper: newest edition first, the rest in the archive
const ep = read('epaper/index.html');
assert(ep.indexOf('epaper-2026-10-10') < ep.indexOf('epaper-2026-10-09') && ep.includes('class="archive"'));

// Feeds
const sm = read('sitemap.xml');
assert(sm.includes('https://example.github.io/jv/te/advertise/') && sm.includes('/article/') && !sm.includes('draft-story'));
assert(read('news-sitemap.xml').includes('<news:title>భారత్ ఘన విజయం</news:title>') && !read('news-sitemap.xml').includes('Old 1<'));
assert(read('rss.xml').includes('<item>') && read('robots.txt').includes('https://example.github.io/jv/sitemap.xml'));
assert(read('404.html').includes('noindex') && has('css/site.css') && has('js/search.js') && has('fonts/Inter-var.woff2'));

// Content mistakes stop the build with a readable list
json('articles/bad.json', { title: 'x', body: 'y', section: 'nope', published_at: 'yesterday' });
assert.throws(() => build({ contentDir: content, outDir: out, siteUrl: 'https://x.example', now }),
  (e) => /section "nope" is not in categories.json/.test(e.message) && /"published_at" must look like/.test(e.message));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('all build checks passed');
