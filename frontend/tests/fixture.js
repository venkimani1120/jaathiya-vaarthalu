// Sample backend API data (the shape of GET /api/site in backend/src/server.js) and a stand-in backend serving it.
const http = require('http');

const ID = '1'.repeat(24), OLD = '2'.repeat(24);
const SITE = {
  name_te: 'జాతియ వార్తలు', name_en: 'Jaathiya Vaartalu', tagline_te: 'తెలుగు దినపత్రిక', tagline_en: 'Telugu Daily Newspaper',
  editor_publisher_te: 'మామిడి రాజేష్', editor_publisher_en: 'Mamidi Rajesh', rni_number: 'APTEL/25/A5264', established: 2025,
  publishing_centre: 'Narasaraopet, Palnadu District, Andhra Pradesh', phone: '9989716940', whatsapp: '9989716940',
  address_te: 'గుంటూరు - 522 002', address_en: 'Guntur - 522 002',
  advertise: { sizes: [
    { key: 'full', name_en: 'Full page', name_te: 'పూర్తి పేజీ', desc_en: 'The whole page.', desc_te: 'పేజీ మొత్తం.', w: 100, h: 100, price: null },
    { key: 'half', name_en: 'Half page', name_te: 'అర పేజీ', desc_en: 'The bottom half.', desc_te: 'కింది సగం.', w: 100, h: 50, price: null },
  ] },
  subscription: { plans: [{ key: 'month', name_en: 'Monthly', name_te: 'నెలవారీ', desc_en: 'One month.', desc_te: 'ఒక నెల.', price: null }] },
};

const story = (slug, title, date, o = {}) => ({ slug, title, summary: '', body: '<p>o</p>', image: '', section: 'sports', author: '', date, updated: date, breaking: false, ...o });

function apiData() {
  const articles = [
    story('భారత్-ఘన-విజయం', 'భారత్ ఘన విజయం', '2026-10-10T03:30:00.000Z', { summary: 'సారాంశం', body: '<p>మొదటి పేరా</p>', author: 'రాజేష్', breaking: true, image: 'images/win.jpg' }),
    story(ID, 'కొత్త రోడ్డు <b>', '2026-10-10T03:00:00.000Z', { summary: 'రూ.45 లక్షలు · ప్రారంభం', body: '<p>పేరా</p>', image: 'https://res.cloudinary.com/demo/image/upload/c_limit,w_1280,f_auto,q_auto/v1/a.jpg' }),
    story('health-tip', 'Health tip', '2026-10-01T02:30:00.000Z', { body: '<p>x</p>', section: 'health' }),
  ];
  for (let i = 21; i >= 1; i--) articles.push(story(`old-${i}`, `Old ${i}`, `2026-09-${String(i).padStart(2, '0')}T02:30:00.000Z`));
  return {
    generatedAt: '2026-10-10T06:00:00.000Z', site: SITE,
    cats: [{ slug: 'sports', name_en: 'Sports', name_te: 'క్రీడలు' }, { slug: 'health', name_en: 'Health' }],
    articles,
    editions: [
      { date: '2026-10-10', link: 'https://desk.example/e/gnt-1010', name: 'Guntur' },
      { date: '2026-10-10', pdf: 'https://github.com/x/y/releases/download/epaper-2026-10-10/main.pdf', name: 'Main' },
      { date: '2026-10-09', pdf: 'https://github.com/x/y/releases/download/epaper-2026-10-09/main.pdf' },
    ],
    ads: [{ slot: 'inline', image: 'images/ad.jpg', link: 'https://shop.example', end: '2026-12-31' }, { slot: 'inline', image: 'images/old-ad.jpg', end: '2026-01-01' }],
    images: ['images/win.jpg', 'images/ad.jpg', 'images/old-ad.jpg'],
  };
}

// A stand-in backend: /api/site gives `state.data`, /api/news/<OLD> an old story, /images/* a few bytes.
// state.down = true makes /api/site fail.
function stubApi(state) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const json = (s, v) => res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(v));
    if (p === '/api/site') return state.down ? json(500, { error: 'down' }) : json(200, state.data);
    if (p === `/api/news/${OLD}`) return json(200, story(OLD, 'పాత వార్త', '2025-01-01T05:00:00.000Z', { section: 'sports' }));
    if (state.data.images.includes(p.slice(1))) return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(`jpeg ${p}`);
    json(404, { error: 'not found' });
  });
  return new Promise((r) => server.listen(0, () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { apiData, stubApi, ID, OLD };
