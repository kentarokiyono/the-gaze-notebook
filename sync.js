/* ============================================================================
 * The Gaze — Local Folder Sync (Phase 10, Obsidian式 vault)
 * File System Access API でローカルフォルダに .md（YAML風frontmatter）として
 * 読み書き。画像は assets/ サブフォルダへ。真のクロスデバイス同期は
 * Dropbox/iCloud/Git 等でこのフォルダを同期し「読込」で取り込む運用。
 * 対応ブラウザ: Chrome / Edge（showDirectoryPicker）。
 * ========================================================================== */
(function () {
  'use strict';
  const SYNC_DB = 'TheGazeSync', ST = 'kv';
  let vault = null;   // FileSystemDirectoryHandle
  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  // ---- handle 永続化（IndexedDB） ------------------------------------------
  function kvOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(SYNC_DB, 1);
      r.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains(ST)) db.createObjectStore(ST); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function kvSet(k, v) { return new Promise((res, rej) => { kvOpen().then((db) => { const tx = db.transaction(ST, 'readwrite'); tx.objectStore(ST).put(v, k); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => { db.close(); rej(tx.error); }; }).catch(rej); }); }
  function kvGet(k) { return new Promise((res) => { kvOpen().then((db) => { const r = db.transaction(ST, 'readonly').objectStore(ST).get(k); r.onsuccess = () => { db.close(); res(r.result); }; r.onerror = () => { db.close(); res(null); }; }).catch(() => res(null)); }); }

  async function verifyPermission(handle, rw) {
    if (!handle || !handle.queryPermission) return false;
    const opts = { mode: rw ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  // ---- frontmatter シリアライズ / パース -----------------------------------
  // 値はすべて JSON でエンコードし、確実に往復できるようにする（JSONはYAMLのサブセット）
  const FM_KEYS = ['id', 'parentId', 'title', 'createdAt', 'updatedAt', 'pinned', 'daily', 'dailyDate', 'notionPageId', 'richness', 'db', 'canvas'];
  function noteToFile(n) {
    let fm = '---\n';
    FM_KEYS.forEach((k) => {
      if (k === 'title') { fm += 'title: ' + JSON.stringify(n.title || '') + '\n'; return; }
      const v = n[k];
      if (v === undefined || v === null) return;
      fm += k + ': ' + JSON.stringify(v) + '\n';
    });
    fm += '---\n\n';
    return fm + (n.content || '');
  }
  function fileToNote(text) {
    const s = String(text || '').replace(/\r\n/g, '\n');
    const m = s.match(/^---\n([\s\S]*?)\n---[ \t]*\n?\n?/);
    if (!m) return null;
    const note = {};
    m[1].split('\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx < 0) return;
      const key = line.slice(0, idx).trim();
      const raw = line.slice(idx + 1).trim();
      if (!key) return;
      try { note[key] = JSON.parse(raw); } catch (e) { note[key] = raw.replace(/^"|"$/g, ''); }
    });
    if (!note.id) return null;
    note.content = s.slice(m[0].length);
    return note;
  }

  function sanitize(name) { return String(name || 'untitled').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled'; }
  function fileNameFor(n) { return sanitize(n.title) + '__' + n.id + '.md'; }
  function extFor(type) { const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }; return map[type] || 'png'; }

  // ---- 書き出し / 読み込み --------------------------------------------------
  async function writeFile(dir, name, contents) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(contents); await w.close();
  }

  async function exportAll() {
    if (!vault) { if (typeof showToast === 'function') showToast('先にフォルダを選択してください', 'error'); return; }
    if (!(await verifyPermission(vault, true))) { if (typeof showToast === 'function') showToast('書き込み権限がありません', 'error'); return; }
    let notes = [];
    try { notes = await TheGazeDB.getAllNotes(); } catch (e) { return; }
    for (const n of notes) { try { await writeFile(vault, fileNameFor(n), noteToFile(n)); } catch (e) { console.error('write', e); } }
    // assets
    try {
      const assets = window.GazeAssets ? await GazeAssets.all() : [];
      if (assets.length) {
        const ad = await vault.getDirectoryHandle('assets', { create: true });
        for (const a of assets) { if (a.blob) { try { await writeFile(ad, a.id + '.' + extFor(a.type), a.blob); } catch (e) {} } }
      }
    } catch (e) {}
    if (typeof showToast === 'function') showToast(notes.length + '件をフォルダへ保存しました', 'success');
    updateStatus();
  }

  async function importAll() {
    if (!vault) { if (typeof showToast === 'function') showToast('先にフォルダを選択してください', 'error'); return; }
    if (!(await verifyPermission(vault, false))) { if (typeof showToast === 'function') showToast('読み取り権限がありません', 'error'); return; }
    let count = 0;
    try {
      for await (const [name, handle] of vault.entries()) {
        if (handle.kind === 'file' && /\.md$/i.test(name)) {
          try { const f = await handle.getFile(); const note = fileToNote(await f.text()); if (note && note.id) { await TheGazeDB.addNote(note); count++; } } catch (e) {}
        }
      }
    } catch (e) { console.error('import', e); }
    // assets
    try {
      const ad = await vault.getDirectoryHandle('assets');
      for await (const [an, ah] of ad.entries()) {
        if (ah.kind === 'file' && window.GazeAssets) { try { const f = await ah.getFile(); const id = an.replace(/\.[^.]+$/, ''); await GazeAssets.importBlob(id, f, f.type); } catch (e) {} }
      }
    } catch (e) {}
    if (typeof renderNotesList === 'function') await renderNotesList();
    if (typeof refreshGrowth === 'function') refreshGrowth();
    if (typeof showToast === 'function') showToast(count + '件をフォルダから読み込みました', 'success');
  }

  async function writeOne(n) {
    if (!vault || !n) return;
    try { if (!(await verifyPermission(vault, true))) return; await writeFile(vault, fileNameFor(n), noteToFile(n)); } catch (e) {}
  }

  // ---- フォルダ選択 ---------------------------------------------------------
  async function pickVault() {
    if (!supported) { if (typeof showToast === 'function') showToast('このブラウザは未対応です（Chrome/Edge推奨）', 'error'); return; }
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      vault = dir;
      try { await kvSet('vault', dir); } catch (e) {}
      if (typeof showToast === 'function') showToast('フォルダ「' + dir.name + '」に接続しました', 'success');
      updateStatus();
    } catch (e) { /* cancel */ }
  }
  async function restoreVault() {
    if (!supported) return;
    try { const h = await kvGet('vault'); if (h) { vault = h; } } catch (e) {}
    updateStatus();
  }
  function autoOn() { return localStorage.getItem('gaze_vault_auto') === '1'; }
  function setAuto(v) { localStorage.setItem('gaze_vault_auto', v ? '1' : '0'); }

  function updateStatus() {
    const el = document.getElementById('vault-status');
    if (!el) return;
    if (!supported) { el.textContent = '非対応ブラウザ（Chrome/Edge をご利用ください）'; el.className = 'text-xs text-amber-400/80 mb-2'; return; }
    el.textContent = vault ? ('接続中: ' + vault.name + (autoOn() ? '（自動保存ON）' : '')) : '未接続';
    el.className = 'text-xs ' + (vault ? 'text-green-400/80' : 'text-slate-500') + ' mb-2';
  }

  // ---- 初期化 & フック ------------------------------------------------------
  function boot() {
    restoreVault();
    const pick = document.getElementById('vault-pick');
    const exp = document.getElementById('vault-export');
    const imp = document.getElementById('vault-import');
    const auto = document.getElementById('vault-auto');
    if (pick) pick.addEventListener('click', pickVault);
    if (exp) exp.addEventListener('click', exportAll);
    if (imp) imp.addEventListener('click', importAll);
    if (auto) { auto.checked = autoOn(); auto.addEventListener('change', () => { setAuto(auto.checked); updateStatus(); }); }
    updateStatus();

    // saveNote をラップして、自動保存ONなら現在ノートをフォルダにも書き出す
    if (typeof window.saveNote === 'function' && !window.saveNote.__gazeSyncWrapped) {
      const orig = window.saveNote;
      window.saveNote = async function () {
        const r = await orig.apply(this, arguments);
        try { if (vault && autoOn()) { const n = (typeof state !== 'undefined' && state) ? state.currentNote : null; if (n) writeOne(n); } } catch (e) {}
        return r;
      };
      window.saveNote.__gazeSyncWrapped = true;
    }

    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeSync) {
      COMMANDS.push({ id: 'vault-pick', label: 'フォルダを選択（同期）', icon: 'folder', run: () => pickVault() });
      COMMANDS.push({ id: 'vault-export', label: 'フォルダへ保存', icon: 'folder-down', run: () => exportAll() });
      COMMANDS.push({ id: 'vault-import', label: 'フォルダから読込', icon: 'folder-up', run: () => importAll() });
      COMMANDS.__gazeSync = true;
    }
  }

  window.GazeSync = { pickVault, exportAll, importAll, noteToFile, fileToNote };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
