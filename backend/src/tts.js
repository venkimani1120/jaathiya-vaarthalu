// The bulletin's voice (src/bulletin.js): Gemini (Google AI Studio) or Azure text-to-speech makes the audio, Cloudinary
// keeps it. Plain fetch calls, so the backend keeps mongodb as its only npm dependency.
const crypto = require('crypto');

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Azure Speech (a Speech resource's key and region, e.g. centralindia). Script parts are read with a pause between them.
function azure({ key, region, voice, timeoutMs = 60000 }) {
  const lang = voice.split('-').slice(0, 2).join('-'); // te-IN-ShrutiNeural → te-IN
  return async (parts) => {
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${xml(voice)}">${parts.map(xml).join('<break time="600ms"/>')}</voice></speak>`;
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'jaathiya-vaarthalu-api' },
      body: ssml, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`Azure speech: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const mp3 = Buffer.from(await r.arrayBuffer());
    if (!mp3.length) throw new Error('Azure speech: empty audio');
    return mp3;
  };
}

// Gemini text-to-speech with a Google AI Studio API key. Gemini has no SSML: the style is a plain instruction in front
// of the text, and the script parts go on separate lines. It returns 16-bit PCM (or WAV); PCM is wrapped as WAV.
// A 429 (the free tier's rate limit) is marked so the voicer stops the run and tries again on the next refresh.
function gemini({ key, model = 'gemini-3.8-flash-tts', voice = 'Kore', style = '', lang = 'te-IN', timeoutMs = 120000 }) {
  return async (parts) => {
    const text = (style ? `${style}\n\n` : '') + parts.join('\n\n');
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: lang, voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw Object.assign(new Error(`Gemini speech: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`), { status: r.status });
    const j = await r.json();
    const audio = ((j.candidates || [])[0]?.content?.parts || []).find((p) => p.inlineData && /^audio\//.test(p.inlineData.mimeType));
    if (!audio) throw new Error(`Gemini speech: no audio in the answer (${JSON.stringify(j).slice(0, 200)})`);
    const raw = Buffer.from(audio.inlineData.data, 'base64');
    if (!raw.length) throw new Error('Gemini speech: empty audio');
    if (raw.subarray(0, 4).toString() === 'RIFF') return raw;
    const rate = Number((/rate=(\d+)/.exec(audio.inlineData.mimeType) || [])[1]) || 24000;
    return wav(raw, rate);
  };
}

// 16-bit mono PCM → a WAV file (a 44-byte RIFF header in front)
function wav(pcm, rate, channels = 1, bits = 16) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE((rate * channels * bits) / 8, 28); h.writeUInt16LE((channels * bits) / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Cloudinary, from CLOUDINARY_URL (cloudinary://<api key>:<api secret>@<cloud name>). Audio files are Cloudinary
// "video" resources; they are kept under `folder`, named after their script's hash.
function cloudinary(cloudinaryUrl, folder = 'jaathiya/bulletin', { timeoutMs = 60000 } = {}) {
  const u = new URL(cloudinaryUrl);
  const key = decodeURIComponent(u.username), secret = decodeURIComponent(u.password), cloud = u.hostname;
  if (u.protocol !== 'cloudinary:' || !key || !secret || !cloud) throw new Error('CLOUDINARY_URL must look like cloudinary://<api key>:<api secret>@<cloud name>');
  const api = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}`;
  const prefix = folder.replace(/\/+$/, '') + '/';
  // Gemini's WAV files are kept as they are and delivered as MP3 (Cloudinary converts when the extension asks for it),
  // which is much smaller for listeners on mobile data
  const asMp3 = (u) => u.replace(/\.wav(\?|$)/i, '.mp3$1');

  // Every file already in the folder: name → URL (Admin API, 500 a page)
  async function list() {
    const out = new Map();
    let cursor = '';
    do {
      const q = new URLSearchParams({ prefix, max_results: '500', ...(cursor && { next_cursor: cursor }) });
      const r = await fetch(`${api}/resources/video/upload?${q}`, { headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` }, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`Cloudinary list: HTTP ${r.status}`);
      const j = await r.json();
      for (const x of j.resources || []) if (x.public_id.startsWith(prefix)) out.set(x.public_id.slice(prefix.length), asMp3(x.secure_url));
      cursor = j.next_cursor || '';
    } while (cursor);
    return out;
  }

  // A signed upload: the signature is the SHA-1 of the sorted parameters followed by the API secret
  async function upload(name, audio) {
    const isWav = audio.subarray(0, 4).toString() === 'RIFF';
    const params = { public_id: prefix + name, timestamp: String(Math.floor(Date.now() / 1000)) };
    const signature = crypto.createHash('sha1').update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + secret).digest('hex');
    const form = new FormData();
    form.append('file', new Blob([audio], { type: isWav ? 'audio/wav' : 'audio/mpeg' }), `${name}.${isWav ? 'wav' : 'mp3'}`);
    for (const [k, v] of Object.entries({ ...params, api_key: key, signature })) form.append(k, v);
    const r = await fetch(`${api}/video/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`Cloudinary upload: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return asMp3((await r.json()).secure_url);
  }

  return { list, upload };
}

module.exports = { azure, gemini, wav, cloudinary };
