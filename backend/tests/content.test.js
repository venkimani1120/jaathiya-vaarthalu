// Loads sample content and checks the publishing rules, content errors and the desk app news mapping. Run: npm test
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load } = require('../src/content');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-api-test-'));
const content = path.join(tmp, 'content');
const now = new Date('2026-10-10T06:00:00Z'); // 11:30 in India
const json = (f, v) => { fs.mkdirSync(path.dirname(path.join(content, f)), { recursive: true }); fs.writeFileSync(path.join(content, f), JSON.stringify(v)); };

fs.cpSync(path.join(ROOT, 'content', 'site.json'), path.join(content, 'site.json'));
json('categories.json', [{ slug: 'sports', name_en: 'Sports', name_te: 'క్రీడలు' }, { slug: 'health', name_en: 'Health' }]);
json('articles/భారత్-ఘన-విజయం.json', { title: 'భారత్ ఘన విజయం', summary: 'సారాంశం', body: '<p>మొదటి పేరా</p>', section: 'sports', author: 'రాజేష్', published_at: '2026-10-10 09:00', breaking: true, image: 'images/win.jpg' });
json('articles/draft-story.json', { title: 'డ్రాఫ్ట్ వార్త', body: '<p>y</p>', section: 'sports', published_at: '2026-10-09 09:00', draft: true });
json('articles/later-story.json', { title: 'తర్వాత వార్త', body: '<p>y</p>', section: 'sports', published_at: '2026-10-10 18:00' });
json('articles/health-tip.json', { title: 'Health tip', body: '<p>x</p>', section: 'health', published_at: '2026-10-01 08:00' });
json('epaper.json', [{ date: '2026-10-09', pdf: 'https://github.com/x/y/releases/download/epaper-2026-10-09/main.pdf' }, { date: '2026-10-10', pdf: 'https://github.com/x/y/releases/download/epaper-2026-10-10/main.pdf', name: 'Main' }]);
json('ads.json', [{ slot: 'inline', image: 'images/ad.jpg', link: 'https://shop.example', end: '2026-12-31' }]);
fs.mkdirSync(path.join(content, 'images'));
for (const f of ['win.jpg', 'ad.jpg']) fs.writeFileSync(path.join(content, 'images', f), 'x');

// Drafts and stories timed for later are left out; India time; newest first; newest edition first
const d = load(content, now);
assert.deepStrictEqual(d.articles.map((a) => a.slug), ['భారత్-ఘన-విజయం', 'health-tip'], 'draft and future stories are skipped');
assert(d.articles[0].date.toISOString() === '2026-10-10T03:30:00.000Z' && d.articles[0].cat.slug === 'sports' && d.articles[0].breaking);
assert.deepStrictEqual(d.editions.map((e) => e.date), ['2026-10-10', '2026-10-09']);
assert(load(content, new Date('2026-10-10T13:00:00Z')).articles.some((a) => a.slug === 'later-story'), 'a scheduled story is in once its time comes');

// Content mistakes stop the load with a readable list
json('articles/bad.json', { title: 'x', body: 'y', section: 'nope', published_at: 'yesterday', image: 'images/missing.jpg' });
assert.throws(() => load(content, now), (e) => /section "nope" is not in categories.json/.test(e.message) && /"published_at" must look like/.test(e.message)
  && /"images\/missing.jpg" not found/.test(e.message));
fs.rmSync(path.join(content, 'articles', 'bad.json'));

// News desk app: approved news and published e-papers are added to the content/ ones
const ID = 'a'.repeat(24), CLD = 'https://res.cloudinary.com/demo/image/upload/v1/jaathiya/news/';
const remote = {
  base: 'https://desk.example/',
  news: [
    { id: ID, title: 'కొత్త రోడ్డు <b>', highlights: ['రూ.45 లక్షలు', 'ప్రారంభం'], body: 'మొదటి <script>x</script>\n\nరెండవ', dateline: 'గుంటూరు',
      images: [CLD + 'a.jpg', 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4', CLD + 'b.jpg'], section: 'sports', author: 'రాజేష్',
      approvedAt: '2026-10-10T05:00:00Z', updatedAt: '2026-10-10T05:30:00Z' },
    { id: 'b'.repeat(24), title: 'Later', body: 'x', section: 'state', approvedAt: '2026-10-11T05:00:00Z', updatedAt: '2026-10-11T05:00:00Z' },
    { id: 'not-an-id', title: 'Bad', body: 'x', approvedAt: '2026-10-10T05:00:00Z' },
  ],
  epapers: [{ title: 'Guntur', editionDate: '2026-10-10T00:00:00.000Z', shareSlug: 'gnt-1010' }],
};
const warn = console.warn;
console.warn = () => {};
const d2 = load(content, now, remote);
console.warn = warn;
assert.strictEqual(d2.articles.length, 3, 'remote news added; future and bad items skipped');
const ra = d2.articles.find((a) => a.slug === ID);
assert(ra.title === 'కొత్త రోడ్డు <b>' && ra.body.startsWith('<p><b>గుంటూరు:</b> మొదటి &lt;script&gt;') && ra.body.includes('<p>రెండవ</p>'), 'desk text is escaped');
assert(ra.image === 'https://res.cloudinary.com/demo/image/upload/c_limit,w_1280,f_auto,q_auto/v1/jaathiya/news/a.jpg' && ra.body.includes('<video controls') && ra.body.includes('b.jpg'));
assert(ra.summary === 'రూ.45 లక్షలు · ప్రారంభం' && ra.cat.slug === 'sports' && ra.updated.toISOString() === '2026-10-10T05:30:00.000Z');
assert.deepStrictEqual(d2.editions.find((e) => e.link), { date: '2026-10-10', link: 'https://desk.example/e/gnt-1010', name: 'Guntur' });

fs.rmSync(tmp, { recursive: true, force: true });

// fetchRemote reads every page of news, then the e-papers
const http = require('http');
const { fetchRemote } = require('../src/remote');
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = u.pathname === '/api/public/epapers' ? { items: [{ shareSlug: 's' }] }
    : u.pathname === '/api/public/news' ? { items: [{ id: u.searchParams.get('page') + u.searchParams.get('days') }], more: u.searchParams.get('page') === '1' } : null;
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body || {}));
}).listen(0, async () => {
  try {
    const got = await fetchRemote(`http://127.0.0.1:${srv.address().port}/`, { days: 7 });
    assert.deepStrictEqual(got.news.map((n) => n.id), ['17', '27']);
    assert(got.epapers.length === 1 && got.base === `http://127.0.0.1:${srv.address().port}`);
    console.log('all content checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    srv.close();
  }
});
