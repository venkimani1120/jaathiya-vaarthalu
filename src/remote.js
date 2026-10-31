// Approved news and published e-papers from the news desk app (jaathiya-vaartalu-studio-app on Render, which keeps
// them in MongoDB with photos on Cloudinary). build.js calls fetchRemote() when NEWS_API_URL is set, and content.js
// turns the result into stories and editions next to the ones in content/.
// Render's free plan sleeps when idle, so the first request can take about a minute while the server wakes up.
// If the desk app can't be reached the build fails, and the live site stays as it was until the next hourly run.

const TIMEOUT_MS = 120000;
const TRIES = 3;

async function getJson(url) {
  let last;
  for (let i = 1; i <= TRIES; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < TRIES) await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  throw new Error(`News desk app: ${url} failed after ${TRIES} tries (${last.message})`);
}

// base: e.g. https://jaathiya-vaartalu-studio-app.onrender.com; days: how far back approved news is shown
async function fetchRemote(base, { days = 90 } = {}) {
  const api = base.replace(/\/+$/, '');
  const news = [];
  for (let page = 1; ; page++) {
    const r = await getJson(`${api}/api/public/news?days=${days}&page=${page}`);
    news.push(...(r.items || []));
    if (!r.more || page >= 100) break;
  }
  const { items: epapers = [] } = await getJson(`${api}/api/public/epapers`);
  return { base: api, news, epapers };
}

module.exports = { fetchRemote };
