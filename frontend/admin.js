'use strict';
// Admin panel - loaded on demand so visitors never download it.
(() => {
  const { h, api, modal, toast, svg, mb, S, header, footer, loadCatalog } = window.LM;
  const TABS = [['models', 'Models'], ['qr', 'QR access'], ['users', 'Users'], ['settings', 'Settings']];
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
    const seg = h('div', { class: 'seg tabs' }, tabs.map(([k, n]) => h('button', { class: k === S.adminTab ? 'on' : '', onclick: () => (location.hash = `#/admin/${k}`) }, n)));
    const body = { models: adminModels, qr: adminQr, users: adminUsers, settings: adminSettings }[S.adminTab](A);
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
    h('p', { class: 'muted small', style: 'margin:0 0 14px' }, 'Videos of any size are compressed automatically into Data saver / Standard / HD versions after upload.'), list);
  }

  // XHR upload with progress, speed and cancel
  function upload(url, file, onProgress, ctl) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      ctl.abort = () => x.abort();
      x.open('POST', url);
      const t0 = Date.now();
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total, e.loaded / Math.max(0.5, (Date.now() - t0) / 1000), e.loaded, e.total);
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Upload failed')); };
      x.onerror = () => reject(new Error('Upload failed - check your connection.'));
      x.onabort = () => reject(new Error('cancelled'));
      const fd = new FormData();
      fd.append('file', file);
      x.send(fd);
    });
  }

  // Straight to Cloudinary in chunks (large videos are allowed; each chunk is one request)
  async function uploadCloud(c, file, onProgress, ctl) {
    const id = Math.random().toString(36).slice(2) + Date.now();
    const total = file.size;
    const t0 = Date.now();
    let start = 0;
    let aborted = false;
    let cur = null;
    ctl.abort = () => { aborted = true; if (cur) cur.abort(); };
    while (start < total) {
      if (aborted) throw new Error('cancelled');
      const end = Math.min(start + c.chunk, total);
      const base = start;
      await new Promise((resolve, reject) => {
        const x = (cur = new XMLHttpRequest());
        x.open('POST', c.url);
        if (total > c.chunk) { x.setRequestHeader('X-Unique-Upload-Id', id); x.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${total}`); }
        x.upload.onprogress = (e) => { const done = base + e.loaded; onProgress(Math.min(1, done / total), done / Math.max(0.5, (Date.now() - t0) / 1000), done, total); };
        x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error((d.error && d.error.message) || 'Upload failed')); };
        x.onerror = () => reject(new Error('Upload failed - check your connection.'));
        x.onabort = () => reject(new Error('cancelled'));
        const fd = new FormData();
        Object.entries(c.fields).forEach(([k, v]) => fd.append(k, v));
        fd.append('file', file.slice(start, end), file.name);
        x.send(fd);
      });
      start = end;
    }
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
          box.append(slots.image.el, slots.working.el, slots.assembly.el);
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

  function videoSlot(get, slot, label, set) {
    const el = h('div');
    let ctl = null;
    let up = null; // live upload state { pct, text }
    const render = () => {
      const m = get();
      const v = m.files[slot];
      const pend = v && v.pending;
      const s = slotBox(label, h('span', { class: 'muted small' }, v && v.ready ? `${dur(v.duration)} · ${v.renditions.length} qualities` : 'Not set'));
      // 1) uploading from this browser
      if (up) {
        s.append(h('div', { class: 'row small muted', style: 'margin:6px 0' }, h('span', { class: 'grow' }, up.text), h('button', { class: 'btn sm', onclick: () => ctl && ctl.abort() }, 'Cancel')),
          h('div', { class: 'bar' }, h('i', { style: `width:${up.pct * 100}%` })));
      } else if (pend && pend.status === 'processing') {
        // 2) server is compressing
        s.append(h('div', { class: 'row small muted', style: 'margin:6px 0' }, h('span', { class: 'grow' }, `Compressing${pend.name ? ' ' + pend.name : ''}… ${Math.round(pend.progress * 100)}%`)),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(3, pend.progress * 100)}%` })),
          h('p', { class: 'muted small' }, v && v.ready ? 'Visitors keep seeing the current video until the new one is ready.' : 'It appears for visitors as soon as it is ready. You can close this window.'));
      } else if (pend && pend.status === 'error') {
        s.append(h('div', { class: 'err' }, pend.error || 'Could not process this video.'));
      }
      // 3) finished video: qualities, thumbnail picker
      if (v && v.ready) {
        s.append(h('div', { class: 'row wrap', style: 'margin:6px 0' }, v.renditions.map((r) => h('span', { class: 'chip' }, `${r.h}p · ${mb(r.size)}`))));
        if (v.posters.length) {
          s.append(h('div', { class: 'muted small', style: 'margin:8px 0 6px' }, 'Thumbnail - tap the frame that shows the finished model'),
            h('div', { class: 'posters' }, v.posters.map((u, i) => h('button', { class: 'pst' + (i === v.poster ? ' on' : ''), 'aria-label': `Thumbnail ${i + 1}`, onclick: async () => {
              try { set(await api(`/api/admin/models/${m.id}/poster/${slot}`, { method: 'POST', body: { index: i } })); } catch (e) { toast(e.message, true); }
            } }, h('img', { src: u, alt: '', loading: 'lazy' })))),
            h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: async () => {
              try { set(await api(`/api/admin/models/${m.id}/poster/${slot}`, { method: 'POST', body: { index: v.poster, useAsFolderImage: true } })); toast('Folder image updated'); } catch (e) { toast(e.message, true); }
            } }, 'Use as folder image'));
        }
        const mid = v.renditions[Math.min(1, v.renditions.length - 1)];
        s.append(h('video', { src: mid.url, poster: v.posters[v.poster] || null, controls: true, preload: 'none', playsinline: true }));
      }
      s.append(h('div', { class: 'row wrap', style: 'margin-top:6px' },
        h('button', { class: 'btn sm', disabled: up ? true : null, onclick: () => pickFile('video/*,.mkv,.mov,.avi', async (file) => {
          ctl = {};
          up = { pct: 0, text: `Uploading ${file.name}…` };
          render();
          try {
            const onProg = (p, bps, done, total) => {
              up.pct = p; up.text = `Uploading ${Math.round(p * 100)}% · ${mb(done)} of ${mb(total)} · ${mb(bps)}/s`;
              const b = el.querySelector('.bar i'); if (b) b.style.width = p * 100 + '%';
              const t = el.querySelector('.slot .small span.grow'); if (t) t.textContent = up.text;
            };
            // with Cloudinary the file goes straight there (and is compressed there), then the server is told it is uploaded
            const d = await api(`/api/admin/models/${m.id}/upload-url/${slot}`, { method: 'POST', body: { filename: file.name, type: file.type, size: file.size } });
            let nm;
            if (d.direct) {
              await uploadCloud(d.cloud, file, onProg, ctl);
              nm = await api(`/api/admin/models/${m.id}/file/${slot}/complete`, { method: 'POST', body: { key: d.key } });
            } else nm = await upload(`/api/admin/models/${m.id}/file/${slot}`, file, onProg, ctl);
            up = null;
            toast('Uploaded - compressing now');
            set(nm);
          } catch (e) { up = null; render(); if (e.message !== 'cancelled') toast(e.message, true); }
        }) }, v ? 'Replace' : 'Upload'),
        v ? h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Delete the ${label.toLowerCase()}?`)) return; try { set(await api(`/api/admin/models/${m.id}/file/${slot}`, { method: 'DELETE' })); } catch (e) { toast(e.message, true); } } }, 'Delete') : null));
      el.replaceChildren(s);
    };
    render();
    return { el, render };
  }

  // ---------- QR ----------
  function adminQr(A) {
    const wrap = h('div', { class: 'list' }, A.profiles.map((p) => qrCard(p, A)));
    return h('div', {},
      h('p', { class: 'lead' }, 'Each QR code opens the library with its own set of unlocked models. Print different QR codes for different customers or kits.'),
      h('button', { class: 'btn primary sm', style: 'margin-bottom:16px', onclick: async () => { try { await api('/api/admin/profiles', { method: 'POST', body: { label: 'New QR', mode: 'all' } }); refresh(); } catch (e) { toast(e.message, true); } } }, '+ New QR code'),
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
    const label = h('input', { class: 'input', value: p.label, maxlength: 60, 'aria-label': 'QR label' });
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
    const save = async (patch, msg) => { try { await api(`/api/admin/profiles/${p.id}`, { method: 'PATCH', body: patch }); toast(msg || 'Saved'); refresh(); } catch (e) { toast(e.message, true); } };
    const dl = h('button', { class: 'btn sm', style: 'margin-top:10px;width:100%', onclick: () => downloadQr(p, dl) }, 'Download PNG');
    return h('div', { class: 'card qrcard' },
      h('div', {}, h('img', { class: 'qr', src: `/api/admin/profiles/${p.id}/qr.png?size=400&t=${Date.now()}`, alt: 'QR code' }), dl),
      h('div', { class: 'grow' },
        h('label', { class: 'field' }, h('span', {}, 'Label'), label),
        h('div', { class: 'row wrap', style: 'margin-bottom:12px' }, h('span', { class: 'link grow' }, p.link),
          h('button', { class: 'btn sm', onclick: () => { (navigator.clipboard ? navigator.clipboard.writeText(p.link) : Promise.reject()).then(() => toast('Link copied'), () => toast('Copy failed - select the link and copy it', true)); } }, 'Copy')),
        seg, picker,
        h('label', { class: 'check', style: 'margin-top:12px' }, editor, 'Editor link: anyone with this QR can upload and manage models and videos (not users, passwords or QR codes)'),
        h('div', { class: 'row wrap', style: 'margin-top:14px' },
          h('button', { class: 'btn primary sm', onclick: () => save({ label: label.value, mode, allowed: [...sel], editor: editor.checked }) }, 'Save'),
          h('button', { class: 'btn sm', onclick: () => save({ mode: 'all' }, 'All models opened') }, 'Open all'),
          h('button', { class: 'btn sm', onclick: () => save({ mode: 'custom', allowed: [] }, 'All models locked') }, 'Lock all'),
          A.profiles.length > 1 ? h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Delete QR "${p.label}"? Printed copies will stop working.`)) return; try { await api(`/api/admin/profiles/${p.id}`, { method: 'DELETE' }); refresh(); } catch (e) { toast(e.message, true); } } }, 'Delete') : null)));
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
        h('p', { class: 'muted small' }, A.storage && A.storage.kind === 'cloudinary'
          ? `Photos, videos and the database are stored in Cloudinary (${A.storage.cloudName}). Videos upload straight to Cloudinary, which compresses them.`
          : 'Photos, videos and the database are stored on this server’s disk. Set CLOUDINARY_URL to store everything in Cloudinary instead.')),
      h('div', { class: 'card' }, h('h2', {}, 'Brand logo'), h('p', { class: 'muted small' }, 'Upload your Luminary logo image (PNG/WebP with a transparent or black background) to replace the built-in wordmark.'),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => pickFile('image/*', async (f) => { try { await upload('/api/admin/logo', f, () => {}, {}); toast('Logo updated'); await loadCatalog(); refresh(); } catch (e) { toast(e.message, true); } }) }, 'Upload logo'),
          A.logo ? h('button', { class: 'btn sm danger', onclick: async () => { await api('/api/admin/logo', { method: 'DELETE' }); await loadCatalog(); refresh(); } }, 'Use built-in wordmark') : null)));
  }

  window.LM.adminView = adminView;
})();
