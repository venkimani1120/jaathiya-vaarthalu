// Search page: filters /search-index.json (built by src/build.js) in the browser.
// The page's language-specific strings and links come from data- attributes on #search-results.
(() => {
  const box = document.getElementById('search-results');
  if (!box) return;
  const d = box.dataset;
  const msg = box.querySelector('.search-msg');
  const grid = box.querySelector('.grid');
  const q = (new URLSearchParams(location.search).get('q') || '').trim();
  document.querySelectorAll('input[name="q"]').forEach((i) => (i.value = q));
  if ([...q].length < 3) return; // the page already says "Type at least 3 characters"

  document.getElementById('search-h').textContent = d.heading.replace('%s', q);
  document.title = d.title.replace('%s', q);
  msg.textContent = d.busy;
  const sections = JSON.parse(d.sections);
  const fmt = (iso) => new Date(iso).toLocaleDateString(d.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

  // Same markup as the cards on the built pages (card() in src/render.js)
  const card = (a) => {
    const art = el('article', 'card'), link = el('a'), body = el('div', 'card-body');
    link.href = d.article + a.u;
    if (a.i) { const img = el('img'); Object.assign(img, { src: a.i, alt: '', loading: 'lazy', width: 640, height: 360 }); link.append(img); }
    else { const ph = el('div', 'ph'); ph.setAttribute('aria-hidden', 'true'); link.append(ph); }
    if (sections[a.c]) body.append(el('span', 'cat', sections[a.c]));
    body.append(el('h2', '', a.t), el('span', 'date', fmt(a.d)));
    link.append(body);
    art.append(link);
    return art;
  };

  fetch(d.index)
    .then((r) => r.json())
    .then((items) => {
      const needle = q.toLowerCase();
      const hits = items.filter((a) => a.x.includes(needle)).slice(0, 60);
      msg.textContent = hits.length ? '' : d.none;
      grid.replaceChildren(...hits.map(card));
    })
    .catch(() => (msg.textContent = d.none));
})();
