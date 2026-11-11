// ─────────────────────────────────────────────────────────────────────────
// engine.js — deterministic timeline for the promo composition.
//
// Every visual value is a pure function of the time t (seconds). There are no
// CSS transitions and no wall-clock reads, so render.js can seek frame by
// frame and each frame is reproducible.
//
//   tl.scene(name, tIn, tOut, build)   a section, shown only in [tIn, tOut)
//   tl.set(el, {o:0, y:40})            base values
//   tl.to(el, {o:1}, at, dur, ease)    tween from the previous value
//   tl.fromTo(el, from, to, at, dur, ease)
//   tl.tick(fn)                        per-frame callback fn(t) of the scene
//
// Numeric props: x y z (px) · r rx ry (deg) · s sx sy (scale) · o (opacity)
//   blur (px) · bright · ct cr cb cl (clip inset %) · w h (px) · "--name"
//   (CSS variable). A target without .style is "virtual": values go to el.v.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const E = {
    lin: p => p,
    out: p => 1 - Math.pow(1 - p, 3),
    out5: p => 1 - Math.pow(1 - p, 5),
    expo: p => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    in: p => p * p * p,
    in5: p => Math.pow(p, 5),
    io: p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    back: p => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    step: p => (p >= 1 ? 1 : 0),
  };
  const DEF = { o: 1, s: 1, sx: 1, sy: 1, bright: 1 };
  const def = k => (k in DEF ? DEF[k] : 0);
  // Seeded PRNG: layouts are the same on every render.
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  class Timeline {
    constructor(stage) { this.stage = stage; this.items = []; this.map = new Map(); this.scenes = []; this.cur = null; this.global = []; }
    _item(el) {
      let it = this.map.get(el);
      if (!it) { it = { el, tr: {}, scene: this.cur, last: {} }; this.map.set(el, it); this.items.push(it); }
      return it;
    }
    _track(el, k) { const it = this._item(el); return it.tr[k] || (it.tr[k] = { base: undefined, segs: [] }); }
    set(el, props) { for (const k in props) this._track(el, k).base = props[k]; return this; }
    to(el, props, at, dur = 0.5, ease = E.out) {
      for (const k in props) this._track(el, k).segs.push({ t: at, d: Math.max(dur, 1e-4), to: props[k], ease });
      return this;
    }
    fromTo(el, from, to, at, dur = 0.5, ease = E.out) {
      for (const k in to) this._track(el, k).segs.push({ t: at, d: Math.max(dur, 1e-4), from: from[k], to: to[k], ease });
      return this;
    }
    // Shorthands: enter (fade + offset to rest) and leave (fade out).
    in(el, at, { dur = 0.5, ease = E.expo, ...from } = {}) {
      const f = { o: 0, ...from }, t = {}; for (const k in f) t[k] = def(k);
      return this.fromTo(el, f, t, at, dur, ease);
    }
    out(el, at, { dur = 0.25, ease = E.in, ...to } = {}) { return this.to(el, { o: 0, ...to }, at, dur, ease); }
    cut(el, tIn, tOut) { this.fromTo(el, { o: 0 }, { o: 1 }, tIn, 0, E.step); if (tOut != null) this.to(el, { o: 0 }, tOut, 0, E.step); return this; }
    hide(el, at) { return this.to(el, { o: 0 }, at, 0, E.step); }
    tick(fn) { (this.cur ? this.cur.ticks : this.global).push(fn); return this; }
    scene(name, tIn, tOut, build) {
      const root = document.createElement('section');
      root.className = 'scene sc-' + name;
      this.stage.appendChild(root);
      const sc = { name, tIn, tOut, root, ticks: [], on: null };
      this.scenes.push(sc); this.cur = sc;
      build(root, tIn, tOut);
      this.cur = null;
      return sc;
    }
    finalize() {
      for (const it of this.items) for (const k in it.tr) {
        const tr = it.tr[k]; tr.segs.sort((a, b) => a.t - b.t);
        let prev = tr.base !== undefined ? tr.base : (tr.segs[0] && tr.segs[0].from !== undefined ? tr.segs[0].from : def(k));
        tr.start = prev;
        for (const s of tr.segs) { if (s.from === undefined) s.from = prev; prev = s.to; }
      }
      this.duration = Math.max(...this.scenes.map(s => s.tOut));
    }
    _val(tr, t) {
      let v = tr.start;
      for (const s of tr.segs) { if (s.t > t) break; const p = clamp((t - s.t) / s.d); v = s.from + (s.to - s.from) * s.ease(p); }
      return v;
    }
    seek(t) {
      for (const sc of this.scenes) {
        const on = t >= sc.tIn && t < sc.tOut;
        if (on !== sc.on) { sc.on = on; sc.root.style.display = on ? 'block' : 'none'; }
      }
      for (const it of this.items) {
        if (it.scene && !it.scene.on) continue;
        const v = {}; for (const k in it.tr) v[k] = this._val(it.tr[k], t);
        if (!it.el.style) { it.el.v = v; continue; }
        this._apply(it, v);
      }
      for (const fn of this.global) fn(t);
      for (const sc of this.scenes) if (sc.on) for (const fn of sc.ticks) fn(t);
    }
    _apply(it, v) {
      const st = it.el.style, L = it.last;
      const put = (k, val) => { if (L[k] !== val) { L[k] = val; if (k.startsWith('--')) st.setProperty(k, val); else st[k] = val; } };
      const o = 'o' in v ? clamp(v.o) : 1;
      if ('o' in v) { put('opacity', o.toFixed(4)); put('visibility', o <= 0.001 ? 'hidden' : 'visible'); }
      if (o <= 0.001) return;
      const g = k => (k in v ? v[k] : def(k));
      if ('x' in v || 'y' in v || 'z' in v || 'r' in v || 'rx' in v || 'ry' in v || 's' in v || 'sx' in v || 'sy' in v) {
        put('transform', `translate3d(${g('x').toFixed(2)}px,${g('y').toFixed(2)}px,${g('z').toFixed(2)}px) rotateX(${g('rx').toFixed(3)}deg) rotateY(${g('ry').toFixed(3)}deg) rotate(${g('r').toFixed(3)}deg) scale(${(g('s') * g('sx')).toFixed(5)},${(g('s') * g('sy')).toFixed(5)})`);
      }
      if ('blur' in v || 'bright' in v) {
        const b = g('blur'), br = g('bright');
        put('filter', (b > 0.05 ? `blur(${b.toFixed(2)}px) ` : '') + (Math.abs(br - 1) > 0.002 ? `brightness(${br.toFixed(3)})` : '') || 'none');
      }
      if ('ct' in v || 'cr' in v || 'cb' in v || 'cl' in v) put('clipPath', `inset(${g('ct').toFixed(2)}% ${g('cr').toFixed(2)}% ${g('cb').toFixed(2)}% ${g('cl').toFixed(2)}%)`);
      if ('w' in v) put('width', v.w.toFixed(2) + 'px');
      if ('h' in v) put('height', v.h.toFixed(2) + 'px');
      for (const k in v) if (k.startsWith('--')) put(k, v[k].toFixed(4));
    }
  }

  // DOM helpers.
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  // Split text into inline-block spans (words or chars) for staggered motion.
  function split(node, mode = 'word') {
    const text = node.textContent; node.textContent = '';
    const parts = mode === 'char' ? [...text] : text.split(/(\s+)/);
    const out = [];
    for (const p of parts) {
      if (/^\s+$/.test(p)) { node.appendChild(document.createTextNode(p)); continue; }
      const s = el('span', 'sp', node); s.textContent = p; out.push(s);
    }
    return out;
  }
  window.PromoEngine = { Timeline, E, el, split, rng, clamp };
})();
