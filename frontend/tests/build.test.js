// Builds the site from a stand-in backend API into a temp folder and checks the pages. Run: npm test
// SITE_URL has a sub-path (/jv), like a GitHub Pages project site, so every link must carry it.
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildAll } = require('../src/build');
const { apiData, stubApi, ID } = require('./fixture');

const now = new Date('2026-10-10T06:00:00Z'); // 11:30 in India

(async () => {
  const state = { data: apiData() };
  const { server, url } = await stubApi(state);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-test-'));
  try {
    const r = await buildAll({ apiUrl: url + '/', outDir: out, siteUrl: 'https://example.github.io/jv/', now });
    assert(r.articles === 24 && r.images === 3);
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
    assert(has('te/article/భారత్-ఘన-విజయం/index.html') && read('images/win.jpg') === 'jpeg /images/win.jpg', 'images come from the API');
    const rart = read(`article/${ID}/index.html`);
    assert(rart.includes('కొత్త రోడ్డు &lt;b&gt;') && rart.includes('src="https://res.cloudinary.com/demo/image/upload/c_limit') && rart.includes('రూ.45 లక్షలు · ప్రారంభం'));

    // Sections, with pages of 20 and the language fallback
    assert(read('category/sports/index.html').includes('<h1>Sports</h1>') && read('category/sports/index.html').includes('href="/jv/category/sports/page/2/"'));
    assert(read('category/sports/page/2/index.html').includes('rel="prev" href="/jv/category/sports/"'));
    assert(read('te/category/sports/index.html').includes('<h1>క్రీడలు</h1>'));
    assert(read('te/category/health/index.html').includes('<h1>Health</h1>'), 'no Telugu name: falls back to English');

    // Search index
    const idx = JSON.parse(read('search-index.json'));
    assert(idx.length === 24 && idx[0].t === 'భారత్ ఘన విజయం' && idx[0].x.includes('మొదటి పేరా') && idx[0].c === 'sports');
    assert(read('te/search/index.html').includes('data-article="/jv/te/article/"') && read('search/index.html').includes('js/search.js'));

    // Advertise / subscribe: WhatsApp enquiry
    const adv = read('advertise/index.html');
    assert(adv.includes('Half page') && adv.includes('action="https://wa.me/919989716940"') && adv.includes('data-param="size"') && adv.includes('?size=half#enquiry'));
    assert(read('te/advertise/index.html').includes('అర పేజీ') && read('subscribe/index.html').includes('Monthly'));

    // E-paper: newest editions first, the rest in the archive; desk editions open the desk app's reader
    const ep = read('epaper/index.html');
    assert(ep.indexOf('epaper-2026-10-10') < ep.indexOf('epaper-2026-10-09') && ep.includes('class="archive"'));
    assert(ep.includes('href="https://desk.example/e/gnt-1010"') && ep.includes('Guntur') && ep.includes('Read the e-paper'));

    // Feeds
    const sm = read('sitemap.xml');
    assert(sm.includes('https://example.github.io/jv/te/advertise/') && sm.includes('/article/'));
    assert(read('news-sitemap.xml').includes('<news:title>భారత్ ఘన విజయం</news:title>') && !read('news-sitemap.xml').includes('Old 1<'));
    assert(read('rss.xml').includes('<item>') && read('robots.txt').includes('https://example.github.io/jv/sitemap.xml'));
    assert(read('404.html').includes('noindex') && has('css/site.css') && has('js/search.js') && has('fonts/Inter-var.woff2') && !has('fonts/README.txt'));
    console.log('all build checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
})();
