/* ============================================================================
 * The Gaze — Canvas (Phase 8: 無限ホワイトボード)
 * note.canvas = { nodes:[{id,type,x,y,w,h,...}], edges:[{id,from,to}], viewport:{x,y,scale} }
 *  - パン(背景ドラッグ) / ズーム(ホイール) / ノード移動・リサイズ / 接続線 / 削除
 *  - ノード種別: text（テキスト）/ note（ノート参照）/ image（画像）
 * ========================================================================== */
(function () {
  'use strict';
  const HIDE_IDS = ['md-toolbar', 'editor-area', 'backlinks-panel', 'related-panel', 'db-view'];
  let root = null;      // #canvas-view
  let surface = null;   // 変形レイヤ
  let svg = null;       // 接続線
  let vp = { x: 0, y: 0, scale: 1 };
  let selected = null;  // 選択中ノードID
  let linking = null;   // {from, tempLine}
  const uid = (p) => (p || 'n') + '_' + Math.random().toString(36).slice(2, 8);

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  const cur = () => (typeof state !== 'undefined' && state ? state.currentNote : null);
  const cv = () => { const n = cur(); return n ? n.canvas : null; };

  let saveT = null;
  function save() {
    const n = cur(); if (!n || !n.canvas) return;
    n.canvas.viewport = vp;
    n.updatedAt = Date.now();
    clearTimeout(saveT);
    saveT = setTimeout(() => { TheGazeDB.addNote(n).then(() => { if (typeof renderTree === 'function') renderTree(); }).catch(() => {}); }, 250);
  }

  async function createCanvas() {
    const c = { nodes: [], edges: [], viewport: { x: 60, y: 60, scale: 1 } };
    const note = {
      id: (typeof newId === 'function' ? newId() : 'note_' + Date.now()),
      title: '新しいキャンバス', content: '', parentId: null,
      createdAt: Date.now(), updatedAt: Date.now(), canvas: c,
    };
    await TheGazeDB.addNote(note); await renderTree();
    if (typeof openNoteById === 'function') openNoteById(note.id);
    if (typeof showToast === 'function') showToast('キャンバスを作成しました', 'success');
  }

  // ---- 座標変換 -------------------------------------------------------------
  function applyTransform() { surface.style.transform = 'translate(' + vp.x + 'px,' + vp.y + 'px) scale(' + vp.scale + ')'; }
  function toCanvas(clientX, clientY) {
    const r = root.getBoundingClientRect();
    return { x: (clientX - r.left - vp.x) / vp.scale, y: (clientY - r.top - vp.y) / vp.scale };
  }

  // ---- 描画 -----------------------------------------------------------------
  function render() {
    const c = cv(); if (!root || !c) return;
    vp = c.viewport || { x: 0, y: 0, scale: 1 };
    root.innerHTML =
      '<div class="cv-toolbar">' +
      '<button class="cv-tb" data-add="text" title="テキスト"><i data-lucide="type" class="w-4 h-4"></i></button>' +
      '<button class="cv-tb" data-add="note" title="ノート"><i data-lucide="file-text" class="w-4 h-4"></i></button>' +
      '<button class="cv-tb" data-add="image" title="画像"><i data-lucide="image" class="w-4 h-4"></i></button>' +
      '<span class="cv-sep"></span>' +
      '<button class="cv-tb" data-zoom="in" title="拡大"><i data-lucide="zoom-in" class="w-4 h-4"></i></button>' +
      '<button class="cv-tb" data-zoom="out" title="縮小"><i data-lucide="zoom-out" class="w-4 h-4"></i></button>' +
      '<button class="cv-tb" data-fit title="全体表示"><i data-lucide="maximize" class="w-4 h-4"></i></button>' +
      '<span class="cv-zoom-label"></span>' +
      '</div>' +
      '<div class="cv-surface"><svg class="cv-edges"></svg></div>' +
      '<div class="cv-hint">背景ドラッグで移動・ホイールで拡大縮小。ノードの右下でリサイズ、右のドットでつなぐ。</div>';
    surface = root.querySelector('.cv-surface');
    svg = root.querySelector('.cv-edges');
    applyTransform();
    c.nodes.forEach((n) => surface.appendChild(nodeEl(n)));
    drawEdges();
    updateZoomLabel();
    if (window.lucide) lucide.createIcons();
    bindToolbar();
  }
  function updateZoomLabel() { const l = root.querySelector('.cv-zoom-label'); if (l) l.textContent = Math.round(vp.scale * 100) + '%'; }

  function bindToolbar() {
    root.querySelectorAll('.cv-tb[data-add]').forEach((b) => b.addEventListener('click', () => addNode(b.dataset.add)));
    root.querySelectorAll('.cv-tb[data-zoom]').forEach((b) => b.addEventListener('click', () => zoomBy(b.dataset.zoom === 'in' ? 1.2 : 1 / 1.2)));
    const fit = root.querySelector('[data-fit]'); if (fit) fit.addEventListener('click', fitView);
  }

  function nodeEl(n) {
    const el = document.createElement('div');
    el.className = 'cv-node cv-node-' + n.type + (selected === n.id ? ' sel' : '');
    el.dataset.id = n.id;
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    el.style.width = (n.w || 200) + 'px';
    if (n.h) el.style.height = n.h + 'px';
    if (n.color) el.style.setProperty('--cv-accent', n.color);

    let inner = '';
    if (n.type === 'text') {
      inner = '<div class="cv-text" contenteditable="true" spellcheck="false">' + esc(n.text || '') + '</div>';
    } else if (n.type === 'note') {
      const note = null; // filled async
      inner = '<div class="cv-note"><div class="cv-note-title">読み込み中…</div><div class="cv-note-prev"></div><button class="cv-open" title="開く"><i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i></button></div>';
    } else if (n.type === 'image') {
      inner = '<img class="cv-img" data-asset="' + esc(n.assetId || '') + '" alt="">';
    }
    el.innerHTML =
      '<div class="cv-node-bar"><span class="cv-drag"></span><button class="cv-del" title="削除"><i data-lucide="x" class="w-3 h-3"></i></button></div>' +
      '<div class="cv-node-body">' + inner + '</div>' +
      '<div class="cv-port" title="つなぐ"></div>' +
      '<div class="cv-resize"></div>';
    bindNode(el, n);
    if (n.type === 'note') hydrateNoteNode(el, n);
    if (n.type === 'image' && window.GazeAssets) GazeAssets.hydrate(el);
    return el;
  }

  async function hydrateNoteNode(el, n) {
    let notes = []; try { notes = await TheGazeDB.getAllNotes(); } catch (e) {}
    const note = notes.find((x) => x.id === n.noteId);
    const t = el.querySelector('.cv-note-title'), p = el.querySelector('.cv-note-prev');
    if (!note) { if (t) t.textContent = '(削除済みのノート)'; return; }
    if (t) t.textContent = note.title || 'Untitled';
    if (p) p.textContent = (note.content || '').replace(/\n+/g, ' ').slice(0, 120);
    const open = el.querySelector('.cv-open');
    if (open) open.addEventListener('click', (e) => { e.stopPropagation(); if (typeof openNoteById === 'function') openNoteById(n.noteId); });
  }

  // ---- ノード操作 -----------------------------------------------------------
  function addNode(type) {
    const c = cv();
    const center = toCanvas(root.getBoundingClientRect().left + root.clientWidth / 2, root.getBoundingClientRect().top + root.clientHeight / 2);
    const off = (c.nodes.length % 6) * 28; // 少しずつずらして重なりを防ぐ
    const n = { id: uid(), type, x: Math.round(center.x - 100 + off), y: Math.round(center.y - 60 + off), w: 220 };
    if (type === 'text') { n.text = ''; n.h = 120; }
    if (type === 'image') {
      pickImage(async (file) => {
        try { n.assetId = await GazeAssets.save(file, file.name); } catch (e) { return; }
        n.h = 160; c.nodes.push(n); surface.appendChild(nodeEl(n)); save();
      });
      return;
    }
    if (type === 'note') {
      notePicker((noteId) => { n.noteId = noteId; n.h = 110; c.nodes.push(n); surface.appendChild(nodeEl(n)); drawEdges(); save(); });
      return;
    }
    c.nodes.push(n);
    const el = nodeEl(n); surface.appendChild(el); save();
    const ta = el.querySelector('.cv-text'); if (ta) ta.focus();
  }

  function bindNode(el, n) {
    // select
    el.addEventListener('mousedown', (e) => { if (e.target.closest('.cv-text')) return; selectNode(n.id); });
    // drag via bar
    const bar = el.querySelector('.cv-node-bar');
    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cv-del')) return;
      e.preventDefault(); e.stopPropagation();
      const start = toCanvas(e.clientX, e.clientY); const ox = n.x, oy = n.y;
      const move = (ev) => { const p = toCanvas(ev.clientX, ev.clientY); n.x = Math.round(ox + (p.x - start.x)); n.y = Math.round(oy + (p.y - start.y)); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; drawEdges(); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    // delete
    el.querySelector('.cv-del').addEventListener('click', (e) => { e.stopPropagation(); deleteNode(n.id); });
    // resize
    const rz = el.querySelector('.cv-resize');
    rz.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ow = n.w || 200, oh = n.h || el.offsetHeight;
      const move = (ev) => { n.w = Math.max(120, Math.round(ow + (ev.clientX - sx) / vp.scale)); n.h = Math.max(70, Math.round(oh + (ev.clientY - sy) / vp.scale)); el.style.width = n.w + 'px'; el.style.height = n.h + 'px'; drawEdges(); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    // text edit
    const txt = el.querySelector('.cv-text');
    if (txt) txt.addEventListener('blur', () => { n.text = txt.innerText; save(); });
    // link port
    const port = el.querySelector('.cv-port');
    port.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); startLink(n, e); });
  }

  function selectNode(id) {
    selected = id;
    surface.querySelectorAll('.cv-node').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  }
  function deleteNode(id) {
    const c = cv();
    c.nodes = c.nodes.filter((n) => n.id !== id);
    c.edges = c.edges.filter((e) => e.from !== id && e.to !== id);
    if (selected === id) selected = null;
    const el = surface.querySelector('.cv-node[data-id="' + id + '"]'); if (el) el.remove();
    drawEdges(); save();
  }

  // ---- 接続線 ---------------------------------------------------------------
  function nodeCenter(n) { return { x: n.x + (n.w || 200) / 2, y: n.y + (n.h || 100) / 2 }; }
  function drawEdges() {
    const c = cv(); if (!svg) return;
    const map = {}; c.nodes.forEach((n) => (map[n.id] = n));
    let h = '';
    c.edges.forEach((e) => {
      const a = map[e.from], b = map[e.to]; if (!a || !b) return;
      const p = nodeCenter(a), q = nodeCenter(b);
      h += '<line class="cv-edge" data-id="' + e.id + '" x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '" />';
    });
    svg.innerHTML = h;
    svg.querySelectorAll('.cv-edge').forEach((ln) => ln.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm('この接続を削除しますか？')) { const c2 = cv(); c2.edges = c2.edges.filter((x) => x.id !== ln.dataset.id); drawEdges(); save(); }
    }));
  }
  function startLink(from, e) {
    const c = cv();
    const move = (ev) => {
      const p = toCanvas(ev.clientX, ev.clientY); const s = nodeCenter(from);
      let temp = svg.querySelector('.cv-edge-temp');
      if (!temp) { temp = document.createElementNS('http://www.w3.org/2000/svg', 'line'); temp.setAttribute('class', 'cv-edge cv-edge-temp'); svg.appendChild(temp); }
      temp.setAttribute('x1', s.x); temp.setAttribute('y1', s.y); temp.setAttribute('x2', p.x); temp.setAttribute('y2', p.y);
    };
    const up = (ev) => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      const t = svg.querySelector('.cv-edge-temp'); if (t) t.remove();
      const target = ev.target.closest('.cv-node');
      if (target && target.dataset.id !== from.id) {
        const to = target.dataset.id;
        if (!c.edges.some((x) => (x.from === from.id && x.to === to) || (x.from === to && x.to === from.id))) {
          c.edges.push({ id: uid('e'), from: from.id, to }); drawEdges(); save();
        }
      }
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  // ---- パン / ズーム --------------------------------------------------------
  function bindViewport() {
    root.addEventListener('mousedown', (e) => {
      if (e.target !== root && e.target !== surface && !e.target.classList.contains('cv-edges')) return;
      selectNode(null);
      const ox = vp.x, oy = vp.y, sx = e.clientX, sy = e.clientY;
      root.classList.add('panning');
      const move = (ev) => { vp.x = ox + (ev.clientX - sx); vp.y = oy + (ev.clientY - sy); applyTransform(); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); root.classList.remove('panning'); save(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = root.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const before = { x: (cx - vp.x) / vp.scale, y: (cy - vp.y) / vp.scale };
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      vp.scale = Math.max(0.2, Math.min(3, vp.scale * factor));
      vp.x = cx - before.x * vp.scale; vp.y = cy - before.y * vp.scale;
      applyTransform(); updateZoomLabel(); save();
    }, { passive: false });
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); deleteNode(selected); }
    });
    root.tabIndex = 0;
  }
  function zoomBy(f) {
    const r = root.getBoundingClientRect(); const cx = r.width / 2, cy = r.height / 2;
    const before = { x: (cx - vp.x) / vp.scale, y: (cy - vp.y) / vp.scale };
    vp.scale = Math.max(0.2, Math.min(3, vp.scale * f));
    vp.x = cx - before.x * vp.scale; vp.y = cy - before.y * vp.scale;
    applyTransform(); updateZoomLabel(); save();
  }
  function fitView() {
    const c = cv(); if (!c.nodes.length) { vp = { x: 60, y: 60, scale: 1 }; applyTransform(); updateZoomLabel(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    c.nodes.forEach((n) => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + (n.w || 200)); maxY = Math.max(maxY, n.y + (n.h || 120)); });
    const pad = 60, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const s = Math.min(root.clientWidth / w, root.clientHeight / h, 1.5);
    vp.scale = Math.max(0.2, s);
    vp.x = (root.clientWidth - w * vp.scale) / 2 - (minX - pad) * vp.scale;
    vp.y = (root.clientHeight - h * vp.scale) / 2 - (minY - pad) * vp.scale;
    applyTransform(); updateZoomLabel(); save();
  }

  // ---- 補助: 画像ピッカー / ノートピッカー ----------------------------------
  function pickImage(cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (f) cb(f); inp.remove(); });
    document.body.appendChild(inp); inp.click();
  }
  async function notePicker(cb) {
    let notes = []; try { notes = await TheGazeDB.getAllNotes(); } catch (e) {}
    notes = notes.filter((n) => !n.canvas);
    const ov = document.createElement('div');
    ov.className = 'cv-picker-ov';
    ov.innerHTML = '<div class="cv-picker"><div class="cv-picker-head"><input class="cv-picker-in" placeholder="ノートを検索…"><button class="cv-picker-x"><i data-lucide="x" class="w-4 h-4"></i></button></div><div class="cv-picker-list"></div></div>';
    document.body.appendChild(ov);
    if (window.lucide) lucide.createIcons();
    const list = ov.querySelector('.cv-picker-list'), inp = ov.querySelector('.cv-picker-in');
    const draw = (q) => {
      const f = notes.filter((n) => !q || (n.title || '').toLowerCase().includes(q.toLowerCase())).slice(0, 50);
      list.innerHTML = f.map((n) => '<div class="cv-picker-item" data-id="' + n.id + '">' + esc(n.title || 'Untitled') + '</div>').join('') || '<div class="cv-picker-empty">見つかりません</div>';
      list.querySelectorAll('.cv-picker-item').forEach((it) => it.addEventListener('click', () => { ov.remove(); cb(it.dataset.id); }));
    };
    draw('');
    inp.addEventListener('input', () => draw(inp.value)); inp.focus();
    ov.querySelector('.cv-picker-x').addEventListener('click', () => ov.remove());
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.remove(); });
  }

  // ---- 表示切替 -------------------------------------------------------------
  function show() {
    HIDE_IDS.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    root.classList.remove('hidden');
    render();
    setTimeout(() => root.focus(), 0);
  }
  function hide() {
    HIDE_IDS.forEach((id) => { const el = document.getElementById(id); if (el && el.id !== 'db-view') el.style.display = ''; });
    root.classList.add('hidden');
  }
  function sync() { const n = cur(); if (n && n.canvas) show(); else hide(); }

  // ---- 初期化 ---------------------------------------------------------------
  function boot() {
    root = document.getElementById('canvas-view');
    if (!root) return;
    bindViewport();
    if (typeof window.loadNote === 'function' && !window.loadNote.__gazeCanvasWrapped) {
      const orig = window.loadNote;
      window.loadNote = async function () { const r = await orig.apply(this, arguments); try { sync(); } catch (e) { console.error('canvas sync', e); } return r; };
      window.loadNote.__gazeCanvasWrapped = true;
    }
    const btn = document.getElementById('new-canvas-btn');
    if (btn) btn.addEventListener('click', createCanvas);
    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeCanvas) {
      COMMANDS.push({ id: 'new-canvas', label: '新規キャンバス', icon: 'layout-dashboard', run: () => createCanvas() });
      COMMANDS.__gazeCanvas = true;
    }
  }

  window.GazeCanvas = { createCanvas, sync };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
