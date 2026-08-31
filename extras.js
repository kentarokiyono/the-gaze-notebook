/* ============================================================================
 * The Gaze — Extras
 * Phase 16: PDF出力（window.print + 印刷用整形）
 * Phase 17: クイックキャプチャ（ホットキー/フローティングボタン→デイリーに追記）
 * ========================================================================== */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  const cur = () => (typeof state !== 'undefined' && state ? state.currentNote : null);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const hhmm = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  // ---- PDF出力 --------------------------------------------------------------
  async function exportPDF() {
    const n = cur();
    if (!n) { if (typeof showToast === 'function') showToast('ノートを開いてください', 'error'); return; }
    let area = document.getElementById('print-area');
    if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    const titleEl = document.getElementById('note-title');
    const ta = document.getElementById('note-content');
    const title = (titleEl && titleEl.value) || n.title || '';
    const content = (ta ? ta.value : n.content) || '';
    const md = (title ? '# ' + title + '\n\n' : '') + content;
    let html; try { html = window.marked ? marked.parse(md) : '<pre>' + esc(md) + '</pre>'; } catch (e) { html = '<pre>' + esc(md) + '</pre>'; }
    area.innerHTML = '<div class="print-content prose">' + html + '</div>';
    try { if (window.GazeAssets) { await GazeAssets.preload(area.innerHTML); GazeAssets.hydrate(area); } } catch (e) {}
    try { if (window.GazeRich) GazeRich.enhance(area); } catch (e) {}
    if (typeof showToast === 'function') showToast('印刷ダイアログで「PDFに保存」を選んでください', 'success');
    setTimeout(() => { window.print(); }, 350);
  }

  // ---- クイックキャプチャ ---------------------------------------------------
  async function captureToDaily(text) {
    const iso = todayIso();
    let notes = []; try { notes = await TheGazeDB.getAllNotes(); } catch (e) {}
    let note = notes.find((x) => x.daily && x.dailyDate === iso) || notes.find((x) => x.title === iso);
    if (!note) {
      let content = '';
      try { if (window.GazeTemplates && GazeTemplates.dailyContent) content = GazeTemplates.dailyContent(iso) || ''; } catch (e) {}
      note = { id: (typeof newId === 'function' ? newId() : 'note_' + Date.now()), title: iso, content, parentId: null, createdAt: Date.now(), updatedAt: Date.now(), daily: true, dailyDate: iso };
    }
    const stamp = '- ' + hhmm() + ' ' + text.trim();
    note.content = (note.content && note.content.trim() ? note.content.replace(/\s+$/, '') + '\n' : '') + stamp;
    note.updatedAt = Date.now();
    await TheGazeDB.addNote(note);
    if (typeof renderNotesList === 'function') await renderNotesList();
    if (cur() && cur().id === note.id) { const ta = document.getElementById('note-content'); if (ta) { ta.value = note.content; if (window.GazeBlocks) GazeBlocks.renderFromModel(); } }
    if (typeof refreshGrowth === 'function') refreshGrowth();
    return note;
  }
  async function captureToNew(text) {
    const lines = text.trim().split('\n');
    const title = lines[0].slice(0, 60);
    const content = lines.slice(1).join('\n');
    const note = { id: (typeof newId === 'function' ? newId() : 'note_' + Date.now()), title, content, parentId: null, createdAt: Date.now(), updatedAt: Date.now() };
    await TheGazeDB.addNote(note);
    if (typeof renderTree === 'function') await renderTree();
    return note;
  }

  let capOv = null;
  function openCapture() {
    if (!capOv) {
      capOv = document.createElement('div');
      capOv.className = 'hidden fixed inset-0 modal-backdrop z-[70] flex items-start justify-center pt-[16vh] px-4';
      capOv.innerHTML =
        '<div class="cap-modal"><div class="cap-head"><i data-lucide="zap" class="w-4 h-4 text-blue-400"></i><span>クイックキャプチャ</span>' +
        '<button class="cap-x"><i data-lucide="x" class="w-4 h-4"></i></button></div>' +
        '<textarea id="cap-input" placeholder="今すぐメモ…（Ctrl/⌘+Enter で今日のノートに追記）"></textarea>' +
        '<div class="cap-foot"><span class="cap-hint">Ctrl/⌘+Enter: 追記　Esc: 閉じる</span>' +
        '<button class="cap-new">新規ノート</button><button class="cap-save">今日に追記</button></div></div>';
      document.body.appendChild(capOv);
      if (window.lucide) lucide.createIcons();
      capOv.addEventListener('mousedown', (e) => { if (e.target === capOv) capOv.classList.add('hidden'); });
      capOv.querySelector('.cap-x').addEventListener('click', () => capOv.classList.add('hidden'));
      capOv.querySelector('.cap-save').addEventListener('click', () => doCapture('daily'));
      capOv.querySelector('.cap-new').addEventListener('click', () => doCapture('new'));
      capOv.querySelector('#cap-input').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { capOv.classList.add('hidden'); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCapture('daily'); }
      });
    }
    capOv.classList.remove('hidden');
    const i = capOv.querySelector('#cap-input'); i.value = ''; setTimeout(() => i.focus(), 30);
  }
  async function doCapture(mode) {
    const inp = capOv.querySelector('#cap-input'); const text = inp.value.trim();
    if (!text) { capOv.classList.add('hidden'); return; }
    capOv.classList.add('hidden');
    try {
      if (mode === 'new') { const n = await captureToNew(text); if (typeof showToast === 'function') showToast('ノートを作成しました', 'success'); if (typeof openNoteById === 'function') openNoteById(n.id); }
      else { const n = await captureToDaily(text); if (typeof showToast === 'function') showToast('今日のノートに追記しました', 'success'); }
    } catch (e) { if (typeof showToast === 'function') showToast('保存に失敗しました', 'error'); }
  }

  function boot() {
    // フローティングのキャプチャボタン
    if (!document.getElementById('quick-capture-fab')) {
      const fab = document.createElement('button');
      fab.id = 'quick-capture-fab'; fab.title = 'クイックキャプチャ (Ctrl/⌘+Shift+N)';
      fab.innerHTML = '<i data-lucide="zap" class="w-5 h-5"></i>';
      fab.addEventListener('click', openCapture);
      document.body.appendChild(fab);
      if (window.lucide) lucide.createIcons();
    }
    // エディタのタイトルバーに PDF ボタンを追加
    const anchor = document.getElementById('import-from-notion-btn');
    if (anchor && anchor.parentNode && !document.getElementById('export-pdf-btn')) {
      const b = document.createElement('button');
      b.id = 'export-pdf-btn'; b.className = 'text-btn'; b.title = 'PDFで出力';
      b.innerHTML = '<i data-lucide="file-down" class="w-3.5 h-3.5"></i>PDF';
      anchor.parentNode.insertBefore(b, anchor);
      b.addEventListener('click', exportPDF);
      if (window.lucide) lucide.createIcons();
    }
    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeExtras) {
      COMMANDS.push({ id: 'export-pdf', label: 'PDFで出力', icon: 'file-down', run: () => exportPDF() });
      COMMANDS.push({ id: 'quick-capture', label: 'クイックキャプチャ', icon: 'zap', run: () => openCapture() });
      COMMANDS.__gazeExtras = true;
    }
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'N' || e.key === 'n')) { e.preventDefault(); openCapture(); }
    });
  }

  window.GazeExtras = { exportPDF, openCapture };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
