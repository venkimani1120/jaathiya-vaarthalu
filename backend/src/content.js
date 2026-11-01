// Reads and checks everything under content/. A mistake in any file stops the start (or the build) with a list of
// problems, so a bad edit on GitHub fails the deploy instead of publishing a broken site.
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const istDay = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // "YYYY-MM-DD"

// ---- News from the desk app (src/remote.js) ----
// Desk sections → website sections (categories.json). A section missing from categories.json leaves the story without one.
const DESK_SECTION = { state: 'state', district: 'district', constituency: 'district', sports: 'sports', business: 'business' };
const isVideo = (u) => /\/video\/upload\/|\.(mp4|webm|mov)(\?|$)/i.test(u);
// Cloudinary resizes and converts on the fly: a smaller, WebP/AVIF copy for slow phones
const cld = (u, w) => u.replace(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)/, `$1c_limit,w_${w},f_auto,q_auto/`);

// Reporters don't have write access to this repo, so their text is escaped, never inserted as HTML
function remoteArticle(n, cats) {
  const media = (n.images || []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u));
  const photo = media.find((u) => !isVideo(u)) || '';
  const paras = String(n.body || '').split(/\n\s*\n|\r?\n/).map((s) => esc(s.trim())).filter(Boolean);
  if (n.dateline && paras.length) paras[0] = `<b>${esc(String(n.dateline).replace(/[:\s]+$/, ''))}:</b> ${paras[0]}`;
  const extra = media.filter((u) => u !== photo).map((u) => (isVideo(u)
    ? `<video controls preload="none" width="640" height="360" src="${esc(u)}"></video>`
    : `<img src="${esc(cld(u, 1280))}" alt="" loading="lazy" width="640" height="480">`));
  const date = new Date(n.approvedAt), updated = new Date(n.updatedAt);
  return {
    slug: String(n.id), title: n.title, summary: (n.highlights || []).join(' · '),
    body: paras.map((p) => `<p>${p}</p>`).join('') + extra.map((m) => `<figure>${m}</figure>`).join(''),
    image: photo ? cld(photo, 1280) : '', cat: cats.find((c) => c.slug === DESK_SECTION[n.section]), author: n.author || '',
    date, updated: isNaN(updated) || updated < date ? date : updated, breaking: false,
  };
}

// remote: what fetchRemote() returned, or nothing when the desk app is not used
function load(dir, now = new Date(), remote) {
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
    // Drafts and stories timed for later stay off the site. The next refresh publishes them when due.
    if (a.draft || !date || date > now) continue;
    articles.push({
      slug, title: a.title, summary: a.summary || '', body: a.body, image: a.image || '',
      cat: cats.find((c) => c.slug === a.section), author: a.author || '',
      date, updated: toDate(a.updated_at) || date, breaking: !!a.breaking,
    });
  }
  if (remote) {
    const local = new Set(articles.map((a) => a.slug));
    for (const n of remote.news) {
      // The desk app already checks its news, so a bad item is skipped with a warning instead of stopping the start
      if (!n || !/^[a-f0-9]{24}$/.test(n.id) || !n.title || !n.body || isNaN(new Date(n.approvedAt))) { console.warn(`Desk news skipped: ${JSON.stringify(n).slice(0, 120)}`); continue; }
      if (!local.has(n.id) && new Date(n.approvedAt) <= now) articles.push(remoteArticle(n, cats));
    }
  }
  articles.sort((x, y) => y.date - x.date);

  editions.forEach((e, i) => {
    const w = `epaper.json item ${i + 1}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) errors.push(`${w}: "date" must look like "2026-10-10"`);
    if (!e.pdf) errors.push(`${w}: "pdf" (link to the PDF) is required`);
    else fileOk(`${w} "pdf"`, e.pdf);
    fileOk(`${w} "thumb"`, e.thumb);
  });
  // Published e-papers from the desk app open in its reader at <app>/e/<link>
  if (remote) for (const e of remote.epapers) {
    const d = new Date(e.editionDate);
    if (e.shareSlug && !isNaN(d)) editions.push({ date: istDay(d), link: `${String(remote.base).replace(/\/+$/, '')}/e/${encodeURIComponent(e.shareSlug)}`, name: e.title || '' });
  }
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

module.exports = { load, toDate, isUrl, remoteArticle };
