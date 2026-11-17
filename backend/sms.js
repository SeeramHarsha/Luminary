'use strict';
// Sends one SMS through an HTTP SMS provider (Fast2SMS, MSG91, Twilio, Telinfy ... any provider that has an HTTP API).
// The request is described by environment variables, copied from the provider's own "send SMS" API sample:
//   SMS_API_URL      address, may contain placeholders, e.g. https://api.example.com/send?key={{apikey}}&to={{phone}}&text={{message}}
//   SMS_API_METHOD   GET or POST (default POST)
//   SMS_API_FORMAT   json (default) or form: how SMS_API_BODY is sent
//   SMS_API_BODY     body template, e.g. {"to":"{{phone}}","text":"{{message}}","sender":"{{sender}}","template_id":"{{template_id}}"}
//   SMS_API_HEADERS  JSON object of headers, e.g. {"Authorization":"Bearer {{apikey}}"}
//   SMS_API_KEY, SMS_SENDER, SMS_TEMPLATE_ID, SMS_ENTITY_ID, SMS_ROUTE   values for the placeholders of the same name
//   SMS_SUCCESS_MATCH  optional: text that must appear in the provider's answer for a send to count as successful (or a regular expression written between slashes, e.g. /"return"\s*:\s*true/)
//   SMS_DEFAULT_COUNTRY  country code added to 10-digit numbers (default 91)
// Placeholders: {{phone}} (digits with country code), {{phone10}}, {{phone_plus}}, {{message}}, {{sender}}, {{apikey}}, {{template_id}}, {{entity_id}}, {{route}}
//   and the values of the template's variables (for providers that take a DLT template id + values instead of the full text):
//   {{values_pipe}} (a|b|c), {{values_json}} (JSON list), {{v1}} {{v2}} ... in the order of the variables in SMS_TEXT
const env = process.env;

const configured = () => !!env.SMS_API_URL;

// 10 digits -> with country code; returns digits only, or null when it cannot be a phone number
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  const cc = String(env.SMS_DEFAULT_COUNTRY || '91').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 10 && cc) d = cc + d;
  else if (d.length === 11 && d.startsWith('0') && cc) d = cc + d.slice(1);
  return d.length >= 11 && d.length <= 15 ? d : null;
}
const maskPhone = (d) => (d ? d.slice(0, 2) + '******' + d.slice(-3) : '');

function fill(tpl, vars, mode) {
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k] == null ? '' : String(vars[k]);
    if (mode === 'url' || mode === 'form') return encodeURIComponent(v);
    if (mode === 'json') return JSON.stringify(v).slice(1, -1);
    return v;
  });
}

function matches(text) {
  const want = env.SMS_SUCCESS_MATCH;
  if (!want) return true;
  const re = /^\/(.+)\/([a-z]*)$/.exec(want);
  if (re) { try { return new RegExp(re[1], re[2]).test(text); } catch { return false; } }
  return text.includes(want);
}

async function send({ phone, message, values = [] }) {
  if (!configured()) return { ok: false, error: 'SMS is not set up yet (SMS_API_URL is missing).' };
  const to = normalizePhone(phone);
  if (!to) return { ok: false, error: 'That is not a valid phone number.' };
  const clean = values.map((v) => String(v == null ? '' : v).replace(/\|/g, '/').replace(/[\r\n]+/g, ' '));
  const vars = { values_pipe: clean.join('|'), values_json: JSON.stringify(clean), ...Object.fromEntries(clean.map((v, i) => ['v' + (i + 1), v])), phone: to, phone10: to.slice(-10), phone_plus: '+' + to, message, sender: env.SMS_SENDER || '', apikey: env.SMS_API_KEY || '', template_id: env.SMS_TEMPLATE_ID || '', entity_id: env.SMS_ENTITY_ID || '', route: env.SMS_ROUTE || '' };
  const method = String(env.SMS_API_METHOD || 'POST').toUpperCase();
  const headers = {};
  if (env.SMS_API_HEADERS) {
    let h;
    try { h = JSON.parse(env.SMS_API_HEADERS); } catch { return { ok: false, error: 'SMS_API_HEADERS is not valid JSON.' }; }
    for (const [k, v] of Object.entries(h)) headers[k] = fill(v, vars, 'plain');
  }
  let body;
  if (method !== 'GET' && env.SMS_API_BODY) {
    const form = String(env.SMS_API_FORMAT || 'json').toLowerCase() === 'form';
    body = fill(env.SMS_API_BODY, vars, form ? 'form' : 'json');
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(fill(env.SMS_API_URL, vars, 'url'), { method, headers, body, signal: ac.signal });
    const text = await res.text().catch(() => '');
    const ok = res.ok && matches(text);
    return { ok, status: res.status, response: text.slice(0, 300), to, error: ok ? null : (res.ok ? 'The SMS provider did not confirm the message.' : 'The SMS provider answered HTTP ' + res.status + '.') };
  } catch (e) {
    return { ok: false, to, error: e.name === 'AbortError' ? 'The SMS provider did not answer in time.' : 'Could not reach the SMS provider.' };
  } finally { clearTimeout(timer); }
}

module.exports = { configured, send, normalizePhone, maskPhone };
