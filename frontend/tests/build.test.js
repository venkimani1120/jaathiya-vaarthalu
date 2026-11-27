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
    assert(home.includes('Today&#39;s news') && !home.includes('Old 1<') && !home.includes('Health tip') && !home.includes('class="note"'), "only today's news on the home page");
    assert(home.includes('href="/jv/old-news/"'));
    const homeTe = read('te/index.html');
    assert(homeTe.includes('<html lang="te">') && homeTe.includes('>క్రీడలు<') && !homeTe.includes('>Sports<') && homeTe.includes('href="/jv/"'));

    // Every local link and asset carries the sub-path
    for (const f of ['index.html', 'te/index.html', 'advertise/index.html', 'epaper/index.html', 'epaper/2026-10-09/index.html', 'old-news/index.html', 'old-news/2026-09-05/index.html', 'bulletin/index.html', 'te/bulletin/2026-09-05/index.html', 'search/index.html', '404.html']) {
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

    // Sections show the current day's stories only, and the language fallback
    const sports = read('category/sports/index.html');
    assert(sports.includes('<h1>Sports</h1>') && sports.includes('భారత్ ఘన విజయం') && !sports.includes('Old 1<') && !has('category/sports/page/2/index.html'));
    assert(read('te/category/sports/index.html').includes('<h1>క్రీడలు</h1>') && read('te/category/sports/index.html').includes('నేటి వార్తలు'));
    const health = read('te/category/health/index.html');
    assert(health.includes('<h1>Health</h1>') && health.includes('ఈ రోజు ఈ విభాగంలో వార్తలు లేవు') && !health.includes('Health tip'), 'no Telugu name: falls back to English; no story today');

    // Old news: a date filter and the earlier days; one page per day with news
    const old = read('old-news/index.html');
    assert(old.includes('action="/jv/old-news/"') && old.includes('min="2026-09-01" max="2026-10-10"') && old.includes('aria-current="page">Old news<'));
    assert(old.includes('href="/jv/old-news/2026-10-01/"') && old.includes('href="/jv/old-news/2026-09-21/"') && !old.includes('href="/jv/old-news/2026-10-10/"'), 'earlier days, not the current one');
    const day = read('old-news/2026-09-05/index.html');
    assert(day.includes('Old 5<') && !day.includes('Old 6<') && day.includes('value="2026-09-05"'));
    assert(day.includes('href="/jv/old-news/2026-09-04/"') && day.includes('href="/jv/old-news/2026-09-06/"'), 'earlier and later day links');
    assert(read('te/old-news/2026-10-01/index.html').includes('Health tip') && read('te/old-news/index.html').includes('పాత వార్తలు'));
    assert(!has('old-news/2026-08-01/index.html'), 'no page for a day without news');

    // News bulletin: the current day's stories in the player (breaking first), a playlist and the date filter
    const bl = read('bulletin/index.html');
    assert(bl.includes('<h1>News Bulletin</h1>') && bl.includes('src="/jv/js/bulletin.js"') && bl.includes('aria-current="page">News Bulletin<'));
    assert(bl.indexOf('భారత్ ఘన విజయం</h2>') < bl.indexOf('కొత్త రోడ్డు &lt;b&gt;</h2>') && !bl.includes('Old 1<'), "today's stories, breaking first");
    assert(bl.includes('data-say="సారాంశం"') && bl.includes('class="playlist"') && bl.includes('data-i="1"') && bl.includes('voice reader is coming soon'));
    assert(bl.includes('action="/jv/bulletin/"') && !bl.includes('data-audio'), 'no audio yet');
    const blTe = read('te/bulletin/2026-09-05/index.html');
    assert(blTe.includes('వార్తా బులెటిన్: ') && blTe.includes('Old 5</h2>') && blTe.includes('href="/jv/te/article/old-5/"') && blTe.includes('href="/jv/te/bulletin/2026-09-04/"'));
    assert(home.includes('href="/jv/bulletin/"'), 'menu link');

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
    assert(ep.includes('epaper-2026-10-10') && ep.includes('href="/jv/epaper/2026-10-09/"') && ep.includes('class="archive"'));
    assert(ep.includes('action="/jv/epaper/"') && ep.includes('min="2026-10-09"'), 'e-paper date filter');
    const ep9 = read('epaper/2026-10-09/index.html');
    assert(ep9.includes('epaper-2026-10-09') && !ep9.includes('epaper-2026-10-10') && ep9.includes('href="/jv/epaper/2026-10-10/"') && ep9.includes('aria-current="page">E-paper<'));
    assert(ep.includes('href="https://desk.example/e/gnt-1010"') && ep.includes('Guntur') && ep.includes('Read the e-paper'));

    // Feeds
    const sm = read('sitemap.xml');
    assert(sm.includes('https://example.github.io/jv/te/advertise/') && sm.includes('/article/') && sm.includes('/jv/old-news/2026-09-05/'));
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
