// Alerts to staff mobiles when an advertising or subscription enquiry arrives.
// Provider comes from NOTIFY_PROVIDER:
//   log       (default) prints to the console only
//   smsgate   free: real SMS sent from your own Android phone's SIM by the "SMS Gateway for Android" app (sms-gate.app)
//   telegram  free: a Telegram bot message to staff chats (no SIM, no phone numbers)
//   msg91, twilio  paid SMS gateways
// Uses Node's built-in fetch, so there is no extra dependency. Never throws: callers get { ok, error }.
const fs = require('fs');
const path = require('path');

const site = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'site.json'), 'utf8'));
const KIND = { advertise: 'advertising', subscription: 'subscription' };
const OPTION = Object.fromEntries([...site.advertise.sizes, ...site.subscription.plans].map((x) => [x.key, x.name_en]));

// Indian numbers by default: "98765 43210", "098765-43210", "919876543210" and "+91 98765 43210" all become "+919876543210"
function toE164(raw) {
  const s = String(raw || '').replace(/[\s-]/g, '');
  if (/^\+\d{10,15}$/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+91' + d;
  if (d.length === 11 && d[0] === '0') return '+91' + d.slice(1);
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  return null;
}

// Staff numbers from NOTIFY_TO (comma separated); falls back to the paper's phone in config/site.json
const recipients = (env = process.env) =>
  [...new Set(String(env.NOTIFY_TO || site.phone || '').split(',').map(toE164).filter(Boolean))];

// Values for the SMS (and for MSG91 template variables). Kept short: one SMS is 160 plain characters.
function enquiryVars(e) {
  const cut = (v, n) => Array.from(String(v || '').trim()).slice(0, n).join('');
  return { kind: KIND[e.kind] || e.kind, name: cut(e.name, 30), phone: cut(e.phone, 20),
    option: cut(OPTION[e.option_key] || e.option_key || '-', 20), place: cut(e.place || '-', 25) };
}
const enquiryText = (v) => `New ${v.kind} enquiry: ${v.name}, ${v.phone}, ${v.option}, ${v.place}. ${site.name_en}`;

const providers = {
  async log({ to, text }) {
    console.log(`[notify] SMS to ${to.join(', ')}: ${text}`);
  },
  // SMS Gateway for Android: cloud mode by default; for local mode set SMSGATE_URL to http://<phone-ip>:8080
  async smsgate({ to, text, env, fetch }) {
    const base = (env.SMSGATE_URL || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/$/, '');
    const r = await fetch(base + '/message', {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${env.SMSGATE_USER}:${env.SMSGATE_PASSWORD}`).toString('base64'), 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, phoneNumbers: to }),
      signal: AbortSignal.timeout(10e3),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`SMS gateway ${r.status}: ${j.message || 'request failed'}`); }
  },
  // Telegram bot: each chat in TELEGRAM_CHAT_ID (comma separated) gets the message
  async telegram({ text, env, fetch }) {
    for (const chat of String(env.TELEGRAM_CHAT_ID).split(',').map((c) => c.trim()).filter(Boolean)) {
      const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text }),
        signal: AbortSignal.timeout(10e3),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`Telegram ${r.status} for chat ${chat}: ${j.description || 'request failed'}`); }
    }
  },
  // MSG91 Flow API. The SMS text is the DLT-approved template in MSG91; we send its variables
  // (##kind## ##name## ##phone## ##option## ##place##).
  async msg91({ to, vars, env, fetch }) {
    const r = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: env.MSG91_TEMPLATE_ID, short_url: '0', recipients: to.map((n) => ({ mobiles: n.slice(1), ...vars })) }),
      signal: AbortSignal.timeout(10e3),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.type === 'error') throw new Error(`MSG91 ${r.status}: ${j.message || 'request failed'}`);
  },
  async twilio({ to, text, env, fetch }) {
    const auth = 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    for (const n of to) {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: n, From: env.TWILIO_FROM, Body: text }),
        signal: AbortSignal.timeout(10e3),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`Twilio ${r.status} for ${n}: ${j.message || 'request failed'}`); }
    }
  },
};
const REQUIRED = { msg91: ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'], twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
  smsgate: ['SMSGATE_USER', 'SMSGATE_PASSWORD'], telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], log: [] };

// Sends the staff alert for one enquiry row. `deps` lets the test swap env and fetch.
async function enquiryAlert(e, { env = process.env, fetch = globalThis.fetch } = {}) {
  const name = env.NOTIFY_PROVIDER || 'log';
  try {
    if (!providers[name]) throw new Error(`Unknown NOTIFY_PROVIDER "${name}"`);
    const missing = REQUIRED[name].filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing ${missing.join(', ')} in .env`);
    const to = name === 'telegram' ? [] : recipients(env); // Telegram sends to chats, not phone numbers
    if (name !== 'telegram' && !to.length) throw new Error('No valid mobile number in NOTIFY_TO');
    const vars = enquiryVars(e);
    await providers[name]({ to, vars, text: enquiryText(vars), env, fetch });
    return { ok: true, provider: name };
  } catch (err) {
    return { ok: false, provider: name, error: String(err.message || err).slice(0, 300) };
  }
}

module.exports = { enquiryAlert, toE164, recipients, enquiryVars, enquiryText };
