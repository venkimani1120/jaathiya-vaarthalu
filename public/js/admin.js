const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const j = async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'లోపం జరిగింది'); return d; };
const get = (u) => fetch(u).then(j);
const put = (u, b) => fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(j);
const del = (u) => fetch(u, { method: 'DELETE' }).then(j);
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(j);
const TABS = () => [['list', 'వార్తలు'], ['new', 'కొత్త వార్త'],
  ...(me.role !== 'reporter' ? [['paper', 'ఈ-పేపర్ అప్‌లోడ్'], ['cats', 'విభాగాలు'], ['ads', 'ప్రకటనలు'], ['enq', 'విచారణలు'], ['wa', 'వాట్సాప్']] : []),
  ...(me.role === 'admin' ? [['users', 'వినియోగదారులు'], ['subs', 'సబ్‌స్క్రైబర్లు'], ['audit', 'ఆడిట్ లాగ్']] : [])];
const ROLE = { admin: 'అడ్మిన్', editor: 'ఎడిటర్', reporter: 'రిపోర్టర్' };
const tbl = (l, f) => (l.length ? l.map(f).join('') : '<p>ఇంకా ఏమీ లేవు.</p>');
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (x) { msg(x.message, true); } };
const frame = (form) => { $('#view').innerHTML = `<p id="msg" class="msg" hidden role="status"></p>${form}<div id="rows"></div>`; };
const STATUS = { draft: 'డ్రాఫ్ట్', scheduled: 'షెడ్యూల్ చేయబడింది', published: 'ప్రచురితం' };
let me = null;

const msg = (t, err) => { const m = $('#msg'); m.className = 'msg' + (err ? ' err' : ''); m.textContent = t; m.hidden = false; };

function loginView() {
  $('#root').innerHTML = `<form class="login form" id="lf"><h1>లాగిన్</h1>
    <label for="em">ఇమెయిల్</label><input id="em" type="email" autocomplete="username" required>
    <label for="pw">పాస్‌వర్డ్</label><input id="pw" type="password" autocomplete="current-password" required>
    <div class="actions"><button>లాగిన్</button></div><p id="msg" class="msg" hidden role="status"></p></form>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { me = await post('/api/auth/login', { email: $('#em').value, password: $('#pw').value }); shell(); }
    catch (x) { msg(x.message, true); }
  };
}

function shell() {
  const canPublish = me.role !== 'reporter';
  $('#root').innerHTML = `<div class="bar"><img src="/logo.png" alt="జాతియ వార్తలు"><span>${esc(me.name)} <button id="out" class="alt" style="background:none;color:inherit;border:1px solid var(--line)">లాగ్ అవుట్</button></span></div>
    <div class="tabs">${TABS().map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div>
    <main id="view"></main>`;
  $('#out').onclick = async () => { await post('/api/auth/logout', {}); loginView(); };
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => view(b.dataset.v)));
  view('list');
}

async function view(v) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === v));
  ({ list: listView, new: newView, paper: paperView, cats: catView, ads: adsView, enq: enqView, wa: waView, users: usersView, subs: subsView, audit: auditView })[v]();
}

async function listView() {
  $('#view').innerHTML = '<p id="msg" class="msg" hidden role="status"></p><div id="rows"></div>';
  const rows = await get('/api/admin/articles').catch((e) => (msg(e.message, true), []));
  $('#rows').innerHTML = rows.length ? rows.map((a) => `<div class="arow"><div><b>${esc(a.title)}</b><br><span class="st ${a.status === 'published' ? 'pub' : ''}">${STATUS[a.status]}</span></div>
    <div>${me.role !== 'reporter' || a.status === 'draft' ? `<button class="alt" data-edit="${a.id}">సవరించండి</button>` : ''}${a.status !== 'published' && me.role !== 'reporter' ? `<button data-id="${a.id}">ప్రచురించండి</button>` : ''}</div></div>`).join('') : '<p>ఇంకా వార్తలు లేవు. "కొత్త వార్త" నొక్కండి.</p>';
  $('#rows').onclick = async (e) => {
    if (e.target.dataset.edit) return newView(e.target.dataset.edit);
    if (!e.target.dataset.id) return;
    try { await post(`/api/admin/articles/${e.target.dataset.id}/publish`, {}); await listView(); msg('ప్రచురించబడింది'); }
    catch (x) { msg(x.message, true); }
  };
}

async function newView(id) {
  const [cats, a] = await Promise.all([get('/api/categories'), id ? get('/api/admin/articles/' + id) : {}]);
  let img = a.image_path || '';
  const canPublish = me.role !== 'reporter';
  const btns = id
    ? `<button type="button" id="sv">మార్పులు సేవ్ చేయండి</button>${canPublish && a.status !== 'published' ? '<button type="button" id="pub" class="alt">ప్రచురించండి</button>' : ''}${canPublish && a.status === 'published' ? '<button type="button" id="dr" class="alt">డ్రాఫ్ట్‌గా మార్చండి</button>' : ''}<button type="button" id="del" class="alt">తొలగించండి</button>`
    : `${canPublish ? '<button type="button" id="pub">ప్రచురించండి</button>' : ''}<button type="button" id="dr" class="alt">డ్రాఫ్ట్‌గా సేవ్ చేయండి</button>`;
  $('#view').innerHTML = `<form class="form" id="nf"><p id="msg" class="msg" hidden role="status"></p>
    <label for="title">శీర్షిక</label><input id="title" required value="${esc(a.title)}">
    <label for="summary">సారాంశం</label><textarea id="summary" rows="2">${esc(a.summary)}</textarea>
    <label>వార్త పాఠ్యం</label>
    <div class="tools"><button type="button" class="alt" data-c="bold"><b>B</b></button><button type="button" class="alt" data-c="formatBlock" data-a="h2">శీర్షిక</button><button type="button" class="alt" data-c="insertUnorderedList">జాబితా</button><button type="button" class="alt" data-c="createLink">లింక్</button></div>
    <div id="body" class="editor" contenteditable="true" role="textbox" aria-multiline="true">${a.body || ''}</div>
    <label for="file">చిత్రం</label><input id="file" type="file" accept="image/jpeg,image/png,image/webp"><img id="pv" class="preview" alt="" ${img ? `src="${esc(img)}"` : 'hidden'}>
    <label for="cat">విభాగం</label><select id="cat"><option value="">ఎంచుకోండి</option>${cats.map((c) => `<option value="${c.id}" ${c.id === a.category_id ? 'selected' : ''}>${esc(c.name_en || c.name_te)}</option>`).join('')}</select>
    <label><input id="brk" type="checkbox" ${a.is_breaking ? 'checked' : ''}> బ్రేకింగ్ న్యూస్</label>
    ${canPublish && a.status !== 'published' ? '<label for="when">ప్రచురణ సమయం (ఖాళీగా వదిలితే ఇప్పుడే)</label><input id="when" type="datetime-local">' : ''}
    <div class="actions">${btns}</div></form>`;
  document.querySelector('.tools').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const url = b.dataset.c === 'createLink' ? prompt('లింక్ చిరునామా (https://...)') : b.dataset.a;
    if (b.dataset.c !== 'createLink' || url) document.execCommand(b.dataset.c, false, url);
  };
  $('#file').onchange = async () => {
    const f = $('#file').files[0]; if (!f) return;
    const fd = new FormData(); fd.append('image', f);
    try { img = (await fetch('/api/admin/upload', { method: 'POST', body: fd }).then(j)).path; $('#pv').src = img; $('#pv').hidden = false; }
    catch (x) { msg(x.message, true); }
  };
  const save = async (action) => { // action: publish | draft | save
    const title = $('#title').value.trim();
    if (!title || !$('#body').textContent.trim()) return msg('శీర్షిక మరియు వార్త పాఠ్యం అవసరం', true);
    const data = { title, summary: $('#summary').value, body: $('#body').innerHTML, image_path: img || null, category_id: +$('#cat').value || null, is_breaking: $('#brk').checked, action,
      publish_at: action === 'publish' ? new Date(($('#when') || {}).value || Date.now()).toISOString() : undefined };
    try {
      const r = id ? await put('/api/admin/articles/' + id, data) : await post('/api/admin/articles', data);
      const text = action === 'save' ? 'మార్పులు సేవ్ అయ్యాయి' : r.status === 'published' ? 'ప్రచురించబడింది' : r.status === 'scheduled' ? 'షెడ్యూల్ చేయబడింది' : 'డ్రాఫ్ట్ సేవ్ అయింది';
      if (id) view('list'); else await newView();
      msg(text);
    } catch (x) { msg(x.message, true); }
  };
  if ($('#pub')) $('#pub').onclick = () => save('publish');
  if ($('#dr')) $('#dr').onclick = () => save('draft');
  if ($('#sv')) $('#sv').onclick = () => save('save');
  if ($('#del')) $('#del').onclick = async () => {
    if (!confirm('ఈ వార్తను శాశ్వతంగా తొలగించాలా?')) return;
    try { await del('/api/admin/articles/' + id); view('list'); msg('తొలగించబడింది'); } catch (x) { msg(x.message, true); }
  };
}

async function catView() {
  const load = async () => {
    $('#rows').innerHTML = tbl(await get('/api/categories'), (c) => `<div class="arow" data-id="${c.id}"><input class="ne" value="${esc(c.name_en || c.name_te)}" aria-label="పేరు (ఇంగ్లీష్)" required><input class="nt" value="${c.name_te !== c.name_en ? esc(c.name_te) : ''}" aria-label="పేరు (తెలుగు)" placeholder="తెలుగు పేరు"><input class="o" type="number" value="${c.sort_order}" aria-label="క్రమం" style="width:4.5rem"><span class="st">${esc(c.slug)}</span><div><button data-a="save">సేవ్ చేయండి</button><button class="alt" data-a="del">తొలగించండి</button></div></div>`);
  };
  frame(`<form class="form" id="cf"><label for="ce">పేరు (ఇంగ్లీష్‌లో, ఉదా. Sports)</label><input id="ce" required><label for="ct">తెలుగు పేరు (ఐచ్ఛికం, ఉదా. క్రీడలు; ఖాళీగా వదిలితే ఇంగ్లీష్ పేరు చూపిస్తుంది)</label><input id="ct"><label for="cs">స్లగ్ (ఇంగ్లీష్ అక్షరాలు, ఉదా. sports)</label><input id="cs" pattern="[a-z0-9\\-]*"><div class="actions"><button>జోడించండి</button></div></form>`);
  $('#cf').onsubmit = guard(async (e) => { e.preventDefault(); await post('/api/admin/categories', { name_en: $('#ce').value, name_te: $('#ct').value, slug: $('#cs').value }); $('#cf').reset(); await load(); msg('జోడించబడింది'); });
  $('#rows').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = b.closest('.arow'), id = r.dataset.id;
    if (b.dataset.a === 'save') { await put('/api/admin/categories/' + id, { name_en: r.querySelector('.ne').value, name_te: r.querySelector('.nt').value, sort_order: +r.querySelector('.o').value }); msg('సేవ్ అయింది'); }
    else if (confirm('ఈ విభాగాన్ని తొలగించాలా?')) { await del('/api/admin/categories/' + id); await load(); msg('తొలగించబడింది'); }
  });
  await load();
}

async function adsView() {
  const load = async () => {
    $('#rows').innerHTML = tbl(await get('/api/admin/ads'), (a) => `<div class="arow" data-id="${a.id}" data-act="${a.active}"><img src="${esc(a.image_path)}" alt=""><span class="st">${esc(a.link_url || 'లింక్ లేదు')}<br>${esc(a.start_date || '')} ${esc(a.end_date || '')}</span><div><button class="alt" data-a="tog">${a.active ? 'ఆపండి' : 'ప్రారంభించండి'}</button><button class="alt" data-a="del">తొలగించండి</button></div></div>`);
  };
  frame(`<form class="form" id="af"><label for="ai">చిత్రం</label><input id="ai" name="image" type="file" accept="image/jpeg,image/png,image/webp" required>
    <label for="al">లింక్ (https://...)</label><input id="al" name="link_url" type="url"><label for="as">ప్రారంభ తేదీ</label><input id="as" name="start_date" type="date"><label for="ae">ముగింపు తేదీ</label><input id="ae" name="end_date" type="date">
    <div class="actions"><button>జోడించండి</button></div></form>`);
  $('#af').onsubmit = guard(async (e) => { e.preventDefault(); await fetch('/api/admin/ads', { method: 'POST', body: new FormData($('#af')) }).then(j); $('#af').reset(); await load(); msg('జోడించబడింది'); });
  $('#rows').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = b.closest('.arow'), id = r.dataset.id;
    if (b.dataset.a === 'tog') { await put('/api/admin/ads/' + id, { active: r.dataset.act !== '1' }); await load(); msg('సేవ్ అయింది'); }
    else if (confirm('ఈ ప్రకటనను తొలగించాలా?')) { await del('/api/admin/ads/' + id); await load(); msg('తొలగించబడింది'); }
  });
  await load();
}

async function enqView() {
  const site = await get('/api/site');
  const opt = Object.fromEntries([...site.advertise.sizes, ...site.subscription.plans].map((x) => [x.key, x.name_te]));
  const KIND = { advertise: 'ప్రకటన', subscription: 'చందా' };
  // SMS / Telegram alert to staff (server/notify.js); rows from before the alert existed have no status
  const SMS = { sent: 'సందేశం పంపబడింది', logged: 'సందేశం సెటప్ చేయలేదు', failed: 'సందేశం విఫలమైంది' };
  const sms = (q) => (q.notify_status ? ` · <span title="${esc(q.notify_error || '')}">${SMS[q.notify_status] || esc(q.notify_status)}</span>` : '');
  const load = async () => {
    $('#rows').innerHTML = tbl(await get('/api/admin/enquiries'), (q) => `<div class="arow" data-id="${q.id}" data-st="${q.status}"><span><b>${esc(q.name)}</b> · <a href="tel:${esc(q.phone)}">${esc(q.phone)}</a>${q.email ? ` · ${esc(q.email)}` : ''}<br>
      <span class="st ${q.status === 'done' ? 'pub' : ''}">${KIND[q.kind]}: ${esc(opt[q.option_key] || q.option_key || '-')}${q.place ? ` · ${esc(q.place)}` : ''} · ${esc(q.created_at)} UTC · ${q.status === 'done' ? 'పూర్తయింది' : 'కొత్తది'}${sms(q)}</span>${q.message ? `<br>${esc(q.message)}` : ''}</span>
      <div><button class="alt" data-a="tog">${q.status === 'done' ? 'కొత్తదిగా మార్చండి' : 'పూర్తయింది'}</button><button class="alt" data-a="del">తొలగించండి</button></div></div>`);
  };
  frame('');
  $('#rows').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = b.closest('.arow'), id = r.dataset.id;
    if (b.dataset.a === 'tog') { await put('/api/admin/enquiries/' + id, { status: r.dataset.st === 'done' ? 'new' : 'done' }); await load(); msg('సేవ్ అయింది'); }
    else if (confirm('ఈ విచారణను తొలగించాలా?')) { await del('/api/admin/enquiries/' + id); await load(); msg('తొలగించబడింది'); }
  });
  await load();
}

// WhatsApp group feed: messages pulled from the groups and the drafts made from them (server/whatsapp.js)
async function waView() {
  const WST = { draft: 'డ్రాఫ్ట్ అయింది', image: 'ఫోటో', skipped: 'వదిలేశాం' };
  const load = async () => {
    const d = await get('/api/admin/whatsapp');
    const last = d.last ? `చివరిగా తెచ్చింది: ${esc(new Date(d.last.at).toLocaleString('te-IN'))} · కొత్త డ్రాఫ్ట్‌లు ${d.last.drafts}${d.last.errors.length ? ` · <b>లోపం:</b> ${esc(d.last.errors.join('; '))}` : ''}` : 'ఇంకా తేలేదు';
    $('#wahead').innerHTML = d.enabled ? `<p>గ్రూపులు: ${d.groups.map(esc).join(', ')}<br>${last}</p><div class="actions"><button id="pull">ఇప్పుడే తెచ్చు</button></div>`
      : '<p>వాట్సాప్ ఫీడ్ ఆన్ చేయలేదు. .env లో WAHA_URL, WHATSAPP_GROUPS ఇవ్వండి (README చూడండి).</p>';
    $('#rows').innerHTML = tbl(d.messages, (m) => `<div class="arow"><span><b>${esc(m.sender_name || m.sender || '-')}</b> · ${esc(m.sent_at)} UTC · <span class="st ${m.status === 'draft' ? 'pub' : ''}">${WST[m.status]}</span>${m.title ? ` → ${esc(m.title)} (${STATUS[m.article_status] || ''})` : ''}<br>${esc((m.text || '').slice(0, 200))}</span>
      <div>${m.article_id && (m.article_status === 'draft' || me.role !== 'reporter') ? `<button class="alt" data-edit="${m.article_id}">సవరించండి</button>` : ''}</div></div>`);
  };
  frame('<div id="wahead"></div>');
  $('#rows').onclick = (e) => { if (e.target.dataset.edit) newView(e.target.dataset.edit); };
  $('#wahead').onclick = guard(async (e) => {
    if (e.target.id !== 'pull') return;
    const r = await post('/api/admin/whatsapp/pull', {}); await load(); msg(r.busy ? 'ఇప్పటికే తెస్తోంది' : `${r.drafts} కొత్త డ్రాఫ్ట్‌లు`);
  });
  await load();
}

async function usersView() {
  const opts = (sel) => Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  const load = async () => {
    $('#rows').innerHTML = tbl(await get('/api/admin/users'), (u) => `<div class="arow" data-id="${u.id}"><span><b>${esc(u.name)}</b><br><span class="st">${esc(u.email)}</span></span>
      <select class="r" aria-label="పాత్ర" ${u.id === me.id ? 'disabled' : ''}>${opts(u.role)}</select><input class="p" type="password" minlength="8" placeholder="కొత్త పాస్‌వర్డ్ (ఐచ్ఛికం)" autocomplete="new-password">
      <div><button data-a="save">సేవ్ చేయండి</button>${u.id === me.id ? '' : '<button class="alt" data-a="del">తొలగించండి</button>'}</div></div>`);
  };
  frame(`<form class="form" id="uf"><label for="un">పేరు</label><input id="un" required><label for="ue">ఇమెయిల్</label><input id="ue" type="email" required>
    <label for="up">పాస్‌వర్డ్ (కనీసం 8 అక్షరాలు)</label><input id="up" type="password" minlength="8" required autocomplete="new-password"><label for="ur">పాత్ర</label><select id="ur">${opts('reporter')}</select>
    <div class="actions"><button>జోడించండి</button></div></form>`);
  $('#uf').onsubmit = guard(async (e) => { e.preventDefault(); await post('/api/admin/users', { name: $('#un').value, email: $('#ue').value, password: $('#up').value, role: $('#ur').value }); $('#uf').reset(); await load(); msg('జోడించబడింది'); });
  $('#rows').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = b.closest('.arow'), id = r.dataset.id;
    if (b.dataset.a === 'save') { await put('/api/admin/users/' + id, { role: r.querySelector('.r').value, password: r.querySelector('.p').value || undefined }); r.querySelector('.p').value = ''; msg('సేవ్ అయింది'); }
    else if (confirm('ఈ వినియోగదారుని తొలగించాలా?')) { await del('/api/admin/users/' + id); await load(); msg('తొలగించబడింది'); }
  });
  await load();
}

async function subsView() {
  const load = async () => {
    const l = await get('/api/admin/subscribers');
    $('#rows').innerHTML = `<p>మొత్తం: ${l.length}</p>` + tbl(l, (s) => `<div class="arow" data-id="${s.id}"><span>${esc(s.email)}<br><span class="st">${esc(s.subscribed_at)}</span></span><button class="alt" data-a="del">తొలగించండి</button></div>`);
  };
  frame('<p><a class="btn" href="/api/admin/subscribers.csv">CSV డౌన్‌లోడ్</a></p>');
  $('#rows').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b || !confirm('ఈ చందాదారుని తొలగించాలా?')) return;
    await del('/api/admin/subscribers/' + b.closest('.arow').dataset.id); await load(); msg('తొలగించబడింది');
  });
  await load();
}

async function auditView() {
  frame('');
  $('#rows').innerHTML = tbl(await get('/api/admin/audit'), (r) => `<div class="arow"><span><b>${esc(r.name || '-')}</b> ${esc(r.action)} ${esc(r.entity)} #${esc(r.entity_id)}</span><span class="st">${esc(r.at)} UTC</span></div>`);
}

function paperView() {
  $('#view').innerHTML = `<form class="form" id="pf"><p id="msg" class="msg" hidden role="status"></p>
    <label for="d">తేదీ</label><input id="d" type="date" required value="${new Date().toISOString().slice(0, 10)}">
    <label for="e">సంచిక పేరు</label><input id="e" value="Main">
    <label for="p">PDF ఫైల్ (50 MB వరకు)</label><input id="p" type="file" accept="application/pdf" required>
    <div class="actions"><button>అప్‌లోడ్ చేయండి</button></div></form>`;
  $('#pf').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(); fd.append('date', $('#d').value); fd.append('edition', $('#e').value); fd.append('pdf', $('#p').files[0]);
    try { const r = await fetch('/api/admin/epaper', { method: 'POST', body: fd }).then(j); $('#p').value = ''; msg(r.thumb ? 'ఈ-పేపర్ అప్‌లోడ్ అయింది' : 'ఈ-పేపర్ అప్‌లోడ్ అయింది, కానీ థంబ్‌నెయిల్ తయారు కాలేదు'); }
    catch (x) { msg(x.message, true); }
  };
}

get('/api/auth/me').then((u) => { me = u; shell(); }).catch(loginView);
