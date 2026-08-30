/* ============================================================================
 * The Gaze — Templates (Phase 6)
 * ページテンプレートの作成・適用。{{date}} {{time}} {{title}} を置換。
 * デイリーノートに使うテンプレートを1つ指定でき、新規デイリー作成時に適用。
 * ========================================================================== */
(function () {
  'use strict';
  const LS = 'gaze_page_templates';
  const DEFAULTS = [
    { id: 't_meeting', name: '会議メモ', icon: 'users', content: '# {{title}}\n\n- **日時**: {{date}} {{time}}\n- **参加者**: \n\n## 議題\n\n- \n\n## 決定事項\n\n- \n\n## ネクストアクション\n\n- [ ] ' },
    { id: 't_daily', name: 'デイリージャーナル', icon: 'sun', daily: true, content: '# {{date}}\n\n## 今日の3つの目標\n\n- [ ] \n- [ ] \n- [ ] \n\n## メモ\n\n\n\n## 振り返り\n\n' },
    { id: 't_project', name: 'プロジェクト', icon: 'target', content: '# {{title}}\n\n## 概要\n\n\n\n## 目標\n\n- \n\n## タスク\n\n- [ ] \n\n## メモ\n\n' },
    { id: 't_reading', name: '読書メモ', icon: 'book-open', content: '# {{title}}\n\n- **著者**: \n- **読了日**: {{date}}\n\n## 要点\n\n- \n\n## 引用\n\n> \n\n## 感想\n\n' },
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function getAll() { try { const a = JSON.parse(localStorage.getItem(LS) || 'null'); return Array.isArray(a) ? a : DEFAULTS.slice(); } catch (e) { return DEFAULTS.slice(); } }
  function saveAll(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }
  function seed() { if (localStorage.getItem(LS) === null) saveAll(DEFAULTS.slice()); }

  function subst(text, ctx) {
    ctx = ctx || {};
    const now = new Date(); const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const date = ctx.date || (now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));
    const time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    return String(text || '').replace(/\{\{date\}\}/g, date).replace(/\{\{time\}\}/g, time).replace(/\{\{title\}\}/g, ctx.title || '');
  }

  function firstHeadingTitle(md) { const m = String(md || '').match(/^#\s+(.+)$/m); return m ? m[1].trim() : ''; }

  async function createFrom(tpl) {
    const content = subst(tpl.content, { title: tpl.name });
    const title = firstHeadingTitle(content) || tpl.name;
    // 本文がタイトルの見出しで始まる場合は本文側から除去（タイトル欄に入れる）
    let body = content;
    const hm = body.match(/^#\s+(.+)\n*/); if (hm && hm[1].trim() === title) body = body.slice(hm[0].length);
    const note = {
      id: (typeof newId === 'function' ? newId() : 'note_' + Date.now()),
      title, content: body, parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await TheGazeDB.addNote(note); await renderTree();
    if (typeof openNoteById === 'function') openNoteById(note.id);
    if (typeof showToast === 'function') showToast('「' + tpl.name + '」から作成しました', 'success');
    closeOverlay();
  }

  function dailyTemplate() { return getAll().find((t) => t.daily); }
  function dailyContent(iso) { const t = dailyTemplate(); if (!t) return ''; let c = subst(t.content, { date: iso, title: iso }); const hm = c.match(/^#\s+(.+)\n*/); if (hm && hm[1].trim() === iso) c = c.slice(hm[0].length); return c; }

  // ---- overlay UI -----------------------------------------------------------
  let overlay = null;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'tpl-overlay';
    overlay.className = 'hidden fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeOverlay(); });
    return overlay;
  }
  function closeOverlay() { if (overlay) overlay.classList.add('hidden'); }

  function openPicker() {
    ensureOverlay();
    const tpls = getAll();
    overlay.innerHTML =
      '<div class="tpl-modal">' +
      '<div class="tpl-head"><h2>テンプレート</h2><button class="tpl-x" data-x><i data-lucide="x" class="w-5 h-5"></i></button></div>' +
      '<div class="tpl-list">' +
      tpls.map((t) => '<div class="tpl-card" data-id="' + t.id + '">' +
        '<div class="tpl-card-ic"><i data-lucide="' + (t.icon || 'file-text') + '" class="w-4 h-4"></i></div>' +
        '<div class="tpl-card-main"><div class="tpl-card-name">' + esc(t.name) + (t.daily ? ' <span class="tpl-daily">デイリー</span>' : '') + '</div>' +
        '<div class="tpl-card-prev">' + esc((t.content || '').replace(/\n+/g, ' ').slice(0, 60)) + '</div></div>' +
        '<button class="tpl-use" data-use="' + t.id + '">使う</button>' +
        '<button class="tpl-edit" data-edit="' + t.id + '" title="編集"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button></div>').join('') +
      '</div>' +
      '<div class="tpl-foot"><button class="tpl-new" data-new><i data-lucide="plus" class="w-4 h-4"></i>新規テンプレート</button></div>' +
      '</div>';
    overlay.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
    overlay.querySelector('[data-x]').addEventListener('click', closeOverlay);
    overlay.querySelector('[data-new]').addEventListener('click', () => openEditor(null));
    overlay.querySelectorAll('.tpl-use').forEach((b) => b.addEventListener('click', () => { const t = getAll().find((x) => x.id === b.dataset.use); if (t) createFrom(t); }));
    overlay.querySelectorAll('.tpl-edit').forEach((b) => b.addEventListener('click', () => { const t = getAll().find((x) => x.id === b.dataset.edit); openEditor(t); }));
    overlay.querySelectorAll('.tpl-card').forEach((c) => c.addEventListener('click', (e) => { if (e.target.closest('.tpl-use,.tpl-edit')) return; const t = getAll().find((x) => x.id === c.dataset.id); if (t) createFrom(t); }));
  }

  function openEditor(tpl) {
    ensureOverlay();
    const editing = !!tpl;
    tpl = tpl || { id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: '', icon: 'file-text', content: '' };
    overlay.innerHTML =
      '<div class="tpl-modal">' +
      '<div class="tpl-head"><h2>' + (editing ? 'テンプレートを編集' : '新規テンプレート') + '</h2><button class="tpl-x" data-x><i data-lucide="x" class="w-5 h-5"></i></button></div>' +
      '<div class="tpl-editor">' +
      '<label class="tpl-label">名前</label><input class="tpl-input" id="tpl-name" value="' + esc(tpl.name) + '" placeholder="例: 会議メモ">' +
      '<label class="tpl-label">本文（Markdown）　<span class="tpl-hint2">{{date}} {{time}} {{title}} が使えます</span></label>' +
      '<textarea class="tpl-textarea" id="tpl-content" rows="12" placeholder="# {{title}}\n\n## セクション\n\n- ">' + esc(tpl.content) + '</textarea>' +
      '<label class="tpl-check"><input type="checkbox" id="tpl-daily"' + (tpl.daily ? ' checked' : '') + '> デイリーノートに使う</label>' +
      '</div>' +
      '<div class="tpl-foot">' +
      (editing ? '<button class="tpl-del" data-del><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>削除</button>' : '') +
      '<div class="tpl-foot-right"><button class="tpl-cancel" data-back>戻る</button><button class="tpl-save" data-save>保存</button></div>' +
      '</div></div>';
    overlay.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
    overlay.querySelector('[data-x]').addEventListener('click', closeOverlay);
    overlay.querySelector('[data-back]').addEventListener('click', openPicker);
    overlay.querySelector('[data-save]').addEventListener('click', () => {
      const name = overlay.querySelector('#tpl-name').value.trim();
      if (!name) { if (typeof showToast === 'function') showToast('名前を入力してください', 'error'); return; }
      tpl.name = name;
      tpl.content = overlay.querySelector('#tpl-content').value;
      const isDaily = overlay.querySelector('#tpl-daily').checked;
      const all = getAll();
      if (isDaily) all.forEach((t) => { if (t.id !== tpl.id) delete t.daily; });
      tpl.daily = isDaily || undefined;
      const i = all.findIndex((t) => t.id === tpl.id);
      if (i >= 0) all[i] = tpl; else all.push(tpl);
      saveAll(all);
      if (typeof showToast === 'function') showToast('テンプレートを保存しました', 'success');
      openPicker();
    });
    const del = overlay.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => { saveAll(getAll().filter((t) => t.id !== tpl.id)); openPicker(); });
  }

  function saveCurrentAsTemplate() {
    const n = (typeof state !== 'undefined' && state) ? state.currentNote : null;
    if (!n) { if (typeof showToast === 'function') showToast('ノートを開いてください', 'error'); return; }
    const content = (n.title ? '# ' + n.title + '\n\n' : '') + (n.content || '');
    openEditor({ id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: n.title || 'テンプレート', icon: 'file-text', content });
  }

  function boot() {
    seed();
    const btn = document.getElementById('template-picker-btn');
    if (btn) btn.addEventListener('click', openPicker);
    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeTpl) {
      COMMANDS.push({ id: 'tpl-new', label: 'テンプレートから作成', icon: 'layout-template', run: () => openPicker() });
      COMMANDS.push({ id: 'tpl-save-current', label: '現在のノートをテンプレート化', icon: 'save', run: () => saveCurrentAsTemplate() });
      COMMANDS.__gazeTpl = true;
    }
  }

  window.GazeTemplates = { openPicker, createFrom, dailyContent, saveCurrentAsTemplate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
