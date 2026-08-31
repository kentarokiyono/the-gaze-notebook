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
    { type: 'image', label: '画像', sub: '画像を挿入', icon: 'image', kw: 'image img 画像 がぞう' },
    { type: 'inlinedb', label: 'インラインDB', sub: 'ページ内データベース', icon: 'table', kw: 'database db table インライン でーたべーす' },
    { type: 'bookmark', label: 'ブックマーク', sub: 'URLをカード表示', icon: 'bookmark', kw: 'bookmark link url ぶっくまーく りんく' },
    { type: 'webembed', label: 'Web埋め込み', sub: 'ページをiframe表示', icon: 'globe', kw: 'web embed iframe browser ぶらうざ うぇぶ' },
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
  const wl = { open: false, blockId: null, start: 0, index: 0, items: [] }; // [[ リンク補完
  let wlEl = null;
  const foldedIds = new Set();  // 折りたたみ中の見出しブロックID
  let clickPending = null;      // クリックでフォーカス中のブロックID（カーソル位置マッピング用）

  const uid = () => 'blk_' + Math.random().toString(36).slice(2, 9);
  const getBlock = (id) => blocks.find((b) => b.id === id);
  const rowOf = (id) => container && container.querySelector('.block-row[data-id="' + id + '"]');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // インラインMarkdownを整形HTMLへ。表示文字→ソース位置の対応表(map)も返し、
  // クリック位置からソースのカーソル位置を復元できるようにする。
  function renderInline(src) {
    const s = String(src || '');
    let html = '', plain = '';
    const map = [];
    const feed = (text, srcStart, open, close) => {
      html += (open || '');
      for (let k = 0; k < text.length; k++) { map[plain.length] = srcStart + k; plain += text[k]; }
      html += esc(text) + (close || '');
    };
    let i = 0;
    while (i < s.length) {
      let j;
      if (s[i] === '`') { j = s.indexOf('`', i + 1); if (j > i) { feed(s.slice(i + 1, j), i + 1, '<code>', '</code>'); i = j + 1; continue; } }
      if (s.startsWith('**', i)) { j = s.indexOf('**', i + 2); if (j > i + 1) { feed(s.slice(i + 2, j), i + 2, '<strong>', '</strong>'); i = j + 2; continue; } }
      if (s.startsWith('~~', i)) { j = s.indexOf('~~', i + 2); if (j > i + 1) { feed(s.slice(i + 2, j), i + 2, '<del>', '</del>'); i = j + 2; continue; } }
      if (s.startsWith('==', i)) { j = s.indexOf('==', i + 2); if (j > i + 1) { feed(s.slice(i + 2, j), i + 2, '<mark>', '</mark>'); i = j + 2; continue; } }
      if ((s[i] === '*' || s[i] === '_') && s[i + 1] !== s[i]) { j = s.indexOf(s[i], i + 1); if (j > i + 1) { feed(s.slice(i + 1, j), i + 1, '<em>', '</em>'); i = j + 1; continue; } }
      if (s[i] === '!' && s[i + 1] === '[' && s[i + 2] !== '[') {
        const close = s.indexOf(']', i + 2);
        if (close > i && s[close + 1] === '(') {
          const p = s.indexOf(')', close + 2);
          if (p > close) {
            const alt = s.slice(i + 2, close), url = s.slice(close + 2, p);
            if (url.indexOf('asset:') === 0) html += '<img class="blk-img" data-asset="' + esc(url.slice(6)) + '" alt="' + esc(alt) + '">';
            else html += '<img class="blk-img" src="' + esc(url) + '" alt="' + esc(alt) + '">';
            i = p + 1; continue;
          }
        }
      }
      if (s.startsWith('[[', i)) {
        j = s.indexOf(']]', i + 2);
        if (j > i + 1) {
          const raw = s.slice(i + 2, j);
          const pipe = raw.indexOf('|');
          const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
          const disp = pipe >= 0 ? raw.slice(pipe + 1) : raw;
          const dispStart = i + 2 + (pipe >= 0 ? pipe + 1 : 0);
          html += '<a class="wikilink" data-wikilink="' + esc(target) + '">';
          feed(disp, dispStart);
          html += '</a>';
          i = j + 2; continue;
        }
      }
      if (s[i] === '[') {
        const close = s.indexOf(']', i + 1);
        if (close > i && s[close + 1] === '(') {
          const p = s.indexOf(')', close + 2);
          if (p > close) {
            const url = s.slice(close + 2, p);
            html += '<a href="' + esc(url) + '" target="_blank" rel="noopener" data-mdlink="1">';
            feed(s.slice(i + 1, close), i + 1);
            html += '</a>';
            i = p + 1; continue;
          }
        }
      }
      feed(s[i], i); i++;
    }
    map[plain.length] = s.length;
    return { html, map, plain };
  }

  // ノート本文から指定見出しのセクションを抽出（埋め込み ![[note#heading]] 用）
  function sectionOf(content, name) {
    const lines = String(content || '').split('\n');
    let start = -1, lvl = 0;
    for (let k = 0; k < lines.length; k++) {
      const mm = lines[k].match(/^(#{1,6})\s+(.*)$/);
      if (mm && mm[2].trim().toLowerCase() === name.trim().toLowerCase()) { start = k; lvl = mm[1].length; break; }
    }
    if (start < 0) return null;
    let end = lines.length;
    for (let k = start + 1; k < lines.length; k++) {
      const mm = lines[k].match(/^(#{1,6})\s+/);
      if (mm && mm[1].length <= lvl) { end = k; break; }
    }
    return lines.slice(start + 1, end).join('\n').trim();
  }

  const headingLevel = (b) => (b.type === 'h1' ? 1 : b.type === 'h2' ? 2 : b.type === 'h3' ? 3 : 0);

  // ---- Markdown <-> blocks ---------------------------------------------------
  function mdToBlocks(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') { i++; continue; }
      let m;
      // fenced code (gaze-db はインラインDBとして扱う)
      if ((m = l.match(/^```([\w-]*)\s*$/))) {
        const lang = m[1] || ''; i++;
        const code = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // closing fence
        if (lang === 'gaze-db') {
          let dbData = null; try { dbData = JSON.parse(code.join('\n')); } catch (e) {}
          out.push({ id: uid(), type: 'inlinedb', text: '', dbData: dbData || (window.GazeDB && GazeDB.newInlineDb ? GazeDB.newInlineDb() : { props: [], rows: [], views: [], activeView: null }) });
        } else {
          out.push({ id: uid(), type: 'code', text: code.join('\n'), lang });
        }
        continue;
      }
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { out.push({ id: uid(), type: 'h' + m[1].length, text: m[2] }); i++; continue; }
      if ((m = l.match(/^!\[\[([^\]]+)\]\]\s*$/))) { out.push({ id: uid(), type: 'embed', text: m[1].trim() }); i++; continue; }
      if ((m = l.match(/^@web\((card|frame)\)\{(.+)\}\s*$/))) { out.push({ id: uid(), type: 'web', mode: m[1], url: m[2].trim(), text: '' }); i++; continue; }
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
      case 'inlinedb': return '```gaze-db\n' + JSON.stringify(b.dbData || {}) + '\n```';
      case 'web': return '@web(' + (b.mode || 'card') + '){' + (b.url || '') + '}';
      case 'embed': return '![[' + b.text + ']]';
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

    // 見出しの折りたたみトグル
    if (headingLevel(b) > 0) {
      const fold = document.createElement('button');
      fold.className = 'block-fold' + (foldedIds.has(b.id) ? ' folded' : '');
      fold.title = 'セクションを折りたたむ';
      fold.innerHTML = '<i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>';
      fold.addEventListener('click', (e) => { e.stopPropagation(); toggleFold(b.id); });
      row.appendChild(fold);
    }

    if (b.type === 'embed') {
      const card = document.createElement('div');
      card.className = 'blk-embed';
      card.dataset.target = b.text;
      card.innerHTML =
        '<div class="blk-embed-head"><i data-lucide="corner-down-right" class="w-3.5 h-3.5"></i>' +
        '<span class="blk-embed-title">' + esc(b.text) + '</span>' +
        '<i data-lucide="arrow-up-right" class="w-3.5 h-3.5 blk-embed-open"></i></div>' +
        '<div class="blk-embed-body prose prose-invert"></div>';
      card.addEventListener('click', () => openFromEl(card));
      row.appendChild(card);
      return row;
    }

    if (b.type === 'inlinedb') {
      const box = document.createElement('div');
      box.className = 'inline-db';
      row.appendChild(box);
      if (window.GazeDB && GazeDB.mountInline) {
        if (!b.dbData) b.dbData = GazeDB.newInlineDb();
        setTimeout(() => GazeDB.mountInline(box, () => b.dbData, (nd) => { b.dbData = nd; syncToModel(); }), 0);
      } else {
        box.innerHTML = '<div class="inline-db-err">データベースを読み込めませんでした</div>';
      }
      return row;
    }

    if (b.type === 'web') { createWebRow(row, b); return row; }

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
    renderInlineToEl(ce, b);
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

  // ---- live preview: 編集(ソース) ⇄ 表示(整形) の切替 -----------------------
  function isEditing(ce) { return ce.dataset.editing === '1'; }
  function enterEdit(ce, b) {
    if (ce.dataset.editing === '1') return;
    ce.dataset.editing = '1';
    ce.textContent = b.text || '';
    ce.classList.remove('blk-rendered');
  }
  function exitEdit(ce, b) {
    ce.dataset.editing = '';
    renderInlineToEl(ce, b);
  }
  function renderInlineToEl(ce, b) {
    const r = renderInline(b.text || '');
    ce.innerHTML = r.html;
    ce.classList.add('blk-rendered');
    ce._map = r.map;
    ce._plain = r.plain;
    if (window.GazeAssets && ce.querySelector('img[data-asset]')) GazeAssets.hydrate(ce);
  }

  // 現在の選択（ブラウザが配置したカーソル）から表示文字オフセットを得る
  function renderedSelOffset(ce) {
    const s = window.getSelection();
    if (!s.rangeCount) return (ce._plain || '').length;
    const r = s.getRangeAt(0);
    if (!ce.contains(r.startContainer)) return (ce._plain || '').length;
    const range = document.createRange();
    range.selectNodeContents(ce);
    try { range.setEnd(r.startContainer, r.startOffset); } catch (_) { return (ce._plain || '').length; }
    return range.toString().length;
  }

  function openFromEl(el) {
    const emb = el.closest && el.closest('.blk-embed');
    if (emb) {
      if (emb.dataset.noteId && typeof window.openNoteById === 'function') window.openNoteById(emb.dataset.noteId);
      else if (typeof window.openNoteByTitle === 'function') window.openNoteByTitle((emb.dataset.target || '').split('#')[0].trim());
      return;
    }
    const wl = el.closest && el.closest('.wikilink');
    if (wl) { if (typeof window.openNoteByTitle === 'function') window.openNoteByTitle(wl.dataset.wikilink); return; }
    const a = el.closest && el.closest('a[data-mdlink]');
    if (a) { window.open(a.getAttribute('href'), '_blank', 'noopener'); return; }
  }

  // ---- 画像挿入 -------------------------------------------------------------
  function pickImage(cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (f) cb(f); inp.remove(); });
    document.body.appendChild(inp); inp.click();
  }
  async function insertImageFile(file, afterId) {
    if (!file || !window.GazeAssets || !/^image\//.test(file.type || '')) return;
    let id;
    try { id = await GazeAssets.save(file, file.name); } catch (e) { if (typeof showToast === 'function') showToast('画像の保存に失敗しました', 'error'); return; }
    const idx = afterId ? blocks.findIndex((x) => x.id === afterId) : blocks.length - 1;
    const imgBlock = { id: uid(), type: 'paragraph', text: '![' + (file.name || '') + '](asset:' + id + ')' };
    const after = { id: uid(), type: 'paragraph', text: '' };
    blocks.splice(idx + 1, 0, imgBlock, after);
    renderAll(); focusBlock(after.id, 0); syncToModel();
    if (typeof showToast === 'function') showToast('画像を挿入しました', 'success');
  }

  // ---- Web埋め込み / ブックマーク -------------------------------------------
  function embedUrl(url) {
    try {
      const u = new URL(url);
      let m;
      if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get('v')) return 'https://www.youtube.com/embed/' + u.searchParams.get('v');
      if (u.hostname === 'youtu.be') return 'https://www.youtube.com/embed/' + u.pathname.slice(1);
      if (/(^|\.)vimeo\.com$/.test(u.hostname) && (m = u.pathname.match(/\/(\d+)/))) return 'https://player.vimeo.com/video/' + m[1];
      return url;
    } catch (e) { return url; }
  }
  function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } }
  function renderWebBody(bodyEl, b) {
    if (!b.url) { bodyEl.innerHTML = '<div class="web-empty">上のバーにURLを入力してください</div>'; return; }
    if (b.mode === 'frame') {
      const src = embedUrl(b.url);
      bodyEl.innerHTML = '<iframe class="web-frame" src="' + esc(src) + '" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" referrerpolicy="no-referrer" loading="lazy"></iframe>' +
        '<div class="web-frame-note">表示されない場合、そのサイトは埋め込みを許可していません。<b class="web-to-card">カード表示に切替</b></div>';
      const tc = bodyEl.querySelector('.web-to-card');
      if (tc) tc.addEventListener('click', () => { b.mode = 'card'; syncToModel(); const row = rowOf(b.id); if (row) rebuildWebBody(row, b); });
    } else {
      const dom = domainOf(b.url);
      bodyEl.innerHTML =
        '<a class="web-card" href="' + esc(b.url) + '" target="_blank" rel="noopener">' +
        '<img class="web-fav" src="https://www.google.com/s2/favicons?domain=' + esc(dom) + '&sz=64" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="web-card-main"><div class="web-card-dom">' + esc(dom) + '</div><div class="web-card-url">' + esc(b.url) + '</div></div>' +
        '<i data-lucide="arrow-up-right" class="w-4 h-4 web-card-go"></i></a>';
      if (window.lucide) lucide.createIcons();
    }
  }
  function rebuildWebBody(row, b) {
    const body = row.querySelector('.web-body'); if (body) renderWebBody(body, b);
    const tog = row.querySelector('.web-toggle'); if (tog) tog.innerHTML = b.mode === 'frame' ? '<i data-lucide="layout" class="w-3.5 h-3.5"></i>カード' : '<i data-lucide="globe" class="w-3.5 h-3.5"></i>埋め込み';
    if (window.lucide) lucide.createIcons();
  }
  function createWebRow(row, b) {
    const box = document.createElement('div');
    box.className = 'web-block';
    box.innerHTML =
      '<div class="web-bar">' +
      '<i data-lucide="globe" class="w-3.5 h-3.5 web-bar-ic"></i>' +
      '<input class="web-url" placeholder="https://…" value="' + esc(b.url || '') + '">' +
      '<button class="web-btn web-reload" title="再読み込み"><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i></button>' +
      '<button class="web-btn web-toggle" title="表示切替">' + (b.mode === 'frame' ? '<i data-lucide="layout" class="w-3.5 h-3.5"></i>カード' : '<i data-lucide="globe" class="w-3.5 h-3.5"></i>埋め込み') + '</button>' +
      '<button class="web-btn web-open" title="新規タブで開く"><i data-lucide="external-link" class="w-3.5 h-3.5"></i></button>' +
      '<button class="web-btn web-remove" title="削除"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>' +
      '</div><div class="web-body"></div>';
    row.appendChild(box);
    const body = box.querySelector('.web-body');
    renderWebBody(body, b);
    const inp = box.querySelector('.web-url');
    const commit = () => { const v = inp.value.trim(); if (v && !/^https?:\/\//.test(v)) inp.value = 'https://' + v; b.url = inp.value.trim(); syncToModel(); renderWebBody(body, b); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    inp.addEventListener('blur', commit);
    box.querySelector('.web-reload').addEventListener('click', () => renderWebBody(body, b));
    box.querySelector('.web-toggle').addEventListener('click', () => { b.mode = b.mode === 'frame' ? 'card' : 'frame'; syncToModel(); rebuildWebBody(row, b); });
    box.querySelector('.web-open').addEventListener('click', () => { if (b.url) window.open(b.url, '_blank', 'noopener'); });
    box.querySelector('.web-remove').addEventListener('click', () => {
      const idx = blocks.findIndex((x) => x.id === b.id); if (idx >= 0) { blocks.splice(idx, 1); if (!blocks.length) blocks.push({ id: uid(), type: 'paragraph', text: '' }); renderAll(); syncToModel(); }
    });
    if (window.lucide) lucide.createIcons();
  }

  // ---- editable events ------------------------------------------------------
  function bindEditable(ce, b, row) {
    ce.addEventListener('mousedown', (e) => {
      if (isEditing(ce)) return; // 既に編集中は通常挙動
      const link = e.target.closest('.wikilink,a[data-mdlink]');
      if (link) { e.preventDefault(); openFromEl(link); return; }
      // preventDefaultせず、ブラウザにカーソルを配置させ click で位置を読み取る
      clickPending = b.id;
    });
    ce.addEventListener('click', () => {
      if (clickPending === b.id && !isEditing(ce)) {
        const rOff = renderedSelOffset(ce);
        const sOff = (ce._map && ce._map[rOff] != null) ? ce._map[rOff] : (b.text || '').length;
        enterEdit(ce, b);
        setCaret(ce, sOff);
      }
      clickPending = null;
    });
    ce.addEventListener('focus', () => {
      lastFocusedId = b.id; clearDividerSel();
      if (!isEditing(ce) && clickPending !== b.id) { enterEdit(ce, b); setCaret(ce, (b.text || '').length); }
    });
    ce.addEventListener('blur', () => {
      if (slash.open && slash.blockId === b.id) return; // メニュー操作中は維持
      exitEdit(ce, b);
    });
    ce.addEventListener('compositionstart', () => { composing = true; });
    ce.addEventListener('compositionend', () => {
      composing = false;
      b.text = ce.textContent;
      if (maybeShortcut(b)) return;
      syncToModel(); maybeSlash(ce, b); maybeWiki(ce, b);
    });
    ce.addEventListener('input', () => {
      b.text = ce.textContent;
      if (composing) return;
      if (maybeShortcut(b)) return;
      syncToModel();
      maybeSlash(ce, b); maybeWiki(ce, b);
    });
    ce.addEventListener('keydown', (e) => onKeydown(e, ce, b));
    ce.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (items) {
        for (const it of items) {
          if (it.type && it.type.indexOf('image/') === 0) { e.preventDefault(); const f = it.getAsFile(); if (f) insertImageFile(f, b.id); return; }
        }
      }
      const t = (e.clipboardData || window.clipboardData).getData('text/plain');
      // 空ブロックにURLだけを貼り付け → ブックマークカードに変換
      if ((b.text || '') === '' && /^https?:\/\/\S+$/.test(t.trim())) {
        e.preventDefault();
        b.type = 'web'; b.mode = 'card'; b.url = t.trim(); b.text = '';
        const idx = blocks.findIndex((x) => x.id === b.id);
        if (!blocks[idx + 1]) blocks.splice(idx + 1, 0, { id: uid(), type: 'paragraph', text: '' });
        renderAll(); syncToModel(); return;
      }
      e.preventDefault();
      document.execCommand('insertText', false, t);
    });
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
    // [[ リンク補完 navigation
    if (wl.open && wl.blockId === b.id) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveWiki(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveWiki(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); applyWiki(wl.items[wl.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeWiki(); return; }
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
    else if ((m = t.match(/^!\[\[([^\]]+)\]\]$/))) { b.type = 'embed'; b.text = m[1].trim(); changed = true; }
    else if ((m = t.match(/^```(\w*)$/))) { b.type = 'code'; b.lang = m[1] || ''; b.text = ''; changed = true; }

    if (!changed) return false;
    closeSlash();
    if (b.type === 'divider' || b.type === 'embed') {
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

  // ---- [[ リンク補完 --------------------------------------------------------
  function ensureWlMenu() {
    if (wlEl) return wlEl;
    wlEl = document.createElement('div'); wlEl.id = 'wl-menu'; wlEl.className = 'hidden';
    document.body.appendChild(wlEl); return wlEl;
  }
  function closeWiki() { wl.open = false; wl.blockId = null; wl.items = []; if (wlEl) wlEl.classList.add('hidden'); }
  async function maybeWiki(ce, b) {
    const off = caretOffset(ce);
    const before = (b.text || '').slice(0, off);
    const m = before.match(/\[\[([^\[\]\n]*)$/);
    if (!m) { closeWiki(); return; }
    const q = m[1];
    const start = off - q.length - 2;
    let notes = [];
    try { notes = await TheGazeDB.getAllNotes(); } catch (e) { closeWiki(); return; }
    const ql = q.toLowerCase();
    const curId = (typeof state !== 'undefined' && state && state.currentNote) ? state.currentNote.id : null;
    let items = notes.filter((n) => n.id !== curId && (n.title || '').toLowerCase().includes(ql)).slice(0, 8)
      .map((n) => ({ title: n.title || 'Untitled' }));
    const exact = items.some((it) => it.title.toLowerCase() === ql);
    if (q.trim() && !exact) items.push({ title: q.trim(), create: true });
    if (!items.length) { closeWiki(); return; }
    wl.open = true; wl.blockId = b.id; wl.start = start; wl.index = 0; wl.items = items;
    drawWiki(ce);
  }
  function drawWiki(ce) {
    const el = ensureWlMenu();
    el.innerHTML = wl.items.map((it, i) =>
      '<div class="wl-item' + (i === wl.index ? ' sel' : '') + '" data-i="' + i + '">' +
      '<i data-lucide="' + (it.create ? 'plus' : 'file-text') + '" class="w-3.5 h-3.5"></i>' +
      '<span class="truncate">' + (it.create ? '「' + esc(it.title) + '」を作成' : esc(it.title)) + '</span></div>').join('');
    el.classList.remove('hidden');
    const sel = window.getSelection(); let rect = null;
    if (sel.rangeCount) { const r = sel.getRangeAt(0).getClientRects()[0]; if (r) rect = r; }
    if (!rect) rect = ce.getBoundingClientRect();
    el.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 260)) + 'px';
    el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 260)) + 'px';
    if (window.lucide) lucide.createIcons();
    el.querySelectorAll('.wl-item').forEach((d) => {
      d.addEventListener('mousedown', (e) => { e.preventDefault(); applyWiki(wl.items[parseInt(d.dataset.i)]); });
      d.addEventListener('mousemove', () => { wl.index = parseInt(d.dataset.i); wlEl.querySelectorAll('.wl-item').forEach((x, i) => x.classList.toggle('sel', i === wl.index)); });
    });
  }
  function moveWiki(dir) {
    wl.index = (wl.index + dir + wl.items.length) % wl.items.length;
    if (wlEl) wlEl.querySelectorAll('.wl-item').forEach((x, i) => x.classList.toggle('sel', i === wl.index));
  }
  function applyWiki(item) {
    if (!item) { closeWiki(); return; }
    const b = getBlock(wl.blockId); const start = wl.start; closeWiki();
    if (!b) return;
    const r = rowOf(b.id); const ce = r && r.querySelector('.block-content');
    const caret = ce ? caretOffset(ce) : (b.text || '').length;
    const insert = '[[' + item.title + ']]';
    b.text = (b.text || '').slice(0, start) + insert + (b.text || '').slice(caret);
    renderAll(); focusBlock(b.id, start + insert.length); syncToModel();
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
    if (type === 'image') { pickImage((file) => insertImageFile(file, b.id)); return; }
    if (type === 'inlinedb') {
      b.type = 'inlinedb'; b.text = '';
      b.dbData = (window.GazeDB && GazeDB.newInlineDb) ? GazeDB.newInlineDb() : { props: [], rows: [], views: [], activeView: null };
      const idx = blocks.findIndex((x) => x.id === b.id);
      const after = { id: uid(), type: 'paragraph', text: '' };
      blocks.splice(idx + 1, 0, after);
      renderAll(); syncToModel(); return;
    }
    if (type === 'bookmark' || type === 'webembed') {
      b.type = 'web'; b.mode = type === 'webembed' ? 'frame' : 'card'; b.url = b.url || ''; b.text = '';
      const idx = blocks.findIndex((x) => x.id === b.id);
      if (!blocks[idx + 1]) blocks.splice(idx + 1, 0, { id: uid(), type: 'paragraph', text: '' });
      renderAll(); syncToModel();
      const r = rowOf(b.id); const inp = r && r.querySelector('.web-url'); if (inp) inp.focus();
      return;
    }
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
    applyFolds();
    fillEmbeds();
  }

  // 折りたたみ中の見出し配下を隠す
  function applyFolds() {
    let hideLevel = 0;
    for (const b of blocks) {
      const lvl = headingLevel(b);
      const row = rowOf(b.id);
      let hide = false;
      if (hideLevel > 0) {
        if (lvl > 0 && lvl <= hideLevel) hideLevel = 0;
        else hide = true;
      }
      if (row) row.style.display = hide ? 'none' : '';
      if (!hide && lvl > 0 && foldedIds.has(b.id)) hideLevel = lvl;
    }
  }

  function toggleFold(id) {
    if (foldedIds.has(id)) foldedIds.delete(id); else foldedIds.add(id);
    const row = rowOf(id);
    const fold = row && row.querySelector('.block-fold');
    if (fold) fold.classList.toggle('folded', foldedIds.has(id));
    applyFolds();
  }

  // 埋め込みカードに対象ノートの内容を流し込む
  async function fillEmbeds() {
    const cards = container.querySelectorAll('.blk-embed[data-target]');
    if (!cards.length) return;
    let notes = [];
    try { notes = await TheGazeDB.getAllNotes(); } catch (e) { return; }
    const byTitle = {};
    notes.forEach((n) => { if (n.title) byTitle[n.title.toLowerCase()] = n; });
    cards.forEach((el) => {
      const target = el.dataset.target || '';
      const hash = target.indexOf('#');
      const name = (hash >= 0 ? target.slice(0, hash) : target).trim();
      const heading = hash >= 0 ? target.slice(hash + 1).trim() : '';
      const titleEl = el.querySelector('.blk-embed-title');
      const bodyEl = el.querySelector('.blk-embed-body');
      const n = byTitle[name.toLowerCase()];
      if (!n) {
        el.classList.add('missing');
        if (titleEl) titleEl.textContent = target;
        if (bodyEl) bodyEl.innerHTML = '<span class="blk-embed-missing">未作成のノート — クリックで作成</span>';
        delete el.dataset.noteId;
        return;
      }
      el.classList.remove('missing');
      el.dataset.noteId = n.id;
      if (titleEl) titleEl.textContent = (n.title || 'Untitled') + (heading ? ' › ' + heading : '');
      let content = n.content || '';
      if (heading) { const sec = sectionOf(content, heading); if (sec != null) content = sec; }
      if (bodyEl) {
        try { bodyEl.innerHTML = window.marked ? marked.parse(content) : esc(content); }
        catch (e) { bodyEl.textContent = content; }
        bodyEl.querySelectorAll('a').forEach((a) => { a.addEventListener('click', (ev) => ev.preventDefault()); });
      }
    });
  }

  function focusBlock(id, offset) {
    const r = rowOf(id);
    if (!r) return;
    const b = getBlock(id);
    const ce = r.querySelector('.block-content');
    if (ce && b) { enterEdit(ce, b); setCaret(ce, offset); ce.scrollIntoView({ block: 'nearest' }); }
  }

  // ---- 公開API --------------------------------------------------------------
  function renderFromModel() {
    if (!container || !textarea) return;
    blocks = mdToBlocks(textarea.value);
    renderAll();
    // 画像アセットを事前ロードして再ハイドレート
    if (window.GazeAssets && /asset:/.test(textarea.value)) {
      GazeAssets.preload(textarea.value).then(() => {
        container.querySelectorAll('img[data-asset]').forEach((im) => { if (im.dataset.assetHydrated !== '1') GazeAssets.hydrate(im.parentNode || container); });
      });
    }
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

    // 画像ファイルのドラッグ&ドロップ
    container.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); container.classList.add('drop-file'); }
    });
    container.addEventListener('dragleave', (e) => { if (e.target === container) container.classList.remove('drop-file'); });
    container.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      container.classList.remove('drop-file');
      if (files && files.length) {
        const imgs = Array.prototype.filter.call(files, (f) => /^image\//.test(f.type));
        if (imgs.length) { e.preventDefault(); imgs.reduce((pr, f) => pr.then(() => insertImageFile(f, lastFocusedId)), Promise.resolve()); }
      }
    });

    // メニュー外クリックで閉じる
    document.addEventListener('mousedown', (e) => {
      if (slash.open && menuEl && !menuEl.contains(e.target)) closeSlash();
      if (wl.open && wlEl && !wlEl.contains(e.target)) closeWiki();
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

    // renderPreview をラップして、プレビュー内の画像もハイドレート
    if (typeof window.renderPreview === 'function' && !window.renderPreview.__gazeWrapped) {
      const orig = window.renderPreview;
      window.renderPreview = function () {
        const r = orig.apply(this, arguments);
        try {
          const pc = document.getElementById('preview-content');
          if (pc && window.GazeAssets) { GazeAssets.preload(pc.innerHTML).then(() => GazeAssets.hydrate(pc)); GazeAssets.hydrate(pc); }
        } catch (e) {}
        return r;
      };
      window.renderPreview.__gazeWrapped = true;
    }

    // 既にノートが開かれていれば描画
    renderFromModel();
  }

  window.GazeBlocks = { renderFromModel, isActive, toggleSource, handleToolbar };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
