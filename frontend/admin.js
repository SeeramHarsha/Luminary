'use strict';
// Admin panel - loaded on demand so visitors never download it.
(() => {
  const { h, api, modal, toast, svg, mb, S, header, footer, loadCatalog } = window.LM;
  const TABS = [['models', 'Models'], ['qr', 'Schools'], ['usage', 'Usage'], ['calendar', 'Calendar'], ['users', 'Users'], ['settings', 'Settings']];
  const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
  const busy = (m) => ['working', 'assembly'].some((k) => m.files[k] && m.files[k].pending && m.files[k].pending.status === 'processing');

  let pollTimer = null;
  async function adminView(tab) {
    clearInterval(pollTimer);
    if (!S.me || (S.me.role !== 'admin' && S.me.role !== 'editor')) { location.hash = '#/'; return; }
    const tabs = S.me.role === 'admin' ? TABS : TABS.slice(0, 1); // editor links only manage models
    S.adminTab = tabs.some(([k]) => k === tab) ? tab : 'models';
    let A;
    try { A = S.admin = await api('/api/admin/state'); } catch (e) { toast(e.message, true); return; }
    if (S.adminTab === 'usage') { try { A.usage = await api('/api/admin/usage?days=' + (S.usageDays || 30)); } catch (e) { toast(e.message, true); return; } }
    if (S.adminTab === 'calendar') { try { A.cal = await api('/api/admin/calendar'); } catch (e) { toast(e.message, true); return; } }
    const seg = h('div', { class: 'seg tabs' }, tabs.map(([k, n]) => h('button', { class: k === S.adminTab ? 'on' : '', onclick: () => (location.hash = `#/admin/${k}`) }, n)));
    const body = { models: adminModels, qr: adminQr, usage: adminUsage, calendar: adminCalendar, users: adminUsers, settings: adminSettings }[S.adminTab](A);
    document.getElementById('app').replaceChildren(h('div', { class: 'page' }, header(),
      h('main', {}, h('button', { class: 'crumb', onclick: () => { loadCatalog().then(() => (location.hash = '#/')); } }, h('span', { html: svg('back') }), 'Back to library'),
        h('h1', {}, S.me.role === 'admin' ? 'Admin ' : 'Editor ', h('span', { class: 'grad' }, 'panel')), tabs.length > 1 ? seg : null,
        A.defaultPassword ? h('div', { class: 'warnbox' }, 'You are still using the default admin password. Change it under Settings before going live.') : null, body), footer()));
    window.LM.updateOfflineDot();
    // keep the list live while videos are being compressed
    if (S.adminTab === 'models' && A.models.some(busy)) pollTimer = setInterval(() => { if (!document.querySelector('.scrim')) adminView('models'); }, 3000);
  }
  const refresh = () => adminView(S.adminTab);

  // ---------- models ----------
  function adminModels(A) {
    const pill = (m, k, label) => {
      const f = m.files[k];
      const p = f && f.pending;
      const cls = p && p.status === 'processing' ? ' proc' : p && p.status === 'error' ? ' bad' : (f && (f.ready || f.url)) ? ' on' : '';
      return [h('i', { class: 'pill' + cls }), label + (p && p.status === 'processing' ? ` ${Math.round(p.progress * 100)}%` : '') + '  '];
    };
    const list = h('div', { class: 'list' }, A.models.map((m) => h('div', { class: 'mrow' },
      h('div', { class: 't' }, m.files.image ? h('img', { src: m.files.image.url, alt: '', loading: 'lazy' }) : null),
      h('div', { class: 'meta' }, h('b', {}, `${String(m.number).padStart(2, '0')} · ${m.name}`),
        h('span', { class: 'muted small' }, pill(m, 'image', 'Image'), pill(m, 'working', 'Working'), pill(m, 'assembly', 'Assembly'))),
      h('button', { class: 'btn sm', onclick: () => editModel(m) }, 'Edit'))));
    return h('div', {}, h('div', { class: 'row', style: 'margin-bottom:14px' }, h('p', { class: 'lead grow', style: 'margin:0' }, `${A.models.length} models`),
      h('button', { class: 'btn primary sm', onclick: () => editModel(null) }, '+ Add model')),
    h('p', { class: 'muted small', style: 'margin:0 0 14px' }, 'Videos are played from YouTube: upload each video to YouTube (Unlisted is fine, and allow embedding), then paste its link.'), list);
  }

  // XHR upload with progress, speed and cancel
  function upload(url, file, onProgress, ctl, raw = false) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      ctl.abort = () => x.abort();
      x.open(raw ? 'PUT' : 'POST', url);
      const t0 = Date.now();
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total, e.loaded / Math.max(0.5, (Date.now() - t0) / 1000), e.loaded, e.total);
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Upload failed')); };
      x.onerror = () => reject(new Error('Upload failed - check your connection.'));
      x.onabort = () => reject(new Error('cancelled'));
      if (raw) { x.send(file); return; } // straight to the bucket: the raw file is the body
      const fd = new FormData();
      fd.append('file', file);
      x.send(fd);
    });
  }

  function editModel(model) {
    modal((box, close) => {
      let m = model;
      let timer = null;
      const slots = {};
      const draw = () => {
        clearInterval(timer);
        box.replaceChildren();
        const name = h('input', { class: 'input', value: m ? m.name : '', maxlength: 120, placeholder: 'Folder name' });
        const num = h('input', { class: 'input', type: 'number', value: m ? m.number : '', min: 1 });
        const desc = h('textarea', { class: 'input', maxlength: 1000, placeholder: 'Short description' }, m ? m.description : '');
        const err = h('div', { class: 'err' });
        box.append(h('h2', {}, m ? 'Edit model' : 'New model'),
          h('label', { class: 'field' }, h('span', {}, 'Folder name'), name),
          m ? h('label', { class: 'field' }, h('span', {}, 'Order number'), num) : null,
          h('label', { class: 'field' }, h('span', {}, 'Description'), desc), err);
        box.append(h('button', { class: 'btn primary', style: 'width:100%;margin-bottom:16px', onclick: async () => {
          try {
            if (m) m = await api(`/api/admin/models/${m.id}`, { method: 'PATCH', body: { name: name.value, description: desc.value, number: num.value } });
            else m = await api('/api/admin/models', { method: 'POST', body: { name: name.value, description: desc.value } });
            toast('Saved'); draw();
          } catch (e) { err.textContent = e.message; }
        } }, m ? 'Save details' : 'Create model'));
        if (m) {
          const set = (nm) => { m = nm; Object.values(slots).forEach((s) => s.render()); watch(); };
          slots.image = imageSlot(() => m, set);
          slots.working = videoSlot(() => m, 'working', 'Working video', set);
          slots.assembly = videoSlot(() => m, 'assembly', 'Assembly video', set);
          slots.workingCover = coverSlot(() => m, 'working', 'Working video cover image', set);
          slots.assemblyCover = coverSlot(() => m, 'assembly', 'Assembly video cover image', set);
          box.append(slots.image.el, slots.working.el, slots.workingCover.el, slots.assembly.el, slots.assemblyCover.el);
          box.append(h('button', { class: 'btn danger', style: 'width:100%;margin-top:6px', onclick: async () => {
            if (!confirm(`Delete "${m.name}" and all its files?`)) return;
            try { await api(`/api/admin/models/${m.id}`, { method: 'DELETE' }); close(); toast('Deleted'); refresh(); } catch (e) { toast(e.message, true); }
          } }, 'Delete this folder'));
          watch();
        }
        box.append(h('button', { class: 'btn', style: 'width:100%;margin-top:10px', onclick: () => { clearInterval(timer); close(); refresh(); } }, 'Done'));
      };
      // poll while a video is compressing
      function watch() {
        clearInterval(timer);
        if (!m || !busy(m)) return;
        timer = setInterval(async () => {
          if (!box.isConnected) return clearInterval(timer);
          try {
            const nm = await api(`/api/admin/models/${m.id}`);
            const was = busy(m);
            m = nm;
            Object.values(slots).forEach((s) => s.render());
            if (was && !busy(m)) { clearInterval(timer); toast('Video ready'); }
          } catch {}
        }, 2000);
      }
      draw();
    });
  }

  const slotBox = (label, status) => h('div', { class: 'slot' }, h('div', { class: 'row' }, h('b', { class: 'grow', style: 'font-weight:400' }, label), status));

  function pickFile(accept, onFile) {
    const input = h('input', { type: 'file', accept, hidden: true, onchange: () => input.files[0] && onFile(input.files[0]) });
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  }

  function imageSlot(get, set) {
    const el = h('div');
    const render = () => {
      const m = get();
      const f = m.files.image;
      const bar = h('div', { class: 'bar', hidden: true }, h('i'));
      const status = h('span', { class: 'muted small' }, f ? mb(f.size) : 'Not set');
      const s = slotBox('Folder image', status);
      s.append(f ? h('img', { class: 'prev', src: f.url, alt: '' }) : null, bar,
        h('div', { class: 'row wrap', style: 'margin-top:6px' },
          h('button', { class: 'btn sm', onclick: () => pickFile('image/*', async (file) => {
            bar.hidden = false; status.textContent = 'Uploading…';
            try { set(await upload(`/api/admin/models/${m.id}/file/image`, file, (p) => { bar.firstChild.style.width = p * 100 + '%'; }, {})); toast('Image updated'); }
            catch (e) { bar.hidden = true; status.textContent = ''; toast(e.message, true); }
          }) }, f ? 'Replace' : 'Upload'),
          f ? h('button', { class: 'btn sm danger', onclick: async () => { try { set(await api(`/api/admin/models/${m.id}/file/image`, { method: 'DELETE' })); } catch (e) { toast(e.message, true); } } }, 'Delete') : null));
      el.replaceChildren(s);
    };
    render();
    return { el, render };
  }

  // cover image shown on a video (different from the folder image)
  function coverSlot(get, slot, label, set) {
    const el = h('div');
    const render = () => {
      const m = get();
      const c = (m.covers || {})[slot];
      const bar = h('div', { class: 'bar', hidden: true }, h('i'));
      const status = h('span', { class: 'muted small' }, c ? mb(c.size) : 'Not set (the folder image is used)');
      const s = slotBox(label, status);
      s.append(c ? h('img', { class: 'prev', src: c.url, alt: '' }) : null, bar,
        h('div', { class: 'row wrap', style: 'margin-top:6px' },
          h('button', { class: 'btn sm', onclick: () => pickFile('image/*', async (file) => {
            bar.hidden = false; status.textContent = 'Uploading…';
            try { set(await upload(`/api/admin/models/${m.id}/cover/${slot}`, file, (p) => { bar.firstChild.style.width = p * 100 + '%'; }, {})); toast('Cover image updated'); }
            catch (e) { bar.hidden = true; status.textContent = ''; toast(e.message, true); }
          }) }, c ? 'Replace' : 'Upload'),
          c ? h('button', { class: 'btn sm danger', onclick: async () => { try { set(await api(`/api/admin/models/${m.id}/cover/${slot}`, { method: 'DELETE' })); } catch (e) { toast(e.message, true); } } }, 'Delete') : null));
      el.replaceChildren(s);
    };
    render();
    return { el, render };
  }

  // video = a YouTube link (older uploaded files still play until replaced)
  function videoSlot(get, slot, label, set) {
    const el = h('div');
    const render = () => {
      const m = get();
      const v = m.files[slot];
      const input = h('input', { class: 'input', type: 'url', inputmode: 'url', autocapitalize: 'none', placeholder: 'Paste the YouTube link', value: v && v.youtube ? `https://youtu.be/${v.youtube}` : '', 'aria-label': label + ' YouTube link' });
      const status = h('span', { class: 'muted small' }, v && v.ready ? (v.youtube ? 'YouTube video' : 'Old uploaded file') : 'Not set');
      const s = slotBox(label, status);
      if (v && v.youtube) s.append(h('img', { class: 'prev', src: `https://i.ytimg.com/vi/${v.youtube}/hqdefault.jpg`, alt: '' }));
      else if (v && v.ready && v.renditions.length) {
        s.append(h('p', { class: 'muted small' }, 'This is an old uploaded file. Paste a YouTube link below to replace it.'),
          h('video', { src: v.renditions[v.renditions.length - 1].url, controls: true, preload: 'none', playsinline: true }));
      }
      s.append(h('label', { class: 'field' }, h('span', {}, 'YouTube link (an Unlisted video works)'), input),
        h('div', { class: 'row wrap', style: 'margin-top:6px' },
          h('button', { class: 'btn sm primary', onclick: async () => {
            try { set(await api(`/api/admin/models/${m.id}/youtube/${slot}`, { method: 'PUT', body: { url: input.value } })); toast('Video saved'); }
            catch (e) { toast(e.message, true); }
          } }, v && v.ready ? 'Replace' : 'Save'),
          v && v.youtube ? h('a', { class: 'btn sm', href: `https://youtu.be/${v.youtube}`, target: '_blank', rel: 'noopener' }, 'Open on YouTube') : null,
          v ? h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Remove the ${label.toLowerCase()}?`)) return; try { set(await api(`/api/admin/models/${m.id}/file/${slot}`, { method: 'DELETE' })); } catch (e) { toast(e.message, true); } } }, 'Remove') : null));
      el.replaceChildren(s);
    };
    render();
    return { el, render };
  }

  // ---------- QR ----------
  function adminQr(A) {
    const wrap = h('div', { class: 'list' }, A.profiles.map((p) => qrCard(p, A)));
    return h('div', {},
      h('p', { class: 'lead' }, 'Each school has a 4-digit code that visitors type when they open Luminary, and a QR code that opens it without typing. Choose which models each school can open.'),
      h('button', { class: 'btn primary sm', style: 'margin-bottom:16px', onclick: async () => { try { await api('/api/admin/profiles', { method: 'POST', body: { label: 'New school', mode: 'all' } }); refresh(); } catch (e) { toast(e.message, true); } } }, '+ New school'),
      wrap);
  }

  // Builds a printable PNG (QR + label + link) in the browser, then saves it.
  async function downloadQr(p, btn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      const r = await fetch(`/api/admin/profiles/${p.id}/qr.png?size=900&t=${Date.now()}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('QR image could not be created');
      const img = await createImageBitmap(await r.blob());
      try { await document.fonts.load('500 44px Outfit'); } catch {}
      const W = 1100;
      const c = document.createElement('canvas');
      c.width = W; c.height = 1320;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, c.height);
      g.drawImage(img, 100, 70, 900, 900);
      g.textAlign = 'center'; g.fillStyle = '#10121a';
      g.font = '500 62px Outfit, sans-serif'; g.fillText(p.label, W / 2, 1060, W - 120);
      g.font = '300 38px Outfit, sans-serif'; g.fillStyle = '#555'; g.fillText('Scan to open the Luminary library', W / 2, 1125, W - 120);
      g.font = '300 28px Outfit, sans-serif'; g.fillStyle = '#888'; g.fillText(p.link.replace(/^https?:\/\//, ''), W / 2, 1185, W - 120);
      g.font = '200 24px Outfit, sans-serif'; g.fillStyle = '#999'; g.fillText('A  B O T C L U B  P R O D U C T', W / 2, 1260);
      const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not render PNG'))), 'image/png'));
      const name = `luminary-qr-${p.label.replace(/[^\w-]+/g, '_') || 'code'}.png`;
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name, style: 'display:none' });
      document.body.append(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
      toast('QR image saved to your downloads');
    } catch (e) {
      toast(e.message || 'Download failed', true);
      window.open(`/api/admin/profiles/${p.id}/qr.png?size=1200&download=1`, '_blank');
    } finally { btn.disabled = false; btn.textContent = old; }
  }

  function qrCard(p, A) {
    let mode = p.mode;
    const sel = new Set(p.allowed);
    const editor = h('input', { type: 'checkbox' });
    editor.checked = !!p.editor;
    const label = h('input', { class: 'input', value: p.label, maxlength: 60, 'aria-label': 'School name' });
    const pinIn = h('input', { class: 'input', value: p.pin || '', inputmode: 'numeric', maxlength: 4, placeholder: '0000', 'aria-label': 'School code', style: 'max-width:150px;text-align:center;font-size:22px;letter-spacing:.35em;padding-left:.35em' });
    pinIn.oninput = () => { pinIn.value = pinIn.value.replace(/\D/g, '').slice(0, 4); };
    const checks = h('div', { class: 'checks' }, A.models.map((m) => {
      const cb = h('input', { type: 'checkbox', onchange: () => { cb.checked ? sel.add(m.id) : sel.delete(m.id); } });
      cb.checked = sel.has(m.id);
      return h('label', { class: 'check' }, cb, `${String(m.number).padStart(2, '0')} · ${m.name}`);
    }));
    const setAll = (v) => checks.querySelectorAll('input').forEach((cb, i) => { cb.checked = v; v ? sel.add(A.models[i].id) : sel.delete(A.models[i].id); });
    const picker = h('div', { hidden: mode === 'all' }, h('div', { class: 'row wrap', style: 'margin:10px 0' },
      h('button', { class: 'btn sm', onclick: () => setAll(true) }, 'Tick all'), h('button', { class: 'btn sm', onclick: () => setAll(false) }, 'Untick all'),
      h('span', { class: 'muted small' }, 'Ticked = open, unticked = locked')), checks);
    const seg = h('div', { class: 'seg' }, [['all', 'Open all models'], ['custom', 'Choose models']].map(([k, n]) => h('button', { class: k === mode ? 'on' : '', onclick: (e) => { mode = k; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); picker.hidden = k === 'all'; } }, n)));
    const pinWrap = h('div', { class: 'field', hidden: !!p.editor }, h('span', {}, 'School code (4 digits, typed on the sign-in screen)'),
      h('div', { class: 'row wrap' }, pinIn, h('button', { class: 'btn sm', onclick: () => save({ regenPin: true }, 'New code created') }, 'New random code')));
    editor.addEventListener('change', () => { pinWrap.hidden = editor.checked; });
    const save = async (patch, msg) => { try { await api(`/api/admin/profiles/${p.id}`, { method: 'PATCH', body: patch }); toast(msg || 'Saved'); refresh(); } catch (e) { toast(e.message, true); } };
    const dl = h('button', { class: 'btn sm', style: 'margin-top:10px;width:100%', onclick: () => downloadQr(p, dl) }, 'Download PNG');
    return h('div', { class: 'card qrcard' },
      h('div', {}, h('img', { class: 'qr', src: `/api/admin/profiles/${p.id}/qr.png?size=400&t=${Date.now()}`, alt: 'QR code' }), dl),
      h('div', { class: 'grow' },
        !p.editor ? h('div', { class: 'row wrap', style: 'margin-bottom:12px;gap:10px;align-items:center' },
          h('button', { class: 'btn primary sm', onclick: () => { S.calSchool = p.id; S.calEdit = false; location.hash = '#/admin/calendar'; } }, p.calendar && p.calendar.length ? 'View calendar' : 'Set up calendar'),
          h('span', { class: 'muted small' }, p.calendar && p.calendar.length ? `Academic calendar: ${p.calendar.length} sessions` : 'No academic calendar yet')) : null,
        h('label', { class: 'field' }, h('span', {}, 'School name'), label),
        pinWrap,
        h('div', { class: 'row wrap', style: 'margin-bottom:12px' }, h('span', { class: 'link grow' }, p.link),
          h('button', { class: 'btn sm', onclick: () => { (navigator.clipboard ? navigator.clipboard.writeText(p.link) : Promise.reject()).then(() => toast('Link copied'), () => toast('Copy failed - select the link and copy it', true)); } }, 'Copy')),
        seg, picker,
        h('label', { class: 'check', style: 'margin-top:12px' }, editor, 'Editor link: anyone with this QR can upload and manage models and videos (not users, passwords or QR codes)'),
        h('div', { class: 'row wrap', style: 'margin-top:14px' },
          h('button', { class: 'btn primary sm', onclick: () => save({ label: label.value, mode, allowed: [...sel], editor: editor.checked, pin: editor.checked ? undefined : pinIn.value }) }, 'Save'),
          h('button', { class: 'btn sm', onclick: () => save({ mode: 'all' }, 'All models opened') }, 'Open all'),
          h('button', { class: 'btn sm', onclick: () => save({ mode: 'custom', allowed: [] }, 'All models locked') }, 'Lock all'),
          A.profiles.length > 1 ? h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Delete "${p.label}"? Its school code and printed QR codes will stop working.`)) return; try { await api(`/api/admin/profiles/${p.id}`, { method: 'DELETE' }); refresh(); } catch (e) { toast(e.message, true); } } }, 'Delete') : null)));
  }

  // ---------- academic calendar ----------
  const CAL_CHIP = { missed: ['delayed', '#ff5d6c'], late: ['done late', '#ff8a3d'], due: ['due now', '#f5a524'], upcoming: ['upcoming', '#7a8cff'] };
  function adminCalendar(A) {
    const C = A.cal;
    const sel = C.schools.find((x) => x.id === S.calSchool) || null;
    const attention = (x) => x.summary.missed * 3 + x.summary.late * 2 + x.summary.due;
    const go = (id, edit) => { S.calSchool = id; S.calEdit = !!edit; refresh(); };
    const call = async (url, method, body, msg) => { try { await api(url, { method, body }); if (msg) toast(msg); refresh(); } catch (e) { toast(e.message, true); } };

    if (!sel) {
      const cards = [...C.schools].sort((a, b) => attention(b) - attention(a)).map((x) => {
        const m = x.summary;
        const pct = m.total ? Math.round((m.opened / m.total) * 100) : 0;
        const chips = [['missed', m.missed], ['late', m.late], ['due', m.due], ['upcoming', m.upcoming]].filter(([, n]) => n)
          .map(([k, n]) => h('span', { class: 'chip', style: `border-color:${CAL_CHIP[k][1]};color:${CAL_CHIP[k][1]}` }, `${n} ${CAL_CHIP[k][0]}`));
        return h('div', { class: 'card', style: 'cursor:pointer', onclick: () => go(x.id, !m.total) },
          h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, x.label), h('span', { class: 'muted small' }, m.total ? `${m.opened} of ${m.total} sessions done` : 'No calendar yet')),
          m.total ? h('div', { class: 'bar', style: 'margin:10px 0' }, h('i', { style: `width:${pct}%` })) : null,
          chips.length ? h('div', { class: 'row wrap', style: 'gap:6px' }, chips) : null,
          h('div', { class: 'row wrap', style: 'margin-top:10px;gap:8px' },
            h('button', { class: 'btn primary sm', onclick: (e) => { e.stopPropagation(); go(x.id, !m.total); } }, m.total ? 'View calendar' : 'Set up calendar'),
            m.total ? h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); go(x.id, true); } }, 'Edit calendar') : null));
      });
      return h('div', {},
        h('p', { class: 'lead' }, 'Each school has an academic calendar like its plan: month by month, which grade and chapter, which models, and in which dates. Luminary checks the usage and shows whether the models were opened in time. Schools that are behind are listed first.'),
        h('div', { class: 'row wrap', style: 'margin-bottom:14px;gap:8px' },
          h('button', { class: 'btn sm', onclick: () => window.open('/api/admin/calendar.csv', '_blank') }, 'Download status as CSV'),
          h('button', { class: 'btn sm', onclick: () => pickFile('.json,application/json', async (file) => {
            try {
              const r = await api('/api/admin/calendar/import', { method: 'POST', body: JSON.parse(await file.text()) });
              S.calSchool = r.id;
              toast(`${r.school}: ${r.entries} sessions ${r.created ? 'added (new school, code ' + r.pin + ')' : 'replaced'}` + (r.skipped.length ? `; models ${r.skipped.join(', ')} not found` : ''));
              refresh();
            } catch (e) { toast(e instanceof SyntaxError ? 'That file is not a valid calendar file.' : e.message, true); }
          }) }, 'Import a school calendar (file)')),
        h('div', { class: 'list' }, cards.length ? cards : h('p', { class: 'muted' }, 'No schools yet. Create one in the Schools tab.')));
    }

    // one school: its calendar in the PDF's layout, tools below
    const m = sel.summary;
    const mSel = h('select', { class: 'input', 'aria-label': 'Model' }, C.models.map((x) => h('option', { value: x.id }, `${String(x.number).padStart(2, '0')} · ${x.name}`)));
    const fromIn = h('input', { class: 'input', type: 'month', value: C.today.slice(0, 7), 'aria-label': 'From month' });
    const toIn = h('input', { class: 'input', type: 'month', value: C.today.slice(0, 7), 'aria-label': 'To month' });
    const startIn = h('input', { class: 'input', type: 'month', value: C.today.slice(0, 7), 'aria-label': 'First month' });
    const daysIn = h('input', { class: 'input', type: 'number', min: 1, max: 12, value: 1, 'aria-label': 'Months per model', style: 'max-width:110px' });
    const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return ym + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0'); };
    const copyTo = h('select', { class: 'input', 'aria-label': 'Copy to' }, [h('option', { value: 'all' }, 'All other schools')].concat(C.schools.filter((x) => x.id !== sel.id).map((x) => h('option', { value: x.id }, x.label))));
    const editing = !!S.calEdit || !sel.entries.length; // View = read-only, exactly what the school sees. Edit = change dates, remove rows, planning tools
    const table = window.LM.calPage(sel, editing ? { admin: {
      onDates: (id, from, to) => call(`/api/admin/profiles/${sel.id}/calendar/${id}`, 'PATCH', { from, to }, 'Dates saved'),
      onRemove: (id) => { if (confirm('Remove this row from the calendar?')) call(`/api/admin/profiles/${sel.id}/calendar/${id}`, 'DELETE', undefined, 'Removed'); },
    } } : { link: true });
    const summary = m.total ? `${m.opened} of ${m.total} sessions done${m.missed ? ' · ' + m.missed + ' delayed' : ''}${m.late ? ' · ' + m.late + ' done late' : ''}${m.due ? ' · ' + m.due + ' due now' : ''}${m.upcoming ? ' · ' + m.upcoming + ' upcoming' : ''}` : 'No calendar yet. Import a calendar file, create a plan below, or add models one by one.';
    const out = h('div', {},
      h('button', { class: 'crumb', onclick: () => go(null) }, h('span', { html: svg('back') }), 'All schools'),
      h('h2', { style: 'margin:6px 0 4px' }, sel.label),
      h('p', { class: 'muted small' }, summary),
      sel.entries.length ? h('div', { class: 'row wrap', style: 'margin:8px 0 14px;gap:10px;align-items:center' },
        h('button', { class: 'btn primary sm', onclick: () => { S.calEdit = !editing; refresh(); } }, editing ? 'View calendar' : 'Edit calendar'),
        h('button', { class: 'btn sm', onclick: () => window.LM.downloadTimetable(sel) }, 'Download timetable'),
        h('button', { class: 'btn sm', onclick: () => window.print() }, 'Print / save as PDF'),
        h('span', { class: 'muted small' }, editing ? 'Edit mode: change dates, remove rows, or use the planning tools below.' : 'View mode: this is what the school sees. Nothing can be changed here.')) : null,
      sel.entries.length ? table : null,
      h('div', { class: 'card', style: 'margin-top:20px' }, h('h3', { style: 'margin:0 0 6px' }, 'Create a simple plan'),
        h('p', { class: 'muted small' }, 'Models one after another, in number order, with the days you choose for each. This replaces the calendar of this school (only the models it can open are used).'),
        h('div', { class: 'row wrap', style: 'gap:8px;align-items:end' }, h('label', { class: 'field', style: 'margin:0' }, h('span', {}, 'First month'), startIn), h('label', { class: 'field', style: 'margin:0' }, h('span', {}, 'Months per model'), daysIn),
          h('button', { class: 'btn primary sm', onclick: () => { if (sel.entries.length && !confirm('Replace the existing calendar of this school?')) return; call('/api/admin/calendar/plan', 'POST', { to: sel.id, start: startIn.value + '-01', months: daysIn.value }, 'Plan created'); } }, 'Create plan'),
          h('button', { class: 'btn sm', onclick: () => { if (!confirm('Create this plan for ALL schools? It replaces their calendars.')) return; call('/api/admin/calendar/plan', 'POST', { to: 'all', start: startIn.value + '-01', months: daysIn.value }, 'Plan created for all schools'); } }, 'Create for all schools'))),
      h('div', { class: 'card' }, h('h3', { style: 'margin:0 0 6px' }, 'Add one model'),
        h('div', { class: 'row wrap', style: 'gap:8px;align-items:end' }, h('label', { class: 'field grow', style: 'margin:0;min-width:200px' }, h('span', {}, 'Model'), mSel), h('label', { class: 'field', style: 'margin:0' }, h('span', {}, 'From month'), fromIn), h('label', { class: 'field', style: 'margin:0' }, h('span', {}, 'To'), toIn),
          h('button', { class: 'btn primary sm', onclick: () => call(`/api/admin/profiles/${sel.id}/calendar`, 'POST', { model: mSel.value, from: fromIn.value + '-01', to: monthEnd(toIn.value < fromIn.value ? fromIn.value : toIn.value) }, 'Added') }, 'Add'))),
      sel.entries.length ? h('div', { class: 'card' }, h('div', { class: 'row wrap', style: 'gap:8px;align-items:center' }, h('span', { class: 'muted small' }, 'Copy this calendar to'), copyTo,
        h('button', { class: 'btn sm', onclick: () => { if (!confirm('Replace the calendar of the chosen school(s) with this one?')) return; call('/api/admin/calendar/copy', 'POST', { from: sel.id, to: copyTo.value }, 'Calendar copied'); } }, 'Copy'))) : null);
    if (!editing) while (out.children.length > 5) out.lastElementChild.remove(); // view mode: the calendar only
    return out;
  }

  // ---------- usage ----------
  const fmtTime = (s) => (s < 60 ? (s ? s + ' sec' : '0 min') : s < 3600 ? Math.round(s / 60) + ' min' : Math.floor(s / 3600) + ' h ' + String(Math.round((s % 3600) / 60)).padStart(2, '0') + ' min');
  const ago = (t) => {
    if (!t) return 'Never';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'Just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    return Math.round(m / 1440) + ' days ago';
  };
  function adminUsage(A) {
    const U = A.usage;
    const range = h('div', { class: 'row wrap', style: 'margin:0 0 14px' }, [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([n, t]) =>
      h('button', { class: 'btn sm' + (U.days === n ? ' primary' : ''), onclick: () => { S.usageDays = n; refresh(); } }, t)));
    const big = (n, l) => h('div', { class: 'card', style: 'flex:1;min-width:120px;text-align:center;padding:14px 8px' }, h('div', { style: 'font-size:26px;font-weight:600' }, n), h('div', { class: 'muted small' }, l));
    const bars = (arr) => { const mx = Math.max(1, ...arr); return h('div', { style: 'display:flex;align-items:flex-end;gap:2px;height:34px', title: 'Time spent, last 14 days' }, arr.map((v) => h('i', { style: `flex:1;min-height:2px;border-radius:2px;background:linear-gradient(#5b8cff,#8f6bff);opacity:${v ? 1 : 0.18};height:${Math.max(6, (v / mx) * 100)}%` }))); };
    const cards = U.rows.map((r) => h('div', { class: 'card' },
      h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, r.label), h('span', { class: 'chip' }, 'Code ' + (r.pin || '-')), h('span', { class: 'muted small' }, 'Last active: ' + ago(r.last))),
      h('div', { class: 'row wrap', style: 'margin:10px 0;gap:18px' },
        h('div', {}, h('div', { style: 'font-size:20px;font-weight:600' }, fmtTime(r.seconds)), h('div', { class: 'muted small' }, 'Time spent')),
        h('div', {}, h('div', { style: 'font-size:20px;font-weight:600' }, r.plays), h('div', { class: 'muted small' }, 'Videos played')),
        h('div', {}, h('div', { style: 'font-size:20px;font-weight:600' }, r.views), h('div', { class: 'muted small' }, 'Model pages')),
        h('div', {}, h('div', { style: 'font-size:20px;font-weight:600' }, r.visits), h('div', { class: 'muted small' }, 'Visits')),
        h('div', {}, h('div', { style: 'font-size:20px;font-weight:600' }, r.activeDays), h('div', { class: 'muted small' }, 'Active days'))),
      r.cal && r.cal.total ? h('div', { class: 'small', style: 'margin-bottom:8px' }, `Calendar: ${r.cal.opened} of ${r.cal.total} sessions done` + (r.cal.missed ? ` · ${r.cal.missed} delayed` : '') + (r.cal.late ? ` · ${r.cal.late} done late` : '') + (r.cal.due ? ` · ${r.cal.due} due now` : '')) : null,
      r.seconds || r.plays ? bars(r.spark) : null,
      r.top.length ? h('div', { class: 'muted small', style: 'margin-top:10px' }, 'Most used: ' + r.top.map((t) => String(t.number).padStart(2, '0') + ' ' + t.name + (t.plays ? ` (${t.plays} ${t.plays === 1 ? 'play' : 'plays'})` : '')).join(' · ')) : h('div', { class: 'muted small', style: 'margin-top:6px' }, 'No activity in this period yet.')));
    return h('div', {},
      h('p', { class: 'lead' }, 'How much each school uses Luminary: time spent, videos played and which models they open. Counted per school, with no names or personal data.'),
      range,
      h('div', { class: 'row wrap', style: 'gap:10px;margin-bottom:14px' }, big(fmtTime(U.totals.seconds), 'Total time'), big(U.totals.plays, 'Videos played'), big(U.totals.views, 'Model pages'), big(U.totals.visits, 'Visits')),
      h('button', { class: 'btn sm', style: 'margin-bottom:14px', onclick: () => window.open(`/api/admin/usage.csv?days=${U.days}`, '_blank') }, 'Download CSV'),
      h('div', { class: 'list' }, cards.length ? cards : h('p', { class: 'muted' }, 'No schools yet.')));
  }

  // ---------- users ----------
  function adminUsers(A) {
    const pOpts = (sel) => [h('option', { value: '' }, 'All models')].concat(A.profiles.map((p) => h('option', { value: p.id, selected: p.id === sel || null }, p.label)));
    const rows = A.users.map((u) => {
      const sel = h('select', { class: 'input', style: 'min-height:36px;padding:4px 10px;width:auto', onchange: async () => { try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { profileId: sel.value } }); toast('Access updated'); } catch (e) { toast(e.message, true); } } }, pOpts(u.profileId));
      return h('div', { class: 'mrow', style: 'flex-wrap:wrap' },
        h('div', { class: 'meta' }, h('b', {}, u.username), h('span', { class: 'muted small' }, u.role === 'admin' ? 'Administrator' : 'User')),
        u.role === 'admin' ? null : sel,
        h('button', { class: 'btn sm', onclick: async () => { const pw = prompt(`New password for ${u.username}:`); if (!pw) return; try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { password: pw } }); toast('Password changed'); } catch (e) { toast(e.message, true); } } }, 'Reset password'),
        h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Delete ${u.username}?`)) return; try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); refresh(); } catch (e) { toast(e.message, true); } } }, 'Delete'));
    });
    const un = h('input', { class: 'input', placeholder: 'Username', autocapitalize: 'none' });
    const pw = h('input', { class: 'input', placeholder: 'Password (min 4)', type: 'text' });
    const pf = h('select', { class: 'input' }, pOpts(''));
    const err = h('div', { class: 'err' });
    return h('div', {}, h('p', { class: 'lead' }, 'Users sign in with a username and password and see the models their access level opens. (Visitors who scan a QR code do not need an account.)'),
      h('div', { class: 'list', style: 'margin-bottom:22px' }, rows),
      h('div', { class: 'card' }, h('h2', {}, 'Add a user'), h('div', { class: 'field' }, un), h('div', { class: 'field' }, pw),
        h('label', { class: 'field' }, h('span', {}, 'Access'), pf), err,
        h('button', { class: 'btn primary', onclick: async () => { try { await api('/api/admin/users', { method: 'POST', body: { username: un.value, password: pw.value, profileId: pf.value } }); toast('User added'); refresh(); } catch (e) { err.textContent = e.message; } } }, 'Add user')));
  }

  // ---------- settings ----------
  function adminSettings(A) {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'err' });
    return h('div', { class: 'list' },
      h('div', { class: 'card' }, h('h2', {}, `Change password (${A.me})`),
        h('label', { class: 'field' }, h('span', {}, 'Current password'), cur), h('label', { class: 'field' }, h('span', {}, 'New password (min 6)'), nw), err,
        h('button', { class: 'btn primary', onclick: async () => { try { await api('/api/admin/password', { method: 'POST', body: { current: cur.value, next: nw.value } }); toast('Password changed'); cur.value = nw.value = ''; err.textContent = ''; refresh(); } catch (e) { err.textContent = e.message; } } }, 'Update password')),
      h('div', { class: 'card' }, h('h2', {}, 'Storage'),
        h('p', { class: 'muted small' }, A.storage && A.storage.kind === 'gcs'
          ? `Photos and the database are stored in the Google Cloud Storage bucket gs://${A.storage.bucket}. Videos are played from YouTube.`
          : 'Photos and the database are stored on this server\u2019s disk. Set GCS_BUCKET to use a Google Cloud Storage bucket instead.')),
      h('div', { class: 'card' }, h('h2', {}, 'Brand logo'), h('p', { class: 'muted small' }, 'Upload your Luminary logo image (PNG/WebP with a transparent or black background) to replace the built-in wordmark.'),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => pickFile('image/*', async (f) => { try { await upload('/api/admin/logo', f, () => {}, {}); toast('Logo updated'); await loadCatalog(); refresh(); } catch (e) { toast(e.message, true); } }) }, 'Upload logo'),
          A.logo ? h('button', { class: 'btn sm danger', onclick: async () => { await api('/api/admin/logo', { method: 'DELETE' }); await loadCatalog(); refresh(); } }, 'Use built-in wordmark') : null)));
  }

  window.LM.adminView = adminView;
})();
