'use strict';
(() => {
  const $app = document.getElementById('app');
  const S = { me: null, catalog: null, admin: null, adminTab: 'models', q: '' };
  const MEDIA_CACHE = 'lm-media';

  // ---------- tiny helpers ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  }
  const ICON = {
    download: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.8 3.8-5.6 7-5.6s6.2 1.8 7 5.6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  const icon = (n) => h('span', { html: `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`, style: 'display:contents' });
  const svg = (n) => `<svg viewBox="0 0 24 24">${ICON[n]}</svg>`;
  const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e5 ? (b / 1e6).toFixed(b >= 1e7 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');

  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 3200);
  }
  async function api(url, opt = {}) {
    const init = { credentials: 'same-origin', method: opt.method || 'GET', headers: {} };
    try {
      const savedQr = localStorage.getItem('lm_qr');
      if (savedQr) init.headers['x-qr-code'] = savedQr;
    } catch {}
    if (opt.body instanceof FormData) init.body = opt.body;
    else if (opt.body !== undefined) { init.body = JSON.stringify(opt.body); init.headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(url, init); } catch { throw new Error('You are offline.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.error || 'Something went wrong.');
      e.status = r.status;
      throw e;
    }
    return data;
  }
  const wipeDataCache = () => (window.caches ? caches.delete('lm-data') : Promise.resolve());

  function modal(build) {
    const close = () => scrim.remove();
    const box = h('div', { class: 'sheetbox', role: 'dialog' });
    const scrim = h('div', { class: 'scrim', onclick: (e) => e.target === scrim && close() }, box);
    build(box, close);
    document.body.append(scrim);
    return close;
  }

  // ---------- brand ----------
  function logo(cls = '') {
    const c = S.catalog;
    if (c && c.logo) return h('img', { class: 'logo-img ' + cls, src: c.logo + '?v=' + c.logoV, alt: 'Luminary', onerror: (e) => e.target.replaceWith(h('span', { class: 'wordmark' }, 'Luminary')) });
    return h('span', { class: 'wordmark' }, 'Luminary');
  }
  const footer = () => h('footer', { class: 'footer' }, h('span', {}, 'A BotClub product'));

  // ---------- offline manager ----------
  const offline = {
    quality() { try { return localStorage.getItem('lm_oq') || 'mid'; } catch { return 'mid'; } },
    // what "save for offline" stores: folder images, thumbnails, and ONE quality of each video
    list() {
      const out = [];
      const c = S.catalog;
      if (!c) return out;
      const want = { low: 0, mid: 1, high: 2 }[this.quality()];
      for (const m of c.models) {
        if (m.image) out.push({ url: m.image.url, size: m.image.size || 0, label: `${m.name} · image` });
        for (const k of ['working', 'assembly']) {
          const v = m[k];
          if (!v) continue;
          if (v.poster) out.push({ url: v.poster, size: 20000, label: `${m.name} · thumbnail` });
          const rs = [...v.renditions].sort((a, b) => a.h - b.h);
          let pick = rs[0];
          for (const r of rs) if ({ low: 0, mid: 1, high: 2 }[r.q] <= want) pick = r;
          if (pick) out.push({ url: pick.url, size: pick.size || 0, label: `${m.name} · ${k} video` });
        }
      }
      if (c.logo) out.push({ url: c.logo, size: 0, label: 'logo' });
      return out;
    },
    async status() {
      if (!window.caches) return { supported: false, list: [], missing: [], total: 0, missingBytes: 0 };
      const cache = await caches.open(MEDIA_CACHE);
      const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
      const list = this.list();
      const missing = list.filter((x) => !have.has(x.url));
      return { supported: true, list, missing, have, total: list.reduce((a, x) => a + x.size, 0), missingBytes: missing.reduce((a, x) => a + x.size, 0) };
    },
    async prune() {
      if (!window.caches) return;
      const cache = await caches.open(MEDIA_CACHE);
      // keep what is wanted, plus any video quality the visitor already saved (it costs them nothing to keep)
      const keep = new Set(this.list().map((x) => x.url));
      const known = new Set();
      for (const m of S.catalog.models) for (const k of ['working', 'assembly']) if (m[k]) m[k].renditions.forEach((r) => known.add(r.url));
      for (const r of await cache.keys()) {
        const p = new URL(r.url).pathname;
        if (!keep.has(p) && !known.has(p)) await cache.delete(r);
      }
      // a rendition of the same video that is no longer wanted is dropped only if a wanted one is present
      const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
      for (const m of S.catalog.models) for (const k of ['working', 'assembly']) {
        const v = m[k];
        if (!v) continue;
        const wanted = v.renditions.filter((r) => keep.has(r.url));
        if (wanted.length && wanted.every((r) => have.has(r.url))) for (const r of v.renditions) if (!keep.has(r.url)) await cache.delete(r.url);
      }
    },
    async download(items, onProgress, signal) {
      const cache = await caches.open(MEDIA_CACHE);
      const total = items.reduce((a, x) => a + x.size, 0) || 1;
      let done = 0;
      for (const it of items) {
        const res = await fetch(it.url, { credentials: 'same-origin', signal });
        if (!res.ok) throw new Error(`Could not download ${it.label}`);
        const type = res.headers.get('Content-Type') || 'application/octet-stream';
        const chunks = [];
        let got = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          chunks.push(value);
          got += value.length;
          onProgress(Math.min(1, (done + got) / total), it.label);
        }
        const blob = new Blob(chunks, { type });
        await cache.put(it.url, new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(blob.size) } }));
        done += it.size || got;
      }
      localStorage.setItem('lm_offline', '1');
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    },
    async clear() { await caches.delete(MEDIA_CACHE); localStorage.removeItem('lm_offline'); },
  };

  async function offlineSheet() {
    modal(async (box, close) => {
      box.append(h('h2', {}, 'Offline access'));
      const body = h('div', {}, h('p', { class: 'muted' }, 'Checking…'));
      box.append(body);
      const render = async () => {
        const st = await offline.status();
        body.replaceChildren();
        if (!st.supported) return body.append(h('p', { class: 'muted' }, 'This browser cannot save content for offline use.'));
        const ready = st.missing.length === 0 && st.list.length > 0;
        const got = st.list.length - st.missing.length;
        let est = '';
        try { const e = await navigator.storage.estimate(); est = ` · ${mb(e.usage || 0)} of ${mb(e.quota || 0)} used on this device`; } catch {}
        const oq = offline.quality();
        const qseg = h('div', { class: 'seg', style: 'margin-bottom:14px' }, [['low', 'Data saver'], ['mid', 'Standard'], ['high', 'HD']].map(([k, n]) => h('button', { class: k === oq ? 'on' : '', onclick: () => { try { localStorage.setItem('lm_oq', k); } catch {} render(); updateOfflineDot(); } }, n)));
        body.append(qseg,
          h('p', { class: 'lead' }, ready ? 'Everything you can open is saved on this device. It will open without internet, even when you scan the QR again.' : 'Save every unlocked model, picture and video to this device so it opens instantly with no internet.'),
          h('div', { class: 'row wrap', style: 'margin-bottom:14px' },
            h('span', { class: 'chip ' + (ready ? 'ok' : '') }, ready ? 'Saved for offline' : `${got} of ${st.list.length} files saved`),
            h('span', { class: 'muted small' }, ready ? mb(st.total) + est : `${mb(st.missingBytes)} to download${est}`)),
        );
        const bar = h('div', { class: 'bar', hidden: true }, h('i'));
        const msg = h('p', { class: 'muted small', style: 'min-height:20px' });
        const go = h('button', { class: 'btn primary', style: 'width:100%' }, ready ? 'Up to date' : got ? 'Download the rest' : 'Download everything');
        go.disabled = ready;
        go.onclick = async () => {
          go.disabled = true; bar.hidden = false;
          try {
            await offline.download(st.missing, (p, label) => { bar.firstChild.style.width = p * 100 + '%'; msg.textContent = label; });
            toast('Saved for offline use');
            render(); updateOfflineDot();
          } catch (e) { msg.textContent = ''; toast(e.message || 'Download failed', true); go.disabled = false; }
        };
        body.append(go, h('div', { style: 'height:10px' }), bar, msg);
        if (got) body.append(h('button', { class: 'btn danger sm', onclick: async () => { await offline.clear(); toast('Offline copy removed'); render(); updateOfflineDot(); } }, 'Remove offline copy'));
      };
      render();
      box.append(h('div', { style: 'height:14px' }), h('button', { class: 'btn', style: 'width:100%', onclick: close }, 'Close'));
    });
  }
  async function updateOfflineDot() {
    const d = document.getElementById('offdot');
    if (!d) return;
    const st = await offline.status();
    d.hidden = !st.supported;
    d.className = 'dot' + (st.missing.length ? ' warn' : '');
  }

  // ---------- auth / boot ----------
  async function loadMe() {
    try { S.me = await api('/api/me'); } catch { S.me = { role: 'viewer', via: 'guest' }; }
    return S.me;
  }
  async function loadCatalog() {
    S.catalog = await api('/api/catalog');
    return S.catalog;
  }
  async function logout() {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    await wipeDataCache();
    try { localStorage.removeItem('lm_qr'); } catch {}
    S.admin = null;
    S.catalog = null;
    await loadMe();
    location.hash = '#/';
    route();
  }

  // ---------- school code screen ----------
  function schoolGate(note) {
    const err = h('div', { class: 'err' }, note || '');
    const input = h('input', { class: 'input', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'off', placeholder: '0000', 'aria-label': 'School code', required: true, style: 'text-align:center;font-size:30px;letter-spacing:.45em;padding-left:.45em' });
    const btn = h('button', { class: 'btn primary', style: 'width:100%', type: 'submit' }, 'Continue');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!/^\d{4}$/.test(input.value)) { err.textContent = 'Please enter the 4-digit code of your school.'; return; }
        btn.disabled = true; err.textContent = '';
        try {
          const d = await api('/api/school', { method: 'POST', body: { code: input.value } });
          await wipeDataCache();
          try { localStorage.setItem('lm_qr', d.code); } catch {}
          await loadMe();
          await loadCatalog();
          startTracking();
          location.hash = '#/';
          route();
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; input.value = ''; input.focus(); }
      },
    }, h('label', { class: 'field' }, h('span', {}, 'School code'), input), err, btn);
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); if (input.value.length === 4) btn.click(); });
    $app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box' },
      logo(),
      h('h2', { style: 'margin:14px 0 6px' }, 'Enter your school code'),
      h('p', { class: 'lead' }, 'Ask your teacher for the 4-digit code of your school.'),
      form,
      h('p', { class: 'muted small', style: 'text-align:center;margin-top:16px' }, h('a', { href: '#/login' }, 'Admin sign in')),
      footer())));
    setTimeout(() => input.focus(), 50);
  }

  function adminLoginView(note) {
    const err = h('div', { class: 'err' }, note || '');
    const user = h('input', { class: 'input', autocomplete: 'username', autocapitalize: 'none', value: 'admin', required: true });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary', style: 'width:100%', type: 'submit' }, 'Sign in as Admin');
    const backBtn = h('button', { class: 'btn', type: 'button', style: 'width:100%;margin-top:10px', onclick: () => { location.hash = '#/'; } }, 'Back to library');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; err.textContent = '';
        try {
          await wipeDataCache();
          await api('/api/login', { method: 'POST', body: { username: user.value, password: pass.value, role: 'admin' } });
          await loadMe();
          await loadCatalog();
          location.hash = '#/admin';
          route();
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      },
    },
      h('label', { class: 'field' }, h('span', {}, 'Username'), user),
      h('label', { class: 'field' }, h('span', {}, 'Password'), pass), err, btn, backBtn);
    $app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box' },
      logo(),
      h('h2', { style: 'margin:14px 0 6px' }, 'Admin Sign In'),
      h('p', { class: 'lead' }, 'Sign in to access the administrator panel.'),
      form, footer())));
  }

  // ---------- views ----------
  function header(extra) {
    return h('header', { class: 'top' },
      h('a', { class: 'brand', href: '#/', 'aria-label': 'Luminary home' }, logo()),
      extra,
      h('button', { class: 'icon-btn', 'aria-label': 'Offline access', onclick: offlineSheet }, icon('download'), h('i', { id: 'offdot', class: 'dot', hidden: true })),
      h('button', { class: 'icon-btn', 'aria-label': 'Account', onclick: accountSheet }, icon('user')));
  }
  function accountSheet() {
    const m = S.me || { role: 'viewer', via: 'guest' };
    modal((box, close) => {
      const isAdmin = m.role === 'admin';
      const isStaff = isAdmin || m.role === 'editor';
      const isQr = m.via === 'qr';
      box.append(...[
        h('h2', {}, isStaff ? (m.name || 'Admin') : isQr ? 'School access' : 'Not signed in'),
        h('p', { class: 'muted' }, isAdmin ? 'Signed in as Administrator' : isStaff ? 'Editor access: you can upload and manage models' : isQr ? `School: ${m.profile?.label || 'Custom'}` : 'Browsing all models · No login required'),
        S.catalog && S.catalog.models.some((x) => x.plan) ? h('a', { class: 'btn sm', style: 'width:100%;margin-bottom:10px', href: '#/plan', onclick: close }, 'View calendar') : null,
        isStaff ? h('a', { class: 'btn primary', style: 'width:100%;margin-bottom:10px', href: '#/admin', onclick: close }, isAdmin ? 'Open admin panel' : 'Manage models') : null,
        isAdmin
          ? h('button', { class: 'btn danger sm', style: 'width:100%;margin-bottom:10px', onclick: async () => { close(); await logout(); } }, 'Sign out')
          : h('a', { class: 'btn sm', style: 'width:100%;margin-bottom:10px', href: '#/admin', onclick: close }, 'Admin sign in'),
        isQr ? h('button', { class: 'btn sm', style: 'width:100%;margin-bottom:10px', onclick: async () => { try { localStorage.removeItem('lm_qr'); } catch {} close(); await logout(); toast('Signed out of the school'); } }, 'Use a different school code') : null,
        h('button', { class: 'btn sm', style: 'width:100%', onclick: close }, 'Close')].filter(Boolean)); // native append() would print "null" for empty items
    });
  }

  // ---------- calendar page: same layout as the school's PDF (month by month: grade, chapter, type, line, models, what happens, slot) ----------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const CAL_ST = { done: ['Done', '#2fbf71'], early: ['Done early', '#2fbf71'], late: ['Done late', '#ff8a3d'], due: ['Due now', '#f5a524'], upcoming: ['Upcoming', '#7a8cff'], missed: ['Delayed', '#ff5d6c'] };
  const TYPE_COL = { revision: '#6aa5ff', live: '#ffb45e', enrichment: '#b69cff' };
  const OPENED_ST = ['done', 'early', 'late'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const calDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const chapterShort = (c) => (/^Full syllabus/i.test(c) ? 'full syllabus rev' : (c.match(/Ch \d+/g) || []).join(' & ') || c);
  function calPage(rep, opt = {}) {
    const info = rep.info || {};
    const adm = opt.admin;
    const root = h('div', { class: 'calview' });
    if (info.heading || info.subtitle) root.append(h('div', { class: 'calhead' }, info.heading ? h('h2', {}, info.heading) : null, info.subtitle ? h('div', { class: 'muted small' }, info.subtitle) : null));
    if (info.intro) root.append(h('div', { class: 'calnote' }, info.intro));
    const chip = (it) => {
      const opened = OPENED_ST.includes(it.status);
      const col = it.status === 'missed' ? '#ff5d6c' : opened ? '#2fbf71' : it.status === 'due' ? '#f5a524' : '#8a8fa3';
      const label = (opened ? '✓ ' : '○ ') + pad2(it.number) + ' · ' + it.name;
      const tip = CAL_ST[it.status][0] + (it.delayDays ? ` (${it.delayDays} ${it.delayDays === 1 ? 'day' : 'days'})` : '');
      return opt.link && it.number ? h('a', { class: 'mchip', href: '#/m/' + it.model, style: 'color:' + col, title: tip }, label) : h('span', { class: 'mchip', style: 'color:' + col, title: tip }, label);
    };
    const byMonth = new Map();
    for (const e of rep.entries) { const k = e.from.slice(0, 7); (byMonth.get(k) || byMonth.set(k, []).get(k)).push(e); }
    for (const [ym, list] of byMonth) {
      const head = ['Grade', 'Chapter', 'Type', 'Line', 'Models', 'What happens', 'Slot', 'Dates', 'Status'].concat(adm ? [''] : []);
      const rows = list.map((e) => {
        let dates;
        if (adm) {
          const f = h('input', { class: 'input', type: 'date', value: e.from, 'aria-label': 'From' });
          const t = h('input', { class: 'input', type: 'date', value: e.to, 'aria-label': 'To' });
          f.addEventListener('change', () => adm.onDates(e.id, f.value, t.value));
          t.addEventListener('change', () => adm.onDates(e.id, f.value, t.value));
          dates = h('div', { class: 'caldates' }, f, h('span', { class: 'muted small' }, 'to'), t);
        } else dates = h('span', {}, calDay(e.from) + (e.from === e.to ? '' : ' – ' + calDay(e.to)));
        const st = CAL_ST[e.status];
        const sub = e.status === 'missed' ? `${e.delayDays} ${e.delayDays === 1 ? 'day' : 'days'} delayed` : e.status === 'late' ? `${e.delayDays} ${e.delayDays === 1 ? 'day' : 'days'} late` : e.total > 1 && e.opened && e.opened < e.total ? `${e.opened} of ${e.total} opened` : '';
        const cells = [
          h('td', {}, e.grade ? String(e.grade) : ''),
          h('td', {}, e.chapter || e.note || ''),
          h('td', {}, e.type ? h('span', { class: 'tp', style: 'color:' + (TYPE_COL[e.type] || '#aab') }, e.type) : ''),
          h('td', {}, e.line || ''),
          h('td', {}, h('div', { class: 'mchips' }, e.items.map(chip))),
          h('td', {}, e.what || ''),
          h('td', {}, e.slot || ''),
          h('td', { class: 'nowrap' }, dates),
          h('td', {}, h('span', { class: 'planpill', style: 'color:' + st[1] }, st[0]), sub ? h('div', { class: 'muted small', style: 'margin-top:4px' }, sub) : null),
        ];
        if (adm) cells.push(h('td', {}, h('button', { class: 'btn sm danger', onclick: () => adm.onRemove(e.id) }, 'Remove')));
        return h('tr', {}, cells);
      });
      root.append(h('h3', { class: 'calmonth' }, MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4)),
        h('div', { class: 'calwrap' }, h('table', { class: 'caltab' }, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), h('tbody', {}, rows))));
    }
    // every model of the plan: where it lands, and whether it was opened
    const sku = new Map((info.skus || []).map((k) => [k.model, k]));
    const per = new Map();
    for (const e of rep.entries) for (const it of e.items) {
      const o = per.get(it.model) || { it, lands: [], opened: 0 };
      o.lands.push(MONTHS[+e.from.slice(5, 7) - 1].slice(0, 3) + ' · ' + (e.grade ? 'Gr' + e.grade + ' ' + chapterShort(e.chapter) + (e.type ? ' (' + e.type + ')' : '') : e.note || 'planned'));
      if (OPENED_ST.includes(it.status)) o.opened++;
      per.set(it.model, o);
    }
    if (per.size && info.skus && info.skus.length) {
      const rows = [...per.values()].sort((x, y) => x.it.number - y.it.number).map((o) => {
        const k = sku.get(o.it.model) || {};
        return h('tr', {}, h('td', {}, k.code || ''), h('td', {}, pad2(o.it.number) + ' · ' + o.it.name), h('td', {}, o.lands.join('; ')), h('td', {}, k.type ? h('span', { class: 'tp', style: 'color:' + (TYPE_COL[k.type] || '#aab') }, k.type) : ''), h('td', { class: 'nowrap' }, `${o.opened} of ${o.lands.length} opened`));
      });
      root.append(h('h3', { class: 'calmonth' }, `Every model accounted for (${per.size})`),
        h('div', { class: 'calwrap' }, h('table', { class: 'caltab' }, h('thead', {}, h('tr', {}, ['SKU', 'Model', 'Lands at', 'Type', 'Opened'].map((t) => h('th', {}, t)))), h('tbody', {}, rows))));
    }
    const section = (title, items, cls) => (items && items.length ? [h('h3', { class: 'calmonth' }, title), h('div', { class: 'calnote ' + (cls || '') }, h('ul', {}, items.map((t) => h('li', {}, t))))] : []);
    root.append(...section('Mappings to push back to the catalogue', info.mappings), ...section('Gaps', info.gaps, 'warn'), ...section('Collect from the school', info.collect));
    return root;
  }
  async function planView() {
    let rep;
    try { rep = await api('/api/plan'); } catch (e) { toast(e.message, true); location.hash = '#/'; return; }
    const back = h('button', { class: 'crumb', onclick: () => (location.hash = '#/') }, h('span', { html: svg('back') }), 'All models');
    $app.replaceChildren(h('div', { class: 'page' }, header(), h('main', {}, back, h('h1', {}, rep.school + ' ', h('span', { class: 'grad' }, 'calendar')), calPage(rep, { link: true })), footer()));
    window.scrollTo(0, 0);
    updateOfflineDot();
  }

  // ---------- the school's academic calendar ----------
  const PLAN_LABEL = { now: 'Now', next: 'Next', overdue: 'Delayed', done: '\u2713 Opened' };
  const fmtPlanDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const planDates = (p) => (p.from === p.to ? fmtPlanDay(p.from) : fmtPlanDay(p.from) + ' \u2013 ' + fmtPlanDay(p.to));
  const planPill = (state) => h('span', { class: 'planpill ' + state }, PLAN_LABEL[state]);
  // card on the library screen: what to open now, what was missed, what comes next
  function planCard(c) {
    const list = c.models.filter((m) => m.plan);
    if (!list.length) return null;
    const by = (k) => list.filter((m) => m.plan.state === k).sort((x, y) => (x.plan.from < y.plan.from ? -1 : 1));
    const opened = by('done').length;
    const row = (m) => h('a', { class: 'planrow', href: '#/m/' + m.id }, planPill(m.plan.state), h('span', { class: 'nm' }, String(m.number).padStart(2, '0') + ' \u00b7 ' + m.name), h('span', { class: 'muted small' }, planDates(m.plan) + (m.plan.state === 'overdue' && m.plan.days ? ` \u00b7 ${m.plan.days} ${m.plan.days === 1 ? 'day' : 'days'} late` : '')));
    const over = by('overdue');
    const now = by('now');
    // delayed models first (they need attention), then what is due now; long lists are trimmed
    const rows = [...over.slice(0, 3).map(row), ...now.slice(0, 5).map(row), ...(now.length ? [] : by('next').slice(0, 1).map(row))];
    return h('section', { class: 'card plancard' },
      h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, "Your school's plan"), h('span', { class: 'muted small' }, `${opened} of ${list.length} models opened`)),
      h('div', { class: 'bar', style: 'margin:10px 0 6px' }, h('i', { style: `width:${Math.round((opened / list.length) * 100)}%` })),
      h('a', { class: 'small', href: '#/plan', style: 'display:inline-block;margin:0 0 6px' }, 'See the full calendar \u2192'),
      over.length ? h('div', { class: 'small', style: 'color:#ff8a3d;margin-bottom:4px' }, `${over.length} ${over.length === 1 ? 'model is' : 'models are'} delayed: their dates are over and ${over.length === 1 ? 'it has' : 'they have'} not been opened yet.`) : null,
      ...(rows.length ? rows : [h('div', { class: 'muted small' }, 'Everything planned so far has been opened. Well done!')]),
      over.length > 3 || now.length > 5 ? h('div', { class: 'muted small', style: 'margin-top:8px' }, [over.length > 3 ? `${over.length - 3} more delayed` : '', now.length > 5 ? `${now.length - 5} more to open now` : ''].filter(Boolean).join(' · ') + '. The tag on each model tile below shows its status.') : null);
  }

  function folder(m, i) {
    const hue = Math.round(220 - (i * 300) / 31);
    const a = h('a', { class: 'folder' + (m.locked ? ' locked' : ''), href: `#/m/${m.id}`, style: `--h:${hue};--i:${i}`, 'aria-label': m.name + (m.locked ? ' (locked)' : '') },
      h('div', { class: 'tab' }),
      h('div', { class: 'shell' }, h('div', { class: 'in' },
        h('div', { class: 'sheet' }),
        h('div', { class: 'photo' }, m.image ? h('img', { src: m.image.url, alt: '', loading: 'lazy', decoding: 'async' }) : null),
        h('div', { class: 'front' }, h('span', { class: 'num' }, String(m.number).padStart(2, '0')), h('span', { class: 'nm' }, m.name)))),
      m.locked ? h('span', { class: 'lk', html: svg('lock') }) : null,
      !m.locked && m.plan ? h('span', { class: 'planpill ' + m.plan.state, title: planDates(m.plan) }, PLAN_LABEL[m.plan.state]) : null);
    if (m.locked) a.addEventListener('click', (e) => { e.preventDefault(); toast('Locked — scan an authorised QR code to open this model.'); });
    return a;
  }

  async function homeView() {
    const c = S.catalog;
    const grid = h('div', { class: 'grid' });
    const fill = () => {
      const q = S.q.trim().toLowerCase();
      const rows = c.models.map((m, i) => ({ m, i })).filter(({ m }) => !q || m.name.toLowerCase().includes(q) || String(m.number) === q);
      grid.replaceChildren(...rows.map(({ m, i }) => folder(m, i)));
      if (!rows.length) grid.replaceChildren(h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'No models match your search.'));
    };
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search models', value: S.q, 'aria-label': 'Search models', oninput: (e) => { S.q = e.target.value; fill(); } });
    const open = c.models.filter((m) => !m.locked).length;
    const sync = h('div', { class: 'banner', hidden: true });
    $app.replaceChildren(h('div', { class: 'page' }, header(), h('main', {},
      h('h1', {}, 'Model ', h('span', { class: 'grad' }, 'library')),
      h('div', { class: 'row wrap', style: 'align-items:center;gap:12px;margin-bottom:6px' },
        h('p', { class: 'lead grow', style: 'margin:0' }, `${c.models.length} models` + (open < c.models.length ? ` · ${open} unlocked` : '')),
        c.models.some((m) => m.plan) ? h('a', { class: 'btn primary sm', href: '#/plan' }, 'View calendar') : null),
      sync,
      planCard(c),
      h('div', { class: 'tools' }, h('div', { class: 'search', html: svg('search') }, search)),
      grid), footer()));
    fill();
    updateOfflineDot();
    if (navigator.onLine && localStorage.getItem('lm_offline') === '1') {
      await offline.prune();
      const st = await offline.status();
      if (st.missing.length) {
        sync.hidden = false;
        sync.append(h('span', { class: 'grow small' }, `New or updated content (${mb(st.missingBytes)}) is ready to save for offline.`),
          h('button', { class: 'btn sm primary', onclick: offlineSheet }, 'Update'));
      }
    }
  }

  function videoCard(title, f, poster, busy, modelId, slot) {
    const box = f
      ? h('div', { class: 'vbox' }, LM.Player(f, { title, poster, m: modelId, slot }).el)
      : h('div', { class: 'vbox none' }, h('div', {}, h('span', { class: 'spark' }), h('div', { class: 'small' }, busy ? 'Being prepared - check back in a moment' : 'Video coming soon')));
    return h('section', { class: 'vcard' }, h('div', { class: 'vh' }, h('b', {}, title), f ? h('span', { class: 'muted small' }, fmtDur(f.duration)) : null), box);
  }
  const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

  async function modelView(id) {
    LM.stopPlayers && LM.stopPlayers();
    if (S.catalog.models.some((m) => m.id === id && !m.locked && (m.working || m.assembly))) await loadScript('/player.js');
    const ms = S.catalog.models;
    const i = ms.findIndex((m) => m.id === id);
    if (i < 0) { location.hash = '#/'; return; }
    const m = ms[i];
    if (!m.locked) track('view', { m: m.id });
    const back = h('button', { class: 'crumb', onclick: () => (history.length > 1 ? history.back() : (location.hash = '#/')) }, h('span', { html: svg('back') }), 'All models');
    let content;
    if (m.locked) {
      content = h('div', { class: 'lockbox' }, h('span', { html: svg('lock') }), h('h1', {}, m.name), h('p', { class: 'muted' }, 'This model is locked for your access. Scan an authorised QR code to open it.'));
    } else {
      const pager = h('div', { class: 'pager' },
        i > 0 ? h('a', { class: 'btn', href: `#/m/${ms[i - 1].id}` }, '← ' + String(ms[i - 1].number).padStart(2, '0')) : h('span', { style: 'flex:1' }),
        i < ms.length - 1 ? h('a', { class: 'btn', href: `#/m/${ms[i + 1].id}` }, String(ms[i + 1].number).padStart(2, '0') + ' →') : h('span', { style: 'flex:1' }));
      content = h('div', {},
        h('div', { class: 'mhead' },
          m.image ? h('div', { class: 'thumb' }, h('img', { src: m.image.url, alt: '' })) : null,
          h('div', {}, h('span', { class: 'chip' }, 'MODEL ' + String(m.number).padStart(2, '0')), h('h1', { style: 'margin-top:6px' }, m.name))),
        m.description ? h('p', { class: 'lead', style: 'max-width:70ch' }, m.description) : null,
        m.plan ? h('p', { class: 'small', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, planPill(m.plan.state), h('span', { class: 'muted' }, "Your school's plan: " + planDates(m.plan)), m.plan.note ? h('span', {}, '\u00b7 ' + m.plan.note) : null) : null,
        h('div', { class: 'vids' }, videoCard('Working video', m.working, m.image?.url, m.busy, m.id, 'working'), videoCard('Assembly video', m.assembly, m.image?.url, m.busy, m.id, 'assembly')),
        pager);
    }
    $app.replaceChildren(h('div', { class: 'page' }, header(), h('main', {}, back, content), footer()));
    window.scrollTo(0, 0);
    updateOfflineDot();
  }

  // shared with the lazily loaded admin.js / player.js
  const scripts = {};
  const loadScript = (src) => scripts[src] || (scripts[src] = new Promise((res, rej) => {
    const s = h('script', { src, onload: res, onerror: () => { delete scripts[src]; rej(new Error('Could not load ' + src + ' (offline?)')); } });
    document.head.append(s);
  }));
  // usage tracking: counters per school on the server (visit, model page, video play, time spent)
  let lastInput = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));
  const deviceId = () => { try { let d = localStorage.getItem('lm_dev'); if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('lm_dev', d); } return d; } catch { return 'nodevice' + Math.random().toString(36).slice(2); } };
  const track = (type, extra) => { if (S.me && S.me.via !== 'guest') api('/api/track', { method: 'POST', body: { type, d: deviceId(), ...extra } }).catch(() => {}); };
  let beat = null;
  function startTracking() {
    track('visit');
    if (beat) return;
    // every 30 s while the page is open and someone is using it (or a video is open)
    beat = setInterval(() => { if (document.visibilityState === 'visible' && (Date.now() - lastInput < 120000 || window.LM.activePlayer)) track('ping'); }, 30000);
  }
  const LM = window.LM = { h, api, modal, toast, svg, icon, mb, S, header, footer, logo, loadCatalog, wipeDataCache, updateOfflineDot, offline, track, calPage };

  // ---------- routing ----------
  async function route() {
    // nobody is signed in yet: ask for the school code (admins sign in from a link on that screen)
    if (!S.me || S.me.via === 'guest') {
      if (/^#\/(login|admin)/.test(location.hash)) return adminLoginView();
      return schoolGate();
    }
    if (!S.catalog) {
      try { await loadCatalog(); } catch (e) {
        toast(e.message, true);
      }
    }
    const hash = location.hash || '#/';
    let m;
    if (LM.stopPlayers) LM.stopPlayers();
    if ((m = hash.match(/^#\/m\/([\w-]+)/))) await modelView(m[1]);
    else if ((m = hash.match(/^#\/admin(?:\/(\w+))?/))) {
      if (!S.me || (S.me.role !== 'admin' && S.me.role !== 'editor')) {
        adminLoginView();
      } else {
        await loadScript('/admin.js');
        await LM.adminView(m[1]);
      }
    } else if (hash === '#/plan') {
      await planView();
    } else if (hash === '#/login') {
      adminLoginView();
    } else {
      await homeView();
    }
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => route());

  async function start() {
    await loadMe();
    if (S.me.via === 'guest') return route();
    startTracking();
    try { await loadCatalog(); } catch (e) {}
    if (!S.catalog) return $app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box' }, h('p', { class: 'lead' }, 'You are offline and nothing is saved on this device yet. Connect once to download the library.'), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again'))));
    route();
  }

  (async function boot() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    let code = null;
    const pathMatch = location.pathname.match(/^\/q\/([\w-]+)/);
    if (pathMatch) code = pathMatch[1];
    else {
      const hashMatch = location.hash.match(/^#\/q\/([\w-]+)/);
      if (hashMatch) code = hashMatch[1];
      else {
        try {
          const qp = new URLSearchParams(location.search);
          if (qp.get('qr')) code = qp.get('qr');
        } catch {}
      }
    }
    if (code) {
      try {
        await api('/api/qr/' + code);
        await wipeDataCache();
        localStorage.setItem('lm_qr', code);
      } catch (e) {
        if (e.status === 404) { try { localStorage.removeItem('lm_qr'); } catch {} }
      }
      history.replaceState(null, '', '/#/');
    } else {
      try {
        const savedQr = localStorage.getItem('lm_qr');
        if (savedQr) await api('/api/qr/' + savedQr);
      } catch {}
    }
    start();
  })();
})();
