/* ============================================================================
 * The Gaze — Block Editor (Phase 1)
 * Notion風のブロック単位エディタ + スラッシュコマンド。
 *
 * 設計方針: 既存の #note-content textarea (Markdown文字列) を「モデル」として
 * 読み書きするUIレイヤー。ブロック編集のたびに textarea へ同期し input を発火
 * させるため、保存・統計・バックリンク・グラフ・検索など既存機能はそのまま動く。
 * ========================================================================== */
(function () {
  'use strict';

  // ---- 型定義 ---------------------------------------------------------------
  const LIST_TYPES = new Set(['bullet', 'numbered', 'todo']);
  const isList = (t) => LIST_TYPES.has(t);

  // スラッシュメニューの項目
  const SLASH = [
    { type: 'paragraph', label: 'テキスト', sub: 'ただの文章', icon: 'type', kw: 'text paragraph p ぶんしょう てきすと' },
    { type: 'h1', label: '見出し1', sub: '大見出し', icon: 'heading-1', kw: 'h1 heading title みだし おおみだし' },
    { type: 'h2', label: '見出し2', sub: '中見出し', icon: 'heading-2', kw: 'h2 heading みだし' },
    { type: 'h3', label: '見出し3', sub: '小見出し', icon: 'heading-3', kw: 'h3 heading みだし' },
    { type: 'bullet', label: '箇条書きリスト', sub: '順序なしリスト', icon: 'list', kw: 'bullet ul list かじょう りすと' },
    { type: 'numbered', label: '番号付きリスト', sub: '順序ありリスト', icon: 'list-ordered', kw: 'numbered ol list ばんごう りすと' },
    { type: 'todo', label: 'To-do リスト', sub: 'チェックボックス', icon: 'list-checks', kw: 'todo task check チェック' },
    { type: 'quote', label: '引用', sub: '引用ブロック', icon: 'quote', kw: 'quote いんよう' },
    { type: 'callout', label: 'コールアウト', sub: '目立つメモ', icon: 'info', kw: 'callout note info コールアウト メモ' },
    { type: 'code', label: 'コード', sub: 'コードブロック', icon: 'code', kw: 'code こーど' },
    { type: 'divider', label: '区切り線', sub: '水平線', icon: 'minus', kw: 'divider hr line くぎり せん' },
  ];

  const PLACEHOLDER = {
    paragraph: "「/」でコマンド。入力を開始…",
    h1: '見出し1', h2: '見出し2', h3: '見出し3',
    bullet: 'リスト項目', numbered: 'リスト項目', todo: 'To-do',
    quote: '引用', callout: 'コールアウト',
  };

  const CALLOUT_ICON = { note: 'info', info: 'info', tip: 'lightbulb', warning: 'alert-triangle', danger: 'flame', success: 'check-circle', question: 'help-circle' };

  // ---- 状態 -----------------------------------------------------------------
  let blocks = [];
  let container = null;      // #block-editor
  let textarea = null;       // #note-content (hidden model)
  let lastFocusedId = null;
  let composing = false;     // IME変換中
  let dragId = null;
  let selectedDividerId = null;
  const slash = { open: false, blockId: null, pos: 0, index: 0, items: [] };
  let menuEl = null;

  const uid = () => 'blk_' + Math.random().toString(36).slice(2, 9);
  const getBlock = (id) => blocks.find((b) => b.id === id);
  const rowOf = (id) => container && container.querySelector('.block-row[data-id="' + id + '"]');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Markdown <-> blocks ---------------------------------------------------
  function mdToBlocks(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') { i++; continue; }
      let m;
      // fenced code
      if ((m = l.match(/^```(\w*)\s*$/))) {
        const lang = m[1] || ''; i++;
        const code = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // closing fence
        out.push({ id: uid(), type: 'code', text: code.join('\n'), lang });
        continue;
      }
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { out.push({ id: uid(), type: 'h' + m[1].length, text: m[2] }); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push({ id: uid(), type: 'divider', text: '' }); i++; continue; }
      if ((m = l.match(/^>\s?\[!(\w+)\][ \t]*(.*)$/))) { out.push({ id: uid(), type: 'callout', variant: m[1].toLowerCase(), text: m[2] }); i++; continue; }
      if ((m = l.match(/^>\s?(.*)$/))) { out.push({ id: uid(), type: 'quote', text: m[1] }); i++; continue; }
      if ((m = l.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/))) { out.push({ id: uid(), type: 'todo', checked: /x/i.test(m[1]), text: m[2] }); i++; continue; }
      if ((m = l.match(/^[-*]\s+(.*)$/))) { out.push({ id: uid(), type: 'bullet', text: m[1] }); i++; continue; }
      if ((m = l.match(/^\d+\.\s+(.*)$/))) { out.push({ id: uid(), type: 'numbered', text: m[1] }); i++; continue; }
      out.push({ id: uid(), type: 'paragraph', text: l }); i++;
    }
    if (out.length === 0) out.push({ id: uid(), type: 'paragraph', text: '' });
    return out;
  }

  function blockToMd(b, num) {
    switch (b.type) {
      case 'h1': return '# ' + b.text;
      case 'h2': return '## ' + b.text;
      case 'h3': return '### ' + b.text;
      case 'bullet': return '- ' + b.text;
      case 'numbered': return num + '. ' + b.text;
      case 'todo': return '- [' + (b.checked ? 'x' : ' ') + '] ' + b.text;
      case 'quote': return '> ' + b.text;
      case 'callout': return '> [!' + (b.variant || 'note') + '] ' + b.text;
      case 'code': return '```' + (b.lang || '') + '\n' + (b.text || '') + '\n```';
      case 'divider': return '---';
      default: return b.text;
    }
  }

  function blocksToMd(list) {
    let out = '', num = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i], prev = list[i - 1];
      if (b.type === 'numbered') num = (prev && prev.type === 'numbered') ? num + 1 : 1;
      if (i > 0) out += (isList(prev.type) && isList(b.type)) ? '\n' : '\n\n';
      out += blockToMd(b, num);
    }
    return out;
  }

  // ---- モデル同期 -----------------------------------------------------------
  function syncToModel() {
    if (!textarea) return;
    textarea.value = blocksToMd(blocks);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- caret helpers --------------------------------------------------------
  function setCaret(ce, offset) {
    if (!ce) return;
    ce.focus();
    let tn = ce.firstChild;
    if (!tn) { tn = document.createTextNode(''); ce.appendChild(tn); }
    if (tn.nodeType !== 3) { tn = document.createTextNode(ce.textContent || ''); ce.innerHTML = ''; ce.appendChild(tn); }
    const len = tn.textContent.length;
    const r = document.createRange();
    r.setStart(tn, Math.max(0, Math.min(offset, len)));
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }

  function caretOffset(ce) {
    const s = window.getSelection();
    if (!s.rangeCount) return 0;
    const r = s.getRangeAt(0);
    if (!ce.contains(r.startContainer)) return 0;
    const pre = r.cloneRange();
    pre.selectNodeContents(ce);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  }

  function selRange(ce) {
    const s = window.getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!ce.contains(r.startContainer)) return null;
    const a = r.cloneRange(); a.selectNodeContents(ce); a.setEnd(r.startContainer, r.startOffset);
    const start = a.toString().length;
    const b = r.cloneRange(); b.selectNodeContents(ce); b.setEnd(r.endContainer, r.endOffset);
    const end = b.toString().length;
    return { start, end };
  }

  // ---- row 生成 -------------------------------------------------------------
  function createRow(b, num) {
    const row = document.createElement('div');
    row.className = 'block-row';
    row.dataset.id = b.id;
    row.dataset.type = b.type;

    const handle = document.createElement('div');
    handle.className = 'block-handle';
    handle.setAttribute('draggable', 'true');
    handle.title = 'ドラッグで移動 / クリックで操作';
    handle.innerHTML = '<i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i>';
    row.appendChild(handle);
    bindDrag(row, handle, b);

    if (b.type === 'divider') {
      const d = document.createElement('div');
      d.className = 'block-divider-wrap';
      d.innerHTML = '<hr class="blk-divider">';
      d.addEventListener('click', () => { selectDivider(b.id); });
      row.appendChild(d);
      if (selectedDividerId === b.id) d.classList.add('sel');
      return row;
    }

    if (b.type === 'code') {
      const wrap = document.createElement('div');
      wrap.className = 'blk-code-wrap';
      const ta = document.createElement('textarea');
      ta.className = 'blk-code-ta';
      ta.value = b.text || '';
      ta.spellcheck = false;
      ta.placeholder = 'コード…';
      ta.rows = Math.max(1, (b.text || '').split('\n').length);
      const auto = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.addEventListener('input', () => { b.text = ta.value; auto(); syncToModel(); });
      ta.addEventListener('focus', () => { lastFocusedId = b.id; auto(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && ta.value === '' && ta.selectionStart === 0) {
          e.preventDefault(); convertOrMerge(b);
        }
      });
      wrap.appendChild(ta);
      row.appendChild(wrap);
      requestAnimationFrame(auto);
      return row;
    }

    // marker (list / todo / callout)
    if (b.type === 'bullet') {
      const mk = document.createElement('div'); mk.className = 'block-marker'; mk.textContent = '•'; row.appendChild(mk);
    } else if (b.type === 'numbered') {
      const mk = document.createElement('div'); mk.className = 'block-marker'; mk.textContent = num + '.'; row.appendChild(mk);
    } else if (b.type === 'todo') {
      const box = document.createElement('div');
      box.className = 'blk-todo-box' + (b.checked ? ' checked' : '');
      box.innerHTML = b.checked ? '<i data-lucide="check" class="w-3 h-3"></i>' : '';
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        b.checked = !b.checked;
        box.classList.toggle('checked', b.checked);
        box.innerHTML = b.checked ? '<i data-lucide="check" class="w-3 h-3"></i>' : '';
        if (window.lucide) lucide.createIcons();
        const c = row.querySelector('.block-content'); if (c) c.classList.toggle('done', b.checked);
        syncToModel();
      });
      row.appendChild(box);
    } else if (b.type === 'callout') {
      const mk = document.createElement('div'); mk.className = 'block-marker callout-ic';
      mk.innerHTML = '<i data-lucide="' + (CALLOUT_ICON[b.variant] || 'info') + '" class="w-4 h-4"></i>';
      row.appendChild(mk);
    }

    const ce = document.createElement('div');
    ce.className = 'block-content blk-' + b.type + (b.type === 'todo' && b.checked ? ' done' : '');
    ce.contentEditable = 'true';
    ce.spellcheck = false;
    ce.dataset.ph = PLACEHOLDER[b.type] || '';
    ce.textContent = b.text || '';
    bindEditable(ce, b, row);
    if (b.type === 'callout') {
      const inner = document.createElement('div');
      inner.className = 'blk-callout callout-' + (b.variant || 'note');
      inner.appendChild(ce);
      // move marker inside callout box for correct layout
      const mk = row.querySelector('.callout-ic');
      if (mk) { row.removeChild(mk); inner.insertBefore(mk, inner.firstChild); }
      row.appendChild(inner);
    } else {
      row.appendChild(ce);
    }
    return row;
  }

  // ---- editable events ------------------------------------------------------
  function bindEditable(ce, b, row) {
    ce.addEventListener('focus', () => { lastFocusedId = b.id; clearDividerSel(); });
    ce.addEventListener('compositionstart', () => { composing = true; });
    ce.addEventListener('compositionend', () => {
      composing = false;
      b.text = ce.textContent;
      if (maybeShortcut(b)) return;
      syncToModel(); maybeSlash(ce, b);
    });
    ce.addEventListener('input', () => {
      b.text = ce.textContent;
      if (composing) return;
      if (maybeShortcut(b)) return;
      syncToModel();
      maybeSlash(ce, b);
    });
    ce.addEventListener('keydown', (e) => onKeydown(e, ce, b));
    ce.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey) tryOpenWikilink(ce, b);
    });
  }

  // ---- keydown --------------------------------------------------------------
  function onKeydown(e, ce, b) {
    // slash menu navigation
    if (slash.open && slash.blockId === b.id) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSlash(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSlash(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); applySlash(slash.items[slash.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
    }

    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); handleToolbar('bold'); return; }
      if (k === 'i') { e.preventDefault(); handleToolbar('italic'); return; }
      if (k === 'e') { e.preventDefault(); handleToolbar('code'); return; }
      if (k === 'k') { e.preventDefault(); handleToolbar('link'); return; }
    }

    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault(); enterSplit(ce, b); return;
    }
    if (e.key === 'Backspace' && !composing) {
      const off = caretOffset(ce);
      const sel = selRange(ce);
      if (off === 0 && sel && sel.start === sel.end) { e.preventDefault(); convertOrMerge(b); return; }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
    if (e.key === 'ArrowUp' && !composing) {
      if (caretOffset(ce) === 0) { const p = neighborEditable(b.id, -1); if (p) { e.preventDefault(); setCaret(p, (p.textContent || '').length); } }
    }
    if (e.key === 'ArrowDown' && !composing) {
      if (caretOffset(ce) === (ce.textContent || '').length) { const n = neighborEditable(b.id, 1); if (n) { e.preventDefault(); setCaret(n, 0); } }
    }
  }

  function neighborEditable(id, dir) {
    const idx = blocks.findIndex((x) => x.id === id);
    let j = idx + dir;
    while (j >= 0 && j < blocks.length) {
      const r = rowOf(blocks[j].id);
      const ce = r && r.querySelector('.block-content');
      if (ce) return ce;
      const ta = r && r.querySelector('.blk-code-ta');
      if (ta) { ta.focus(); return null; }
      j += dir;
    }
    return null;
  }

  // Enter: split current block into two
  function enterSplit(ce, b) {
    const off = caretOffset(ce);
    const full = ce.textContent || '';
    const before = full.slice(0, off);
    const after = full.slice(off);

    // empty list item → exit list (convert to paragraph)
    if (isList(b.type) && full.trim() === '') {
      b.type = 'paragraph'; b.text = ''; delete b.checked;
      renderAll(); focusBlock(b.id, 0); syncToModel(); return;
    }

    b.text = before;
    const nb = { id: uid(), type: 'paragraph', text: after };
    if (isList(b.type)) { nb.type = b.type; if (b.type === 'todo') nb.checked = false; }
    const idx = blocks.findIndex((x) => x.id === b.id);
    blocks.splice(idx + 1, 0, nb);
    renderAll();
    focusBlock(nb.id, 0);
    syncToModel();
  }

  // Backspace at start: outdent formatting, or merge into previous
  function convertOrMerge(b) {
    if (b.type !== 'paragraph') {
      b.type = 'paragraph'; delete b.checked; delete b.variant;
      renderAll(); focusBlock(b.id, 0); syncToModel(); return;
    }
    const idx = blocks.findIndex((x) => x.id === b.id);
    if (idx <= 0) return;
    const prev = blocks[idx - 1];
    if (prev.type === 'divider') {
      blocks.splice(idx - 1, 1); renderAll(); focusBlock(b.id, 0); syncToModel(); return;
    }
    if (prev.type === 'code') { focusBlock(prev.id, 0); return; }
    const at = (prev.text || '').length;
    prev.text = (prev.text || '') + (b.text || '');
    blocks.splice(idx, 1);
    renderAll();
    focusBlock(prev.id, at);
    syncToModel();
  }

  // ---- Markdown ショートカット ---------------------------------------------
  function maybeShortcut(b) {
    if (b.type === 'code' || b.type === 'divider') return false;
    const t = b.text;
    let m, changed = false;
    if ((m = t.match(/^(#{1,3})\s(.*)$/))) { b.type = 'h' + m[1].length; b.text = m[2]; changed = true; }
    else if ((m = t.match(/^[-*]\s\[([ xX])\]\s(.*)$/))) { b.type = 'todo'; b.checked = /x/i.test(m[1]); b.text = m[2]; changed = true; }
    else if ((m = t.match(/^\[([ xX]?)\]\s(.*)$/))) { b.type = 'todo'; b.checked = /x/i.test(m[1]); b.text = m[2]; changed = true; }
    else if ((m = t.match(/^[-*]\s(.*)$/))) { b.type = 'bullet'; b.text = m[1]; changed = true; }
    else if ((m = t.match(/^\d+\.\s(.*)$/))) { b.type = 'numbered'; b.text = m[1]; changed = true; }
    else if ((m = t.match(/^>\s\[!(\w+)\]\s?(.*)$/))) { b.type = 'callout'; b.variant = m[1].toLowerCase(); b.text = m[2]; changed = true; }
    else if ((m = t.match(/^>\s(.*)$/))) { b.type = 'quote'; b.text = m[1]; changed = true; }
    else if (/^(-{3}|\*{3})$/.test(t)) { b.type = 'divider'; b.text = ''; changed = true; }
    else if ((m = t.match(/^```(\w*)$/))) { b.type = 'code'; b.lang = m[1] || ''; b.text = ''; changed = true; }

    if (!changed) return false;
    closeSlash();
    if (b.type === 'divider') {
      const idx = blocks.findIndex((x) => x.id === b.id);
      const nb = { id: uid(), type: 'paragraph', text: '' };
      blocks.splice(idx + 1, 0, nb);
      renderAll(); focusBlock(nb.id, 0);
    } else if (b.type === 'code') {
      renderAll(); const r = rowOf(b.id); const ta = r && r.querySelector('.blk-code-ta'); if (ta) ta.focus();
    } else {
      renderAll(); focusBlock(b.id, 0);
    }
    syncToModel();
    return true;
  }

  // ---- スラッシュメニュー ---------------------------------------------------
  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.id = 'slash-menu';
    menuEl.className = 'hidden';
    document.body.appendChild(menuEl);
    return menuEl;
  }

  function maybeSlash(ce, b) {
    const off = caretOffset(ce);
    const before = (b.text || '').slice(0, off);
    const m = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!m) { closeSlash(); return; }
    const q = m[1].toLowerCase();
    const pos = off - m[1].length - 1; // index of '/'
    const items = SLASH.filter((it) => !q || (it.label + ' ' + it.kw).toLowerCase().includes(q));
    if (items.length === 0) { closeSlash(); return; }
    slash.open = true; slash.blockId = b.id; slash.pos = pos; slash.index = 0; slash.items = items;
    drawSlash(ce);
  }

  function drawSlash(ce) {
    const el = ensureMenu();
    el.innerHTML = slash.items.map((it, i) =>
      '<div class="slash-item' + (i === slash.index ? ' sel' : '') + '" data-i="' + i + '">' +
      '<div class="slash-ic"><i data-lucide="' + it.icon + '" class="w-4 h-4"></i></div>' +
      '<div class="min-w-0"><div class="truncate">' + esc(it.label) + '</div><div class="slash-sub truncate">' + esc(it.sub) + '</div></div>' +
      '</div>').join('');
    el.classList.remove('hidden');
    // position near caret
    const sel = window.getSelection();
    let rect = null;
    if (sel.rangeCount) { const r = sel.getRangeAt(0).getClientRects()[0]; if (r) rect = r; }
    if (!rect) rect = ce.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - 340);
    const left = Math.min(rect.left, window.innerWidth - 280);
    el.style.top = Math.max(8, top) + 'px';
    el.style.left = Math.max(8, left) + 'px';
    if (window.lucide) lucide.createIcons();
    el.querySelectorAll('.slash-item').forEach((d) => {
      d.addEventListener('mousedown', (e) => { e.preventDefault(); applySlash(slash.items[parseInt(d.dataset.i)]); });
      d.addEventListener('mousemove', () => { slash.index = parseInt(d.dataset.i); updateSlashSel(); });
    });
  }

  function updateSlashSel() {
    if (!menuEl) return;
    menuEl.querySelectorAll('.slash-item').forEach((d, i) => d.classList.toggle('sel', i === slash.index));
  }

  function moveSlash(dir) {
    slash.index = (slash.index + dir + slash.items.length) % slash.items.length;
    updateSlashSel();
    const cur = menuEl && menuEl.querySelector('.slash-item.sel');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function closeSlash() {
    slash.open = false; slash.blockId = null; slash.items = [];
    if (menuEl) menuEl.classList.add('hidden');
  }

  function applySlash(item) {
    if (!item) { closeSlash(); return; }
    const b = getBlock(slash.blockId);
    const pos = slash.pos;
    closeSlash();
    if (!b) return;
    // remove the "/query" text
    const off = (function () { const r = rowOf(b.id); const ce = r && r.querySelector('.block-content'); return ce ? caretOffset(ce) : (b.text || '').length; })();
    b.text = (b.text || '').slice(0, pos) + (b.text || '').slice(off);
    applyType(b, item.type);
  }

  function applyType(b, type) {
    if (type === 'divider') {
      b.type = 'divider'; b.text = '';
      const idx = blocks.findIndex((x) => x.id === b.id);
      const nb = { id: uid(), type: 'paragraph', text: '' };
      blocks.splice(idx + 1, 0, nb);
      renderAll(); focusBlock(nb.id, 0); syncToModel(); return;
    }
    if (type === 'code') { b.type = 'code'; b.lang = b.lang || ''; renderAll(); const r = rowOf(b.id); const ta = r && r.querySelector('.blk-code-ta'); if (ta) ta.focus(); syncToModel(); return; }
    if (type === 'callout') { b.type = 'callout'; b.variant = b.variant || 'note'; }
    else { b.type = type; }
    if (type === 'todo' && typeof b.checked === 'undefined') b.checked = false;
    if (type !== 'todo') delete b.checked;
    renderAll(); focusBlock(b.id, (b.text || '').length); syncToModel();
  }

  // ---- ツールバー連携（app.js の applyMd から委譲） -------------------------
  function handleToolbar(action) {
    if (!isActive()) return false;
    const b = getBlock(lastFocusedId);
    const row = b && rowOf(b.id);
    const ce = row && row.querySelector('.block-content');

    const blockMap = { h1: 'h1', h2: 'h2', ul: 'bullet', ol: 'numbered', task: 'todo', quote: 'quote' };
    if (blockMap[action]) {
      if (!b) return true;
      // toggle off back to paragraph if same
      if (b.type === blockMap[action]) applyType(b, 'paragraph');
      else applyType(b, blockMap[action]);
      return true;
    }
    if (action === 'hr') {
      const idx = b ? blocks.findIndex((x) => x.id === b.id) : blocks.length - 1;
      const nb = { id: uid(), type: 'divider', text: '' };
      const pb = { id: uid(), type: 'paragraph', text: '' };
      blocks.splice(idx + 1, 0, nb, pb);
      renderAll(); focusBlock(pb.id, 0); syncToModel();
      return true;
    }
    if (!ce || !b) return true;
    // inline wrap on current selection
    const wraps = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], code: ['`', '`'] };
    if (wraps[action]) {
      const [pre, suf] = wraps[action];
      wrapSelection(ce, b, pre, suf);
      return true;
    }
    if (action === 'link') {
      const sel = selRange(ce) || { start: (b.text || '').length, end: (b.text || '').length };
      const t = b.text || '';
      const inner = t.slice(sel.start, sel.end) || 'テキスト';
      b.text = t.slice(0, sel.start) + '[' + inner + '](url)' + t.slice(sel.end);
      renderAll(); focusBlock(b.id, sel.start + 1 + inner.length + 2); syncToModel();
      return true;
    }
    if (action === 'wikilink') {
      const off = caretOffset(ce);
      const t = b.text || '';
      b.text = t.slice(0, off) + '[[]]' + t.slice(off);
      renderAll(); focusBlock(b.id, off + 2); syncToModel();
      return true;
    }
    return true;
  }

  function wrapSelection(ce, b, pre, suf) {
    const sel = selRange(ce) || { start: (b.text || '').length, end: (b.text || '').length };
    const t = b.text || '';
    const inner = t.slice(sel.start, sel.end);
    b.text = t.slice(0, sel.start) + pre + inner + suf + t.slice(sel.end);
    renderAll();
    if (sel.start === sel.end) focusBlock(b.id, sel.start + pre.length);
    else focusBlock(b.id, sel.start + pre.length + inner.length + suf.length);
    syncToModel();
  }

  // ---- ctrl/cmd + click で WikiLink を開く ----------------------------------
  function tryOpenWikilink(ce, b) {
    const off = caretOffset(ce);
    const t = b.text || '';
    const start = t.lastIndexOf('[[', off);
    if (start === -1) return;
    const end = t.indexOf(']]', start);
    if (end === -1 || off > end + 2) return;
    const name = t.slice(start + 2, end).trim();
    if (name && typeof window.openNoteByTitle === 'function') window.openNoteByTitle(name);
  }

  // ---- divider 選択 ---------------------------------------------------------
  function selectDivider(id) {
    clearDividerSel();
    selectedDividerId = id;
    const r = rowOf(id); const w = r && r.querySelector('.block-divider-wrap');
    if (w) w.classList.add('sel');
  }
  function clearDividerSel() {
    if (!selectedDividerId) return;
    const r = rowOf(selectedDividerId); const w = r && r.querySelector('.block-divider-wrap');
    if (w) w.classList.remove('sel');
    selectedDividerId = null;
  }

  // ---- drag & drop ----------------------------------------------------------
  function bindDrag(row, handle, b) {
    handle.addEventListener('dragstart', (e) => {
      dragId = b.id; row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', b.id); } catch (_) {}
    });
    handle.addEventListener('dragend', () => {
      dragId = null; row.classList.remove('dragging');
      container.querySelectorAll('.drop-above,.drop-below').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
    });
    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === b.id) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const below = (e.clientY - rect.top) > rect.height / 2;
      row.classList.toggle('drop-below', below);
      row.classList.toggle('drop-above', !below);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', (e) => {
      if (!dragId || dragId === b.id) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const below = (e.clientY - rect.top) > rect.height / 2;
      const from = blocks.findIndex((x) => x.id === dragId);
      const moved = blocks.splice(from, 1)[0];
      let to = blocks.findIndex((x) => x.id === b.id);
      if (below) to += 1;
      blocks.splice(to, 0, moved);
      dragId = null;
      renderAll(); syncToModel();
    });
  }

  // ---- render ---------------------------------------------------------------
  function renderAll() {
    if (!container) return;
    container.innerHTML = '';
    let num = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'numbered') num = (i > 0 && blocks[i - 1].type === 'numbered') ? num + 1 : 1;
      container.appendChild(createRow(b, num));
    }
    if (window.lucide) lucide.createIcons();
  }

  function focusBlock(id, offset) {
    const r = rowOf(id);
    if (!r) return;
    const ce = r.querySelector('.block-content');
    if (ce) { setCaret(ce, offset); ce.scrollIntoView({ block: 'nearest' }); }
  }

  // ---- 公開API --------------------------------------------------------------
  function renderFromModel() {
    if (!container || !textarea) return;
    blocks = mdToBlocks(textarea.value);
    renderAll();
  }

  function isActive() {
    return !!(container && !container.classList.contains('hidden'));
  }

  function toggleSource() {
    if (!container || !textarea) return;
    const btn = document.getElementById('toggle-source-btn');
    if (isActive()) {
      // block -> source
      syncToModel();
      container.classList.add('hidden');
      textarea.classList.remove('hidden');
      if (btn) btn.classList.add('active');
      textarea.focus();
    } else {
      // source -> block
      container.classList.remove('hidden');
      textarea.classList.add('hidden');
      if (btn) btn.classList.remove('active');
      renderFromModel();
    }
  }

  // ---- 初期化 & app.js フック ----------------------------------------------
  function boot() {
    container = document.getElementById('block-editor');
    textarea = document.getElementById('note-content');
    if (!container || !textarea) return;

    // textarea はモデルとして隠す（ブロック表示が既定）
    textarea.classList.add('hidden');

    const btn = document.getElementById('toggle-source-btn');
    if (btn) btn.addEventListener('click', toggleSource);

    // クリックで空白部→最後のブロック末尾にフォーカス
    container.addEventListener('mousedown', (e) => {
      if (e.target === container && blocks.length) {
        const last = blocks[blocks.length - 1];
        if (last.type === 'paragraph' || last.type === 'divider') {
          if (last.type === 'divider') { blocks.push({ id: uid(), type: 'paragraph', text: '' }); renderAll(); }
        }
        const tid = blocks[blocks.length - 1].id;
        setTimeout(() => focusBlock(tid, (getBlock(tid).text || '').length), 0);
      }
    });

    // メニュー外クリックで閉じる
    document.addEventListener('mousedown', (e) => {
      if (slash.open && menuEl && !menuEl.contains(e.target)) closeSlash();
      if (selectedDividerId && !e.target.closest('.block-divider-wrap')) clearDividerSel();
    });
    document.addEventListener('keydown', (e) => {
      if (selectedDividerId && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        const idx = blocks.findIndex((x) => x.id === selectedDividerId);
        selectedDividerId = null;
        if (idx >= 0) { blocks.splice(idx, 1); if (!blocks.length) blocks.push({ id: uid(), type: 'paragraph', text: '' }); renderAll(); syncToModel(); }
      }
    });

    // loadNote をラップして、(1)保留中の保存をフラッシュして編集消失を防ぎ、
    // (2)ノート読み込み時にブロックを再構築する。
    if (typeof window.loadNote === 'function' && !window.loadNote.__gazeWrapped) {
      const orig = window.loadNote;
      window.loadNote = async function (id) {
        // 別ノートへ切り替える前に、デバウンス中の保存を確定させる
        try {
          if (typeof state !== 'undefined' && state && state.currentNote &&
              state.currentNote.id !== id && state.saveTimeout &&
              typeof saveNote === 'function') {
            clearTimeout(state.saveTimeout); state.saveTimeout = null;
            await saveNote();
          }
        } catch (err) { console.error('flush save', err); }
        const r = await orig.apply(this, arguments);
        try { renderFromModel(); } catch (err) { console.error('block render', err); }
        return r;
      };
      window.loadNote.__gazeWrapped = true;
    }

    // applyMd をラップして、ブロックモード時はブロック側で処理
    if (typeof window.applyMd === 'function' && !window.applyMd.__gazeWrapped) {
      const orig = window.applyMd;
      window.applyMd = function (action) {
        if (isActive() && handleToolbar(action)) return;
        return orig.apply(this, arguments);
      };
      window.applyMd.__gazeWrapped = true;
    }

    // 既にノートが開かれていれば描画
    renderFromModel();
  }

  window.GazeBlocks = { renderFromModel, isActive, toggleSource, handleToolbar };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
