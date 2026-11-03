'use strict';
// Light custom video player: big touch targets, instant scrubbing, auto quality, phone landscape mode.
(() => {
  const { h, mb } = window.LM;
  const players = new Set();
  const RANK = { low: 0, mid: 1, high: 2 };
  const QNAME = { low: 'Data saver', mid: 'Standard', high: 'HD' };
  const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const I = {
    play: '<path d="M8 5.5v13a.5.5 0 00.77.42l10.2-6.5a.5.5 0 000-.84L8.77 5.08A.5.5 0 008 5.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/>',
    replay: '<path d="M4 12a8 8 0 108-8M4 4v5h5"/>',
    back: '<path d="M11 5L5 11l6 6"/><path d="M5 11h9a5 5 0 010 10h-2"/>',
    fwd: '<path d="M13 5l6 6-6 6"/><path d="M19 11h-9a5 5 0 000 10h2"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    exit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const ic = (n, cls = '') => h('span', { class: 'pi ' + cls, html: `<svg viewBox="0 0 24 24">${I[n]}</svg>` });
  const isPhone = () => matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 700;

  function netIndex(len) {
    const c = navigator.connection || {};
    let s = 2;
    if (c.saveData) s = 0;
    else {
      if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g') s = 0;
      else if (c.effectiveType === '3g') s = 1;
      if (c.downlink) { if (c.downlink < 1.2) s = Math.min(s, 0); else if (c.downlink < 3.5) s = Math.min(s, 1); }
    }
    return s === 0 ? 0 : s === 1 ? Math.min(1, len - 1) : len - 1;
  }

  function Player(info, opts = {}) {
    const R = [...info.renditions].sort((a, b) => a.h - b.h);
    let cur = -1;
    let pref = 'auto';
    try { pref = localStorage.getItem('lm_q') || 'auto'; } catch {}
    let speed = 1;
    let dragging = false;
    let pending = 0;
    let hideT = null;
    let stalls = [];
    let stallT = null;
    let inCinema = false;
    let pushed = false;
    let saved = new Set();

    const v = h('video', { playsinline: '', preload: 'none', poster: info.poster || opts.poster || null, disablepictureinpicture: null });
    v.setAttribute('webkit-playsinline', '');
    const total = () => (isFinite(v.duration) && v.duration > 0 ? v.duration : info.duration || 0);

    // --- UI pieces ---
    const bigLabel = h('span', { class: 'pl-meta' });
    const big = h('button', { class: 'pl-big', 'aria-label': 'Play ' + (opts.title || 'video'), onclick: () => start() }, ic('play'), bigLabel);
    const spin = h('div', { class: 'pl-spin', hidden: true });
    const flash = h('div', { class: 'pl-flash' });
    const msg = h('div', { class: 'pl-msg', hidden: true });
    const surface = h('div', { class: 'pl-surface' });

    const tCur = h('span', { class: 'pl-t' }, '0:00');
    const tTot = h('span', { class: 'pl-t' }, fmt(total()));
    const buf = h('i', { class: 'pl-buf' });
    const fill = h('i', { class: 'pl-fill' });
    const thumb = h('i', { class: 'pl-thumb' });
    const tip = h('div', { class: 'pl-tip' }, '0:00');
    const seek = h('div', { class: 'pl-seek', role: 'slider', 'aria-label': 'Seek', tabindex: '0' }, h('div', { class: 'pl-trk' }, buf, fill), thumb, tip);

    const playBtn = h('button', { class: 'pl-btn main', 'aria-label': 'Play/Pause', onclick: () => toggle() }, ic('play'));
    const backBtn = h('button', { class: 'pl-btn', 'aria-label': 'Back 10 seconds', onclick: () => skip(-10) }, ic('back'), h('em', {}, '10'));
    const fwdBtn = h('button', { class: 'pl-btn', 'aria-label': 'Forward 10 seconds', onclick: () => skip(10) }, ic('fwd'), h('em', {}, '10'));
    const speedBtn = h('button', { class: 'pl-chipbtn', 'aria-label': 'Playback speed', onclick: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; v.playbackRate = speed; speedBtn.textContent = speed + '×'; keepUI(); } }, '1×');
    const qBtn = h('button', { class: 'pl-chipbtn', 'aria-label': 'Quality', onclick: () => toggleMenu() }, 'Auto');
    const fsBtn = h('button', { class: 'pl-btn', 'aria-label': 'Fullscreen', onclick: () => (inCinema ? exitCinema() : enterCinema()) }, ic('full'));
    const menu = h('div', { class: 'pl-menu', hidden: true });
    const closeBtn = h('button', { class: 'pl-btn close', 'aria-label': 'Close fullscreen', onclick: () => exitCinema() }, ic('close'));
    const title = h('div', { class: 'pl-title' }, opts.title || '');

    const ctl = h('div', { class: 'pl-ctl' },
      h('div', { class: 'pl-top' }, closeBtn, title),
      h('div', { class: 'pl-bot' },
        h('div', { class: 'pl-bar' }, tCur, seek, tTot),
        h('div', { class: 'pl-row' }, backBtn, playBtn, fwdBtn, h('span', { class: 'grow' }), speedBtn, qBtn, fsBtn)),
      menu);

    const root = h('div', { class: 'pl idle', tabindex: '-1' }, v, surface, big, spin, flash, msg, ctl);

    // --- quality selection ---
    async function cachedSet() {
      const s = new Set();
      try { const c = await caches.open('lm-media'); for (let i = 0; i < R.length; i++) if (await c.match(R[i].url)) s.add(i); } catch {}
      return s;
    }
    function indexFor(q) {
      let best = 0;
      R.forEach((r, i) => { if (RANK[r.q] <= RANK[q]) best = i; });
      return best;
    }
    async function pickIndex() {
      saved = await cachedSet();
      if (saved.size) { // anything already on the device costs no data
        if (pref !== 'auto') { const i = indexFor(pref); if (saved.has(i)) return i; }
        return Math.max(...saved);
      }
      return pref === 'auto' ? netIndex(R.length) : indexFor(pref);
    }
    function label(i) { return R[i] ? `${R[i].h}p` : ''; }
    function refreshQ() {
      qBtn.textContent = pref === 'auto' ? `Auto · ${label(cur)}` : label(cur);
    }
    function load(i, at, play) {
      cur = i;
      v.preload = 'auto';
      v.src = R[i].url;
      v.playbackRate = speed;
      const go = () => { if (at) v.currentTime = at; if (play) v.play().catch(() => {}); };
      v.addEventListener('loadedmetadata', go, { once: true });
      v.load();
      refreshQ();
    }
    function switchTo(i, note) {
      if (i === cur || !R[i]) return;
      const at = v.currentTime;
      const was = !v.paused || root.classList.contains('buffering');
      load(i, at, was);
      if (note) toast(note);
    }
    function toast(t) { msg.textContent = t; msg.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (msg.hidden = true), 2600); }

    function toggleMenu(force) {
      const open = force !== undefined ? force : menu.hidden;
      menu.hidden = !open;
      if (!open) return keepUI();
      const items = [['auto', 'Auto', 'Picks the best for your connection']].concat(R.map((r) => [r.q, `${QNAME[r.q]} · ${r.h}p`, mb(r.size)]));
      menu.replaceChildren(...items.map(([q, name, sub]) => h('button', { class: 'pl-opt' + (q === pref ? ' on' : ''), onclick: async () => {
        pref = q;
        try { localStorage.setItem('lm_q', q); } catch {}
        menu.hidden = true;
        if (v.src) { const i = q === 'auto' ? await pickIndex() : indexFor(q); switchTo(i); refreshQ(); } else refreshQ();
        keepUI();
      } }, h('b', {}, name), h('small', {}, sub))));
      clearTimeout(hideT);
    }

    // --- playback ---
    async function start() {
      big.disabled = true;
      const i = await pickIndex();
      root.classList.remove('idle');
      if (window.LM.activePlayer && window.LM.activePlayer !== api) window.LM.activePlayer.pause();
      window.LM.activePlayer = api;
      load(i, 0, true);
      if (isPhone()) enterCinema();
      showUI();
    }
    function toggle() {
      if (!v.src) return start();
      if (v.ended) { v.currentTime = 0; return v.play(); }
      v.paused ? v.play().catch(() => {}) : v.pause();
    }
    function skip(d) {
      if (!v.src) return;
      v.currentTime = clamp(v.currentTime + d, 0, total());
      flash.textContent = (d > 0 ? '+' : '−') + Math.abs(d) + 's';
      flash.className = 'pl-flash show ' + (d > 0 ? 'r' : 'l');
      clearTimeout(skip.t); skip.t = setTimeout(() => (flash.className = 'pl-flash'), 520);
      keepUI();
    }

    // --- progress display ---
    let raf = 0;
    function paint() {
      raf = 0;
      const d = total();
      const t = dragging ? pending : v.currentTime;
      const p = d ? clamp(t / d, 0, 1) : 0;
      fill.style.width = p * 100 + '%';
      thumb.style.left = p * 100 + '%';
      tCur.textContent = fmt(t);
      tTot.textContent = fmt(d);
      seek.setAttribute('aria-valuenow', Math.round(p * 100));
      if (v.buffered && v.buffered.length && d) {
        let end = 0;
        for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5) end = Math.max(end, v.buffered.end(i));
        buf.style.width = clamp(end / d, 0, 1) * 100 + '%';
      }
    }
    const queuePaint = () => { if (!raf) raf = requestAnimationFrame(paint); };
    ['timeupdate', 'progress', 'durationchange', 'seeked'].forEach((e) => v.addEventListener(e, queuePaint));

    const setPlayIcon = () => {
      const n = v.ended ? 'replay' : v.paused ? 'play' : 'pause';
      playBtn.replaceChildren(ic(n));
      root.classList.toggle('paused', v.paused);
    };
    v.addEventListener('play', () => { setPlayIcon(); keepUI(); });
    v.addEventListener('pause', () => { setPlayIcon(); showUI(); });
    v.addEventListener('ended', () => { setPlayIcon(); showUI(); });
    v.addEventListener('waiting', () => {
      spin.hidden = false; root.classList.add('buffering');
      const now = Date.now();
      stalls = stalls.filter((t) => now - t < 40000).concat(now);
      if (pref === 'auto' && cur > 0) {
        if (stalls.length >= 2) { stalls = []; switchTo(cur - 1, 'Slow connection - switched to a lighter quality'); }
        else { clearTimeout(stallT); stallT = setTimeout(() => { if (root.classList.contains('buffering') && cur > 0) switchTo(cur - 1, 'Slow connection - switched to a lighter quality'); }, 4500); }
      }
    });
    const ready = () => { spin.hidden = true; root.classList.remove('buffering'); clearTimeout(stallT); };
    ['playing', 'canplay', 'seeked'].forEach((e) => v.addEventListener(e, ready));
    v.addEventListener('error', () => {
      if (cur > 0 && navigator.onLine) return switchTo(cur - 1, 'Could not load this quality - trying a lighter one');
      ready();
      msg.hidden = false;
      msg.textContent = navigator.onLine ? 'This video could not be played.' : 'You are offline and this video is not saved on the device.';
    });

    // --- controls visibility ---
    function showUI() { root.classList.add('ui'); clearTimeout(hideT); }
    function keepUI() {
      showUI();
      hideT = setTimeout(() => { if (!v.paused && !dragging && menu.hidden) root.classList.remove('ui'); }, 3200);
    }

    // --- scrubbing (pointer events: works with touch, pen, mouse) ---
    const rot = () => root.classList.contains('rot');
    const ratio = (e, el) => { const r = el.getBoundingClientRect(); return clamp(rot() ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width, 0, 1); };
    let lastSeek = 0;
    function scrub(e) {
      const d = total();
      pending = ratio(e, seek) * d;
      tip.textContent = fmt(pending);
      tip.style.left = clamp(pending / (d || 1), 0, 1) * 100 + '%';
      queuePaint();
      const now = performance.now();
      if (now - lastSeek > 90) { lastSeek = now; if (v.fastSeek) v.fastSeek(pending); else v.currentTime = pending; }
    }
    seek.addEventListener('pointerdown', (e) => {
      if (!v.src) return;
      dragging = true; root.classList.add('drag'); showUI();
      seek.setPointerCapture(e.pointerId);
      scrub(e);
    });
    seek.addEventListener('pointermove', (e) => { if (dragging) scrub(e); });
    const endDrag = () => { if (!dragging) return; dragging = false; root.classList.remove('drag'); v.currentTime = pending; keepUI(); queuePaint(); };
    seek.addEventListener('pointerup', endDrag);
    seek.addEventListener('pointercancel', endDrag);
    seek.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { skip(-5); e.preventDefault(); } else if (e.key === 'ArrowRight') { skip(5); e.preventDefault(); } });

    // tap = show/hide controls, double-tap left/right = jump 10s
    let lastTap = { t: 0, side: 0 };
    let tapT = null;
    surface.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!menu.hidden) { toggleMenu(false); return; }
      const side = ratio(e, surface) < 0.4 ? -1 : ratio(e, surface) > 0.6 ? 1 : 0;
      const now = Date.now();
      if (side && lastTap.side === side && now - lastTap.t < 320) { clearTimeout(tapT); skip(side * 10); lastTap = { t: 0, side: 0 }; return; }
      lastTap = { t: now, side };
      clearTimeout(tapT);
      tapT = setTimeout(() => {
        if (e.pointerType === 'mouse') toggle(); // desktop: click toggles play like every other player
        else if (root.classList.contains('ui') && !v.paused) root.classList.remove('ui'); else keepUI();
      }, 240);
    });
    root.addEventListener('mousemove', () => { if (!v.paused) keepUI(); });
    root.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === ' ' || k === 'k') { toggle(); e.preventDefault(); }
      else if (k === 'ArrowLeft') skip(-5); else if (k === 'ArrowRight') skip(5);
      else if (k === 'j') skip(-10); else if (k === 'l') skip(10);
      else if (k === 'f') (inCinema ? exitCinema() : enterCinema());
      else if (k === 'Escape' && inCinema) exitCinema();
    });

    // --- fullscreen / landscape ---
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    function applyRot() {
      // portrait phone where the browser could not rotate for us: rotate the player with CSS instead
      const portrait = window.innerHeight > window.innerWidth;
      root.classList.toggle('rot', inCinema && isPhone() && portrait && !fsEl());
    }
    async function enterCinema() {
      if (inCinema) return;
      inCinema = true;
      root.classList.add('cin');
      document.body.classList.add('cin-open');
      fsBtn.replaceChildren(ic('exit'));
      try { history.pushState({ lmcin: 1 }, ''); pushed = true; } catch {}
      try {
        const f = root.requestFullscreen || root.webkitRequestFullscreen;
        if (f) await f.call(root, { navigationUI: 'hide' });
      } catch {}
      try { if (isPhone() && screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch {}
      await new Promise((r) => setTimeout(r, 250));
      // Orientation lock refused (iPhone, some Android): a fullscreen element cannot be rotated by CSS,
      // so leave real fullscreen and fill the screen with a rotated player instead.
      if (isPhone() && window.innerHeight > window.innerWidth && fsEl()) {
        ignoreFs = true;
        try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {}
        setTimeout(() => { ignoreFs = false; }, 400);
      }
      applyRot();
      showUI();
    }
    function leaveCinema() {
      if (!inCinema) return;
      inCinema = false;
      root.classList.remove('cin', 'rot');
      document.body.classList.remove('cin-open');
      fsBtn.replaceChildren(ic('full'));
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch {}
    }
    async function exitCinema() {
      try { if (fsEl()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {}
      leaveCinema();
      if (pushed) { pushed = false; try { history.back(); } catch {} }
    }
    let ignoreFs = false;
    const onFs = () => { if (ignoreFs) { fsSeen = false; applyRot(); return; } if (inCinema && !fsEl() && root.classList.contains('cin') && fsSeen) { leaveCinema(); if (pushed) { pushed = false; try { history.back(); } catch {} } } fsSeen = !!fsEl(); applyRot(); };
    let fsSeen = false;
    const onPop = () => { if (inCinema && pushed) { pushed = false; (fsEl() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(() => {}) : 0); leaveCinema(); } };
    const onResize = () => applyRot();
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    window.addEventListener('popstate', onPop);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // lock-screen / headset controls
    if ('mediaSession' in navigator) {
      v.addEventListener('play', () => {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({ title: opts.title || 'Luminary', artist: 'Luminary · BotClub', artwork: info.poster ? [{ src: info.poster, sizes: '640x360', type: 'image/jpeg' }] : [] });
          navigator.mediaSession.setActionHandler('play', () => v.play());
          navigator.mediaSession.setActionHandler('pause', () => v.pause());
          navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
          navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
        } catch {}
      });
    }

    // idle badge: length, quality that will play, and whether it is already on the device
    (async () => {
      const i = await pickIndex().catch(() => R.length - 1);
      const r = R[i];
      bigLabel.textContent = [fmt(info.duration), r ? `${r.h}p` : '', saved.has(i) ? 'saved offline' : r ? mb(r.size) : ''].filter(Boolean).join(' · ');
      cur = i; refreshQ();
    })();
    speedBtn.textContent = '1×';
    setPlayIcon();

    const api = {
      el: root,
      pause: () => v.pause(),
      destroy() {
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch {}
        if (inCinema) { try { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {} leaveCinema(); }
        document.removeEventListener('fullscreenchange', onFs);
        document.removeEventListener('webkitfullscreenchange', onFs);
        window.removeEventListener('popstate', onPop);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
        clearTimeout(hideT); clearTimeout(stallT); players.delete(api);
        if (window.LM.activePlayer === api) window.LM.activePlayer = null;
      },
    };
    players.add(api);
    return api;
  }

  window.LM.Player = Player;
  window.LM.stopPlayers = () => { [...players].forEach((p) => p.destroy()); };
})();
