/* ============================================================================
 * The Gaze — UI polish
 * Phase 11: エディタ本文幅の切替（標準 / 広い / 全幅）
 * Phase 12: ゴミ箱+取り消し / ノート複製 / お気に入り・最近サイドバー
 * ========================================================================== */
(function () {
  'use strict';
  const WKEY = 'gaze_editor_width';
  const ORDER = ['std', 'wide', 'full'];
  const LABEL = { std: '標準幅', wide: '広い幅', full: '全幅' };
  const ICON = { std: 'move-horizontal', wide: 'unfold-horizontal', full: 'maximize-2' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  const cur = () => (typeof state !== 'undefined' && state ? state.currentNote : null);

  // ---- エディタ幅 -----------------------------------------------------------
  function getWidth() { const w = localStorage.getItem(WKEY); return ORDER.indexOf(w) >= 0 ? w : 'std'; }
  function applyWidth() {
    const w = getWidth();
    document.body.classList.remove('gw-wide', 'gw-full');
    if (w === 'wide') document.body.classList.add('gw-wide');
    else if (w === 'full') document.body.classList.add('gw-full');
    const btn = document.getElementById('width-toggle-btn');
    if (btn) { btn.title = '本文幅: ' + LABEL[w] + '（クリックで切替）'; btn.innerHTML = '<i data-lucide="' + ICON[w] + '" class="w-3.5 h-3.5"></i>'; if (window.lucide) lucide.createIcons(); }
  }
  function cycleWidth() {
    const w = getWidth(); const next = ORDER[(ORDER.indexOf(w) + 1) % ORDER.length];
    localStorage.setItem(WKEY, next); applyWidth();
    if (typeof showToast === 'function') showToast('本文幅: ' + LABEL[next], 'success');
  }

  // ---- ゴミ箱 (soft delete) -------------------------------------------------
  function installTrash() {
    if (typeof TheGazeDB === 'undefined' || TheGazeDB.__gazeTrash) return;
    const rawAll = TheGazeDB.getAllNotes.bind(TheGazeDB);
    TheGazeDB.getAllRaw = rawAll;
    TheGazeDB.getAllNotes = async function () { const a = await rawAll(); return a.filter((n) => !n.trashed); };
    TheGazeDB.getTrashed = async function () { const a = await rawAll(); return a.filter((n) => n.trashed).sort((x, y) => (y.trashedAt || 0) - (x.trashedAt || 0)); };
    TheGazeDB.__gazeTrash = true;

    // deleteNote をソフト削除に置き換え
    window.deleteNote = async function (id) {
      const note = await TheGazeDB.getNote(id);
      if (!note) return;
      note.trashed = true; note.trashedAt = Date.now();
      await TheGazeDB.addNote(note);
      if (cur() && cur().id === id) { state.currentNote = null; if (typeof setView === 'function') setView('library'); }
      if (typeof renderNotesList === 'function') await renderNotesList();
      if (typeof refreshGrowth === 'function') refreshGrowth();
      toastUndo('ゴミ箱に移動しました', () => restoreNote(id));
    };
    window.deleteNote.__gazeWrapped = true;
  }
  async function restoreNote(id) {
    const n = await TheGazeDB.getNote(id); if (!n) return;
    delete n.trashed; delete n.trashedAt; n.updatedAt = Date.now();
    await TheGazeDB.addNote(n);
    if (typeof renderNotesList === 'function') await renderNotesList();
    if (typeof refreshGrowth === 'function') refreshGrowth();
    if (typeof showToast === 'function') showToast('復元しました', 'success');
  }
  async function purgeNote(id) {
    await TheGazeDB.deleteNote(id);
    if (typeof renderNotesList === 'function') await renderNotesList();
    renderTrash();
  }
  async function emptyTrash() {
    if (!confirm('ゴミ箱を空にしますか？（完全に削除され、元に戻せません）')) return;
    const t = await TheGazeDB.getTrashed();
    for (const n of t) { try { await TheGazeDB.deleteNote(n.id); } catch (e) {} }
    if (typeof renderNotesList === 'function') await renderNotesList();
    renderTrash();
    if (typeof showToast === 'function') showToast('ゴミ箱を空にしました', 'success');
  }

  let trashOv = null;
  async function openTrash() {
    if (!trashOv) {
      trashOv = document.createElement('div');
      trashOv.className = 'hidden fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4';
      trashOv.addEventListener('mousedown', (e) => { if (e.target === trashOv) trashOv.classList.add('hidden'); });
      document.body.appendChild(trashOv);
    }
    trashOv.classList.remove('hidden');
    await renderTrash();
  }
  async function renderTrash() {
    if (!trashOv || trashOv.classList.contains('hidden')) return;
    const t = await TheGazeDB.getTrashed();
    trashOv.innerHTML =
      '<div class="trash-modal"><div class="trash-head"><h2>ゴミ箱</h2>' +
      '<button class="trash-empty"' + (t.length ? '' : ' disabled') + '><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>空にする</button>' +
      '<button class="trash-x"><i data-lucide="x" class="w-5 h-5"></i></button></div>' +
      '<div class="trash-list">' +
      (t.length ? t.map((n) => '<div class="trash-item" data-id="' + n.id + '"><i data-lucide="file-text" class="w-4 h-4"></i>' +
        '<span class="trash-title">' + esc(n.title || 'Untitled') + '</span>' +
        '<button class="trash-restore" data-r="' + n.id + '">復元</button>' +
        '<button class="trash-del" data-d="' + n.id + '" title="完全削除"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div>').join('')
        : '<div class="trash-empty-msg">ゴミ箱は空です</div>') +
      '</div></div>';
    if (window.lucide) lucide.createIcons();
    trashOv.querySelector('.trash-x').addEventListener('click', () => trashOv.classList.add('hidden'));
    const eb = trashOv.querySelector('.trash-empty'); if (eb && t.length) eb.addEventListener('click', emptyTrash);
    trashOv.querySelectorAll('.trash-restore').forEach((b) => b.addEventListener('click', async () => { await restoreNote(b.dataset.r); renderTrash(); }));
    trashOv.querySelectorAll('.trash-del').forEach((b) => b.addEventListener('click', () => { if (confirm('完全に削除しますか？')) purgeNote(b.dataset.d); }));
  }

  function toastUndo(message, undoFn) {
    document.querySelectorAll('.gaze-toast').forEach((t) => t.remove());
    const toast = document.createElement('div');
    toast.className = 'gaze-toast fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-2xl z-[70] fade-in bg-slate-800/95 border border-slate-700 border-l-4 border-l-blue-400 flex items-center gap-3';
    const span = document.createElement('span'); span.className = 'text-sm font-medium text-white'; span.textContent = message;
    const btn = document.createElement('button'); btn.className = 'text-xs font-semibold text-blue-300 hover:text-blue-200 underline'; btn.textContent = '元に戻す';
    let done = false;
    btn.addEventListener('click', () => { done = true; toast.remove(); undoFn(); });
    toast.appendChild(span); toast.appendChild(btn);
    document.body.appendChild(toast);
    setTimeout(() => { if (!done) { toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)'; setTimeout(() => toast.remove(), 300); } }, 6000);
  }

  // ---- ノート複製 -----------------------------------------------------------
  async function duplicateNote(id) {
    id = id || (cur() && cur().id);
    if (!id) { if (typeof showToast === 'function') showToast('ノートを開いてください', 'error'); return; }
    const n = await TheGazeDB.getNote(id); if (!n) return;
    const copy = JSON.parse(JSON.stringify(n));
    copy.id = (typeof newId === 'function' ? newId() : 'note_' + Date.now());
    copy.title = (n.title || 'Untitled') + ' (コピー)';
    copy.createdAt = Date.now(); copy.updatedAt = Date.now();
    delete copy.trashed; delete copy.trashedAt; delete copy.notionPageId;
    await TheGazeDB.addNote(copy);
    if (typeof renderTree === 'function') await renderTree();
    if (typeof openNoteById === 'function') openNoteById(copy.id);
    if (typeof showToast === 'function') showToast('ノートを複製しました', 'success');
  }

  // ---- お気に入り / 最近 ----------------------------------------------------
  async function renderQuickAccess() {
    const box = document.getElementById('quick-access');
    if (!box) return;
    let notes = [];
    try { notes = await TheGazeDB.getAllNotes(); } catch (e) { return; }
    const favs = notes.filter((n) => n.pinned).slice(0, 8);
    const recent = notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
    let html = '';
    if (favs.length) {
      html += '<div class="qa-sec"><div class="qa-head"><i data-lucide="pin" class="w-3 h-3"></i>お気に入り</div>' +
        favs.map((n) => '<button class="qa-item" data-id="' + n.id + '"><i data-lucide="file-text" class="w-3.5 h-3.5"></i><span class="truncate">' + esc(n.title || 'Untitled') + '</span></button>').join('') + '</div>';
    }
    if (recent.length) {
      html += '<div class="qa-sec"><div class="qa-head"><i data-lucide="clock" class="w-3 h-3"></i>最近</div>' +
        recent.map((n) => '<button class="qa-item" data-id="' + n.id + '"><i data-lucide="file-text" class="w-3.5 h-3.5"></i><span class="truncate">' + esc(n.title || 'Untitled') + '</span></button>').join('') + '</div>';
    }
    html += '<button class="qa-trash"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>ゴミ箱</button>';
    box.innerHTML = html;
    if (window.lucide) lucide.createIcons();
    box.querySelectorAll('.qa-item').forEach((b) => b.addEventListener('click', () => { if (typeof openNoteById === 'function') openNoteById(b.dataset.id); }));
    const tb = box.querySelector('.qa-trash'); if (tb) tb.addEventListener('click', openTrash);
  }

  function boot() {
    installTrash();
    // ツールバー幅トグル
    const group = document.querySelector('#md-toolbar .ml-auto');
    if (group && !document.getElementById('width-toggle-btn')) {
      const btn = document.createElement('button');
      btn.id = 'width-toggle-btn'; btn.className = 'tb-btn';
      btn.addEventListener('click', cycleWidth);
      group.insertBefore(btn, group.firstChild);
    }
    applyWidth();

    // renderTree をラップして quick-access も更新
    if (typeof window.renderTree === 'function' && !window.renderTree.__gazeQa) {
      const orig = window.renderTree;
      window.renderTree = async function () { const r = await orig.apply(this, arguments); try { renderQuickAccess(); } catch (e) {} return r; };
      window.renderTree.__gazeQa = true;
    }
    renderQuickAccess();

    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeUi) {
      COMMANDS.push({ id: 'toggle-width', label: '本文幅を切替（標準/広い/全幅）', icon: 'move-horizontal', run: () => cycleWidth() });
      COMMANDS.push({ id: 'duplicate-note', label: '現在のノートを複製', icon: 'copy', run: () => duplicateNote() });
      COMMANDS.push({ id: 'open-trash', label: 'ゴミ箱を開く', icon: 'trash-2', run: () => openTrash() });
      COMMANDS.__gazeUi = true;
    }
  }

  window.GazeUI = { cycleWidth, applyWidth, duplicateNote, restoreNote, openTrash, renderQuickAccess };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
