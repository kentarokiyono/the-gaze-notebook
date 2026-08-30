/* ============================================================================
 * The Gaze — Assets (Phase 5: 画像などのバイナリ保存)
 * 画像は本文(Markdown)に data: URL で埋め込むと肥大化するため、専用の
 * IndexedDB(TheGazeAssets)に blob として保存し、本文からは asset:<id> で参照する。
 * 表示時に blob → object URL を解決して <img src> に流し込む。
 * ========================================================================== */
(function () {
  'use strict';
  const DB = 'TheGazeAssets', ST = 'assets';
  const cache = new Map(); // id -> objectURL
  let memFallback = null;   // IndexedDB不可時のメモリ退避

  function open() {
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(DB, 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains(ST)) db.createObjectStore(ST, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('assets idb error'));
    });
  }
  function put(rec) {
    return new Promise((res, rej) => {
      open().then((db) => { const tx = db.transaction(ST, 'readwrite'); tx.objectStore(ST).put(rec); tx.oncomplete = () => { db.close(); res(rec); }; tx.onerror = () => { db.close(); rej(tx.error); }; }).catch(rej);
    });
  }
  function get(id) {
    return new Promise((res, rej) => {
      open().then((db) => { const r = db.transaction(ST, 'readonly').objectStore(ST).get(id); r.onsuccess = () => { db.close(); res(r.result); }; r.onerror = () => { db.close(); rej(r.error); }; }).catch(rej);
    });
  }

  async function save(blob, name) {
    const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const rec = { id, blob, type: blob.type || '', name: name || '' };
    try { await put(rec); }
    catch (e) { (memFallback = memFallback || new Map()).set(id, rec); }
    return id;
  }
  function resolveSync(id) { return cache.get(id) || null; }
  async function load(id) {
    if (cache.has(id)) return cache.get(id);
    let rec = null;
    try { rec = await get(id); } catch (e) {}
    if (!rec && memFallback) rec = memFallback.get(id);
    if (!rec || !rec.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    cache.set(id, url);
    return url;
  }
  // <img data-asset="id"> や <img src="asset:id"> を実URLへ差し替える
  async function hydrate(root) {
    if (!root) return;
    const list = [];
    root.querySelectorAll('img[data-asset]').forEach((im) => list.push(im));
    root.querySelectorAll('img[src^="asset:"]').forEach((im) => list.push(im));
    for (const im of list) {
      if (im.dataset.assetHydrated === '1') continue;
      let id = im.dataset.asset;
      if (!id) { const s = im.getAttribute('src') || ''; if (s.indexOf('asset:') === 0) id = s.slice(6); }
      if (!id) continue;
      const u = resolveSync(id) || await load(id);
      if (u) { im.src = u; im.dataset.assetHydrated = '1'; }
    }
  }
  // Markdown/HTML中の asset: 参照をすべて事前ロード（同期解決を可能に）
  async function preload(text) {
    const ids = (String(text || '').match(/asset:([A-Za-z0-9_]+)/g) || []).map((s) => s.slice(6));
    for (const id of ids) { if (!cache.has(id)) await load(id); }
  }

  window.GazeAssets = { save, load, resolveSync, hydrate, preload, get };
})();
