/* Admin panel, same flow as on the flowertalker site.
   Open: Ctrl+Shift+F, or click the runes above the name 5 times quickly.
   "Применить" saves a draft in this browser only; "Опубликовать" commits content.json
   to the GitHub repo with a fine-grained token, and GitHub Pages redeploys in 1-2 minutes. */
(() => {
  'use strict';

  const DRAFT_KEY = 'ygg:content-draft';
  const GH_KEY = 'ygg:gh';
  const FILE = 'content.json';

  const LABELS = {
    hero: 'крона · первый экран', runes: 'руны над именем', name: 'имя', subtitle: 'подзаголовок', lead: 'вступление',
    about: 'глава I · знакомство', title: 'заголовок', text: 'текст', facts: 'факты', label: 'подпись', value: 'значение',
    kin: 'kin-list', from: 'откуда', portrait: 'психологический портрет',
    interests: 'глава II · ветви', items: 'увлечения', rune: 'руна', tags: 'теги',
    quote: 'цитата в облаках',
    now: 'глава IV · рунные камни', stones: 'камни', href: 'ссылка (необязательно)',
    thread: 'глава V · нить Норн', note: 'приписка',
    well: 'глава VI · источник Урд', links: 'контакты'
  };
  const LONG = new Set(['text', 'lead', 'portrait', 'quote', 'note']);

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } }
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const label = k => esc(LABELS[k] ?? k);

  // guess "owner/repo" from a github.io address
  function guessRepo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return '';
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg && !seg.includes('.') ? `${m[1]}/${seg}` : `${m[1]}/${m[1]}.github.io`;
  }

  // empty copy with the same shape, for "+ добавить"
  const blank = v => Array.isArray(v) ? [] : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).map(k => [k, blank(v[k])]))
    : typeof v === 'number' ? 0 : '';

  function field(key, value, path) {
    if (typeof value === 'number') {
      return `<label class="adm-f"><span>${label(key)}</span><input type="number" data-path="${path}" data-num value="${value}"></label>`;
    }
    const long = LONG.has(key) || String(value).length > 60;
    return `<label class="adm-f"><span>${label(key)}</span>${long
      ? `<textarea rows="3" data-path="${path}">${esc(value)}</textarea>`
      : `<input type="text" data-path="${path}" value="${esc(value)}">`}</label>`;
  }

  function form(value, key, path) {
    if (Array.isArray(value)) {
      const items = value.map((v, i) => `
        <div class="adm-item">
          <button type="button" class="adm-del" data-del="${path}" data-i="${i}" title="удалить">×</button>
          ${form(v, typeof v === 'object' ? '' : `#${i + 1}`, `${path}.${i}`)}
        </div>`).join('');
      return `<fieldset class="adm-group"><legend>${label(key)}</legend>${items}
        <button type="button" class="adm-add" data-add="${path}">+ добавить</button></fieldset>`;
    }
    if (value && typeof value === 'object') {
      const inner = Object.entries(value).map(([k, v]) => form(v, k, path ? `${path}.${k}` : k)).join('');
      return key ? `<fieldset class="adm-group"><legend>${label(key)}</legend>${inner}</fieldset>` : inner;
    }
    return field(key, value, path);
  }

  const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const b64 = s => { let bin = ''; new TextEncoder().encode(s).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };

  async function publish(data, { token, repo }) {
    const url = `https://api.github.com/repos/${repo}/contents/${FILE}`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    const cur = await fetch(url, { headers });
    if (!cur.ok) throw new Error(`не вижу ${FILE} в ${repo} (${cur.status})`);
    const { sha } = await cur.json();
    const res = await fetch(url, {
      method: 'PUT', headers,
      body: JSON.stringify({ message: 'Update site content from admin panel', content: b64(JSON.stringify(data, null, 2) + '\n'), sha })
    });
    if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  }

  let box = null;

  async function open() {
    if (box) return;
    await window.yggContent;
    const base = window.yggData;
    if (!base) { alert('Не удалось загрузить content.json, админке нечего редактировать.'); return; }
    let data = structuredClone(store.get(DRAFT_KEY) || base);
    const gh = store.get(GH_KEY) || { token: '', repo: '' };
    if (!gh.repo) gh.repo = guessRepo() || 'Imperialism175/yggdrasil';
    const hasDraft = !!store.get(DRAFT_KEY);

    box = document.createElement('div');
    box.className = 'adm';
    box.innerHTML = `
      <div class="adm-box" role="dialog" aria-label="Админка" aria-modal="true">
        <header class="adm-head">
          <b><span aria-hidden="true">ᛟ</span> админка</b>
          <button type="button" class="adm-x" data-act="close" aria-label="закрыть">×</button>
        </header>
        <p class="adm-note">${hasDraft ? 'Сейчас ты видишь <b>черновик</b>: он живёт только в этом браузере.' : 'Правь что угодно и жми «Применить».'} Гости увидят изменения после «Опубликовать».</p>
        <form class="adm-form">${form(data, '', '')}</form>
        <details class="adm-gh">
          <summary>публикация на GitHub</summary>
          <label class="adm-f"><span>репозиторий (владелец/имя)</span><input type="text" name="repo" placeholder="Imperialism175/yggdrasil" value="${esc(gh.repo)}"></label>
          <label class="adm-f"><span>токен (fine-grained, Contents: read &amp; write только для этого репо)</span>
            <input type="password" name="token" autocomplete="off" value="${esc(gh.token)}"></label>
          <p class="adm-note">Токен хранится только в этом браузере.</p>
        </details>
        <footer class="adm-foot">
          <button type="button" data-act="apply">Применить</button>
          <button type="button" data-act="publish" class="adm-main">Опубликовать</button>
          <button type="button" data-act="export">Скачать JSON</button>
          <button type="button" data-act="reset" class="adm-ghost">Сбросить черновик</button>
        </footer>
        <p class="adm-status" aria-live="polite"></p>
      </div>`;
    document.body.appendChild(box);
    document.documentElement.classList.add('adm-open');
    box.querySelector('input, textarea')?.focus();

    const status = t => { box.querySelector('.adm-status').textContent = t; };
    const redraw = () => { box.querySelector('.adm-form').innerHTML = form(data, '', ''); };
    const saveGh = () => {
      const v = { repo: box.querySelector('[name=repo]').value.trim(), token: box.querySelector('[name=token]').value.trim() };
      store.set(GH_KEY, v);
      return v;
    };

    box.addEventListener('input', e => {
      const p = e.target.dataset.path;
      if (p) setPath(data, p, 'num' in e.target.dataset ? Number(e.target.value) : e.target.value);
    });
    box.addEventListener('click', async e => {
      if (e.target === box) return close();
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.add) {
        const arr = getPath(data, b.dataset.add);
        arr.push(blank(arr[0] ?? ''));
        return redraw();
      }
      if (b.dataset.del) {
        getPath(data, b.dataset.del).splice(Number(b.dataset.i), 1);
        return redraw();
      }
      switch (b.dataset.act) {
        case 'close': return close();
        case 'apply': store.set(DRAFT_KEY, data); return location.reload();
        case 'reset': store.del(DRAFT_KEY); return location.reload();
        case 'export': {
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
          Object.assign(document.createElement('a'), { href: url, download: FILE }).click();
          return URL.revokeObjectURL(url);
        }
        case 'publish': {
          const cfg = saveGh();
          if (!cfg.repo || !cfg.token) {
            box.querySelector('.adm-gh').open = true;
            return status('Вставь репозиторий и токен GitHub в блоке «публикация».');
          }
          b.disabled = true;
          status('Публикую…');
          try {
            await publish(data, cfg);
            store.set(DRAFT_KEY, data);
            status('Готово! GitHub Pages обновит сайт за 1–2 минуты.');
          } catch (err) {
            status(`Не вышло: ${err.message}`);
          } finally {
            b.disabled = false;
          }
        }
      }
    });
  }

  function close() {
    box?.remove();
    box = null;
    document.documentElement.classList.remove('adm-open');
  }

  addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); box ? close() : open(); }
  });

  // secret entrance: 5 quick clicks on the runes above the name
  let clicks = [];
  document.getElementById('heroRunes')?.addEventListener('click', () => {
    const now = performance.now();
    clicks = clicks.filter(t => now - t < 1500).concat(now);
    if (clicks.length >= 5) { clicks = []; open(); }
  });
})();
