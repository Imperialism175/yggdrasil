/* Page UI: Ratatoskr rail, realm label, reveal-on-scroll, draggable runestones, runes for Urd's well.
   The 3D scene lives in scene.js and reads the same scroll position on its own.
   Runs after content.js has rendered content.json into the page. */
(window.yggContent || Promise.resolve()).then(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // if the 3D scene never starts (no WebGL, blocked module), show the page anyway
  setTimeout(() => {
    const root = document.documentElement;
    if (!root.classList.contains('is-ready')) root.classList.add('no-webgl', 'is-ready', 'content-ready');
  }, 6000);

  const chapters = $$('.chapter');
  const hud = $('#hud');
  const railMarks = $('#railMarks');
  const railFill = $('#railFill');
  const squirrel = $('#squirrel');

  /* ---------- rail ---------- */
  const marks = chapters.map(sec => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rail__mark';
    b.innerHTML = `<span>${sec.dataset.realm}</span>`;
    b.setAttribute('aria-label', sec.dataset.realm);
    b.addEventListener('click', () => sec.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }));
    railMarks.appendChild(b);
    return { b, sec, p: 0 };
  });

  let maxScroll = 1;
  function layout() {
    maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    marks.forEach(m => {
      m.p = clamp(m.sec.offsetTop / maxScroll, 0, 1);
      m.b.style.top = m.p * 100 + '%';
    });
  }

  let ticking = false, lastP = -1, hopTimer = 0;
  function frame() {
    ticking = false;
    const p = clamp(scrollY / maxScroll, 0, 1);
    railFill.style.height = p * 100 + '%';
    squirrel.style.transform = `translateY(${(p * squirrel.parentElement.clientHeight).toFixed(1)}px)`;
    if (Math.abs(p - lastP) > 0.002 && !reduceMotion && lastP >= 0) {
      squirrel.classList.add('is-hop');
      clearTimeout(hopTimer);
      hopTimer = setTimeout(() => squirrel.classList.remove('is-hop'), 350);
    }
    marks.forEach(m => m.b.classList.toggle('is-past', p >= m.p - 0.005));

    const mid = scrollY + innerHeight / 2;
    for (const sec of chapters) {
      if (mid >= sec.offsetTop && mid < sec.offsetTop + sec.offsetHeight) {
        if (hud.textContent !== sec.dataset.realm) hud.textContent = sec.dataset.realm;
        break;
      }
    }
    lastP = p;
  }
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', () => { layout(); request(); });
  layout(); frame();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); request(); });

  /* ---------- reveal ---------- */
  const revealables = $$('.panel, .card, .quote, .hero');
  revealables.forEach(el => el.classList.add('reveal'));
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  revealables.forEach(el => io.observe(el));

  /* ---------- draggable runestones ---------- */
  $$('.stone').forEach(stone => {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, id = null;
    stone.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      id = e.pointerId; moved = false;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(stone.style.getPropertyValue('--x')) || 0;
      oy = parseFloat(stone.style.getPropertyValue('--y')) || 0;
      stone.setPointerCapture(id);
      stone.classList.add('is-drag');
    });
    stone.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      stone.style.setProperty('--x', ox + dx + 'px');
      stone.style.setProperty('--y', oy + dy + 'px');
    });
    const end = e => { if (e.pointerId !== id) return; id = null; stone.classList.remove('is-drag'); };
    stone.addEventListener('pointerup', end);
    stone.addEventListener('pointercancel', end);
    stone.addEventListener('click', e => { if (moved) { e.preventDefault(); moved = false; } }, true);
  });

  /* ---------- runes for Urd's well ---------- */
  const KEY = 'ygg-runes';
  const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
  const countEl = $('#runeCount');
  let count = 0;
  try { count = parseInt(localStorage.getItem(KEY), 10) || 0; } catch { count = 0; }
  countEl.textContent = count;

  $('#dropRune').addEventListener('click', e => {
    count++;
    countEl.textContent = count;
    try { localStorage.setItem(KEY, String(count)); } catch { /* storage unavailable */ }
    const r = e.currentTarget.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'rune-fly';
    s.textContent = [...RUNES][(Math.random() * [...RUNES].length) | 0];
    s.style.left = (r.left + r.width / 2 - 12 + (Math.random() - 0.5) * 60) + 'px';
    s.style.top = (r.bottom + 6) + 'px';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1700);
    window.dispatchEvent(new CustomEvent('ygg:rune'));
  });
});
