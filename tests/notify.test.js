// Checks the enquiry SMS alert (server/notify.js) with a fake fetch, so nothing is really sent. Run: npm test
const assert = require('node:assert');
const { enquiryAlert, toE164, recipients, enquiryVars, enquiryText } = require('../server/notify.js');

(async () => {
  // phone numbers
  assert.strictEqual(toE164('98765 43210'), '+919876543210');
  assert.strictEqual(toE164('098765-43210'), '+919876543210');
  assert.strictEqual(toE164('919876543210'), '+919876543210');
  assert.strictEqual(toE164('+44 7700 900123'), '+447700900123');
  assert.strictEqual(toE164('12345'), null);
  assert.deepStrictEqual(recipients({ NOTIFY_TO: '9876543210, +919876543210,bad,9123456789' }), ['+919876543210', '+919123456789'], 'deduped, invalid dropped');
  assert.deepStrictEqual(recipients({}), ['+919989716940'], 'falls back to site.json phone');

  const e = { kind: 'subscription', name: 'రవి', phone: '9876543210', option_key: 'month', place: 'Guntur' };
  const text = enquiryText(enquiryVars(e));
  assert.strictEqual(text, 'New subscription enquiry: రవి, 9876543210, Monthly, Guntur. Jaathiya Vaartalu');

  // fake fetch records the calls
  const calls = [];
  const fake = (status, body) => async (url, o) => { calls.push({ url, ...o }); return { ok: status < 300, status, json: async () => body }; };

  // log provider (default) never calls out
  const quiet = console.log; console.log = () => {};
  assert.deepStrictEqual(await enquiryAlert(e, { env: {}, fetch: fake(200, {}) }), { ok: true, provider: 'log' });
  console.log = quiet;
  assert.strictEqual(calls.length, 0);

  // msg91: one request for all numbers, template variables, mobiles without "+"
  const m = await enquiryAlert(e, { env: { NOTIFY_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't', NOTIFY_TO: '9876543210,9123456789' }, fetch: fake(200, { type: 'success' }) });
  assert(m.ok, m.error);
  const body = JSON.parse(calls[0].body);
  assert(calls[0].url.includes('msg91.com') && calls[0].headers.authkey === 'k' && body.template_id === 't');
  assert.deepStrictEqual(body.recipients.map((r) => r.mobiles), ['919876543210', '919123456789']);
  assert.strictEqual(body.recipients[0].option, 'Monthly');
  assert.strictEqual((await enquiryAlert(e, { env: { NOTIFY_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't' }, fetch: fake(200, { type: 'error', message: 'bad template' }) })).error, 'MSG91 200: bad template');

  // twilio: one request per number, form body
  calls.length = 0;
  const tw = { NOTIFY_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'x', TWILIO_FROM: '+15550001111', NOTIFY_TO: '9876543210,9123456789' };
  assert((await enquiryAlert(e, { env: tw, fetch: fake(201, {}) })).ok);
  assert.strictEqual(calls.length, 2);
  assert(calls[0].url.endsWith('/Accounts/AC1/Messages.json') && calls[0].body.get('To') === '+919876543210' && calls[0].body.get('Body') === text);
  assert.match((await enquiryAlert(e, { env: tw, fetch: fake(401, { message: 'Authenticate' }) })).error, /Twilio 401.*Authenticate/);

  // smsgate (free, Android phone): one request, numbers in +E.164, basic auth; local URL honoured
  calls.length = 0;
  const sg = { NOTIFY_PROVIDER: 'smsgate', SMSGATE_USER: 'u', SMSGATE_PASSWORD: 'p', NOTIFY_TO: '9876543210' };
  assert((await enquiryAlert(e, { env: sg, fetch: fake(202, {}) })).ok);
  assert.strictEqual(calls[0].url, 'https://api.sms-gate.app/3rdparty/v1/message');
  assert.strictEqual(calls[0].headers.authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
  assert.deepStrictEqual(JSON.parse(calls[0].body), { message: text, phoneNumbers: ['+919876543210'] });
  assert((await enquiryAlert(e, { env: { ...sg, SMSGATE_URL: 'http://192.168.1.5:8080/' }, fetch: fake(202, {}) })).ok);
  assert.strictEqual(calls[1].url, 'http://192.168.1.5:8080/message');
  assert.match((await enquiryAlert(e, { env: sg, fetch: fake(401, { message: 'Unauthorized' }) })).error, /SMS gateway 401: Unauthorized/);

  // telegram (free): one request per chat, no phone numbers needed
  calls.length = 0;
  const tg = { NOTIFY_PROVIDER: 'telegram', TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '111, 222', NOTIFY_TO: 'not-a-number' };
  assert((await enquiryAlert(e, { env: tg, fetch: fake(200, { ok: true }) })).ok);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].url, 'https://api.telegram.org/bot123:abc/sendMessage');
  assert.deepStrictEqual(JSON.parse(calls[1].body), { chat_id: '222', text });
  assert.match((await enquiryAlert(e, { env: tg, fetch: fake(400, { description: 'chat not found' }) })).error, /Telegram 400 for chat 111: chat not found/);

  // failures are reported, never thrown
  assert.match((await enquiryAlert(e, { env: { NOTIFY_PROVIDER: 'twilio' } })).error, /Missing TWILIO_ACCOUNT_SID/);
  assert.match((await enquiryAlert(e, { env: { NOTIFY_PROVIDER: 'pigeon' } })).error, /Unknown NOTIFY_PROVIDER/);
  assert.match((await enquiryAlert(e, { env: { NOTIFY_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't' }, fetch: async () => { throw new Error('network down'); } })).error, /network down/);

  console.log('all notify checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
