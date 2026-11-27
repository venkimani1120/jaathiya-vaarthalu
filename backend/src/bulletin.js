// The news bulletin's voice: what the reader says for each story, and the MP3s made from it.
// The frontend's /bulletin/ page (bulletinOf() in frontend/src/render.js) shows up to MAX stories of a day, breaking
// news first; pick() here must choose the same stories. Each one gets a script (headline, summary, opening sentences),
// and the current day's are voiced once (src/tts.js: Gemini or Azure speech → Cloudinary). A file is named after a hash of its
// voice and script, so a story is voiced again only when its text changes, and nothing is voiced twice after a restart.
const crypto = require('crypto');

const MAX = 10;          // stories in a day's bulletin (keep in step with BULLETIN_MAX in frontend/src/render.js)
const CHARS = 600;       // longest script, in characters
const PER_RUN = 10;      // most new files made in one run

const istDay = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // "YYYY-MM-DD"
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const text = (html) => String(html || '').replace(/<(figure|video)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENT[e]).replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…');

// The day's bulletin from stories sorted newest first: breaking news first, then newest first
function pick(articles, day) {
  const l = articles.filter((a) => istDay(a.date) === day);
  return [...l.filter((a) => a.breaking), ...l.filter((a) => !a.breaking)].slice(0, MAX);
}

// What the reader says, as parts with a pause between them: the headline, the summary (desk highlights are joined
// with " · "), then whole sentences from the body while the script stays under CHARS.
function script(a) {
  const parts = [text(a.title)];
  const summary = text(a.summary).split(/\s*·\s*/).filter(Boolean).join('. ');
  if (summary) parts.push(summary);
  let left = CHARS - parts.join(' ').length;
  // Desk stories start with a bold dateline that the reporter's own text usually repeats, so it is not read out
  const body = text(String(a.body || '').replace(/^<p><b>[^<]*<\/b>\s*/, '<p>'));
  const said = [];
  for (const s of body.split(/(?<=[.!?।])\s+/)) {
    if (summary && !said.length && s.startsWith(summary.slice(0, 40))) continue; // the body repeating the summary
    if (s.length + 1 > left) { if (!said.length && left > 80) said.push(cut(s, left - 1)); break; }
    said.push(s);
    left -= s.length + 1;
  }
  if (said.length) parts.push(said.join(' '));
  return parts.filter(Boolean);
}

const hashOf = (voice, parts) => crypto.createHash('sha1').update(`${voice}\n${parts.join('\n')}`).digest('hex').slice(0, 20);

// tts(parts) → MP3 Buffer; store: { list() → Map(name → url), upload(name, mp3) → url }; dailyChars caps what is
// voiced per India day (a spending limit; it starts again after a restart).
function createVoicer({ tts, store, voice, dailyChars = 20000, log = console }) {
  let known = null;        // name → URL of the files already made
  let running = null;
  let spent = { day: '', chars: 0 };
  let pausedUntil = 0;       // after a rate limit, no speech requests until then
  const waiting = new Map(); // name → audio made but not yet uploaded (so a failed upload doesn't pay for speech again)

  // Every bulletin story (any day) → { script, audio }; audio is '' until its file exists
  function annotate(articles) {
    const out = new Map();
    const days = [...new Set(articles.map((a) => istDay(a.date)))];
    for (const d of days) for (const a of pick(articles, d)) {
      const parts = script(a);
      out.set(a.slug, { script: parts.join(' '), audio: (known && known.get(hashOf(voice, parts))) || '' });
    }
    return out;
  }

  // Voices the current day's stories that have no file yet. Resolves to the number of new files.
  async function voiceDay(articles) {
    if (Date.now() < pausedUntil) return 0;
    if (!known) known = await store.list(); // if the list fails, nothing is voiced (so nothing is paid for twice)
    const day = articles.length ? istDay(articles[0].date) : '';
    const today = istDay(new Date());
    if (spent.day !== today) spent = { day: today, chars: 0 };
    let made = 0;
    for (const a of pick(articles, day)) {
      if (made >= PER_RUN) break;
      const parts = script(a), name = hashOf(voice, parts), size = parts.join(' ').length;
      if (known.has(name)) continue;
      if (!waiting.has(name) && spent.chars + size > dailyChars) { log.error(`Bulletin: daily limit of ${dailyChars} characters reached; the rest is voiced tomorrow`); break; }
      try {
        if (!waiting.has(name)) {
          waiting.set(name, await tts(parts));
          spent.chars += size;
        }
        known.set(name, await store.upload(name, waiting.get(name)));
        waiting.delete(name);
        made++;
      } catch (e) {
        log.error(`Bulletin: story ${a.slug} not voiced: ${e.message}`);
        // rate limited (429), or storage refused (401/403): the rest waits for the next refresh
        if (e.status === 429) {
          pausedUntil = Date.now() + Math.max(60000, e.retryAfterMs || 0);
          log.error(`Bulletin: speech rate limit; voicing again after ${new Date(pausedUntil).toISOString()}`);
        }
        if ([401, 403, 429].includes(e.status)) break;
      }
    }
    return made;
  }

  // One run at a time; a call while one is running gets that run
  const run = (articles) => (running = running || voiceDay(articles).finally(() => { running = null; }));

  return { annotate, run };
}

module.exports = { createVoicer, pick, script, hashOf, MAX, CHARS };
