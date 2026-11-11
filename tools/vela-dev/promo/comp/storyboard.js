// ─────────────────────────────────────────────────────────────────────────
// storyboard.js — the promo video, scene by scene.
//
// EDIT THIS FILE to change copy, order or footage. Timing is in BEATS of the
// soundtrack: B(g) gives the time of global beat g (config in promo.config.json).
// The track plays `passes` times; beat 120 is beat 0 of the second pass.
// Numbers on screen come from window.PROMO_DATA.facts, which render.js reads
// from the repository on every build. Do not type product numbers here.
// Claims that the code cannot prove (test total, audits) are in
// promo.config.json under "claims", with a note on their source.
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
  const EMB = window.PROMO_EMBED || {};
  const U = p => { const u = EMB[p] || `${A}/${p}`; urls.add(p); return `url("${u}")`; };
  const chapters = [], chapter = (g, label) => chapters.push({ t: g ? B(g) : 0, label });
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
  const LITE = Q.has('lite'); // static background: small files for the README loop
  tl.tick(t0 => {
    const v = bgv.v || { a: 0, warp: 0, hue: 0 }, p = LITE ? 0 : pulse(t0), t = LITE ? 0 : t0;
    au.forEach((a, i) => {
      const x = 960 - 850 + Math.sin(t * 0.21 + i * 2.1) * 620, y = 540 - 850 + Math.cos(t * 0.17 + i * 1.7) * 330;
      a.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${(1 + 0.12 * p).toFixed(4)})`;
      a.style.opacity = (v.a * (0.8 + 0.2 * p)).toFixed(4);
      a.style.filter = `hue-rotate(${v.hue.toFixed(1)}deg)`;
    });
    const d = warpInt[Math.min(warpInt.length - 1, Math.round(t * 60))];
    sc.clearRect(0, 0, 1920, 1080);
    for (const s of LITE ? [] : STARS) {
      const z = ((s.z - d) % 1 + 1) % 1 + 0.04, k = 620 / z, x = 960 + s.x * k, y = 540 + s.y * k * 0.62;
      if (x < -50 || x > 1970 || y < -50 || y > 1130) continue;
      const len = Math.min(260, v.warp * 150 / (z * z)), al = clamp((1.04 - z) * 1.6) * (0.25 + 0.75 * v.a);
      const dx = s.x * len, dy = s.y * len * 0.62;
      sc.strokeStyle = `rgba(200,210,255,${al.toFixed(3)})`; sc.lineWidth = s.w * clamp(1.5 - z, .4, 1.5); sc.lineCap = 'round';
      sc.beginPath(); sc.moveTo(x, y); sc.lineTo(x + dx + 0.5, y + dy + 0.5); sc.stroke();
    }
    const f = Math.round(t * 30); gr.style.transform = `translate(${(f * 7919) % 190}px,${(f * 104729) % 190}px)`;
    let fl = 0; for (const [ft, a] of LITE ? [] : FLASH) if (t >= ft) fl = Math.max(fl, a * Math.exp(-(t - ft) * 9));
    flashEl.style.opacity = fl.toFixed(4);
    fadeEl.style.opacity = clamp((t0 - (END - 0.7)) / 0.6).toFixed(4);
    cam.style.transform = `scale(${(1 + 0.013 * p).toFixed(5)})`;
  });
  const bgTo = (g, a, warp, hue = 0, dur = 0.6) => tl.to(bgv, { a, warp, hue }, B(g), dur, E.io);

  // ═══ ACT 1 — the product ═══════════════════════════════════════════════
  // 1 · Cold open: one word per beat.
  chapter(0, 'Stop dragging text boxes');
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
  chapter(8, 'Describe it');
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
    BUILD.forEach((n, i) => {
      const c = el('div', 'card', grid); c.style.backgroundImage = thumbUrl('vela-demo', n);
      c.style.left = 64 + (i % 5) * 364 + 'px'; c.style.top = 392 + Math.floor(i / 5) * 222 + 'px';
      tl.fromTo(c, { o: 0, z: 1000, ry: -55, y: -160, s: 1.35 }, { o: 1, z: 0, ry: 0, y: 0, s: 1 }, B(16 + i) - 0.05, 0.42, E.expo);
      tl.fromTo(c, { bright: 2.4 }, { bright: 1 }, B(16 + i), 0.5, E.out);
    });
    const bar = el('div', 'abs', R); bar.style.cssText = 'left:64px;top:880px;height:6px;width:1792px;border-radius:3px;background:linear-gradient(90deg,#22d3ee,#818cf8,#f472b6);transform-origin:0 50%';
    tl.set(bar, { sx: 0 }); BUILD.forEach((_, i) => tl.to(bar, { sx: (i + 1) / 10 }, B(16 + i), 0.25, E.out)); tl.out(bar, B(28));
    tl.tick(t => {
      const k = clamp(Math.floor((t - B(16)) / BEAT) + 1, 0, 10);
      const types = [...new Set(D.manifest.decks['vela-demo'][BUILD[Math.max(0, k - 1)] - 1].blocks.map(b => b.type).filter(x => x !== 'spacer'))].slice(0, 3).join(' · ');
      const s = t >= B(26) ? '✓ 10 slides · ready to present' : `▸ ${F.skill.name} skill · slide ${pad(k)} / 10   ${types}`;
      if (st.textContent !== s) st.textContent = s;
    });
    tl.to(grid, { rx: 62, s: 2.3, y: 330, z: 260 }, B(28), BEAT * 4, E.in5).to(grid, { bright: 2.6 }, B(30), BEAT * 2, E.in);
  });
  bgTo(16, 0.55, 0.25); bgTo(28, 1, 2.6, 0, BEAT * 4);

  // 3 · Drop: logo, real slides fly past the camera.
  chapter(32, 'Vela Slides');
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
  chapter(49, `${F.blockTypes.length} semantic block types`);
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
  chapter(64, 'Any theme');
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

  // 8 · Build: the deck is JSON. Sizes are measured by the vela CLI at build time.
  chapter(73, 'The deck is JSON');
  tl.scene('json', B(73), B(80), R => {
    const h = el('div', 'abs d', R, 'A deck is <span class="gradc">JSON.</span>'); h.style.cssText = 'left:96px;top:70px;font-size:150px;line-height:1.1;transform-origin:0 50%'; slam(h, B(73), { from: 1.2 });
    const l = el('div', 'abs lbl', R, 'The native format for agents'); l.style.cssText = 'left:104px;top:262px'; tl.in(l, B(73.6), { x: -40 });
    const c = el('div', 'term', R); c.style.cssText += ';left:96px;top:340px;width:800px;height:650px;font-size:24px;line-height:1.46;padding:58px 30px 20px;overflow:hidden;color:#e6e9ff';
    c.textContent = F.json.join('\n'); tl.fromTo(c, { o: 0, y: 60, cb: 100 }, { o: 1, y: 0, cb: 0 }, B(73.4), BEAT * 3.4, E.out);
    const p3 = el('div', 'fill p3d', R), s = el('div', 'slide', p3); s.style.cssText = `left:990px;top:330px;width:850px;height:478px;background-image:${slideUrl('startup-pitch', 4)}`;
    tl.fromTo(s, { o: 0, ry: -40, x: 220, s: 0.8 }, { o: 1, ry: -9, x: 0, s: 1 }, B(75), 0.6, E.expo).to(s, { ry: -4 }, B(75) + 0.6, BEAT * 3, E.lin);
    const f = F.formats, pct = v => Math.round((1 - v / f.full) * 100);
    const k = el('div', 'abs', R, [`Full ${nf(f.full)} B`, `Compact −${pct(f.compact)}%`, `Turbo −${pct(f.turbo)}%`].map(x => `<span class="chip" style="margin-right:10px;font-size:27px;padding:12px 20px">${x}</span>`).join('')); k.style.cssText = 'left:990px;top:850px;white-space:nowrap';
    [...k.children].forEach((n, i) => tl.fromTo(n, { o: 0, y: 30 }, { o: 1, y: 0 }, B(76.5 + i * 0.6), 0.3, E.expo));
    const m = el('div', 'abs mono', R, `three formats · measured on ${f.deck}`); m.style.cssText = 'left:994px;top:936px;font-size:24px;color:#8a93c9;letter-spacing:.06em'; tl.in(m, B(78), { dur: 0.4 });
    [h, l, c, s, k, m].forEach(n => tl.to(n, { o: 0 }, B(79.3), BEAT * 0.6, E.in));
  });
  bgTo(73, 0.6, 0.12, -20); bgTo(79, 1, 2.2, 0, BEAT);

  // 9 · Drop 2: one feature per bar. Order follows the feature ranking.
  function feature(i, name, word, chips, build, label) {
    const t0 = B(80 + i * 4), t1 = B(84 + i * 4);
    chapter(80 + i * 4, label);
    tl.scene('f-' + name, t0, t1, R => {
      build(R, t0);
      if (!word) return;
      const d = el('div', 'tag d', R, word); d.style.cssText = 'left:0;right:0;bottom:44px;text-align:center;font-size:190px;line-height:1.1;transform-origin:50% 100%';
      tl.fromTo(d, { o: 0, y: 130, s: 1.2 }, { o: 1, y: 0, s: 1 }, t0, 0.32, E.expo);
      const c = el('div', 'abs', R, chips.map(x => `<span class="chip" style="margin:0 8px">${x}</span>`).join('')); c.style.cssText = 'left:0;right:0;top:716px;text-align:center';
      tl.in(c, t0 + BEAT * 0.5, { y: 30, dur: 0.35 });
    });
  }
  // A 16:9 frame that shows a list of stills in sequence (real app footage).
  function reel(R, t0, shots, times, zoom) {
    const p3 = el('div', 'fill p3d', R), box = el('div', 'abs t3d', p3); box.style.cssText = 'left:391px;top:44px;width:1138px;height:640px';
    shots.forEach((src, k) => { const s = el('div', 'slide fill', box); s.style.backgroundImage = src; if (zoom && zoom[k]) { s.style.backgroundSize = zoom[k]; s.style.backgroundPosition = 'left top'; } tl.cut(s, t0 + times[k] * BEAT, null); });
    tl.fromTo(box, { o: 0, s: 0.72, ry: 26 }, { o: 1, s: 1, ry: -6 }, t0, 0.5, E.expo).to(box, { ry: -2 }, t0 + 0.5, BEAT * 3, E.lin);
    return box;
  }
  feature(0, 'present', 'PRESENT.', ['Fullscreen', 'Presenter view', 'Pace bar and clock'], (R, t0) => {
    reel(R, t0, [1, 2, 3, 4].map(n => slideUrl('tech-talk', n)), [0, 1, 2, 3]);
  }, 'Present');
  feature(1, 'edit', 'EDIT LIVE.', ['Edit while you present', 'Shift+E'], (R, t0) => {
    const fr = D.manifest.edit;
    reel(R, t0, fr.map(U), fr.map((_, k) => (k === 0 ? 0 : 0.5 + (k - 1) * 3.1 / (fr.length - 1))));
  }, 'Edit while you present');
  feature(2, 'search', 'SEARCH.', ['Ctrl+E', 'Finds slide text', 'Jumps to the slide'], (R, t0) => {
    const s = D.manifest.search; reel(R, t0, s.map(U), [0, 0.6, 1.2, 2.7], ['190%', '190%', '190%', null]);
  }, 'Search');
  feature(3, 'story', 'STORY MODE.', ['One slide', 'Images one by one'], (R, t0) => {
    reel(R, t0, D.manifest.story.slice(0, 4).map(U), [0, 1, 2, 3]);
  }, 'Story mode');
  feature(4, 'phone', 'ANY SCREEN.', ['Portrait layout', 'Phone-ready'], (R, t0) => {
    [[640, 3, -5], [960, 7, 0], [1280, 8, 5]].forEach(([x, n, r], k) => {
      const p = el('div', 'phone', R, '<div></div>'); p.style.left = x + 'px'; p.style.top = '366px'; p.firstChild.style.backgroundImage = U(`phone/p-${pad(n)}.png`);
      tl.fromTo(p, { o: 0, y: 760, r: r * 4, s: 0.9 }, { o: 1, y: 0, r, s: 0.9 }, t0 + k * BEAT * 0.5, 0.45, E.expo).to(p, { y: -16 }, t0 + k * BEAT * 0.5 + 0.45, BEAT * 3, E.lin);
    });
  }, 'Any screen');
  feature(5, 'export', 'EXPORT.', ['Editable PowerPoint', 'Vector PDF', 'Markdown', 'Standalone HTML'], (R, t0) => {
    [['PPTX', 'editable', '#fbbf24'], ['PDF', 'vector', '#fb7185'], ['MD', 'Markdown', '#34d399'], ['HTML', 'one file', '#22d3ee']].forEach(([a, b, c], k) => {
      const f = el('div', 'file', R, `<b>${a}</b><span>${b}</span>`); f.style.setProperty('--fc', c); f.style.left = 510 + k * 300 + 'px'; f.style.top = '370px';
      tl.fromTo(f, { o: 0, s: 0.2, r: -25, y: 260 }, { o: 1, s: 1, r: (k - 1.5) * 4, y: 0 }, t0 + k * BEAT - 0.04, 0.38, E.back);
    });
  }, 'Export');
  feature(6, 'numbers', null, [], (R, t0) => {
    const l = el('div', 'abs lbl', R, 'Vela at a glance'); l.style.cssText = 'left:0;right:0;top:250px;text-align:center'; tl.in(l, t0, { y: -30 });
    [[F.blockTypes.length, 'block types', 'grad', 70, 380], [3, 'deck formats', 'gradc', 440, 340], [3, 'runtimes', 'grad', 770, 340], [D.claims.tests, 'automated tests', 'hotg', 1110, 760]].forEach(([v, lab, g, x, w], k) => {
      const s = el('div', 'stat', R, `<b class="${g}">${v}</b><span>${lab}</span>`); s.style.cssText = `left:${x}px;top:400px;width:${w}px`;
      tl.fromTo(s, { o: 0, s: 2.2, y: 60 }, { o: 1, s: 1, y: 0 }, t0 + k * BEAT, 0.34, E.expo);
      if (typeof v === 'number') count(s.firstChild, v, t0 + k * BEAT, t0 + k * BEAT + 0.3);
    });
  }, 'At a glance');
  bgTo(80, 1, 0.7, 0, 0.2);

  // 10 · Fill, then the hand-over to the agent.
  chapter(108, 'Hand it to your agent');
  tl.scene('fill', B(108), B(112), R => {
    const b = el('div', 'fill', R); b.style.background = '#000';
    const t = el('div', 'word mono', R); t.style.cssText = 'font-size:54px;margin-top:-34px;color:#cfd6ff'; type(t, 'now hand it to your agent', B(108.2), B(111));
  });
  bgTo(108, 0, 0, 0, 0.1);
  tl.scene('handoff', B(112), B(120), R => {
    const b = el('div', 'fill', R); b.style.background = 'radial-gradient(ellipse at center, #1a0f3d 0%, #05061a 70%)';
    const a = el('div', 'word d', R, 'YOUR AGENT'), c = el('div', 'word d hotg', R, 'CAN DRIVE IT.');
    a.style.cssText = 'font-size:270px;margin-top:-290px'; c.style.cssText = 'font-size:230px;margin-top:10px;line-height:1.15';
    slam(a, B(112), { hold: BEAT * 8 }); slam(c, B(116), { from: 2, hold: BEAT * 4 });
  });

  // ═══ ACT 2 — the agent (second pass of the track) ══════════════════════
  const P2 = PASS;
  // 11 · A coding agent edits the deck file with the vela CLI; the browser follows.
  //      The terminal is a simulation. The commands, their output and the three
  //      screens are real (capture-assets.js runs the CLI and renders each state).
  chapter(P2, 'Claude Code + the vela CLI');
  tl.scene('agent', B(P2), B(P2 + 32), R => {
    const AG = D.manifest.agent, st = AG.steps;
    const top = el('div', 'abs lbl', R, 'Claude Code + the vela CLI'); top.style.cssText = 'left:0;right:0;top:54px;text-align:center'; tl.in(top, B(P2 + 0.5), { y: -20 });
    const p3 = el('div', 'fill p3d', R), w = el('div', 'win', p3); w.style.cssText = 'left:50px;top:130px;width:1090px';
    el('div', 'bar', w, '<i></i><i></i><i></i><span>localhost:3030 — Vela Slides</span>');
    const sh = el('div', 'shot', w); sh.style.cssText = 'height:613px;position:relative';
    const hit = [0, 13.4, 20.4];
    [AG.start, st[1].shot, st[2].shot].forEach((f, k) => { const i = el('div', 'fill', sh); i.style.cssText = `background:${U(f)} 100% 18%/136% no-repeat`; tl.cut(i, B(P2 + hit[k]), null);
      if (k) { const fl = el('div', 'fill', sh); fl.style.background = '#a5b4fc'; tl.fromTo(fl, { o: 0 }, { o: 0.55 }, B(P2 + hit[k]), 0.05, E.out).to(fl, { o: 0 }, B(P2 + hit[k]) + 0.05, 0.7, E.out); } });
    const live = el('div', 'abs chip', R, '● live reload'); live.style.cssText = 'left:60px;top:806px;border-color:#34d399;color:#a7f3d0';
    tl.set(live, { o: 0 }); hit.slice(1).forEach(g => tl.fromTo(live, { o: 0, s: 1.25 }, { o: 1, s: 1 }, B(P2 + g), 0.3, E.expo));
    tl.fromTo(w, { o: 0, x: -200, ry: 14 }, { o: 1, x: 0, ry: 4 }, B(P2), 0.7, E.expo);
    const t = el('div', 'term', R); t.style.cssText += ';left:1180px;top:130px;width:690px;height:657px;font-size:24px;line-height:1.45;padding:66px 26px 20px;white-space:pre-wrap;word-break:break-word';
    tl.fromTo(t, { o: 0, x: 200 }, { o: 1, x: 0 }, B(P2 + 0.4), 0.7, E.expo);
    el('div', '', t, '<span style="color:#fbbf24">✻</span> <span style="color:#fff">Claude Code</span>').style.cssText = 'position:absolute;left:120px;top:13px;font-size:22px';
    const pr = el('div', '', t); pr.style.cssText = 'color:#fff;border:1px solid #3b4070;border-radius:10px;padding:10px 14px;margin-bottom:16px;min-height:86px';
    const ask = "> New title: 'Traction: Q3 update'. MRR is now $612K.";
    tl.tick(tt => { const n = Math.floor(clamp((tt - B(P2 + 1.6)) / (B(P2 + 7.4) - B(P2 + 1.6))) * ask.length); const h = ask.slice(0, n) + (tt < B(P2 + 8) ? '▍' : ''); if (pr.textContent !== h) pr.textContent = h; });
    const esc = x => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    [[8.6, 0], [12.6, 1], [19.6, 2]].forEach(([g, k]) => {
      const row = el('div', '', t, `<span class="p">●</span> Bash(${esc(st[k].cmd)})\n<span style="color:#8a93c9">  ⎿ ${esc(st[k].out[0] || 'ok')}</span>`); row.style.marginBottom = '14px';
      tl.fromTo(row, { o: 0, y: 16 }, { o: 1, y: 0 }, B(P2 + g), 0.25, E.expo);
    });
    const done = el('div', '', t, '<span class="p">●</span> Done. Two edits saved to pitch.vela.'); tl.fromTo(done, { o: 0, y: 16 }, { o: 1, y: 0 }, B(P2 + 23.5), 0.25, E.expo);
    const cap = el('div', 'abs d', R, 'The agent edits the file. <span class="grad">The browser follows.</span>'); cap.style.cssText = 'left:0;right:0;top:896px;text-align:center;font-size:72px;letter-spacing:-.03em;line-height:1.2';
    tl.in(cap, B(P2 + 14), { y: 40, dur: 0.5 });
    const sim = el('div', 'abs mono', R, 'simulated session · real CLI output · real renders'); sim.style.cssText = 'right:54px;top:806px;font-size:22px;color:#7c86c8;letter-spacing:.05em'; tl.in(sim, B(P2 + 2), { dur: 0.6 });
    [w, t, top, cap, live, sim].forEach(n => tl.to(n, { s: 1.5, o: 0, blur: 14 }, B(P2 + 30.5), BEAT * 1.5, E.in));
  });
  bgTo(P2, 0.4, 0.06, 40, 0.3); bgTo(P2 + 16, 0.55, 0.15, 20); bgTo(P2 + 28, 1, 2.4, 0, BEAT * 4);

  // 12 · Drop: Vela ships as a skill.
  chapter(P2 + 32, 'Ships as a skill');
  tl.scene('skill', B(P2 + 32), B(P2 + 49), R => {
    const a = el('div', 'word d', R, 'SHIPS AS'), b = el('div', 'word d hotg', R, 'A SKILL.');
    a.style.cssText = 'font-size:230px;margin-top:-270px'; b.style.cssText = 'font-size:290px;margin-top:-30px;line-height:1.15';
    slam(a, B(P2 + 32), { from: 2.2, hold: BEAT * 8 }); slam(b, B(P2 + 34), { from: 1.7, hold: BEAT * 6 }); [a, b].forEach(x => tl.hide(x, B(P2 + 40)));
    const t = el('div', 'term', R); t.style.cssText += ';left:110px;top:170px;width:820px;height:640px;font-size:33px;line-height:1.72;padding:74px 40px 24px';
    t.innerHTML = F.skill.tree.map((l, i) => `<div>${i ? l.replace(/^(\S+ )/, '<span style="color:#4d5594">$1</span>') : `<span class="p">${l}</span>`}</div>`).join('');
    tl.fromTo(t, { o: 0, x: -120, s: 0.92 }, { o: 1, x: 0, s: 1 }, B(P2 + 40), 0.4, E.expo);
    [...t.children].forEach((n, i) => tl.fromTo(n, { o: 0, x: -30 }, { o: 1, x: 0 }, B(P2 + 40) + 0.08 * i, 0.3, E.expo));
    ['One skill.', 'One CLI.', 'JSON in, slides out.'].forEach((x, i) => { const d = el('div', 'abs d' + (i === 2 ? ' grad' : ''), R, x); d.style.cssText = `left:1010px;top:${190 + i * 190}px;font-size:${i === 2 ? 84 : 150}px;line-height:1.2;transform-origin:0 50%;white-space:nowrap`; slam(d, B(P2 + 40 + i * 2), { from: 1.3, dur: 0.3 }); });
    const c = el('div', 'abs', R, [`name: ${F.skill.name}`, `v${F.version}`, 'Markdown + Python CLI'].map(x => `<span class="chip" style="margin-right:14px">${x}</span>`).join('')); c.style.cssText = 'left:110px;top:860px';
    [...c.children].forEach((n, i) => tl.fromTo(n, { o: 0, y: 40, s: 0.7 }, { o: 1, y: 0, s: 1 }, B(P2 + 45 + i) - 0.03, 0.3, E.back));
  });
  bgTo(P2 + 32, 1, 0.8, -30, 0.2);

  // 13 · Break: the twist, in the README's own words.
  chapter(P2 + 49, 'Zero lines written by humans');
  tl.scene('twist', B(P2 + 49), B(P2 + 64), R => {
    const cd = el('div', 'code', R), half = Math.ceil(D.code.length / 2);
    [[70, D.code.slice(0, half)], [1000, D.code.slice(half)]].forEach(([x, lines]) => { const c = el('div', '', cd); c.style.left = x + 'px'; c.textContent = lines.join('\n'); tl.fromTo(c, { y: 60 }, { y: -700 }, B(P2 + 49), B(P2 + 64) - B(P2 + 49), E.lin); });
    tl.fromTo(cd, { o: 0 }, { o: 0.8 }, B(P2 + 49), 1, E.out);
    const sh = el('div', 'fill', R); sh.style.background = 'radial-gradient(ellipse at center, rgba(5,6,26,.92) 12%, rgba(5,6,26,.3) 78%)';
    const n = el('div', 'word d', R, '0'), l = el('div', 'word lbl', R, 'lines of app code');
    n.style.cssText = 'font-size:380px;margin-top:-240px'; l.style.cssText = 'margin-top:150px;font-size:44px;letter-spacing:.4em';
    slam(n, B(P2 + 49), { from: 1.2, hold: BEAT * 4 }); count(n, F.lines, B(P2 + 49), B(P2 + 51.5)); tl.in(l, B(P2 + 49.5), { y: 20 }); [n, l].forEach(x => tl.hide(x, B(P2 + 53)));
    const z = el('div', 'word d hotg', R, 'ZERO'), w = el('div', 'word d', R, 'written by humans.');
    z.style.cssText = 'font-size:470px;margin-top:-330px'; w.style.cssText = 'font-size:124px;margin-top:150px;letter-spacing:-.035em';
    slam(z, B(P2 + 53), { from: 1.6, hold: BEAT * 4 }); tl.in(w, B(P2 + 54), { y: 60, s: 1.2, dur: 0.35 }); [z, w].forEach(x => tl.hide(x, B(P2 + 57.5)));
    const q = el('div', 'quote', R, '<div class="q">“No human has reviewed the source code.”</div><div class="src">— README.md</div>'); q.style.marginTop = '-200px';
    tl.cut(q, B(P2 + 57.5), null);
    split(q.firstChild).forEach((x, i) => tl.fromTo(x, { o: 0, y: 46, blur: 10 }, { o: 1, y: 0, blur: 0 }, B(P2 + 57.5) + i * 0.1, 0.45, E.expo));
    tl.in(q.lastChild, B(P2 + 60), { y: 20 });
  });
  bgTo(P2 + 49, 0.45, 0.08, 30);

  // 14 · Stabs: what keeps it in check. Texts come from promo.config.json "claims".
  chapter(P2 + 64, 'Kept in check');
  tl.scene('checks', B(P2 + 64), B(P2 + 73), R => {
    const hl = el('div', 'abs lbl', R, 'Kept in check by'); hl.style.cssText = 'left:300px;top:120px;font-size:34px'; tl.in(hl, B(P2 + 64), { y: -20, dur: 0.3 });
    const cl = el('div', 'abs', R); cl.style.cssText = 'left:300px;top:210px';
    const items = [`${D.claims.tests} automated tests`, 'AI code reviews', 'Static analysis', D.claims.audits, 'Security bounty program'].filter(Boolean);
    [64, 65, 66, 68, 69].slice(0, items.length).forEach((g, i) => {
      const c = el('div', 'check', cl, `<i>✓</i>${items[i]}`); c.style.marginBottom = '34px';
      tl.fromTo(c, { o: 0, x: -120, s: 1.15 }, { o: 1, x: 0, s: 1 }, B(P2 + g), 0.28, E.expo); tl.fromTo(c.firstChild, { s: 0 }, { s: 1 }, B(P2 + g) + 0.04, 0.35, E.back);
    });
  });
  bgTo(P2 + 64, 1, 0.5, 0, 0.2);

  // 15 · Build: where it runs.
  chapter(P2 + 73, 'Three runtimes, one engine');
  tl.scene('runtimes', B(P2 + 73), B(P2 + 80), R => {
    const l = el('div', 'word lbl', R, 'Three runtimes · one engine'); l.style.cssText = 'margin-top:-300px'; tl.in(l, B(P2 + 73), { y: -20, dur: 0.4 });
    const h = el('div', 'word d', R, '<span class="sp">Claude.ai</span> <span class="sp gradc">Browser</span> <span class="sp grad">Desktop</span>'); h.style.cssText = 'font-size:128px;margin-top:-150px;line-height:1.25;word-spacing:.1em;white-space:nowrap';
    [...h.children].forEach((n, i) => tl.fromTo(n, { o: 0, y: 70, s: 1.25 }, { o: 1, y: 0, s: 1 }, B(P2 + 73.2 + i * 0.9), 0.35, E.expo));
    const c = el('div', 'word', R, ['Linux', 'macOS', 'Windows'].map(x => `<span class="chip" style="margin:0 10px;font-size:40px;padding:18px 36px">${x}</span>`).join('')); c.style.marginTop = '120px';
    [...c.children].forEach((n, i) => tl.fromTo(n, { o: 0, y: 40 }, { o: 1, y: 0 }, B(P2 + 76.2) + i * 0.22, 0.35, E.expo));
    [l, h, c].forEach(n => tl.to(n, { s: 2.6, o: 0, blur: 16 }, B(P2 + 79), BEAT, E.in));
  });
  bgTo(P2 + 73, 0.6, 0.12, -20); bgTo(P2 + 79, 1, 2.4, 0, BEAT);

  // 16 · Final drop: everything, in 3D.
  chapter(P2 + 80, 'The whole thing');
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

  // 17 · Fill, then the last line.
  chapter(P2 + 108, 'You think. Vela shows.');
  tl.scene('think', B(P2 + 108), B(P2 + 116), R => {
    const bg = el('div', 'fill', R); bg.style.background = '#000'; tl.cut(bg, 0, B(P2 + 112));
    const a = el('div', 'word d', R, 'You think.'), b = el('div', 'word d grad', R, 'Vela shows.');
    a.style.cssText = 'font-size:260px;margin-top:-290px'; b.style.cssText = 'font-size:260px;margin-top:-10px;line-height:1.15';
    slam(a, B(P2 + 108), { from: 1.25, hold: BEAT * 8 }); slam(b, B(P2 + 112), { from: 2, hold: BEAT * 4 });
  });
  bgTo(P2 + 112, 1, 0.6, 0, 0.2);

  // 18 · End card.
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
  if (Q.has('lite')) document.getElementById('grain').style.display = 'none';
  if (!capture) { const fit = () => { const k = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `scale(${k})`; stage.style.left = (innerWidth - 1920 * k) / 2 + 'px'; stage.style.top = (innerHeight - 1080 * k) / 2 + 'px'; }; fit(); addEventListener('resize', fit); }
  chapters.sort((x, y) => x.t - y.t);
  window.__promo = { duration: END, fps: D.fps, seek: t => tl.seek(t), beat: B, chapters, urls: [...urls] };
  window.__promoReady = Promise.all([document.fonts.ready, ...[...urls].map(p => { const i = new Image(); i.src = EMB[p] || `${A}/${p}`; return i.decode().catch(() => { window.__promoMissing = (window.__promoMissing || []).concat(p); }); })]).then(async () => {
    await Promise.all(['800 40px Sora', '700 40px Sora', '400 40px "Space Mono"', '400 40px "DM Sans"'].map(f => document.fonts.load(f).catch(() => {})));
    tl.seek(parseFloat(Q.get('t') || '0'));
    return true;
  });
})();
