/* ============================================================================
 * The Gaze — Database (Phase 3)
 * Notion風データベース: プロパティ付きの行を テーブル / ボード(Kanban) /
 * カレンダー / ギャラリー の複数ビューで表示・編集する。
 *
 * データは note.db に保持し、既存のノート保存・JSON書き出しにそのまま乗る。
 *   note.db = { props:[{id,name,type,options?}], rows:[{id,cells:{propId:value}}],
 *               views:[{id,type,name,groupBy?,dateProp?}], activeView }
 * ========================================================================== */
(function () {
  'use strict';

  const PROP_TYPES = [
    { type: 'text', label: 'テキスト', icon: 'type' },
    { type: 'number', label: '数値', icon: 'hash' },
    { type: 'select', label: '選択', icon: 'chevron-down-circle' },
    { type: 'multi', label: 'マルチ選択', icon: 'tags' },
    { type: 'date', label: '日付', icon: 'calendar' },
    { type: 'checkbox', label: 'チェック', icon: 'check-square' },
    { type: 'url', label: 'URL', icon: 'link' },
  ];
  const TYPE_ICON = Object.fromEntries(PROP_TYPES.map((p) => [p.type, p.icon]));
  const OPTION_COLORS = ['slate', 'blue', 'green', 'orange', 'red', 'purple', 'pink', 'yellow', 'teal'];
  const COLOR_HEX = {
    slate: '#64748b', blue: '#3b82f6', green: '#22c55e', orange: '#f97316',
    red: '#ef4444', purple: '#a855f7', pink: '#ec4899', yellow: '#eab308', teal: '#14b8a6',
  };

  let container = null;   // #db-view
  let popover = null;     // 共有ポップオーバー
  const uid = (p) => (p || 'x') + '_' + Math.random().toString(36).slice(2, 9);

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const cur = () => (typeof state !== 'undefined' && state ? state.currentNote : null);
  const db = () => { const n = cur(); return n ? n.db : null; };
  const prop = (id) => { const d = db(); return d && d.props.find((p) => p.id === id); };
  const titleProp = () => { const d = db(); return d && (d.props.find((p) => p.type === 'text') || d.props[0]); };
  const activeView = () => { const d = db(); return d && (d.views.find((v) => v.id === d.activeView) || d.views[0]); };

  function defaultDb() {
    return {
      props: [
        { id: uid('p'), name: '名前', type: 'text' },
        { id: uid('p'), name: 'ステータス', type: 'select', options: [
          { id: uid('o'), name: '未着手', color: 'slate' },
          { id: uid('o'), name: '進行中', color: 'blue' },
          { id: uid('o'), name: '完了', color: 'green' },
        ] },
        { id: uid('p'), name: '日付', type: 'date' },
      ],
      rows: [{ id: uid('r'), cells: {} }, { id: uid('r'), cells: {} }, { id: uid('r'), cells: {} }],
      views: [],
      activeView: null,
    };
  }

  async function createDatabase() {
    const d = defaultDb();
    d.views = [
      { id: uid('v'), type: 'table', name: 'テーブル' },
      { id: uid('v'), type: 'board', name: 'ボード', groupBy: d.props[1].id },
      { id: uid('v'), type: 'calendar', name: 'カレンダー', dateProp: d.props[2].id },
      { id: uid('v'), type: 'gallery', name: 'ギャラリー' },
    ];
    d.activeView = d.views[0].id;
    d.rows[0].cells[d.props[0].id] = '最初の項目';
    const note = {
      id: (typeof newId === 'function' ? newId() : uid('note')),
      title: '新しいデータベース', content: '', parentId: null,
      createdAt: Date.now(), updatedAt: Date.now(), db: d,
    };
    await TheGazeDB.addNote(note);
    await renderTree();
    if (typeof openNoteById === 'function') openNoteById(note.id);
    if (typeof showToast === 'function') showToast('データベースを作成しました', 'success');
  }

  async function save(rerender) {
    const n = cur();
    if (!n || !n.db) return;
    n.updatedAt = Date.now();
    try { await TheGazeDB.addNote(n); } catch (e) { console.error('db save', e); }
    try { await renderTree(); } catch (e) {}
    if (rerender !== false) render();
  }

  // ---- 値の表示/取得 --------------------------------------------------------
  function cellVal(row, p) {
    const v = row.cells[p.id];
    if (p.type === 'checkbox') return !!v;
    if (p.type === 'multi') return Array.isArray(v) ? v : [];
    return v == null ? '' : v;
  }
  function optName(p, id) { const o = (p.options || []).find((x) => x.id === id); return o ? o.name : ''; }
  function optColor(p, id) { const o = (p.options || []).find((x) => x.id === id); return o ? (COLOR_HEX[o.color] || COLOR_HEX.slate) : COLOR_HEX.slate; }

  function chip(name, color) {
    return '<span class="db-chip" style="background:' + color + '22;color:' + color + ';border-color:' + color + '55">' + esc(name) + '</span>';
  }

  // ---- ポップオーバー -------------------------------------------------------
  function closePopover() { if (popover) { popover.remove(); popover = null; } }
  function openPopover(anchor, html, onMount) {
    closePopover();
    popover = document.createElement('div');
    popover.className = 'db-popover';
    popover.innerHTML = html;
    document.body.appendChild(popover);
    const r = anchor.getBoundingClientRect();
    popover.style.top = Math.min(r.bottom + 4, window.innerHeight - 320) + 'px';
    popover.style.left = Math.min(r.left, window.innerWidth - 250) + 'px';
    if (window.lucide) lucide.createIcons();
    if (onMount) onMount(popover);
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
    function outside(e) {
      if (popover && !popover.contains(e.target) && e.target !== anchor) {
        document.removeEventListener('mousedown', outside); closePopover();
      }
    }
  }

  // ---- 選択オプション編集 ---------------------------------------------------
  function selectPopover(anchor, p, current, multi, onPick) {
    const chosen = new Set(multi ? current : (current ? [current] : []));
    const build = () => {
      const opts = (p.options || []).map((o) =>
        '<div class="db-opt" data-id="' + o.id + '">' +
        '<span class="db-opt-dot" style="background:' + (COLOR_HEX[o.color] || COLOR_HEX.slate) + '"></span>' +
        '<span class="flex-1 truncate">' + esc(o.name) + '</span>' +
        (chosen.has(o.id) ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : '') + '</div>').join('');
      return '<div class="db-pop-head">オプション</div>' + opts +
        '<div class="db-opt-add"><input class="db-opt-input" placeholder="新規オプション + Enter"></div>';
    };
    openPopover(anchor, build(), (pop) => {
      pop.querySelectorAll('.db-opt').forEach((el) => el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (multi) { if (chosen.has(id)) chosen.delete(id); else chosen.add(id); onPick([...chosen]); pop.innerHTML = build(); lucide.createIcons(); bind(pop); }
        else { onPick(id); closePopover(); }
      }));
      const inp = pop.querySelector('.db-opt-input');
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && inp.value.trim()) {
          const o = { id: uid('o'), name: inp.value.trim(), color: OPTION_COLORS[(p.options || []).length % OPTION_COLORS.length] };
          (p.options = p.options || []).push(o);
          if (multi) { chosen.add(o.id); onPick([...chosen]); } else { onPick(o.id); closePopover(); return; }
          save(false); pop.innerHTML = build(); lucide.createIcons(); bind(pop); pop.querySelector('.db-opt-input').focus();
        }
      });
      function bind(p2) {
        p2.querySelectorAll('.db-opt').forEach((el) => el.addEventListener('click', () => {
          const id = el.dataset.id;
          if (multi) { if (chosen.has(id)) chosen.delete(id); else chosen.add(id); onPick([...chosen]); p2.innerHTML = build(); lucide.createIcons(); bind(p2); }
          else { onPick(id); closePopover(); }
        }));
        const i2 = p2.querySelector('.db-opt-input');
        i2.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && i2.value.trim()) {
            const o = { id: uid('o'), name: i2.value.trim(), color: OPTION_COLORS[(p.options || []).length % OPTION_COLORS.length] };
            (p.options = p.options || []).push(o);
            if (multi) { chosen.add(o.id); onPick([...chosen]); } else { onPick(o.id); closePopover(); return; }
            save(false); p2.innerHTML = build(); lucide.createIcons(); bind(p2); p2.querySelector('.db-opt-input').focus();
          }
        });
      }
    });
  }

  // ---- プロパティ編集 -------------------------------------------------------
  function propMenu(anchor, p) {
    const typeList = PROP_TYPES.map((t) =>
      '<div class="db-opt db-type" data-t="' + t.type + '"><span class="db-opt-dot"><i data-lucide="' + t.icon + '" class="w-3 h-3"></i></span>' +
      '<span class="flex-1">' + t.label + '</span>' + (p.type === t.type ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : '') + '</div>').join('');
    const html = '<div class="db-pop-head">プロパティ</div>' +
      '<input class="db-name-input" value="' + esc(p.name) + '">' +
      '<div class="db-pop-head">種類</div>' + typeList +
      (p !== titleProp() ? '<div class="db-opt db-del" style="color:#f87171"><span class="db-opt-dot"><i data-lucide="trash-2" class="w-3 h-3"></i></span>プロパティを削除</div>' : '');
    openPopover(anchor, html, (pop) => {
      const nameInp = pop.querySelector('.db-name-input');
      nameInp.addEventListener('input', () => { p.name = nameInp.value; });
      nameInp.addEventListener('blur', () => save());
      nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { save(); closePopover(); } });
      pop.querySelectorAll('.db-type').forEach((el) => el.addEventListener('click', () => {
        const t = el.dataset.t;
        if (t !== p.type) {
          p.type = t;
          if ((t === 'select' || t === 'multi') && !p.options) p.options = [];
        }
        save(); closePopover();
      }));
      const del = pop.querySelector('.db-del');
      if (del) del.addEventListener('click', () => {
        const d = db(); d.props = d.props.filter((x) => x.id !== p.id);
        d.rows.forEach((r) => delete r.cells[p.id]);
        d.views.forEach((v) => { if (v.groupBy === p.id) delete v.groupBy; if (v.dateProp === p.id) delete v.dateProp; });
        save(); closePopover();
      });
    });
  }

  function addProp(type) {
    const d = db();
    const p = { id: uid('p'), name: '項目' + (d.props.length + 1), type: type || 'text' };
    if (type === 'select' || type === 'multi') p.options = [];
    d.props.push(p); save();
  }
  function addRow(preset) {
    const d = db();
    const row = { id: uid('r'), cells: Object.assign({}, preset || {}) };
    d.rows.push(row); save(); return row;
  }
  function deleteRow(id) { const d = db(); d.rows = d.rows.filter((r) => r.id !== id); save(); }

  // ---- セル描画（テーブル） -------------------------------------------------
  function cellEl(row, p) {
    const td = document.createElement('td');
    td.className = 'db-td';
    const v = cellVal(row, p);
    if (p.type === 'checkbox') {
      td.innerHTML = '<span class="db-check' + (v ? ' on' : '') + '">' + (v ? '<i data-lucide="check" class="w-3 h-3"></i>' : '') + '</span>';
      td.querySelector('.db-check').addEventListener('click', () => { row.cells[p.id] = !v; save(); });
    } else if (p.type === 'select') {
      td.innerHTML = v ? chip(optName(p, v), optColor(p, v)) : '<span class="db-empty">—</span>';
      td.addEventListener('click', () => selectPopover(td, p, v, false, (id) => { row.cells[p.id] = id; save(); }));
    } else if (p.type === 'multi') {
      td.innerHTML = v.length ? v.map((id) => chip(optName(p, id), optColor(p, id))).join('') : '<span class="db-empty">—</span>';
      td.addEventListener('click', () => selectPopover(td, p, v, true, (ids) => { row.cells[p.id] = ids; save(); }));
    } else if (p.type === 'date') {
      const inp = document.createElement('input'); inp.type = 'date'; inp.className = 'db-input db-date'; inp.value = v || '';
      inp.addEventListener('change', () => { row.cells[p.id] = inp.value; save(false); });
      td.appendChild(inp);
    } else if (p.type === 'url') {
      const inp = document.createElement('input'); inp.className = 'db-input'; inp.value = v || ''; inp.placeholder = 'https://';
      inp.addEventListener('blur', () => { row.cells[p.id] = inp.value.trim(); save(false); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      td.appendChild(inp);
    } else { // text / number
      const inp = document.createElement('input');
      inp.className = 'db-input' + (p === titleProp() ? ' db-title-cell' : '');
      if (p.type === 'number') inp.type = 'number';
      inp.value = v; inp.placeholder = p === titleProp() ? '無題' : '';
      inp.addEventListener('blur', () => { row.cells[p.id] = p.type === 'number' ? inp.value : inp.value; save(false); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      td.appendChild(inp);
    }
    return td;
  }

  // ---- テーブルビュー -------------------------------------------------------
  function renderTable() {
    const d = db();
    const wrap = document.createElement('div');
    wrap.className = 'db-table-wrap';
    const table = document.createElement('table');
    table.className = 'db-table';
    // header
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    d.props.forEach((p) => {
      const th = document.createElement('th');
      th.className = 'db-th';
      th.innerHTML = '<i data-lucide="' + (TYPE_ICON[p.type] || 'type') + '" class="w-3.5 h-3.5 db-th-ic"></i><span class="db-th-name">' + esc(p.name) + '</span>';
      th.addEventListener('click', () => propMenu(th, p));
      htr.appendChild(th);
    });
    const addTh = document.createElement('th');
    addTh.className = 'db-th db-add-col';
    addTh.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5"></i>';
    addTh.addEventListener('click', () => addColMenu(addTh));
    htr.appendChild(addTh);
    thead.appendChild(htr);
    table.appendChild(thead);
    // body
    const tbody = document.createElement('tbody');
    d.rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.className = 'db-tr';
      d.props.forEach((p) => tr.appendChild(cellEl(row, p)));
      const del = document.createElement('td');
      del.className = 'db-td db-row-del';
      del.innerHTML = '<button class="db-row-del-btn" title="行を削除"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>';
      del.querySelector('button').addEventListener('click', () => deleteRow(row.id));
      tr.appendChild(del);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    const addRowBtn = document.createElement('button');
    addRowBtn.className = 'db-add-row';
    addRowBtn.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5"></i> 新規';
    addRowBtn.addEventListener('click', () => addRow());
    wrap.appendChild(addRowBtn);
    return wrap;
  }

  function addColMenu(anchor) {
    const html = '<div class="db-pop-head">プロパティを追加</div>' + PROP_TYPES.map((t) =>
      '<div class="db-opt db-newprop" data-t="' + t.type + '"><span class="db-opt-dot"><i data-lucide="' + t.icon + '" class="w-3 h-3"></i></span>' + t.label + '</div>').join('');
    openPopover(anchor, html, (pop) => {
      pop.querySelectorAll('.db-newprop').forEach((el) => el.addEventListener('click', () => { addProp(el.dataset.t); closePopover(); }));
    });
  }

  // ---- ボード(Kanban)ビュー -------------------------------------------------
  function renderBoard() {
    const d = db(), view = activeView();
    let gp = view.groupBy ? prop(view.groupBy) : null;
    if (!gp || (gp.type !== 'select')) gp = d.props.find((p) => p.type === 'select');
    const wrap = document.createElement('div');
    wrap.className = 'db-board';
    if (!gp) {
      wrap.innerHTML = '<div class="db-hint">ボード表示には「選択」プロパティが必要です。テーブルで選択プロパティを追加してください。</div>';
      return wrap;
    }
    view.groupBy = gp.id;
    const groups = [{ id: '', name: '未設定', color: COLOR_HEX.slate }].concat((gp.options || []).map((o) => ({ id: o.id, name: o.name, color: COLOR_HEX[o.color] || COLOR_HEX.slate })));
    const tp = titleProp();
    groups.forEach((g) => {
      const col = document.createElement('div');
      col.className = 'db-col'; col.dataset.opt = g.id;
      const rows = d.rows.filter((r) => (cellVal(r, gp) || '') === g.id);
      col.innerHTML = '<div class="db-col-head"><span class="db-opt-dot" style="background:' + g.color + '"></span>' +
        '<span class="db-col-name">' + esc(g.name) + '</span><span class="db-col-count">' + rows.length + '</span></div>';
      const list = document.createElement('div'); list.className = 'db-col-list';
      rows.forEach((r) => list.appendChild(boardCard(r, tp, gp)));
      col.appendChild(list);
      const add = document.createElement('button'); add.className = 'db-col-add';
      add.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5"></i> 新規';
      add.addEventListener('click', () => { const preset = {}; if (g.id) preset[gp.id] = g.id; addRow(preset); });
      col.appendChild(add);
      // drop target
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('drop');
        const rid = e.dataTransfer.getData('text/plain'); const row = d.rows.find((x) => x.id === rid);
        if (row) { row.cells[gp.id] = g.id || undefined; if (!g.id) delete row.cells[gp.id]; save(); }
      });
      wrap.appendChild(col);
    });
    return wrap;
  }
  function boardCard(row, tp, gp) {
    const card = document.createElement('div');
    card.className = 'db-card'; card.draggable = true; card.dataset.id = row.id;
    const title = cellVal(row, tp) || '無題';
    const others = db().props.filter((p) => p !== tp && p !== gp && p.type !== 'checkbox').map((p) => {
      const v = cellVal(row, p);
      if (p.type === 'select') return v ? chip(optName(p, v), optColor(p, v)) : '';
      if (p.type === 'multi') return v.map((id) => chip(optName(p, id), optColor(p, id))).join('');
      if (!v) return '';
      return '<div class="db-card-prop">' + esc(String(v)) + '</div>';
    }).filter(Boolean).join('');
    card.innerHTML = '<div class="db-card-title">' + esc(title) + '</div>' + others;
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', row.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openRowDetail(row));
    return card;
  }

  // ---- カレンダービュー -----------------------------------------------------
  let calMonth = null; // {y,m}
  function renderCalendar() {
    const d = db(), view = activeView();
    let dp = view.dateProp ? prop(view.dateProp) : null;
    if (!dp || dp.type !== 'date') dp = d.props.find((p) => p.type === 'date');
    const wrap = document.createElement('div');
    wrap.className = 'db-cal';
    if (!dp) { wrap.innerHTML = '<div class="db-hint">カレンダー表示には「日付」プロパティが必要です。</div>'; return wrap; }
    view.dateProp = dp.id;
    const now = new Date();
    if (!calMonth) calMonth = { y: now.getFullYear(), m: now.getMonth() };
    const { y, m } = calMonth;
    const first = new Date(y, m, 1), start = first.getDay(), days = new Date(y, m + 1, 0).getDate();
    const tp = titleProp();
    const byDate = {};
    d.rows.forEach((r) => { const v = cellVal(r, dp); if (v) (byDate[v] = byDate[v] || []).push(r); });
    const head = document.createElement('div'); head.className = 'db-cal-head';
    head.innerHTML = '<button class="db-cal-nav" data-d="-1"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>' +
      '<span class="db-cal-title">' + y + '年' + (m + 1) + '月</span>' +
      '<button class="db-cal-nav" data-d="1"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>' +
      '<button class="db-cal-today">今日</button>';
    head.querySelectorAll('.db-cal-nav').forEach((b) => b.addEventListener('click', () => {
      let nm = m + parseInt(b.dataset.d), ny = y;
      if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; }
      calMonth = { y: ny, m: nm }; render();
    }));
    head.querySelector('.db-cal-today').addEventListener('click', () => { calMonth = { y: now.getFullYear(), m: now.getMonth() }; render(); });
    wrap.appendChild(head);
    const grid = document.createElement('div'); grid.className = 'db-cal-grid';
    ['日', '月', '火', '水', '木', '金', '土'].forEach((w) => { const c = document.createElement('div'); c.className = 'db-cal-wd'; c.textContent = w; grid.appendChild(c); });
    for (let i = 0; i < start; i++) { const c = document.createElement('div'); c.className = 'db-cal-cell empty'; grid.appendChild(c); }
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    for (let day = 1; day <= days; day++) {
      const iso = y + '-' + pad(m + 1) + '-' + pad(day);
      const c = document.createElement('div'); c.className = 'db-cal-cell';
      if (iso === now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())) c.classList.add('today');
      c.innerHTML = '<div class="db-cal-day">' + day + '</div>';
      (byDate[iso] || []).forEach((r) => {
        const e = document.createElement('div'); e.className = 'db-cal-event';
        e.textContent = cellVal(r, tp) || '無題';
        e.addEventListener('click', (ev) => { ev.stopPropagation(); openRowDetail(r); });
        c.appendChild(e);
      });
      c.addEventListener('click', () => { const preset = {}; preset[dp.id] = iso; addRow(preset); });
      grid.appendChild(c);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  // ---- ギャラリービュー -----------------------------------------------------
  function renderGallery() {
    const d = db(), tp = titleProp();
    const wrap = document.createElement('div'); wrap.className = 'db-gallery';
    d.rows.forEach((r) => {
      const card = document.createElement('div'); card.className = 'db-gcard';
      const props = d.props.filter((p) => p !== tp).map((p) => {
        const v = cellVal(r, p);
        if (p.type === 'checkbox') return '<div class="db-gprop"><span class="db-gprop-k">' + esc(p.name) + '</span>' + (v ? '✓' : '—') + '</div>';
        if (p.type === 'select') return '<div class="db-gprop"><span class="db-gprop-k">' + esc(p.name) + '</span>' + (v ? chip(optName(p, v), optColor(p, v)) : '—') + '</div>';
        if (p.type === 'multi') return '<div class="db-gprop"><span class="db-gprop-k">' + esc(p.name) + '</span>' + (v.length ? v.map((id) => chip(optName(p, id), optColor(p, id))).join('') : '—') + '</div>';
        return '<div class="db-gprop"><span class="db-gprop-k">' + esc(p.name) + '</span>' + esc(String(v || '—')) + '</div>';
      }).join('');
      card.innerHTML = '<div class="db-gcard-title">' + esc(cellVal(r, tp) || '無題') + '</div>' + props;
      card.addEventListener('click', () => openRowDetail(r));
      wrap.appendChild(card);
    });
    const add = document.createElement('button'); add.className = 'db-gcard db-gadd';
    add.innerHTML = '<i data-lucide="plus" class="w-5 h-5"></i> 新規';
    add.addEventListener('click', () => addRow());
    wrap.appendChild(add);
    return wrap;
  }

  // ---- 行の詳細（プロパティ編集モーダル） ----------------------------------
  function openRowDetail(row) {
    const d = db(), tp = titleProp();
    const body = d.props.map((p) => {
      const pid = 'rd_' + p.id;
      let field = '';
      const v = cellVal(row, p);
      if (p.type === 'checkbox') field = '<span class="db-check' + (v ? ' on' : '') + '" data-cb="' + p.id + '">' + (v ? '<i data-lucide="check" class="w-3 h-3"></i>' : '') + '</span>';
      else if (p.type === 'select') field = '<button class="db-rd-select" data-sel="' + p.id + '">' + (v ? chip(optName(p, v), optColor(p, v)) : '<span class="db-empty">選択…</span>') + '</button>';
      else if (p.type === 'multi') field = '<button class="db-rd-select" data-multi="' + p.id + '">' + (v.length ? v.map((id) => chip(optName(p, id), optColor(p, id))).join('') : '<span class="db-empty">選択…</span>') + '</button>';
      else if (p.type === 'date') field = '<input type="date" class="db-input db-date" data-f="' + p.id + '" value="' + esc(v) + '">';
      else field = '<input class="db-input" data-f="' + p.id + '"' + (p.type === 'number' ? ' type="number"' : '') + ' value="' + esc(v) + '">';
      return '<div class="db-rd-row"><div class="db-rd-key"><i data-lucide="' + (TYPE_ICON[p.type] || 'type') + '" class="w-3.5 h-3.5"></i>' + esc(p.name) + '</div><div class="db-rd-val">' + field + '</div></div>';
    }).join('');
    const overlay = document.createElement('div');
    overlay.className = 'db-rd-overlay';
    overlay.innerHTML = '<div class="db-rd-modal"><div class="db-rd-head"><span class="db-rd-title">' + esc(cellVal(row, tp) || '無題') +
      '</span><button class="db-rd-close"><i data-lucide="x" class="w-5 h-5"></i></button></div><div class="db-rd-body">' + body + '</div></div>';
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();
    const close = () => { overlay.remove(); render(); };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.db-rd-close').addEventListener('click', close);
    overlay.querySelectorAll('.db-input[data-f]').forEach((inp) => {
      inp.addEventListener('change', () => { row.cells[inp.dataset.f] = inp.value; save(false); });
      inp.addEventListener('blur', () => { row.cells[inp.dataset.f] = inp.value; save(false); });
    });
    overlay.querySelectorAll('[data-cb]').forEach((el) => el.addEventListener('click', () => {
      row.cells[el.dataset.cb] = !cellVal(row, prop(el.dataset.cb)); save(false);
      el.classList.toggle('on'); el.innerHTML = el.classList.contains('on') ? '<i data-lucide="check" class="w-3 h-3"></i>' : ''; if (window.lucide) lucide.createIcons();
    }));
    overlay.querySelectorAll('[data-sel]').forEach((el) => el.addEventListener('click', () => {
      const p = prop(el.dataset.sel);
      selectPopover(el, p, cellVal(row, p), false, (id) => { row.cells[p.id] = id; save(false); el.innerHTML = chip(optName(p, id), optColor(p, id)); });
    }));
    overlay.querySelectorAll('[data-multi]').forEach((el) => el.addEventListener('click', () => {
      const p = prop(el.dataset.multi);
      selectPopover(el, p, cellVal(row, p), true, (ids) => { row.cells[p.id] = ids; save(false); el.innerHTML = ids.length ? ids.map((id) => chip(optName(p, id), optColor(p, id))).join('') : '<span class="db-empty">選択…</span>'; });
    }));
  }

  // ---- ビュータブ + 本体 ----------------------------------------------------
  function render() {
    if (!container) return;
    const d = db();
    if (!d) return;
    if (!d.activeView || !d.views.find((v) => v.id === d.activeView)) d.activeView = d.views[0] && d.views[0].id;
    container.innerHTML = '';
    // tabs
    const bar = document.createElement('div'); bar.className = 'db-viewbar';
    const VIEW_ICON = { table: 'table', board: 'columns-3', calendar: 'calendar', gallery: 'layout-grid' };
    d.views.forEach((v) => {
      const t = document.createElement('button');
      t.className = 'db-viewtab' + (v.id === d.activeView ? ' active' : '');
      t.innerHTML = '<i data-lucide="' + (VIEW_ICON[v.type] || 'table') + '" class="w-3.5 h-3.5"></i>' + esc(v.name);
      t.addEventListener('click', () => { d.activeView = v.id; render(); });
      bar.appendChild(t);
    });
    const addV = document.createElement('button'); addV.className = 'db-viewadd';
    addV.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5"></i>';
    addV.addEventListener('click', () => addViewMenu(addV));
    bar.appendChild(addV);
    container.appendChild(bar);
    // body
    const view = activeView();
    let el;
    if (view.type === 'board') el = renderBoard();
    else if (view.type === 'calendar') el = renderCalendar();
    else if (view.type === 'gallery') el = renderGallery();
    else el = renderTable();
    const bodyWrap = document.createElement('div'); bodyWrap.className = 'db-body'; bodyWrap.appendChild(el);
    container.appendChild(bodyWrap);
    if (window.lucide) lucide.createIcons();
  }

  function addViewMenu(anchor) {
    const types = [['table', 'テーブル', 'table'], ['board', 'ボード', 'columns-3'], ['calendar', 'カレンダー', 'calendar'], ['gallery', 'ギャラリー', 'layout-grid']];
    const html = '<div class="db-pop-head">ビューを追加</div>' + types.map((t) =>
      '<div class="db-opt db-newview" data-t="' + t[0] + '"><span class="db-opt-dot"><i data-lucide="' + t[2] + '" class="w-3 h-3"></i></span>' + t[1] + '</div>').join('');
    openPopover(anchor, html, (pop) => {
      pop.querySelectorAll('.db-newview').forEach((el) => el.addEventListener('click', () => {
        const d = db(); const type = el.dataset.t;
        const v = { id: uid('v'), type, name: { table: 'テーブル', board: 'ボード', calendar: 'カレンダー', gallery: 'ギャラリー' }[type] };
        if (type === 'board') { const sp = d.props.find((p) => p.type === 'select'); if (sp) v.groupBy = sp.id; }
        if (type === 'calendar') { const dp = d.props.find((p) => p.type === 'date'); if (dp) v.dateProp = dp.id; }
        d.views.push(v); d.activeView = v.id; closePopover(); render();
      }));
    });
  }

  // ---- 表示切替 -------------------------------------------------------------
  const HIDE_IDS = ['md-toolbar', 'editor-area', 'backlinks-panel', 'related-panel'];
  function showDb() {
    HIDE_IDS.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    if (container) container.classList.remove('hidden');
    calMonth = null;
    render();
  }
  function hideDb() {
    HIDE_IDS.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = ''; });
    if (container) container.classList.add('hidden');
  }
  function sync() {
    const n = cur();
    if (n && n.db) showDb(); else hideDb();
  }

  // ---- 初期化 & フック ------------------------------------------------------
  function boot() {
    container = document.getElementById('db-view');
    // loadNote をラップ（blocks.js の後段）: db ノートなら DB UI を表示
    if (typeof window.loadNote === 'function' && !window.loadNote.__gazeDbWrapped) {
      const orig = window.loadNote;
      window.loadNote = async function () {
        const r = await orig.apply(this, arguments);
        try { sync(); } catch (e) { console.error('db sync', e); }
        return r;
      };
      window.loadNote.__gazeDbWrapped = true;
    }
    // コマンドパレットに登録
    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeDb) {
      COMMANDS.push({ id: 'new-database', label: '新規データベース', icon: 'table', run: () => createDatabase() });
      COMMANDS.__gazeDb = true;
    }
    // ライブラリのボタン
    const btn = document.getElementById('new-database-btn');
    if (btn) btn.addEventListener('click', createDatabase);
    // タイトル変更でDB名も保存（既存 note-title の input で処理済み）
  }

  window.GazeDB = { createDatabase, sync, isDatabase: () => !!(cur() && cur().db) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
