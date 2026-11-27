// The frontend's only data source: the backend service's JSON API (backend/src/server.js describes it).
// fetchSite() turns /api/site back into what render.js expects (Dates, and each story's section as its cats entry).
// Render's free plan sleeps when idle, so the first request can take about a minute while the backend wakes up.

const TIMEOUT_MS = 120000;
const TRIES = 3;

// null for a 404, so a missing story is not retried
async function getJson(url, tries = TRIES) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries) await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  throw new Error(`Backend API: ${url} failed after ${tries} tries (${last.message})`);
}

// One API story → the shape render.js uses
const toArticle = (a, cats) => ({ ...a, date: new Date(a.date), updated: new Date(a.updated), cat: cats.find((c) => c.slug === a.section) });

const fromApi = (d) => ({ ...d, articles: d.articles.map((a) => toArticle(a, d.cats)) });

// apiUrl: e.g. https://jaathiya-vaarthalu-api.onrender.com
function connect(apiUrl) {
  const api = apiUrl.replace(/\/+$/, '');
  return {
    async fetchSite() {
      const d = await getJson(`${api}/api/site`);
      if (!d || !Array.isArray(d.articles)) throw new Error(`Backend API: ${api}/api/site gave no site data`);
      return fromApi(d);
    },
    // A story older than NEWS_DAYS; null when the backend doesn't have it
    async findNews(id, cats) {
      const a = await getJson(`${api}/api/news/${encodeURIComponent(id)}`, 1);
      return a && toArticle(a, cats);
    },
    // A file from the backend's content/images/ (rel = "images/…"): the fetch Response
    image: (rel) => fetch(`${api}/${rel.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
  };
}

module.exports = { connect, fromApi };
