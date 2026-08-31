/* ============================================================================
 * The Gaze — AI enhancements (Phase 14)
 * 自動タグ付け / 自動タイトル生成 / ノート横断で質問（簡易RAG）。
 * 既存の askLLM とプロバイダ設定（app2.js）を利用。
 * ========================================================================== */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  const cur = () => (typeof state !== 'undefined' && state ? state.currentNote : null);

  function providerReady() {
    if (typeof getSelectedProvider !== 'function') return null;
    const provider = getSelectedProvider();
    const apiKey = getProviderApiKey(provider);
    const settings = getSettings();
    if (provider !== 'ollama' && !apiKey) {
      if (typeof showToast === 'function') showToast(getProviderName(provider) + 'のAPIキーが未設定です', 'error');
      if (typeof openSettings === 'function') openSettings();
      return null;
    }
    return { provider, apiKey, endpoint: settings.ollamaEndpoint };
  }

  async function ask(prompt, context) {
    const p = providerReady(); if (!p) throw new Error('no provider');
    return askLLM({ provider: p.provider, apiKey: p.apiKey, endpoint: p.endpoint, prompt, context: context || '' });
  }

  // ---- 自動タグ -------------------------------------------------------------
  async function autoTags() {
    const n = cur(); if (!n || !(n.content || '').trim()) { if (typeof showToast === 'function') showToast('ノートに内容がありません', 'error'); return; }
    if (typeof showToast === 'function') showToast('タグを生成中…', 'success');
    try {
      const resp = await ask('次のノートに付ける日本語のタグを3〜5個提案してください。#や記号は付けず、カンマ区切りの単語だけを1行で出力してください。\n\n本文:\n' + (n.content || '').slice(0, 6000));
      const tags = resp.replace(/\n/g, ',').split(/[,、]/).map((t) => t.trim().replace(/^#/, '').replace(/\s+/g, '_')).filter((t) => t && t.length <= 20).slice(0, 5);
      if (!tags.length) { if (typeof showToast === 'function') showToast('タグを抽出できませんでした', 'error'); return; }
      const existing = new Set((n.content.match(/#[^\s#]+/g) || []).map((s) => s.slice(1)));
      const add = tags.filter((t) => !existing.has(t));
      if (!add.length) { if (typeof showToast === 'function') showToast('新しいタグはありませんでした', 'success'); return; }
      const ta = document.getElementById('note-content');
      const base = (ta ? ta.value : n.content || '').replace(/\s+$/, '');
      const line = add.map((t) => '#' + t).join(' ');
      const newContent = base + '\n\n' + line;
      if (ta) ta.value = newContent;
      n.content = newContent;
      if (window.GazeBlocks) GazeBlocks.renderFromModel();
      if (typeof saveNote === 'function') await saveNote();
      if (typeof showToast === 'function') showToast('タグを追加: ' + add.map((t) => '#' + t).join(' '), 'success');
    } catch (e) { if (typeof showToast === 'function') showToast('タグ生成に失敗: ' + e.message, 'error'); }
  }

  // ---- 自動タイトル ---------------------------------------------------------
  async function autoTitle() {
    const n = cur(); if (!n || !(n.content || '').trim()) { if (typeof showToast === 'function') showToast('ノートに内容がありません', 'error'); return; }
    if (typeof showToast === 'function') showToast('タイトルを生成中…', 'success');
    try {
      const resp = await ask('次の本文に最適な簡潔なタイトルを1つだけ提案してください。20文字以内、記号や引用符は付けず、タイトルの文字列のみを出力してください。\n\n本文:\n' + (n.content || '').slice(0, 4000));
      const title = resp.trim().replace(/^["'「『]|["'」』]$/g, '').split('\n')[0].slice(0, 60);
      if (!title) { if (typeof showToast === 'function') showToast('タイトルを生成できませんでした', 'error'); return; }
      const el = document.getElementById('note-title');
      if (el) { el.value = title; }
      n.title = title;
      if (typeof saveNote === 'function') await saveNote();
      if (typeof renderTree === 'function') renderTree();
      if (typeof showToast === 'function') showToast('タイトル: ' + title, 'success');
    } catch (e) { if (typeof showToast === 'function') showToast('タイトル生成に失敗: ' + e.message, 'error'); }
  }

  // ---- 横断質問（簡易RAG） --------------------------------------------------
  function queryTerms(q) {
    const terms = [];
    (q.toLowerCase().match(/[a-z0-9_]{2,}/g) || []).forEach((w) => terms.push(w));
    const cjk = q.match(/[぀-ヿ一-鿿]{2,}/g);
    if (cjk) cjk.forEach((run) => { for (let i = 0; i < run.length - 1; i++) terms.push(run.substr(i, 2)); });
    return [...new Set(terms)];
  }
  function retrieve(notes, q, k) {
    const terms = queryTerms(q);
    const scored = notes.map((n) => {
      const title = (n.title || '').toLowerCase();
      const hay = (title + '\n' + (n.content || '')).toLowerCase();
      let s = 0; terms.forEach((t) => { if (title.includes(t)) s += 3; else if (hay.includes(t)) s += 1; });
      return { n, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    let top = scored.slice(0, k).map((x) => x.n);
    if (!top.length) top = notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, k);
    return top;
  }

  let askOv = null;
  function openAsk() {
    if (!askOv) {
      askOv = document.createElement('div');
      askOv.className = 'hidden fixed inset-0 modal-backdrop z-[60] flex items-start justify-center pt-[12vh] px-4';
      askOv.innerHTML =
        '<div class="ai-ask-modal"><div class="ai-ask-head"><i data-lucide="sparkles" class="w-4 h-4 text-blue-400"></i>' +
        '<input id="ai-ask-input" placeholder="ノート全体に質問…（例: 先月のアイデアをまとめて）"><button id="ai-ask-go" class="ai-ask-go">質問</button>' +
        '<button id="ai-ask-x" class="ai-ask-x"><i data-lucide="x" class="w-5 h-5"></i></button></div>' +
        '<div id="ai-ask-body" class="ai-ask-body"><div class="ai-ask-hint">保存済みのノートを検索し、関連する内容をもとにAIが回答します。</div></div></div>';
      document.body.appendChild(askOv);
      if (window.lucide) lucide.createIcons();
      askOv.addEventListener('mousedown', (e) => { if (e.target === askOv) askOv.classList.add('hidden'); });
      askOv.querySelector('#ai-ask-x').addEventListener('click', () => askOv.classList.add('hidden'));
      askOv.querySelector('#ai-ask-go').addEventListener('click', runAsk);
      askOv.querySelector('#ai-ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk(); if (e.key === 'Escape') askOv.classList.add('hidden'); });
    }
    askOv.classList.remove('hidden');
    const inp = askOv.querySelector('#ai-ask-input'); inp.value = ''; inp.focus();
  }
  async function runAsk() {
    const inp = askOv.querySelector('#ai-ask-input'); const body = askOv.querySelector('#ai-ask-body');
    const q = inp.value.trim(); if (!q) return;
    if (!providerReady()) return;
    body.innerHTML = '<div class="ai-ask-loading"><div class="thinking-dots"><span></span><span></span><span></span></div> 検索して考えています…</div>';
    let notes = [];
    try { notes = await TheGazeDB.getAllNotes(); } catch (e) {}
    notes = notes.filter((n) => (n.content || '').trim() || (n.title || '').trim());
    const top = retrieve(notes, q, 6);
    const ctx = top.map((n, i) => '### [' + (i + 1) + '] ' + (n.title || 'Untitled') + '\n' + (n.content || '').replace(/\n{3,}/g, '\n\n').slice(0, 1400)).join('\n\n');
    const prompt = 'あなたは私のノートに基づいて答えるアシスタントです。以下のノート抜粋のみを根拠に、日本語で簡潔に回答してください。根拠が無い場合は「該当するノートが見つかりません」と述べてください。可能なら文末に参照したノート番号を [1][2] のように示してください。\n\n質問: ' + q + '\n\n--- ノート抜粋 ---\n' + ctx;
    try {
      const resp = await ask(prompt, '');
      let html = '';
      try { html = window.marked ? marked.parse(resp) : esc(resp); } catch (e) { html = esc(resp); }
      body.innerHTML = '<div class="ai-ask-answer prose prose-invert">' + html + '</div>' +
        '<div class="ai-ask-src"><div class="ai-ask-src-h">参照したノート</div>' +
        top.map((n, i) => '<button class="ai-ask-srcitem" data-id="' + n.id + '"><span class="ai-ask-srcnum">[' + (i + 1) + ']</span>' + esc(n.title || 'Untitled') + '</button>').join('') + '</div>';
      if (window.GazeRich) GazeRich.enhance(body);
      body.querySelectorAll('.ai-ask-srcitem').forEach((b) => b.addEventListener('click', () => { askOv.classList.add('hidden'); if (typeof openNoteById === 'function') openNoteById(b.dataset.id); }));
    } catch (e) { body.innerHTML = '<div class="ai-ask-loading">エラー: ' + esc(e.message) + '</div>'; }
  }

  function boot() {
    // AIドロワーのクイックアクションにボタンを追加
    const qa = document.querySelector('#ai-drawer .flex.flex-wrap.gap-2');
    if (qa && !document.getElementById('ai-autotag-btn')) {
      const mk = (id, icon, label) => { const b = document.createElement('button'); b.id = id; b.className = 'ai-action-btn flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-gaze-border px-3 py-2 rounded-lg text-xs transition-all hover:border-blue-500/50'; b.innerHTML = '<i data-lucide="' + icon + '" class="w-3.5 h-3.5"></i>' + label; return b; };
      const t = mk('ai-autotag-btn', 'tags', '自動タグ'); t.addEventListener('click', autoTags);
      const ti = mk('ai-autotitle-btn', 'heading', 'タイトル生成'); ti.addEventListener('click', autoTitle);
      const as = mk('ai-ask-btn', 'search', '横断質問'); as.addEventListener('click', openAsk);
      qa.appendChild(t); qa.appendChild(ti); qa.appendChild(as);
      if (window.lucide) lucide.createIcons();
    }
    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeAi) {
      COMMANDS.push({ id: 'ai-autotag', label: 'AI: 自動タグ付け', icon: 'tags', run: () => autoTags() });
      COMMANDS.push({ id: 'ai-autotitle', label: 'AI: タイトル生成', icon: 'heading', run: () => autoTitle() });
      COMMANDS.push({ id: 'ai-ask', label: 'AI: ノート横断で質問', icon: 'sparkles', run: () => openAsk() });
      COMMANDS.__gazeAi = true;
    }
    // ショートカット: Ctrl/Cmd+Shift+A で横断質問
    document.addEventListener('keydown', (e) => { const mod = e.ctrlKey || e.metaKey; if (mod && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); openAsk(); } });
  }

  window.GazeAI = { autoTags, autoTitle, openAsk };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
