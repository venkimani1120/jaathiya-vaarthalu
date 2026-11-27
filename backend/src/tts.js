// The bulletin's voice (src/bulletin.js): Azure text-to-speech makes the MP3, Cloudinary keeps it.
// Plain fetch calls, so the backend keeps mongodb as its only npm dependency.
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

// Cloudinary, from CLOUDINARY_URL (cloudinary://<api key>:<api secret>@<cloud name>). Audio files are Cloudinary
// "video" resources; they are kept under `folder`, named after their script's hash.
function cloudinary(cloudinaryUrl, folder = 'jaathiya/bulletin', { timeoutMs = 60000 } = {}) {
  const u = new URL(cloudinaryUrl);
  const key = decodeURIComponent(u.username), secret = decodeURIComponent(u.password), cloud = u.hostname;
  if (u.protocol !== 'cloudinary:' || !key || !secret || !cloud) throw new Error('CLOUDINARY_URL must look like cloudinary://<api key>:<api secret>@<cloud name>');
  const api = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}`;
  const prefix = folder.replace(/\/+$/, '') + '/';

  // Every file already in the folder: name → URL (Admin API, 500 a page)
  async function list() {
    const out = new Map();
    let cursor = '';
    do {
      const q = new URLSearchParams({ prefix, max_results: '500', ...(cursor && { next_cursor: cursor }) });
      const r = await fetch(`${api}/resources/video/upload?${q}`, { headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` }, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`Cloudinary list: HTTP ${r.status}`);
      const j = await r.json();
      for (const x of j.resources || []) if (x.public_id.startsWith(prefix)) out.set(x.public_id.slice(prefix.length), x.secure_url);
      cursor = j.next_cursor || '';
    } while (cursor);
    return out;
  }

  // A signed upload: the signature is the SHA-1 of the sorted parameters followed by the API secret
  async function upload(name, mp3) {
    const params = { public_id: prefix + name, timestamp: String(Math.floor(Date.now() / 1000)) };
    const signature = crypto.createHash('sha1').update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + secret).digest('hex');
    const form = new FormData();
    form.append('file', new Blob([mp3], { type: 'audio/mpeg' }), `${name}.mp3`);
    for (const [k, v] of Object.entries({ ...params, api_key: key, signature })) form.append(k, v);
    const r = await fetch(`${api}/video/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`Cloudinary upload: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).secure_url;
  }

  return { list, upload };
}

module.exports = { azure, cloudinary };
