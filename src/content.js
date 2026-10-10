// Reads and checks everything under content/. A mistake in any file stops the build with a list of
// problems, so a bad edit on GitHub fails the Actions run instead of publishing a broken site.
const fs = require('fs');
const path = require('path');

// Times in the content files are India time, e.g. "2026-10-10 09:30". A time with its own zone (…Z, …+05:30) is kept.
function toDate(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const d = new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(t) ? t : t.replace(' ', 'T') + (t.length === 10 ? 'T00:00' : '') + '+05:30');
  return isNaN(d) ? null : d;
}
const isUrl = (p) => /^https?:\/\//.test(p);

function load(dir, now = new Date()) {
  const errors = [];
  const read = (file, fallback) => {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
      if (fallback === undefined) errors.push(`${file}: file is missing`);
      return fallback;
    }
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { errors.push(`${file}: not valid JSON (${e.message})`); return fallback; }
  };
  // Local files are paths inside content/ (e.g. "images/2026/flood.jpg"); full https:// links are used as they are
  const fileOk = (where, p) => {
    if (p == null || p === '') return;
    if (typeof p !== 'string') return errors.push(`${where}: must be text`);
    if (!isUrl(p) && !fs.existsSync(path.join(dir, p.replace(/^\//, '')))) errors.push(`${where}: file "${p}" not found in content/`);
  };

  const site = read('site.json', {});
  const cats = read('categories.json', []);
  const editions = read('epaper.json', []);
  const ads = read('ads.json', []);

  const slugs = new Set();
  cats.forEach((c, i) => {
    const w = `categories.json item ${i + 1}`;
    if (!c.slug || !/^[a-z0-9-]+$/.test(c.slug)) errors.push(`${w}: "slug" must be lowercase letters, numbers and dashes`);
    else if (slugs.has(c.slug)) errors.push(`${w}: slug "${c.slug}" is used twice`);
    if (!c.name_en) errors.push(`${w}: "name_en" is required`);
    slugs.add(c.slug);
  });

  const articles = [];
  const artDir = path.join(dir, 'articles');
  const files = fs.existsSync(artDir) ? fs.readdirSync(artDir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const w = `articles/${f}`;
    const a = read(w, null);
    if (!a) continue;
    const slug = f.slice(0, -5).normalize('NFC'); // macOS may store Telugu file names decomposed
    const date = toDate(a.published_at);
    if (!a.title || typeof a.title !== 'string') errors.push(`${w}: "title" is required`);
    if (!a.body || typeof a.body !== 'string') errors.push(`${w}: "body" is required`);
    if (!date) errors.push(`${w}: "published_at" must look like "2026-10-10 09:30"`);
    if (a.updated_at && !toDate(a.updated_at)) errors.push(`${w}: "updated_at" must look like "2026-10-10 09:30"`);
    if (a.section && !slugs.has(a.section)) errors.push(`${w}: section "${a.section}" is not in categories.json`);
    if (/[\s/?#%]/.test(slug)) errors.push(`${w}: the file name is the web address, so it can't contain spaces, / ? # or %`);
    fileOk(`${w} "image"`, a.image);
    // Drafts and stories timed for later stay off the site. The hourly rebuild publishes them when due.
    if (a.draft || !date || date > now) continue;
    articles.push({
      slug, title: a.title, summary: a.summary || '', body: a.body, image: a.image || '',
      cat: cats.find((c) => c.slug === a.section), author: a.author || '',
      date, updated: toDate(a.updated_at) || date, breaking: !!a.breaking,
    });
  }
  articles.sort((x, y) => y.date - x.date);

  editions.forEach((e, i) => {
    const w = `epaper.json item ${i + 1}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) errors.push(`${w}: "date" must look like "2026-10-10"`);
    if (!e.pdf) errors.push(`${w}: "pdf" (link to the PDF) is required`);
    else fileOk(`${w} "pdf"`, e.pdf);
    fileOk(`${w} "thumb"`, e.thumb);
  });
  editions.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));

  ads.forEach((a, i) => {
    const w = `ads.json item ${i + 1}`;
    if (!a.slot) errors.push(`${w}: "slot" is required (only "inline" is shown)`);
    if (!a.image) errors.push(`${w}: "image" is required`);
    else fileOk(`${w} "image"`, a.image);
    for (const k of ['start', 'end']) if (a[k] && !/^\d{4}-\d{2}-\d{2}$/.test(a[k])) errors.push(`${w}: "${k}" must look like "2026-10-10"`);
  });

  for (const k of ['name_en', 'name_te', 'phone']) if (!site[k]) errors.push(`site.json: "${k}" is required`);

  if (errors.length) throw new Error(`Content has ${errors.length} problem(s):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  return { site, cats, articles, editions, ads };
}

module.exports = { load, toDate, isUrl };
