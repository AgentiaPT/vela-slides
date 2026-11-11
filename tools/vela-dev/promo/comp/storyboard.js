// ─────────────────────────────────────────────────────────────────────────
// storyboard.js — the promo video, scene by scene.
//
// EDIT THIS FILE to change copy, order or footage. Timing is in BEATS of the
// soundtrack: B(g) gives the time of global beat g (config in promo.config.json).
// The track plays `passes` times; beat 120 is beat 0 of the second pass.
// Numbers on screen come from window.PROMO_DATA.facts, which render.js reads
// from the repository on every build. Do not type product numbers here.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  const { Timeline, E, el, split, rng, clamp } = window.PromoEngine;
  const D = window.PROMO_DATA, F = D.facts, A = window.ASSETS;
  const BEAT = 60 / D.music.bpm, PH = D.music.phase, PASS = D.music.passBeats;
  const B = g => PH + g * BEAT;
  const END = B(PASS * D.music.passes + 1) + D.music.tail;
  const stage = document.getElementById('stage'), cam = document.getElementById('cam');
  document.getElementById('fonts').textContent = D.fontCss || '';
  const tl = new Timeline(cam);
  const nf = n => Math.round(n).toLocaleString('en-US');
  const pad = n => String(n).padStart(2, '0');

  // ── footage helpers ────────────────────────────────────────────────────
  const urls = new Set();
  const U = p => { const u = `${A}/${p}`; urls.add(u); return `url("${u}")`; };
  const slideUrl = (deck, n) => U(`slides/${deck}-${pad(n)}.jpg`);
  const thumbUrl = (deck, n) => U(`thumbs/${deck}-${pad(n)}.jpg`);
  const ALL = []; for (const deck in D.manifest.decks) D.manifest.decks[deck].forEach((_, i) => ALL.push([deck, i + 1]));
  const total = deck => D.manifest.decks[deck].length;
  function full(parent, deck, n) { const s = el('div', 'slide flat fill', parent); s.style.backgroundImage = slideUrl(deck, n); return s; }
  function thumb(parent, i) { const [deck, n] = ALL[i % ALL.length]; const t = el('div', 'thumb ctr', parent); t.style.backgroundImage = thumbUrl(deck, n); return t; }
  function win(parent, shot, w, title) {
    const h = Math.round(w * 9 / 16), wd = el('div', 'win', parent);
    wd.style.width = w + 'px';
    el('div', 'bar', wd, `<i></i><i></i><i></i><span>${title}</span>`);
    const s = el('div', 'shot', wd); s.style.height = h + 'px'; s.style.backgroundImage = U(shot);
    return wd;
  }
  // Largest real block of a type, cut out of its slide (rect from manifest).
  function crop(parent, type, height) {
    let best = null;
    for (const deck in D.manifest.decks) D.manifest.decks[deck].forEach((s, i) => s.blocks.forEach(b => {
      if (b.type === type && (!best || b.w * b.h > best.b.w * best.b.h)) best = { deck, n: i + 1, b };
    }));
    if (!best) return null;
    const m = 12, b = best.b, x = Math.max(0, b.x - m), y = Math.max(0, b.y - m), w = Math.min(960 - x, b.w + 2 * m), h = Math.min(540 - y, b.h + 2 * m);
    const k = Math.min(height / h, 860 / w), box = el('div', 'cropbox', parent), c = el('div', 'crop', box);
    c.style.cssText = `width:${w * k}px;height:${h * k}px;background-image:${slideUrl(best.deck, best.n)};background-size:${960 * k}px ${540 * k}px;background-position:${-x * k}px ${-y * k}px`;
    el('b', '', box, type);
    return box;
  }
  const logoSvg = (color) => D.logo.replace(/\{\{accent\}\}/g, color).replace(/width="48" height="48"/, 'width="100%" height="100%"');
  // Big word that slams in on a beat.
  function slam(node, at, { from = 1.45, dur = 0.34, hold, drift = 0.05 } = {}) {
    tl.fromTo(node, { o: 0, s: from }, { o: 1, s: 1 }, at, dur, E.expo);
    if (hold) tl.to(node, { s: 1 + drift }, at + dur, hold - dur, E.lin);
  }
  function type(node, text, t0, t1, caret = true) {
    tl.tick(t => {
      const n = Math.floor(clamp((t - t0) / (t1 - t0)) * text.length);
      const blink = Math.floor((t - PH) / (BEAT / 2)) % 2 === 0 || (t > t0 && t < t1);
      const html = text.slice(0, n).replace(/&/g, '&amp;').replace(/</g, '&lt;') + (caret ? `<span class="caret" style="opacity:${blink ? 1 : 0}"></span>` : '');
      if (node.__h !== html) { node.__h = html; node.innerHTML = html; }
    });
  }
  function count(node, to, t0, t1, fmt = nf) {
    tl.tick(t => { const v = fmt(to * E.out5(clamp((t - t0) / (t1 - t0)))); if (node.textContent !== v) node.textContent = v; });
  }

  // ── music map (beats inside one pass) ──────────────────────────────────
  const KICK = [[32, 49], [64, 67], [68, 73], [80, 108], [112, 121]], SOFT = [[16, 20], [24, 28]];
  const inR = (b, R) => R.some(([a, z]) => b >= a && b < z);
  function pulse(t) {
    const g = (t - PH) / BEAT; if (g < 0 || g > PASS * D.music.passes + 1) return 0;
    const b = Math.floor(g) % PASS, f = g - Math.floor(g);
    return (inR(b, KICK) ? 1 : inR(b, SOFT) ? 0.4 : 0) * Math.exp(-f * BEAT * 7.5);
  }
  const FLASH = [[32, .9], [64, .55], [80, .9], [112, .8], [120, .5], [152, .9], [184, .55], [200, .9], [232, .8], [240, .7]].map(([g, a]) => [B(g), a]);

  // ── background: aurora, star warp, grain ───────────────────────────────
  const bgv = {}; // virtual target: a = aurora level, warp = star speed, hue
  tl.set(bgv, { a: 0, warp: 0.05, hue: 0 });
  const au = [1, 2, 3].map(i => document.getElementById('au' + i));
  const AUC = ['rgba(99,102,241,.62)', 'rgba(168,85,247,.5)', 'rgba(34,211,238,.34)'];
  au.forEach((a, i) => { a.style.background = `radial-gradient(circle, ${AUC[i]} 0%, transparent 62%)`; });
  const sc = document.getElementById('stars').getContext('2d');
  const R0 = rng(7), STARS = Array.from({ length: 300 }, () => ({ x: R0() * 2 - 1, y: R0() * 2 - 1, z: R0(), w: 0.6 + R0() * 1.8 }));
  let warpInt = null; // integral of the warp speed, sampled at 60 Hz
  const gr = document.getElementById('grain'); gr.width = 1160; gr.height = 740;
  { const g = gr.getContext('2d'), im = g.createImageData(1160, 740), R = rng(99);
    for (let i = 0; i < im.data.length; i += 4) { const v = R() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); }
  const flashEl = document.getElementById('flash'), fadeEl = document.getElementById('fade');
  tl.tick(t => {
    const v = bgv.v || { a: 0, warp: 0, hue: 0 }, p = pulse(t);
    au.forEach((a, i) => {
      const x = 960 - 850 + Math.sin(t * 0.21 + i * 2.1) * 620, y = 540 - 850 + Math.cos(t * 0.17 + i * 1.7) * 330;
      a.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${(1 + 0.12 * p).toFixed(4)})`;
      a.style.opacity = (v.a * (0.8 + 0.2 * p)).toFixed(4);
      a.style.filter = `hue-rotate(${v.hue.toFixed(1)}deg)`;
    });
    const d = warpInt[Math.min(warpInt.length - 1, Math.round(t * 60))];
    sc.clearRect(0, 0, 1920, 1080);
    for (const s of STARS) {
      const z = ((s.z - d) % 1 + 1) % 1 + 0.04, k = 620 / z, x = 960 + s.x * k, y = 540 + s.y * k * 0.62;
      if (x < -50 || x > 1970 || y < -50 || y > 1130) continue;
      const len = Math.min(260, v.warp * 150 / (z * z)), al = clamp((1.04 - z) * 1.6) * (0.25 + 0.75 * v.a);
      const dx = s.x * len, dy = s.y * len * 0.62;
      sc.strokeStyle = `rgba(200,210,255,${al.toFixed(3)})`; sc.lineWidth = s.w * clamp(1.5 - z, .4, 1.5); sc.lineCap = 'round';
      sc.beginPath(); sc.moveTo(x, y); sc.lineTo(x + dx + 0.5, y + dy + 0.5); sc.stroke();
    }
    const f = Math.round(t * 30); gr.style.transform = `translate(${(f * 7919) % 190}px,${(f * 104729) % 190}px)`;
    let fl = 0; for (const [ft, a] of FLASH) if (t >= ft) fl = Math.max(fl, a * Math.exp(-(t - ft) * 9));
    flashEl.style.opacity = fl.toFixed(4);
    fadeEl.style.opacity = clamp((t - (END - 0.7)) / 0.6).toFixed(4);
    cam.style.transform = `scale(${(1 + 0.013 * p).toFixed(5)})`;
  });
  const bgTo = (g, a, warp, hue = 0, dur = 0.6) => tl.to(bgv, { a, warp, hue }, B(g), dur, E.io);

  // ═══ ACT 1 ═════════════════════════════════════════════════════════════
  // 1 · Cold open: one word per beat.
  tl.scene('open', 0, B(8), R => {
    [['STOP', '#05061a', '#fff'], ['DRAGGING', '#f4f6ff', '#05061a'], ['TEXT', '#05061a', '#fff'], ['BOXES.', '#4f46e5', '#fff']].forEach(([w, bg, fg], i) => {
      const t0 = i ? B(i) : 0, t1 = B(i + 1);
      const b = el('div', 'fill', R); b.style.background = bg; tl.cut(b, t0, t1);
      const n = el('div', 'word d', R, w); n.style.cssText = `font-size:${w.length > 6 ? 280 : 330}px;margin-top:${w.length > 6 ? -145 : -170}px;color:${fg}`;
      tl.cut(n, t0, t1); tl.fromTo(n, { s: 1.4 }, { s: 1 }, t0, 0.3, E.expo); tl.to(n, { s: 1.06 }, t0 + 0.3, BEAT, E.lin);
      if (i === 3) { const k = el('div', 'abs', R); k.style.cssText = 'left:330px;top:522px;height:30px;width:1260px;background:linear-gradient(90deg,#fde68a,#fb7185);transform-origin:0 50%;border-radius:15px';
        tl.cut(k, B(3) + 0.1, t1); tl.fromTo(k, { sx: 0, r: -5 }, { sx: 1, r: -5 }, B(3) + 0.1, 0.16, E.out5); }
    });
    const j = el('div', 'word d', R, 'Just say it.'); j.style.cssText = 'font-size:290px;margin-top:-180px;line-height:1.25';
    tl.cut(j, B(4)); tl.fromTo(j, { s: 1.0 }, { s: 1.07 }, B(4), BEAT * 4, E.lin);
    split(j).forEach((w, i) => (w.classList.add('grad'), tl.fromTo(w, { o: 0, y: 90, s: 1.3 }, { o: 1, y: 0, s: 1 }, B(4 + i), 0.3, E.expo)));
  });
  bgTo(4, 0.75, 0.12, 0, 0.3);

  // 2 · The prompt, then the deck builds one slide per beat.
  const PROMPT = 'Create a 10-slide deck that explains Vela Slides';
  const BUILD = [1, 2, 3, 5, 7, 8, 9, 6, 19, 21];
  tl.scene('build', B(8), B(32), R => {
    const pill = el('div', 'pill', R), tx = (el('div', 'dot', pill), el('div', 'tx', pill));
    type(tx, PROMPT, B(8.4), B(14));
    tl.in(pill, B(8), { y: 70, s: 0.9, dur: 0.45 });
    tl.fromTo(pill, { '--glow': 0 }, { '--glow': 1 }, B(15), 0.07, E.out).to(pill, { '--glow': 0 }, B(15) + 0.07, 0.6, E.out);
    tl.to(pill, { s: 0.95 }, B(15), 0.07, E.out).to(pill, { s: 1 }, B(15) + 0.07, 0.3, E.back);
    tl.to(pill, { y: -410, s: 0.6 }, B(16) - 0.12, 0.5, E.io).out(pill, B(28), { dur: 0.3 });
    const st = el('div', 'status', R); st.style.top = '262px'; tl.cut(st, B(16), B(28.5));
    const p3 = el('div', 'fill p3d', R), grid = el('div', 'fill t3d', p3);
    const cards = BUILD.map((n, i) => {
      const c = el('div', 'card', grid); c.style.backgroundImage = thumbUrl('vela-demo', n);
      c.style.left = 64 + (i % 5) * 364 + 'px'; c.style.top = 392 + Math.floor(i / 5) * 222 + 'px';
      tl.fromTo(c, { o: 0, z: 1000, ry: -55, y: -160, s: 1.35 }, { o: 1, z: 0, ry: 0, y: 0, s: 1 }, B(16 + i) - 0.05, 0.42, E.expo);
      tl.fromTo(c, { bright: 2.4 }, { bright: 1 }, B(16 + i), 0.5, E.out);
      return c;
    });
    const bar = el('div', 'abs', R); bar.style.cssText = 'left:64px;top:880px;height:6px;width:1792px;border-radius:3px;background:linear-gradient(90deg,#22d3ee,#818cf8,#f472b6);transform-origin:0 50%';
    tl.set(bar, { sx: 0 }); BUILD.forEach((_, i) => tl.to(bar, { sx: (i + 1) / 10 }, B(16 + i), 0.25, E.out)); tl.out(bar, B(28));
    tl.tick(t => {
      const k = clamp(Math.floor((t - B(16)) / BEAT) + 1, 0, 10);
      const types = [...new Set(D.manifest.decks['vela-demo'][BUILD[Math.max(0, k - 1)] - 1].blocks.map(b => b.type).filter(x => x !== 'spacer'))].slice(0, 4).join(' · ');
      const s = t >= B(26) ? '✓ 10 slides · ready to present' : `▸ slide ${pad(k)} / 10   ${types}`;
      if (st.textContent !== s) st.textContent = s;
    });
    tl.to(grid, { rx: 62, s: 2.3, y: 330, z: 260 }, B(28), BEAT * 4, E.in5).to(grid, { bright: 2.6 }, B(30), BEAT * 2, E.in);
  });
  bgTo(16, 0.55, 0.25); bgTo(28, 1, 2.6, 0, BEAT * 4);

  // 3 · Drop: logo, real slides fly past the camera.
  tl.scene('logo', B(32), B(36), R => {
    const p3 = el('div', 'fill p3d', R), Rn = rng(11);
    for (let i = 0; i < 56; i++) {
      const t = thumb(p3, i * 5 + 3), a = Rn() * Math.PI * 2, d = 0.55 + Rn() * 0.6, t0 = B(32) - 0.15 + Rn() * 1.3;
      tl.fromTo(t, { o: 0, x: 0, y: 0, z: -3200, r: (Rn() - .5) * 60 }, { o: 1, x: Math.cos(a) * 2100 * d, y: Math.sin(a) * 1250 * d, z: 900, r: 0 }, t0, 1.25, E.in);
      tl.fromTo(t, { o: 0 }, { o: 1 }, t0, 0.2, E.out);
    }
    const sh = el('div', 'fill', R); sh.style.background = 'radial-gradient(ellipse at center, rgba(5,6,26,.82) 18%, transparent 62%)';
    const g = el('div', 'word logo', R, `<div style="width:230px;height:230px">${logoSvg('#a5b4fc')}</div><div class="d grad" style="font-size:250px;line-height:1.1">Vela Slides</div>`);
    g.style.marginTop = '-190px';
    tl.fromTo(g, { o: 0, s: 2.8, blur: 26 }, { o: 1, s: 1, blur: 0 }, B(32), 0.5, E.expo).to(g, { s: 1.06 }, B(32) + 0.5, BEAT * 3, E.lin);
    const l = el('div', 'word lbl', R, 'Agent-native presentations'); l.style.cssText = 'margin-top:150px;font-size:38px';
    tl.in(l, B(33), { y: 40 });
  });
  bgTo(32, 1, 0.9, 0, 0.2);

  // 4 · One real slide per beat.
  const BLITZ = [['vela-demo', 3], ['startup-pitch', 1], ['vela-demo', 7], ['business-report', 2], ['course-training', 1], ['vela-demo', 9], ['startup-pitch', 4], ['tech-talk', 2]];
  tl.scene('blitz', B(36), B(44), R => BLITZ.forEach(([deck, n], i) => {
    const s = full(R, deck, n), t0 = B(36 + i);
    tl.cut(s, t0, B(37 + i)); tl.fromTo(s, { s: 1.17, r: i % 2 ? 1.3 : -1.3 }, { s: 1.03, r: 0 }, t0, BEAT, E.expo);
    const c = el('div', 'deckchip', R, `${deck}.vela · ${pad(n)} / ${pad(total(deck))}`); tl.cut(c, t0, B(37 + i));
  }));

  // 5 · Tagline.
  tl.scene('tagline', B(44), B(49), R => {
    const a = el('div', 'abs d', R, 'Describe it.'), b = el('div', 'abs d grad', R, 'Present it.');
    a.style.cssText = 'left:120px;top:210px;font-size:270px;transform-origin:0 50%'; b.style.cssText = 'left:120px;top:520px;font-size:270px;line-height:1.15;transform-origin:0 50%';
    slam(a, B(44), { hold: BEAT * 5 }); slam(b, B(46), { hold: BEAT * 3 });
  });
  bgTo(44, 1, 0.4); bgTo(49, 0.7, 0.1, 30);

  // 6 · Break: the block types, cut out of real slides.
  tl.scene('blocks', B(49), B(64), R => {
    const n = el('div', 'abs d grad big27', R, '0'); n.style.cssText = 'left:84px;top:150px';
    count(n, F.blockTypes.length, B(49), B(53)); tl.in(n, B(49), { y: 60, dur: 0.5 });
    const l = el('div', 'abs lbl', R, 'semantic block types'); l.style.cssText = 'left:100px;top:620px'; tl.in(l, B(50), { y: 30 });
    const q = el('div', 'abs d', R, 'Not just text boxes.'); q.style.cssText = 'left:96px;top:700px;font-size:78px;letter-spacing:-.03em'; tl.in(q, B(56), { y: 40, s: 1.15, dur: 0.4 });
    const wrap = el('div', 'abs', R); wrap.style.cssText = 'left:700px;top:0;width:1220px;height:900px;overflow:hidden;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 16%);mask-image:linear-gradient(to right,transparent 0,#000 16%)';
    const rowsT = [['flow', 'comparison', 'number-row', 'code', 'timeline', 'table'], ['cycle', 'matrix', 'steps', 'checklist', 'svg', 'grid'], ['icon-row', 'callout', 'tag-group', 'progress', 'metric', 'table', 'flow']];
    rowsT.forEach((types, r) => {
      const row = el('div', 'row', wrap); row.style.top = 60 + r * 285 + 'px';
      types.forEach(t => crop(row, t, 190));
      tl.fromTo(row, { x: r === 1 ? -900 : 260 }, { x: r === 1 ? -80 : -1500 }, B(49), B(64) - B(49), E.lin);
      tl.fromTo(row, { o: 0 }, { o: 1 }, B(49) + r * 0.2, 0.6, E.out);
    });
    const tk = el('div', 'ticker', R), sp = F.blockTypes.map(t => el('span', '', tk, t));
    tl.in(tk, B(49.5), { dur: 0.5 });
    tl.tick(t => { const k = Math.floor((t - B(49.5)) / (BEAT / 2)); sp.forEach((s, i) => { const on = i <= k; if (s.__on !== on) { s.__on = on; s.className = on ? 'on' : ''; } }); });
  });

  // 7 · Stabs: real example decks, one per hit.
  const THEMES = [[64, 'business-report', 1, 'REPORTS.'], [65, 'course-training', 1, 'COURSES.'], [66, 'startup-pitch', 1, 'PITCHES.'], [68, 'tech-talk', 1, 'TECH TALKS.'],
    [69, 'startup-pitch', 2, 'ANY THEME.'], [70, 'course-training', 3, 'ANY THEME.'], [71, 'business-report', 3, 'ANY THEME.'], [72, 'tech-talk', 4, 'ANY THEME.']];
  tl.scene('themes', B(64), B(73), R => {
    THEMES.forEach(([g, deck, n], i) => { const s = full(R, deck, n), t1 = B(i + 1 < THEMES.length ? THEMES[i + 1][0] : 73);
      tl.cut(s, B(g), t1); tl.fromTo(s, { s: 1.15 }, { s: 1.03 }, B(g), BEAT, E.expo); });
    el('div', 'tagbg', R);
    THEMES.forEach(([g, , , w], i) => { if (i > 4) return; const d = el('div', 'tag d' + (i === 4 ? ' grad' : ''), R, w); d.style.cssText = 'font-size:210px;line-height:1.1;transform-origin:0 100%';
      tl.cut(d, B(g), i === 4 ? B(73) : B(THEMES[i + 1][0])); tl.fromTo(d, { s: 1.25, y: 30 }, { s: 1, y: 0 }, B(g), 0.3, E.expo); });
  });
  bgTo(64, 1, 0.5, 0, 0.2);

  // 8 · Build: Vera. The prompt is an example from the demo deck itself.
  tl.scene('vera', B(73), B(80), R => {
    const p3 = el('div', 'fill p3d', R), w = win(p3, 'ui/editor-dark-2.png', 1180, 'Vela Slides — editor');
    w.style.cssText += ';left:790px;top:150px';
    tl.fromTo(w, { o: 0, ry: -34, rx: 9, x: 300 }, { o: 1, ry: -17, rx: 5, x: 0 }, B(73), 0.7, E.expo).to(w, { ry: -10, rx: 3 }, B(73) + 0.7, BEAT * 5, E.lin);
    tl.to(w, { s: 3.4, o: 0, blur: 18 }, B(79), BEAT, E.in);
    const l = el('div', 'abs lbl', R, `Vera · ${F.tools} built-in AI tools`); l.style.cssText = 'left:104px;top:236px'; tl.in(l, B(73.3), { x: -40 });
    const h = el('div', 'abs d', R, 'Edit by<br><span class="grad">talking.</span>'); h.style.cssText = 'left:96px;top:300px;font-size:176px;line-height:1.02;transform-origin:0 50%';
    slam(h, B(73), { from: 1.2 });
    const pb = el('div', 'abs chip', R); pb.style.cssText = 'left:100px;top:800px;font-size:33px;padding:24px 38px;border-color:#22d3ee;background:rgba(8,10,36,.94);box-shadow:0 0 60px rgba(34,211,238,.35)';
    tl.in(pb, B(74.3), { y: 40 }); type(pb, "“Add a red accent bar with 'Acme Corp' in the footer”", B(74.6), B(78.4));
    [l, h, pb].forEach(n => tl.out(n, B(79.2), { dur: BEAT * 0.7 }));
  });
  bgTo(73, 0.6, 0.12, -20); bgTo(79, 1, 2.2, 0, BEAT);

  // 9 · Drop 2: one feature per bar.
  function feature(i, name, word, chips, build) {
    const t0 = B(80 + i * 4), t1 = B(84 + i * 4);
    tl.scene('f-' + name, t0, t1, R => {
      build(R, t0);
      if (!word) return;
      const d = el('div', 'tag d', R, word); d.style.cssText = 'left:0;right:0;bottom:44px;text-align:center;font-size:190px;line-height:1.1;transform-origin:50% 100%';
      tl.fromTo(d, { o: 0, y: 130, s: 1.2 }, { o: 1, y: 0, s: 1 }, t0, 0.32, E.expo);
      const c = el('div', 'abs', R, chips.map(x => `<span class="chip" style="margin:0 8px">${x}</span>`).join('')); c.style.cssText = 'left:0;right:0;top:716px;text-align:center';
      tl.in(c, t0 + BEAT * 0.5, { y: 30, dur: 0.35 });
    });
  }
  feature(0, 'present', 'PRESENT.', ['Fullscreen', 'Presenter view', 'Session clock'], (R, t0) => {
    const p3 = el('div', 'fill p3d', R), box = el('div', 'abs t3d', p3); box.style.cssText = 'left:391px;top:44px;width:1138px;height:640px';
    [['tech-talk', 1], ['tech-talk', 2], ['tech-talk', 3], ['tech-talk', 4]].forEach(([d, n], k) => { const s = el('div', 'slide fill', box); s.style.backgroundImage = slideUrl(d, n); tl.cut(s, t0 + k * BEAT, null); if (k) tl.fromTo(s, { x: 90 }, { x: 0 }, t0 + k * BEAT, 0.25, E.expo); });
    tl.fromTo(box, { o: 0, s: 0.72, ry: 26 }, { o: 1, s: 1, ry: -7 }, t0, 0.5, E.expo).to(box, { ry: -3 }, t0 + 0.5, BEAT * 3, E.lin);
  });
  feature(1, 'gallery', 'ORGANIZE.', ['Gallery view', 'Drag to reorder', 'Slide search'], (R, t0) => {
    const w = win(R, 'ui/gallery.png', 1100, 'Vela Slides — gallery'); w.style.cssText += ';left:410px;top:30px';
    tl.fromTo(w, { o: 0, s: 1.35, y: 80 }, { o: 1, s: 1, y: 0 }, t0, 0.5, E.expo).to(w, { s: 1.04 }, t0 + 0.5, BEAT * 3, E.lin);
  });
  feature(2, 'phone', 'ANY SCREEN.', ['Portrait layout', 'Phone-ready'], (R, t0) => {
    [[640, 3, -5], [960, 7, 0], [1280, 8, 5]].forEach(([x, n, r], k) => {
      const p = el('div', 'phone', R, '<div></div>'); p.style.left = x + 'px'; p.style.top = '366px'; p.firstChild.style.backgroundImage = U(`phone/p-${pad(n)}.png`);
      tl.fromTo(p, { o: 0, y: 760, r: r * 4, s: 0.9 }, { o: 1, y: 0, r, s: 0.9 }, t0 + k * BEAT * 0.5, 0.45, E.expo).to(p, { y: -16 }, t0 + k * BEAT * 0.5 + 0.45, BEAT * 3, E.lin);
    });
  });
  feature(3, 'export', 'EXPORT.', ['Vector PDF', 'PowerPoint', 'Markdown', 'Standalone HTML'], (R, t0) => {
    [['PDF', 'vector', '#fb7185'], ['PPTX', 'PowerPoint', '#fbbf24'], ['MD', 'Markdown', '#34d399'], ['HTML', 'one file', '#22d3ee']].forEach(([a, b, c], k) => {
      const f = el('div', 'file', R, `<b>${a}</b><span>${b}</span>`); f.style.setProperty('--fc', c); f.style.left = 510 + k * 300 + 'px'; f.style.top = '370px';
      tl.fromTo(f, { o: 0, s: 0.2, r: -25, y: 260 }, { o: 1, s: 1, r: (k - 1.5) * 4, y: 0 }, t0 + k * BEAT - 0.04, 0.38, E.back);
    });
  });
  feature(4, 'edit', 'EDIT.', ['Click any text', 'Drag and drop', 'Undo'], (R, t0) => {
    const p3 = el('div', 'fill p3d', R), w = win(p3, 'ui/editor-light.png', 1100, 'Vela Slides — editor'); w.style.cssText += ';left:410px;top:30px';
    tl.fromTo(w, { o: 0, ry: 24, s: 0.8 }, { o: 1, ry: 6, s: 1 }, t0, 0.5, E.expo).to(w, { ry: 2, s: 1.04 }, t0 + 0.5, BEAT * 3, E.lin);
  });
  feature(5, 'cli', 'SCRIPT IT.', ['Python CLI', 'Structured JSON I/O', 'Any coding agent'], (R, t0) => {
    const t = el('div', 'term', R); t.style.cssText += ';left:300px;top:150px;width:1320px;height:440px;font-size:35px';
    const a = el('div', '', t), b = el('div', '', t);
    const line = (node, text, s, e) => tl.tick(tt => { const n = Math.floor(clamp((tt - s) / (e - s)) * text.length); const h = tt >= s ? `<span class="p">$ </span>${text.slice(0, n).replace(/"/g, '&quot;')}` : ''; if (node.__h !== h) { node.__h = h; node.innerHTML = h; } });
    line(a, 'vela deck ship my-deck.json', t0 + 0.1, t0 + BEAT * 1.4); line(b, 'vela slide edit deck.json 3 block.2.text "New title"', t0 + BEAT * 1.7, t0 + BEAT * 3.4);
    tl.fromTo(t, { o: 0, y: 80, s: 0.92 }, { o: 1, y: 0, s: 1 }, t0, 0.4, E.expo);
  });
  feature(6, 'numbers', null, [], (R, t0) => {
    const l = el('div', 'abs lbl', R, 'Vela at a glance'); l.style.cssText = 'left:0;right:0;top:250px;text-align:center'; tl.in(l, t0, { y: -30 });
    [[F.blockTypes.length, 'block types', 'grad'], [F.tools, 'Vera AI tools', 'gradc'], [3, 'deck formats', 'grad'], [3, 'runtimes', 'hotg']].forEach(([v, lab, g], k) => {
      const s = el('div', 'stat', R, `<b class="${g}">${v}</b><span>${lab}</span>`); s.style.left = 110 + k * 433 + 'px'; s.style.top = '400px';
      tl.fromTo(s, { o: 0, s: 2.2, y: 60 }, { o: 1, s: 1, y: 0 }, t0 + k * BEAT, 0.34, E.expo); count(s.firstChild, v, t0 + k * BEAT, t0 + k * BEAT + 0.3);
    });
  });
  bgTo(80, 1, 0.7, 0, 0.2);

  // 10 · Fill: stop.
  tl.scene('fill', B(108), B(112), R => {
    const b = el('div', 'fill', R); b.style.background = '#000';
    const t = el('div', 'word mono', R); t.style.cssText = 'font-size:54px;margin-top:-34px;color:#cfd6ff'; type(t, 'one more thing', B(108.2), B(110.6));
  });
  bgTo(108, 0, 0, 0, 0.1);

  // 11 · The twist.
  tl.scene('twist', B(112), B(120), R => {
    const b = el('div', 'fill', R); b.style.background = 'radial-gradient(ellipse at center, #1a0f3d 0%, #05061a 70%)';
    const n = el('div', 'word d', R, '0'), l = el('div', 'word lbl', R, 'lines of app code');
    n.style.cssText = 'font-size:380px;margin-top:-240px'; l.style.cssText = 'margin-top:150px;font-size:44px;letter-spacing:.4em';
    [n, l].forEach(x => tl.cut(x, B(112), B(116))); slam(n, B(112), { hold: BEAT * 4 }); count(n, F.lines, B(112), B(113.6));
    const z = el('div', 'word d hotg', R, 'ZERO'), w = el('div', 'word d', R, 'written by humans.');
    z.style.cssText = 'font-size:470px;margin-top:-330px'; w.style.cssText = 'font-size:124px;margin-top:150px;letter-spacing:-.035em';
    slam(z, B(116), { from: 2.2, hold: BEAT * 4 }); tl.in(w, B(117), { y: 60, s: 1.2, dur: 0.35 });
  });

  // ═══ ACT 2 (second pass of the track) ══════════════════════════════════
  const P2 = PASS;
  // 12 · How: every line is machine-written and machine-checked.
  tl.scene('factory', B(P2), B(P2 + 32), R => {
    const cd = el('div', 'code', R), half = Math.ceil(D.code.length / 2);
    [[70, D.code.slice(0, half)], [1000, D.code.slice(half)]].forEach(([x, lines]) => { const c = el('div', '', cd); c.style.left = x + 'px'; c.textContent = lines.join('\n'); tl.fromTo(c, { y: 60 }, { y: -1500 }, B(P2), B(P2 + 32) - B(P2), E.lin); });
    tl.fromTo(cd, { o: 0 }, { o: 1 }, B(P2), 1.2, E.out).to(cd, { o: 0.35 }, B(P2 + 28), 1, E.out);
    const sh = el('div', 'fill', R); sh.style.background = 'radial-gradient(ellipse at center, rgba(5,6,26,.9) 10%, rgba(5,6,26,.2) 75%)';
    const a = el('div', 'word d', R, 'Every line.'), b = el('div', 'word d grad', R, 'Generated by AI.');
    a.style.cssText = 'font-size:210px;margin-top:-250px'; b.style.cssText = 'font-size:210px;margin-top:0;line-height:1.15';
    slam(a, B(P2), { hold: BEAT * 8 }); slam(b, B(P2 + 4), { hold: BEAT * 4 }); [a, b].forEach(x => tl.out(x, B(P2 + 7.6), { dur: 0.18 }));
    const q = el('div', 'quote', R, '<div class="q">“No human has reviewed the source code.”</div><div class="src">— README.md</div>'); q.style.marginTop = '-200px';
    tl.cut(q, B(P2 + 8), B(P2 + 16));
    split(q.firstChild).forEach((w, i) => tl.fromTo(w, { o: 0, y: 46, blur: 10 }, { o: 1, y: 0, blur: 0 }, B(P2 + 8) + i * 0.11, 0.45, E.expo));
    tl.in(q.lastChild, B(P2 + 11), { y: 20 });
    const hl = el('div', 'abs lbl', R, 'Kept in check by'); hl.style.cssText = 'left:400px;top:190px;font-size:32px'; tl.cut(hl, B(P2 + 16), B(P2 + 28));
    const cl = el('div', 'abs', R); cl.style.cssText = 'left:400px;top:290px'; tl.cut(cl, B(P2 + 16), B(P2 + 28));
    [[16, '270+ automated tests'], [18, 'AI code reviews'], [20, 'Static analysis'], [24, 'Security bounty program']].forEach(([g, t]) => {
      const c = el('div', 'check', cl, `<i>✓</i>${t}`); tl.fromTo(c, { o: 0, x: -90 }, { o: 1, x: 0 }, B(P2 + g), 0.35, E.expo); tl.fromTo(c.firstChild, { s: 0 }, { s: 1 }, B(P2 + g) + 0.05, 0.4, E.back);
    });
    const v = el('div', 'word d gradc', R), vl = el('div', 'word lbl', R, `${F.changelog} versions in the changelog`);
    v.style.cssText = 'font-size:340px;margin-top:-250px;line-height:1.15'; vl.style.cssText = 'margin-top:170px;font-size:36px';
    [v, vl].forEach(x => tl.cut(x, B(P2 + 28), null));
    tl.tick(t => { const k = Math.min(F.versions.length - 1, Math.floor(E.in(clamp((t - B(P2 + 28)) / (B(P2 + 31.7) - B(P2 + 28)))) * F.versions.length)); const s = 'v' + F.versions[k]; if (v.textContent !== s) v.textContent = s; });
    tl.fromTo(v, { s: 0.8 }, { s: 1.15 }, B(P2 + 28), BEAT * 4, E.in);
  });
  bgTo(P2, 0.35, 0.06, 40, 0.3); bgTo(P2 + 16, 0.5, 0.15, 20); bgTo(P2 + 28, 1, 2.4, 0, BEAT * 4);

  // 13 · Drop: the README's own name for it.
  tl.scene('dark', B(P2 + 32), B(P2 + 49), R => {
    const Rn = rng(31), chips = F.versions.map((ver, i) => { const c = el('div', 'verchip', R, 'v' + ver); c.style.left = Math.floor(Rn() * 1860) + 'px'; return { c, sp: 130 + Rn() * 420, y0: Rn() * 1300, o: 0.12 + Rn() * 0.3 }; });
    tl.tick(t => chips.forEach(k => { k.c.style.transform = `translateY(${(((k.y0 + (t - B(P2 + 32)) * k.sp) % 1300) - 110).toFixed(1)}px)`; k.c.style.opacity = k.o; }));
    const sh = el('div', 'fill', R); sh.style.background = 'radial-gradient(ellipse at center, rgba(5,6,26,.88) 15%, rgba(5,6,26,.15) 78%)';
    const l = el('div', 'word lbl', R, 'Alpha · Experimental'), a = el('div', 'word d', R, 'A DARK AI'), b = el('div', 'word d hotg', R, 'SOFTWARE FACTORY.');
    l.style.cssText = 'margin-top:-330px;font-size:34px'; a.style.cssText = 'font-size:230px;margin-top:-250px'; b.style.cssText = 'font-size:168px;margin-top:10px;line-height:1.15';
    tl.in(l, B(P2 + 33), { y: -20 }); slam(a, B(P2 + 32), { from: 2.2, hold: BEAT * 8 }); slam(b, B(P2 + 34), { from: 1.6, hold: BEAT * 6 });
    [l, a, b].forEach(x => tl.hide(x, B(P2 + 40)));
    const v = el('div', 'word d gradc', R, 'v' + F.version); v.style.cssText = 'font-size:360px;margin-top:-330px;line-height:1.15'; slam(v, B(P2 + 40), { from: 1.8, hold: BEAT * 9 });
    const s = el('div', 'word', R, [`${nf(F.lines)} lines`, `${F.blockTypes.length} blocks`, `${F.tools} AI tools`, '270+ tests'].map(x => `<span class="chip" style="margin:0 10px;font-size:34px;padding:16px 30px">${x}</span>`).join(''));
    s.style.marginTop = '150px'; [...s.children].forEach((c, i) => tl.fromTo(c, { o: 0, y: 50, s: 0.7 }, { o: 1, y: 0, s: 1 }, B(P2 + 44 + i) - 0.03, 0.3, E.back));
  });
  bgTo(P2 + 32, 1, 0.8, -30, 0.2);

  // 14 · Break: where it runs, in the README's words.
  tl.scene('yours', B(P2 + 49), B(P2 + 64), R => {
    ['No servers.', 'No deploys.', 'No accounts.'].forEach((t, i) => { const d = el('div', 'abs d' + (i === 2 ? ' grad' : ''), R, t); d.style.cssText = `left:120px;top:${140 + i * 185}px;font-size:150px;line-height:1.15;transform-origin:0 50%`; slam(d, B(P2 + 49 + i * 3), { from: 1.18, dur: 0.45 }); });
    const y = el('div', 'abs d gradc', R, 'Your data stays where you put it.'); y.style.cssText = 'left:124px;top:770px;font-size:72px;letter-spacing:-.03em;line-height:1.2'; tl.in(y, B(P2 + 58.5), { y: 40, dur: 0.5 });
    const p3 = el('div', 'abs p3d', R); p3.style.cssText = 'left:1180px;top:70px;width:680px;height:680px';
    const ring = el('div', 'fill t3d', p3), th = []; for (let i = 0; i < 12; i++) { const t = thumb(ring, i * 3 + 1); th.push(t); }
    tl.tick(t => th.forEach((n, i) => { const a = i / 12 * Math.PI * 2 + (t - B(P2 + 49)) * 0.42; n.style.transform = `translate3d(${(Math.cos(a) * 290).toFixed(1)}px,${(Math.sin(a) * 110).toFixed(1)}px,${(Math.sin(a) * 290).toFixed(1)}px) scale(.42)`; n.style.zIndex = Math.sin(a) > 0 ? 3 : 1; n.style.opacity = (0.55 + 0.45 * Math.sin(a)).toFixed(3); }));
    tl.fromTo(p3, { o: 0, s: 0.7 }, { o: 1, s: 1 }, B(P2 + 50), 0.8, E.expo);
    const f = el('div', 'file ctr', p3, `<b style="font-size:50px">vela.jsx</b><span>one file · ${(F.bytes / 1e6).toFixed(1)} MB</span>`); f.style.cssText += ';width:330px;margin-left:-165px;z-index:2';
  });
  bgTo(P2 + 49, 0.7, 0.1, 30);

  // 15 · Stabs: three runtimes.
  tl.scene('runtimes', B(P2 + 64), B(P2 + 73), R => {
    const l = el('div', 'abs lbl', R, 'Three runtimes · one engine'); l.style.cssText = 'left:126px;top:96px'; tl.in(l, B(P2 + 64), { y: -20, dur: 0.3 });
    [['CLAUDE.AI', ''], ['BROWSER', ' gradc'], ['DESKTOP', ' grad']].forEach(([w, c], i) => { const d = el('div', 'abs d' + c, R, w); d.style.cssText = `left:116px;top:${190 + i * 200}px;font-size:172px;line-height:1.12;transform-origin:0 50%`; slam(d, B(P2 + 64 + i), { from: 1.4, dur: 0.28 }); });
    ['LINUX', 'MACOS', 'WINDOWS'].forEach((w, i) => { const d = el('div', 'abs d outline', R, w); d.style.cssText = `left:1190px;top:${226 + i * 200}px;font-size:120px;-webkit-text-stroke-width:2.5px;transform-origin:0 50%`; slam(d, B(P2 + 68 + i), { from: 1.5, dur: 0.26 }); });
    const e = el('div', 'abs d', R, 'Same engine everywhere.'); e.style.cssText = 'left:122px;top:850px;font-size:84px;letter-spacing:-.03em'; tl.in(e, B(P2 + 71), { y: 40, dur: 0.3 });
  });
  bgTo(P2 + 64, 1, 0.5, 0, 0.2);

  // 16 · Build: bring your own agent (list from the README).
  tl.scene('byoa', B(P2 + 73), B(P2 + 80), R => {
    const h = el('div', 'word d', R, 'Works with the agent<br><span class="grad">you already use.</span>'); h.style.cssText = 'font-size:150px;margin-top:-290px;line-height:1.1'; slam(h, B(P2 + 73), { from: 1.15, dur: 0.5 });
    const c = el('div', 'word', R, ['Claude Code', 'GitHub Copilot CLI', 'Codex CLI', 'Aider', 'Cursor'].map(x => `<span class="chip" style="margin:0 10px;font-size:36px;padding:18px 32px">${x}</span>`).join('')); c.style.marginTop = '150px';
    [...c.children].forEach((n, i) => tl.fromTo(n, { o: 0, y: 40 }, { o: 1, y: 0 }, B(P2 + 74.5) + i * 0.2, 0.35, E.expo));
    [h, c].forEach(n => tl.to(n, { s: 2.6, o: 0, blur: 16 }, B(P2 + 79), BEAT, E.in));
  });
  bgTo(P2 + 73, 0.6, 0.12, -20); bgTo(P2 + 79, 1, 2.4, 0, BEAT);

  // 17 · Final drop: everything, in 3D.
  const VERBS = ['DESCRIBE.', 'GENERATE.', 'EDIT.', 'PRESENT.', 'EXPORT.', 'SHARE.'];
  tl.scene('wall', B(P2 + 80), B(P2 + 92), R => {
    const p3 = el('div', 'fill p3d', R), plane = el('div', 'fill t3d', p3);
    for (let i = 0; i < 99; i++) { const t = thumb(plane, i); t.style.transform = `translate3d(${((i % 11) - 5) * 520}px,${(Math.floor(i / 11) - 4) * 300}px,0)`; }
    tl.fromTo(plane, { rx: 54, r: -12, y: -520, z: -420, s: 1.2 }, { rx: 48, r: 8, y: 760, z: -160, s: 1.2 }, B(P2 + 80), B(P2 + 92) - B(P2 + 80), E.lin);
  });
  tl.scene('ring', B(P2 + 92), B(P2 + 104), R => {
    const p3 = el('div', 'fill p3d', R), sp = el('div', 'fill t3d', p3), th = [];
    for (let i = 0; i < 44; i++) th.push([thumb(sp, i * 2), i % 22, i < 22 ? -1 : 1]);
    tl.tick(t => th.forEach(([n, i, row]) => { const a = i / 22 * Math.PI * 2 + (t - B(P2 + 92)) * 0.55 * row; n.style.transform = `translate3d(${(Math.sin(a) * 1500).toFixed(1)}px,${row * 165}px,${(Math.cos(a) * 1500 - 1500).toFixed(1)}px) rotateY(${(a * 180 / Math.PI).toFixed(2)}deg)`; }));
    tl.fromTo(sp, { z: 700, rx: 10 }, { z: 1150, rx: -8 }, B(P2 + 92), B(P2 + 104) - B(P2 + 92), E.lin);
  });
  tl.scene('verbs', B(P2 + 80), B(P2 + 104), R => {
    const sh = el('div', 'fill', R); sh.style.background = 'radial-gradient(ellipse at center, rgba(5,6,26,.66) 10%, rgba(5,6,26,.08) 66%)';
    VERBS.forEach((w, i) => { const d = el('div', 'word d' + (i % 2 ? ' grad' : ''), R, w); d.style.cssText = 'font-size:300px;margin-top:-170px;line-height:1.15;filter:drop-shadow(0 12px 60px rgba(0,0,12,.95))';
      const t0 = B(P2 + 80 + i * 4); tl.cut(d, t0, B(P2 + 84 + i * 4)); tl.fromTo(d, { s: 1.7 }, { s: 1 }, t0, 0.32, E.expo).to(d, { s: 1.08 }, t0 + 0.32, BEAT * 4 - 0.32, E.lin); });
  });
  tl.scene('title', B(P2 + 104), B(P2 + 108), R => {
    const p3 = el('div', 'fill p3d', R), s = full(p3, 'vela-demo', 1);
    tl.fromTo(s, { s: 0.16, ry: 100, o: 0 }, { s: 1, ry: 0, o: 1 }, B(P2 + 104), 0.7, E.expo).to(s, { s: 1.07 }, B(P2 + 104) + 0.7, BEAT * 3, E.lin);
  });
  bgTo(P2 + 80, 1, 0.7, 0, 0.2); bgTo(P2 + 108, 0, 0, 0, 0.1);

  // 18 · Fill, then the last line.
  tl.scene('think', B(P2 + 108), B(P2 + 116), R => {
    const bg = el('div', 'fill', R); bg.style.background = '#000'; tl.cut(bg, 0, B(P2 + 112));
    const a = el('div', 'word d', R, 'You think.'), b = el('div', 'word d grad', R, 'Vela shows.');
    a.style.cssText = 'font-size:260px;margin-top:-290px'; b.style.cssText = 'font-size:260px;margin-top:-10px;line-height:1.15';
    slam(a, B(P2 + 108), { from: 1.25, hold: BEAT * 8 }); slam(b, B(P2 + 112), { from: 2, hold: BEAT * 4 });
  });
  bgTo(P2 + 112, 1, 0.6, 0, 0.2);

  // 19 · End card.
  tl.scene('end', B(P2 + 116), END, R => {
    const p3 = el('div', 'fill p3d', R), plane = el('div', 'fill t3d', p3);
    for (let i = 0; i < 63; i++) { const t = thumb(plane, i + 4); t.style.transform = `translate3d(${((i % 9) - 4) * 520}px,${(Math.floor(i / 9) - 3) * 300}px,0)`; }
    tl.fromTo(plane, { rx: 46, y: -200, z: -900, o: 0.34 }, { rx: 46, y: 240, z: -900, o: 0.34 }, B(P2 + 116), END - B(P2 + 116), E.lin);
    const sh = el('div', 'fill', R); sh.style.background = 'radial-gradient(ellipse at center, rgba(5,6,26,.93) 22%, rgba(5,6,26,.5) 80%)';
    const g = el('div', 'word logo', R, `<div style="width:170px;height:170px">${logoSvg('#a5b4fc')}</div><div class="d grad" style="font-size:210px;line-height:1.1">Vela Slides</div>`); g.style.marginTop = '-290px';
    slam(g, B(P2 + 116), { from: 1.5, hold: END - B(P2 + 116), drift: 0.04 });
    const l = el('div', 'word lbl', R, 'Agent-native presentations'); l.style.cssText = 'margin-top:0;font-size:38px'; tl.in(l, B(P2 + 117), { y: 30 });
    const u = el('div', 'word', R, '<span class="url">github.com/AgentiaPT/vela-slides</span>'); u.style.marginTop = '110px';
    tl.fromTo(u, { o: 0, s: 0.6 }, { o: 1, s: 1 }, B(P2 + 120), 0.4, E.back);
    const c = el('div', 'word', R, ['Alpha', 'Source-available · ELv2', '100% AI-built'].map(x => `<span class="chip" style="margin:0 10px;font-size:36px;padding:16px 32px">${x}</span>`).join('')); c.style.marginTop = '290px';
    tl.in(c, B(P2 + 121), { y: 30, dur: 0.6 });
  });
  bgTo(P2 + 116, 0.9, 0.3, 0, 0.3);

  // ── boot ───────────────────────────────────────────────────────────────
  tl.finalize();
  { // integral of the star warp speed
    const tr = tl.map.get(bgv).tr.warp, n = Math.ceil(END * 60) + 2; warpInt = new Float64Array(n); let acc = 0;
    for (let i = 0; i < n; i++) { acc += tl._val(tr, i / 60) * 0.11 / 60; warpInt[i] = acc; }
  }
  const capture = Q.has('capture');
  if (!capture) { const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`; }; fit(); addEventListener('resize', fit); }
  window.__promo = { duration: END, fps: D.fps, seek: t => tl.seek(t), beat: B };
  window.__promoReady = Promise.all([document.fonts.ready, ...[...urls].map(u => { const i = new Image(); i.src = u; return i.decode().catch(() => { window.__promoMissing = (window.__promoMissing || []).concat(u); }); })]).then(async () => {
    await Promise.all(['800 40px Sora', '700 40px Sora', '400 40px "Space Mono"', '400 40px "DM Sans"'].map(f => document.fonts.load(f).catch(() => {})));
    tl.seek(parseFloat(Q.get('t') || '0'));
    if (Q.has('play')) { const t0 = performance.now() - parseFloat(Q.get('t') || '0') * 1000; const loop = () => { tl.seek(((performance.now() - t0) / 1000) % END); requestAnimationFrame(loop); }; loop(); }
    return true;
  });
})();
