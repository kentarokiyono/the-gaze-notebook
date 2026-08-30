/* ============================================================================
 * The Gaze — Daily Notes + Full-text Search (Phase 4)
 *  - デイリーノート: 日付タイトルのノートを開閉、前後日ナビ。
 *  - 全文検索: tag: / path: / is: 演算子つきの検索オーバーレイ（スニペット表示）。
 * ========================================================================== */
(function () {
  'use strict';

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  function labelOf(iso) {
    const p = iso.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return (+p[0]) + '年' + (+p[1]) + '月' + (+p[2]) + '日 (' + WD[d.getDay()] + ')';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const cur = () => (typeof state !== 'undefined' && state ? state.currentNote : null);

  // ---- デイリーノート -------------------------------------------------------
  async function openDailyDate(iso) {
    let notes = [];
    try { notes = await TheGazeDB.getAllNotes(); } catch (e) {}
    let note = notes.find((n) => n.daily && n.dailyDate === iso) || notes.find((n) => n.title === iso);
    if (!note) {
      let content = '';
      try { if (window.GazeTemplates && GazeTemplates.dailyContent) content = GazeTemplates.dailyContent(iso) || ''; } catch (e) {}
      note = {
        id: (typeof newId === 'function' ? newId() : 'note_' + Date.now()),
        title: iso, content, parentId: null,
        createdAt: Date.now(), updatedAt: Date.now(), daily: true, dailyDate: iso,
      };
      await TheGazeDB.addNote(note);
      await renderTree();
      if (typeof showToast === 'function') showToast(labelOf(iso) + ' のノートを作成しました', 'success');
    } else if (!note.daily) {
      note.daily = true; note.dailyDate = iso; await TheGazeDB.addNote(note);
    }
    if (typeof openNoteById === 'function') openNoteById(note.id);
  }
  function openDaily(offset) { const d = new Date(); d.setDate(d.getDate() + (offset || 0)); return openDailyDate(isoOf(d)); }
  function shiftDaily(delta) {
    const n = cur(); if (!n || !n.dailyDate) return;
    const p = n.dailyDate.split('-'); const dt = new Date(+p[0], +p[1] - 1, +p[2]);
    dt.setDate(dt.getDate() + delta); openDailyDate(isoOf(dt));
  }

  let navEl = null;
  function ensureNav() {
    if (navEl) return navEl;
    navEl = document.createElement('div');
    navEl.id = 'daily-nav';
    navEl.className = 'hidden';
    navEl.innerHTML =
      '<button class="daily-nav-btn" data-d="-1" title="前日"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>' +
      '<span id="daily-nav-label"></span>' +
      '<button class="daily-nav-btn" data-d="1" title="翌日"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>' +
      '<button id="daily-nav-today" class="daily-today-btn">今日</button>' +
      '<span class="daily-nav-picker"><input type="date" id="daily-nav-date"></span>';
    const tb = document.getElementById('md-toolbar');
    if (tb && tb.parentNode) tb.parentNode.insertBefore(navEl, tb);
    navEl.querySelectorAll('.daily-nav-btn').forEach((b) => b.addEventListener('click', () => shiftDaily(parseInt(b.dataset.d))));
    navEl.querySelector('#daily-nav-today').addEventListener('click', () => openDaily(0));
    navEl.querySelector('#daily-nav-date').addEventListener('change', (e) => { if (e.target.value) openDailyDate(e.target.value); });
    if (window.lucide) lucide.createIcons();
    return navEl;
  }
  function syncDaily() {
    const n = cur();
    ensureNav();
    if (n && n.daily && n.dailyDate) {
      navEl.classList.remove('hidden');
      const lbl = navEl.querySelector('#daily-nav-label'); if (lbl) lbl.textContent = labelOf(n.dailyDate);
      const dp = navEl.querySelector('#daily-nav-date'); if (dp) dp.value = n.dailyDate;
    } else {
      navEl.classList.add('hidden');
    }
  }

  // ---- 全文検索 -------------------------------------------------------------
  function ancestorTitles(note, byId) {
    const out = []; let cur2 = note.parentId ? byId[note.parentId] : null, guard = 0;
    while (cur2 && guard < 20) { out.push(cur2.title || ''); cur2 = cur2.parentId ? byId[cur2.parentId] : null; guard++; }
    return out;
  }
  function dbText(note) {
    if (!note.db) return '';
    const parts = [];
    (note.db.rows || []).forEach((r) => { Object.values(r.cells || {}).forEach((v) => { if (typeof v === 'string') parts.push(v); }); });
    return parts.join(' ');
  }
  function parseQuery(q) {
    const tags = [], paths = [], is = [], terms = [];
    (q.match(/(?:[^\s"]+|"[^"]*")+/g) || []).forEach((tok) => {
      let m;
      if ((m = tok.match(/^tag:(.+)$/i))) tags.push(m[1].replace(/^#/, '').toLowerCase());
      else if ((m = tok.match(/^path:(.+)$/i))) paths.push(m[1].toLowerCase());
      else if ((m = tok.match(/^is:(.+)$/i))) is.push(m[1].toLowerCase());
      else terms.push(tok.replace(/^"|"$/g, '').toLowerCase());
    });
    return { tags, paths, is, terms };
  }
  async function runSearch(q) {
    const parsed = parseQuery(q);
    let notes = [];
    try { notes = await TheGazeDB.getAllNotes(); } catch (e) { return []; }
    const byId = {}; notes.forEach((n) => (byId[n.id] = n));
    const results = [];
    for (const n of notes) {
      const title = n.title || '';
      const content = (n.content || '') + ' ' + dbText(n);
      const hay = (title + '\n' + content).toLowerCase();
      const noteTags = (typeof extractTags === 'function') ? extractTags(title + ' ' + content).map((t) => t.toLowerCase()) : [];
      const anc = ancestorTitles(n, byId).join(' ').toLowerCase();

      if (parsed.is.includes('database') && !n.db) continue;
      if (parsed.is.includes('daily') && !n.daily) continue;
      if (parsed.is.includes('note') && (n.db || n.daily)) continue;
      if (!parsed.tags.every((t) => noteTags.some((x) => x.includes(t)))) continue;
      if (!parsed.paths.every((p) => anc.includes(p) || title.toLowerCase().includes(p))) continue;
      if (!parsed.terms.every((t) => hay.includes(t))) continue;
      if (!q.trim()) continue;

      // score & snippet
      let score = 0;
      parsed.terms.forEach((t) => { if (title.toLowerCase().includes(t)) score += 10; if (hay.includes(t)) score += 1; });
      score += (n.updatedAt || 0) / 1e13;
      results.push({ note: n, score, snippet: makeSnippet(content, parsed.terms) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 40);
  }
  function makeSnippet(content, terms) {
    const text = content.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    let idx = -1;
    for (const t of terms) { const i = text.toLowerCase().indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
    if (idx < 0) idx = 0;
    const start = Math.max(0, idx - 40);
    let snip = (start > 0 ? '…' : '') + text.slice(start, start + 160) + (start + 160 < text.length ? '…' : '');
    snip = esc(snip);
    terms.forEach((t) => { if (!t) return; const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'); snip = snip.replace(re, '<mark>$1</mark>'); });
    return snip;
  }

  // ---- 検索オーバーレイ -----------------------------------------------------
  let overlay = null, resultItems = [], selIdx = 0;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'search-overlay';
    overlay.className = 'hidden';
    overlay.innerHTML =
      '<div class="search-modal">' +
      '<div class="search-input-row"><i data-lucide="search" class="w-4 h-4 text-slate-500"></i>' +
      '<input id="search-input" placeholder="検索  （tag:仕事  path:プロジェクト  is:database）">' +
      '<kbd class="search-esc">esc</kbd></div>' +
      '<div class="search-hint">演算子: <b>tag:</b>タグ  <b>path:</b>親ページ  <b>is:</b>database/daily/note</div>' +
      '<div id="search-results"></div></div>';
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();
    const input = overlay.querySelector('#search-input');
    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => doSearch(input.value), 140); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, resultItems.length - 1); paintSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); paintSel(); }
      else if (e.key === 'Enter') { e.preventDefault(); openSel(); }
      else if (e.key === 'Escape') { closeSearch(); }
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeSearch(); });
    return overlay;
  }
  async function doSearch(q) {
    const box = overlay.querySelector('#search-results');
    const results = await runSearch(q);
    resultItems = results; selIdx = 0;
    if (!q.trim()) { box.innerHTML = '<div class="search-empty">キーワードを入力してください</div>'; return; }
    if (results.length === 0) { box.innerHTML = '<div class="search-empty">一致するノートがありません</div>'; return; }
    box.innerHTML = results.map((r, i) => {
      const ic = r.note.db ? 'table' : r.note.daily ? 'calendar-days' : 'file-text';
      return '<div class="search-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '">' +
        '<i data-lucide="' + ic + '" class="w-4 h-4 search-item-ic"></i>' +
        '<div class="search-item-main"><div class="search-item-title">' + esc(r.note.title || 'Untitled') + '</div>' +
        (r.snippet ? '<div class="search-item-snip">' + r.snippet + '</div>' : '') + '</div></div>';
    }).join('');
    if (window.lucide) lucide.createIcons();
    box.querySelectorAll('.search-item').forEach((el) => {
      el.addEventListener('click', () => { selIdx = parseInt(el.dataset.i); openSel(); });
      el.addEventListener('mousemove', () => { selIdx = parseInt(el.dataset.i); paintSel(); });
    });
  }
  function paintSel() {
    if (!overlay) return;
    overlay.querySelectorAll('.search-item').forEach((el, i) => el.classList.toggle('sel', i === selIdx));
    const s = overlay.querySelector('.search-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function openSel() {
    const r = resultItems[selIdx]; if (!r) return;
    closeSearch();
    if (typeof openNoteById === 'function') openNoteById(r.note.id);
  }
  function openSearch() {
    ensureOverlay();
    overlay.classList.remove('hidden');
    const input = overlay.querySelector('#search-input');
    input.value = ''; input.focus();
    overlay.querySelector('#search-results').innerHTML = '<div class="search-empty">キーワードを入力してください</div>';
    resultItems = []; selIdx = 0;
  }
  function closeSearch() { if (overlay) overlay.classList.add('hidden'); }

  // ---- 初期化 & フック ------------------------------------------------------
  function boot() {
    ensureNav();
    // loadNote ラップ（最後段）: デイリーナビ表示切替
    if (typeof window.loadNote === 'function' && !window.loadNote.__gazeDailyWrapped) {
      const orig = window.loadNote;
      window.loadNote = async function () {
        const r = await orig.apply(this, arguments);
        try { syncDaily(); } catch (e) { console.error('daily sync', e); }
        return r;
      };
      window.loadNote.__gazeDailyWrapped = true;
    }
    const dailyBtn = document.getElementById('open-daily-btn');
    if (dailyBtn) dailyBtn.addEventListener('click', () => openDaily(0));
    const searchBtn = document.getElementById('open-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', openSearch);
    // コマンドパレット登録
    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeP4) {
      COMMANDS.push({ id: 'daily-today', label: '今日のノート', icon: 'calendar-days', run: () => openDaily(0) });
      COMMANDS.push({ id: 'daily-prev', label: '昨日のノート', icon: 'calendar-minus', run: () => openDaily(-1) });
      COMMANDS.push({ id: 'daily-next', label: '明日のノート', icon: 'calendar-plus', run: () => openDaily(1) });
      COMMANDS.push({ id: 'search', label: '全文検索', icon: 'search', run: () => openSearch() });
      COMMANDS.__gazeP4 = true;
    }
    // ショートカット: Ctrl/Cmd+Shift+F で検索, Ctrl/Cmd+Shift+D で今日のノート
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); openSearch(); }
      if (mod && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); openDaily(0); }
    });
  }

  window.GazeSearch = { openSearch, openDaily, openDailyDate };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
