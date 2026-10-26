/* Site text lives in content.json (edited from the admin panel, Ctrl+Shift+F).
   A draft saved by the admin in this browser overrides it locally.
   The static HTML is the fallback if content.json cannot be loaded. */
(() => {
  'use strict';

  const DRAFT_KEY = 'ygg:content-draft';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeHref = h => /^(https?:|mailto:)/i.test(String(h || '').trim()) ? String(h).trim() : '';
  const set = (id, text) => { const el = $(id); if (el && text != null) el.textContent = text; };
  const html = (id, markup) => { const el = $(id); if (el && markup != null) el.innerHTML = markup; };
  const paras = arr => (Array.isArray(arr) ? arr : [arr]).filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('');
  const tilt = i => ['-3deg', '2deg', '-1.5deg', '3deg', '-2deg', '1deg'][i % 6];

  function render(c) {
    if (!c) return;
    const h = c.hero || {};
    set('heroRunes', h.runes);
    set('heroName', h.name);
    set('heroSub', h.subtitle);
    set('heroLead', h.lead);
    if (h.name) document.title = `${h.name} · Иггдрасиль`;

    const a = c.about || {};
    set('aboutTitle', a.title);
    if (a.text) html('aboutText', paras(a.text));
    if (a.facts) html('facts', a.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join(''));
    if (a.kin) html('kin', a.kin.map(k => `<li><b>${esc(k.name)}</b> <span>${esc(k.from)}</span></li>`).join(''));
    set('portrait', a.portrait);

    const it = c.interests || {};
    set('intTitle', it.title);
    set('intSub', it.subtitle);
    if (it.items) html('cards', it.items.map((x, i) => `
      <article class="card">
        <span class="card__rune" aria-hidden="true">${esc(x.rune)}</span>
        <p class="card__num">${String(i + 1).padStart(2, '0')}</p>
        <h3>${esc(x.title)}</h3>
        <p>${esc(x.text)}</p>
        <ul class="tags">${(x.tags || []).filter(Boolean).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </article>`).join(''));

    set('quoteText', c.quote);

    const n = c.now || {};
    set('nowTitle', n.title);
    if (n.stones) {
      const board = $('board');
      board.querySelectorAll('.stone:not(.stone--count)').forEach(s => s.remove());
      const count = board.querySelector('.stone--count');
      n.stones.forEach((s, i) => {
        const el = document.createElement('div');
        el.className = 'stone';
        el.style.setProperty('--r', tilt(i + 1));
        const href = safeHref(s.href);
        el.innerHTML = `<p class="stone__label">${esc(s.label)}</p>` + (href
          ? `<a class="stone__value" href="${esc(href)}" target="_blank" rel="noopener">${esc(s.value)} ↗</a>`
          : `<p class="stone__value">${esc(s.value)}</p>`);
        board.insertBefore(el, count);
      });
    }

    const t = c.thread || {};
    set('threadTitle', t.title);
    if (t.text) html('threadText', paras(t.text));
    set('threadNote', t.note);

    const w = c.well || {};
    set('wellTitle', w.title);
    set('wellText', w.text);
    if (w.links) html('links', w.links.filter(l => safeHref(l.href)).map(l =>
      `<a href="${esc(safeHref(l.href))}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join(''));
  }

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
  }

  const done = data => {
    window.yggData = data;
    let draft = readDraft();
    // a published draft is no longer needed once GitHub Pages serves the same content
    if (draft && data && JSON.stringify(draft) === JSON.stringify(data)) {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
      draft = null;
    }
    try { render(draft || data); } catch (err) { console.warn('content render failed', err); }
    document.documentElement.classList.add('content-ready');
    window.dispatchEvent(new CustomEvent('ygg:content'));
  };

  window.yggContent = fetch('content.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(done)
    .catch(err => { console.warn('content.json not loaded, using built-in text', err); done(null); });
})();
