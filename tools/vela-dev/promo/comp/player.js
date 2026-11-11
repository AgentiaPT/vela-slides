// ─────────────────────────────────────────────────────────────────────────
// player.js — interactive player for the promo composition.
//
// Used when the page is opened by a person (not by render.js). It turns the
// timeline into a presentation that plays itself: chapters, a progress bar,
// keyboard control and the soundtrack when one is available.
//
//   Space / K  play or pause        ← / →   previous / next chapter
//   Home       first chapter        M       sound on or off
//   F          fullscreen           click on the bar: go to that time
//
// Input: window.__promo = { duration, seek(t), chapters: [{ t, label }] }
//        window.PROMO_AUDIO (optional URL or data URI of the mixed track)
// ─────────────────────────────────────────────────────────────────────────
(function () {
  const P = window.__promo, CH = P.chapters, DUR = P.duration;
  const css = document.createElement('style');
  css.textContent = `
    #pl { position: fixed; left: 0; right: 0; bottom: 0; padding: 14px max(20px, env(safe-area-inset-right, 0px)) calc(16px + env(safe-area-inset-bottom, 0px)) max(20px, env(safe-area-inset-left, 0px)); font: 500 16px/1.3 'DM Sans', 'Inter', system-ui, sans-serif; color: #eef1ff;
      background: linear-gradient(to top, rgba(3,4,18,.94), rgba(3,4,18,0)); transition: opacity .35s; z-index: 10; user-select: none; }
    #pl.idle { opacity: 0; }
    #pl .pl-row { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
    #pl button { font: inherit; color: inherit; background: rgba(129,140,248,.18); border: 1px solid rgba(165,180,252,.5); border-radius: 10px; min-width: 46px; height: 42px; padding: 0 14px; cursor: pointer; }
    #pl button:hover, #pl button:focus-visible { background: rgba(129,140,248,.4); outline: none; }
    #pl .pl-ch { flex: 1; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #pl .pl-ch b { color: #a5b4fc; font-weight: 600; margin-right: 10px; }
    #pl .pl-tm { font-variant-numeric: tabular-nums; font-size: 16px; color: #c7cdfa; }
    #bar { position: relative; height: 18px; cursor: pointer; }
    #bar i { position: absolute; left: 0; right: 0; top: 7px; height: 4px; border-radius: 2px; background: rgba(165,180,252,.28); }
    #bar em { position: absolute; left: 0; top: 7px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #22d3ee, #818cf8, #f472b6); }
    #bar s { position: absolute; top: 4px; width: 2px; height: 10px; background: rgba(238,241,255,.55); }
    #start { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; z-index: 20; cursor: pointer;
      background: rgba(3,4,18,.55); font: 600 22px/1.4 'DM Sans', 'Inter', system-ui, sans-serif; color: #eef1ff; text-align: center; padding: 16px; }
    #start div { width: 108px; height: 108px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #c084fc); display: flex; align-items: center; justify-content: center;
      font-size: 44px; padding-left: 8px; box-shadow: 0 0 70px rgba(129,140,248,.8); }
    #start small { font-size: 16px; font-weight: 500; color: #c7cdfa; max-width: 34em; }
    @media (max-width: 640px) { #pl .pl-tm { display: none; } }`;
  document.head.appendChild(css);

  const pl = document.createElement('div'); pl.id = 'pl';
  pl.innerHTML = `<div id="bar"><i></i><em></em></div><div class="pl-row">
    <button id="bprev" title="Previous chapter (←)" aria-label="Previous chapter">⏮</button>
    <button id="bplay" title="Play or pause (Space)" aria-label="Play or pause">▶</button>
    <button id="bnext" title="Next chapter (→)" aria-label="Next chapter">⏭</button>
    <div class="pl-ch"></div><div class="pl-tm"></div>
    <button id="bmute" title="Sound (M)" aria-label="Sound">🔊</button>
    <button id="bfs" title="Fullscreen (F)" aria-label="Fullscreen">⛶</button></div>`;
  document.body.appendChild(pl);
  const bar = pl.querySelector('#bar'), fill = bar.querySelector('em'), chEl = pl.querySelector('.pl-ch'), tmEl = pl.querySelector('.pl-tm');
  CH.forEach(c => { const s = document.createElement('s'); s.style.left = (c.t / DUR * 100) + '%'; bar.appendChild(s); });
  const start = document.createElement('div'); start.id = 'start';
  start.innerHTML = '<div>▶</div>Play the Vela Slides tour<small>Space: play or pause · ← →: chapters · F: fullscreen · M: sound</small>';
  document.body.appendChild(start);

  const audio = window.PROMO_AUDIO ? new Audio(window.PROMO_AUDIO) : null;
  if (audio) audio.preload = 'auto'; else pl.querySelector('#bmute').style.display = 'none';
  let t = Math.min(DUR - 0.05, parseFloat(new URLSearchParams(location.search).get('t') || '0')), playing = false, anchor = 0;
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const chapterAt = x => { let k = 0; CH.forEach((c, i) => { if (c.t <= x + 0.02) k = i; }); return k; };
  function paint() {
    P.seek(t);
    fill.style.width = (t / DUR * 100) + '%';
    const k = chapterAt(t); chEl.innerHTML = `<b>${k + 1} / ${CH.length}</b>${CH[k].label}`;
    tmEl.textContent = fmt(t) + ' / ' + fmt(DUR);
  }
  function setPlaying(on) {
    playing = on; pl.querySelector('#bplay').textContent = on ? '⏸' : '▶';
    if (on) { anchor = performance.now() - t * 1000; if (audio) { audio.currentTime = t; audio.play().catch(() => {}); } requestAnimationFrame(loop); }
    else if (audio) audio.pause();
  }
  function loop() {
    if (!playing) return;
    t = (performance.now() - anchor) / 1000;
    // Keep the picture locked to the sound.
    if (audio && !audio.paused && Math.abs(audio.currentTime - t) > 0.07) { t = audio.currentTime; anchor = performance.now() - t * 1000; }
    if (t >= DUR) { t = DUR - 0.05; paint(); setPlaying(false); return; }
    paint(); requestAnimationFrame(loop);
  }
  function go(x) { t = Math.max(0, Math.min(DUR - 0.05, x)); anchor = performance.now() - t * 1000; if (audio) audio.currentTime = t; paint(); }
  const next = () => { const k = chapterAt(t); go(k + 1 < CH.length ? CH[k + 1].t : DUR - 0.05); };
  const prev = () => { const k = chapterAt(t); go(t - CH[k].t > 1.2 || k === 0 ? CH[k].t : CH[k - 1].t); };
  const fs = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
  const mute = () => { if (audio) { audio.muted = !audio.muted; pl.querySelector('#bmute').textContent = audio.muted ? '🔇' : '🔊'; } };

  start.addEventListener('click', () => { start.remove(); setPlaying(true); });
  pl.querySelector('#bplay').addEventListener('click', () => setPlaying(!playing));
  pl.querySelector('#bprev').addEventListener('click', prev);
  pl.querySelector('#bnext').addEventListener('click', next);
  pl.querySelector('#bmute').addEventListener('click', mute);
  pl.querySelector('#bfs').addEventListener('click', fs);
  bar.addEventListener('click', e => { const r = bar.getBoundingClientRect(); go((e.clientX - r.left) / r.width * DUR); });
  document.getElementById('stage').addEventListener('click', () => { if (!start.isConnected) setPlaying(!playing); });
  addEventListener('keydown', e => {
    if (start.isConnected && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); start.click(); return; }
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'Home') go(0); else if (e.key === 'm') mute(); else if (e.key === 'f') fs();
    wake();
  });
  let idle; function wake() { pl.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => { if (playing) pl.classList.add('idle'); }, 2600); }
  addEventListener('mousemove', wake); addEventListener('touchstart', wake, { passive: true });
  paint(); wake();
})();
