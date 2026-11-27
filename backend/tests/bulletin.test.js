// The news bulletin's voice: story choice, scripts, voicing once per script, the spending limit, the Azure and
// Cloudinary requests (with a stand-in fetch) and the script/audio fields in /api/site. Run: npm test
const assert = require('node:assert');
const crypto = require('crypto');
const { createVoicer, pick, script, hashOf, CHARS } = require('../src/bulletin');
const { azure, gemini, wav, cloudinary } = require('../src/tts');
const { createServer } = require('../src/server');

const at = (iso) => new Date(iso);
const art = (slug, date, o = {}) => ({ slug, title: `శీర్షిక ${slug}`, summary: '', body: '<p>మొదటి వాక్యం. రెండో వాక్యం.</p>', date: at(date), breaking: false, ...o });
const quiet = { error() {} };

(async () => {
  // ---- choosing stories and writing scripts ----
  const day = [art('a', '2026-10-10T06:00:00Z'), art('b', '2026-10-10T05:00:00Z', { breaking: true }), art('c', '2026-10-09T05:00:00Z')];
  assert.deepStrictEqual(pick(day, '2026-10-10').map((a) => a.slug), ['b', 'a'], 'breaking first, one day only');
  const many = Array.from({ length: 14 }, (_, i) => art(`m${i}`, `2026-10-10T0${Math.floor(i / 2)}:${i % 2 ? '30' : '00'}:00Z`));
  assert.strictEqual(pick(many, '2026-10-10').length, 10, 'at most 10 stories');

  const desk = art('d', '2026-10-10T05:00:00Z', { title: 'రోడ్డు &amp; వంతెన', summary: 'రూ.45 లక్షలు · ప్రారంభం',
    body: '<p><b>గుంటూరు:</b> కొత్త రోడ్డు ప్రారంభమైంది. పనులు త్వరలో.</p><figure><img src="x.jpg"></figure>' });
  assert.deepStrictEqual(script(desk), ['రోడ్డు & వంతెన', 'రూ.45 లక్షలు. ప్రారంభం', 'కొత్త రోడ్డు ప్రారంభమైంది. పనులు త్వరలో.'], 'headline, summary, body text without the added dateline');
  const long = art('l', '2026-10-10T05:00:00Z', { body: `<p>${'పదం '.repeat(400)}.</p>` });
  const ls = script(long).join(' ');
  assert(ls.length <= CHARS + 1 && ls.endsWith('…'), 'a long first sentence is cut to fit');
  assert.notStrictEqual(hashOf('te-IN-ShrutiNeural', script(desk)), hashOf('te-IN-MohanNeural', script(desk)), 'the voice is part of the name');

  // ---- voicing: once per script, current day only, a failure doesn't stop the rest ----
  const files = new Map([[hashOf('v', script(day[2])), 'https://cdn.example/old.mp3']]); // a story voiced before
  const said = [];
  let fail = 'a';
  const store = { list: async () => new Map(files), upload: async (name) => `https://cdn.example/${name}.mp3` };
  const tts = async (parts) => { if (parts[0] === `శీర్షిక ${fail}`) throw new Error('busy'); said.push(parts[0]); return Buffer.from('mp3'); };
  const v = createVoicer({ tts, store, voice: 'v', log: quiet });
  assert.strictEqual(v.annotate(day).get('b').audio, '', 'no audio before the first run');
  assert.strictEqual(await v.run(day), 1);
  assert.deepStrictEqual(said, ['శీర్షిక b'], 'only the current day; a failed story is skipped');
  let notes = v.annotate(day);
  assert(notes.get('b').audio.startsWith('https://cdn.example/') && notes.get('a').audio === '' && notes.get('c').audio === 'https://cdn.example/old.mp3');
  assert.strictEqual(notes.get('b').script, 'శీర్షిక b మొదటి వాక్యం. రెండో వాక్యం.');
  fail = '';
  assert.strictEqual(await v.run(day), 1, 'the failed one is tried again');
  assert.strictEqual(await v.run(day), 0, 'nothing is voiced twice');
  day[0].title = 'కొత్త శీర్షిక';
  assert.strictEqual(await v.run(day), 1, 'a changed story is voiced again');

  const capped = createVoicer({ tts, store: { list: async () => new Map(), upload: async (n) => n }, voice: 'v', dailyChars: 50, log: quiet });
  said.length = 0;
  assert.strictEqual(await capped.run(day), 1, 'the daily limit stops voicing');
  // A rate limit (429) stops the run; the rest waits for the next refresh
  let tries = 0;
  const limited = createVoicer({ tts: async () => { tries++; throw Object.assign(new Error('429'), { status: 429 }); }, store: { list: async () => new Map(), upload: async (n) => n }, voice: 'v', log: quiet });
  assert(await limited.run(day) === 0 && tries === 1, 'one try, then wait');
  const listDown = createVoicer({ tts, store: { list: async () => { throw new Error('down'); }, upload: async (n) => n }, voice: 'v', log: quiet });
  await assert.rejects(listDown.run(day), /down/);

  // ---- the Azure and Cloudinary requests ----
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, o = {}) => {
    calls.push({ url: String(url), o });
    if (String(url).includes('tts.speech.microsoft.com')) return new Response(Buffer.from('ID3mp3'), { status: 200 });
    if (String(url).includes('/resources/video/upload')) {
      const page2 = String(url).includes('next_cursor=n2');
      return Response.json({ resources: [{ public_id: page2 ? 'jaathiya/bulletin/bbb' : 'jaathiya/bulletin/aaa', secure_url: page2 ? 'https://r/b.mp3' : 'https://r/a.mp3' }], ...(page2 ? {} : { next_cursor: 'n2' }) });
    }
    if (String(url).includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(o.body);
      if (body.contents[0].parts[0].text.includes('LIMIT')) return new Response('quota', { status: 429 });
      const data = body.contents[0].parts[0].text.includes('RIFF') ? Buffer.from('RIFFxxxxWAVEdata') : Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: data.toString('base64') } }] } }] });
    }
    if (String(url).endsWith('/video/upload')) {
      const wavUp = o.body.get('file').type === 'audio/wav';
      return Response.json({ secure_url: `https://res.cloudinary.com/demo/video/upload/v1/jaathiya/bulletin/${o.body.get('public_id').split('/').pop()}.${wavUp ? 'wav' : 'mp3'}` });
    }
    return new Response('no', { status: 404 });
  };
  try {
    const mp3 = await azure({ key: 'k', region: 'centralindia', voice: 'te-IN-ShrutiNeural' })(['శీర్షిక & <కథ>', 'వాక్యం']);
    const c = calls[0];
    assert(mp3.toString() === 'ID3mp3' && c.url === 'https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1' && c.o.headers['Ocp-Apim-Subscription-Key'] === 'k');
    assert(c.o.headers['X-Microsoft-OutputFormat'].endsWith('mp3') && c.o.body.includes('xml:lang="te-IN"') && c.o.body.includes('<voice name="te-IN-ShrutiNeural">'));
    assert(c.o.body.includes('శీర్షిక &amp; &lt;కథ&gt;<break time="600ms"/>వాక్యం'), 'escaped SSML with a pause between parts');

    const cl = cloudinary('cloudinary://key1:secret1@demo');
    assert.deepStrictEqual([...(await cl.list())], [['aaa', 'https://r/a.mp3'], ['bbb', 'https://r/b.mp3']], 'every page of the list');
    assert(calls[1].o.headers.authorization === `Basic ${Buffer.from('key1:secret1').toString('base64')}` && calls[1].url.includes('prefix=jaathiya%2Fbulletin%2F'));
    const url = await cl.upload('ccc', Buffer.from('mp3'));
    const up = calls.at(-1), f = up.o.body;
    assert(url.endsWith('ccc.mp3') && up.url === 'https://api.cloudinary.com/v1_1/demo/video/upload' && f.get('public_id') === 'jaathiya/bulletin/ccc' && f.get('api_key') === 'key1');
    const sig = crypto.createHash('sha1').update(`public_id=jaathiya/bulletin/ccc&timestamp=${f.get('timestamp')}secret1`).digest('hex');
    assert(f.get('signature') === sig && f.get('file').type === 'audio/mpeg' && !f.has('api_secret'), 'signed with the secret, which is never sent');
    assert.throws(() => cloudinary('https://demo'), /CLOUDINARY_URL/);

    // Gemini: the style instruction and the script lines, Telugu and the voice; PCM comes back wrapped as WAV
    const g = gemini({ key: 'gk', voice: 'Kore', style: 'Read like a news anchor:' });
    const out = await g(['శీర్షిక', 'వివరాలు']);
    const gc = calls.at(-1), gb = JSON.parse(gc.o.body);
    assert(gc.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent' && gc.o.headers['x-goog-api-key'] === 'gk');
    assert(gb.contents[0].parts[0].text === 'Read like a news anchor:\n\nశీర్షిక\n\nవివరాలు' && gb.generationConfig.responseModalities[0] === 'AUDIO');
    assert(gb.generationConfig.speechConfig.languageCode === 'te-IN' && gb.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore');
    assert(out.subarray(0, 4).toString() === 'RIFF' && out.readUInt32LE(24) === 24000 && out.readUInt32LE(40) === 8 && out.length === 52, 'PCM → WAV, 24 kHz');
    assert.strictEqual((await g(['RIFF'])).toString(), 'RIFFxxxxWAVEdata', 'WAV passes through');
    await assert.rejects(g(['LIMIT']), (e) => e.status === 429);
    // WAV goes up as WAV and is delivered as MP3
    const wurl = await cl.upload('ddd', wav(Buffer.alloc(8), 24000));
    assert(calls.at(-1).o.body.get('file').type === 'audio/wav' && wurl.endsWith('/jaathiya/bulletin/ddd.mp3'));
  } finally { global.fetch = realFetch; }

  // ---- /api/site carries script and audio for bulletin stories ----
  const now = new Date();
  const fresh = [{ id: '5'.repeat(24), title: 'ఈ రోజు వార్త', highlights: ['ముఖ్యాంశం'], body: 'వివరాలు ఇవి.', images: [], section: 'state', author: '', approvedAt: now.toISOString(), updatedAt: now.toISOString() }];
  const db = { fetchFromMongo: async ({ base }) => ({ base, news: fresh, epapers: [] }), findNews: async () => null };
  const voicer = createVoicer({ tts: async () => Buffer.from('mp3'), store: { list: async () => new Map(), upload: async (n) => `https://cdn.example/${n}.mp3` }, voice: 'v', log: quiet });
  const { server, refresh, voiced } = createServer({ contentDir: require('path').join(__dirname, '..', 'content'), db, voicer, log: quiet });
  await refresh();
  await new Promise((r) => server.listen(0, r));
  try {
    const site = async () => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/site`)).json()).articles.find((a) => a.slug === fresh[0].id);
    await voiced();
    const a = await site();
    assert(a.script === 'ఈ రోజు వార్త ముఖ్యాంశం వివరాలు ఇవి.' && a.audio.startsWith('https://cdn.example/'), 'audio shows once voiced');
  } finally { server.close(); }
  console.log('all bulletin checks passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
