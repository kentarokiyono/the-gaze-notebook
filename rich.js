/* ============================================================================
 * The Gaze — Rich content (Phase 13)
 * コードのシンタックスハイライト(highlight.js) / Mermaid図 / 数式(KaTeX)。
 * すべてCDNが読み込めた場合のみ動作し、無い環境では静かにスキップ。
 * ========================================================================== */
(function () {
  'use strict';
  let mermaidReady = false;
  function initMermaid() {
    if (mermaidReady || !window.mermaid) return;
    try { mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' }); mermaidReady = true; } catch (e) {}
  }

  function highlightIn(root) {
    if (!window.hljs || !root) return;
    root.querySelectorAll('pre code').forEach((c) => {
      if (c.dataset.hl === '1') return;
      if (c.classList.contains('language-mermaid')) return; // mermaidは別処理
      try { hljs.highlightElement(c); } catch (e) {}
      c.dataset.hl = '1';
    });
  }

  async function renderMermaidEl(el, code) {
    initMermaid();
    if (!window.mermaid || !mermaidReady) { el.textContent = code; return; }
    try {
      const id = 'mmd_' + Math.random().toString(36).slice(2, 9);
      const { svg } = await mermaid.render(id, code);
      el.innerHTML = svg;
      el.classList.add('mermaid-done');
    } catch (e) {
      el.innerHTML = '<div class="rich-err">図の構文エラー</div>';
    }
  }

  // marked出力の ```mermaid (<pre><code class="language-mermaid">) を図に変換
  function mermaidIn(root) {
    if (!root) return;
    root.querySelectorAll('pre code.language-mermaid').forEach((c) => {
      const pre = c.closest('pre'); if (!pre || pre.dataset.mmd === '1') return;
      pre.dataset.mmd = '1';
      const holder = document.createElement('div'); holder.className = 'mermaid-block';
      pre.replaceWith(holder);
      renderMermaidEl(holder, c.textContent || '');
    });
  }

  function mathIn(root) {
    if (!window.renderMathInElement || !root) return;
    try {
      renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      });
    } catch (e) {}
  }

  function enhance(root) {
    if (!root) return;
    highlightIn(root);
    mermaidIn(root);
    mathIn(root);
  }

  function boot() {
    initMermaid();
    // プレビュー描画後にリッチ化
    if (typeof window.renderPreview === 'function' && !window.renderPreview.__gazeRich) {
      const orig = window.renderPreview;
      window.renderPreview = function () {
        const r = orig.apply(this, arguments);
        try { enhance(document.getElementById('preview-content')); } catch (e) {}
        return r;
      };
      window.renderPreview.__gazeRich = true;
    }
  }

  window.GazeRich = { enhance, highlightIn, mermaidIn, mathIn, renderMermaidEl, initMermaid };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
