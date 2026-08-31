/* ============================================================================
 * The Gaze — UI polish (Phase 11+)
 * Phase 11: エディタ本文幅の切替（標準 / 広い / 全幅）
 * ========================================================================== */
(function () {
  'use strict';
  const WKEY = 'gaze_editor_width';
  const ORDER = ['std', 'wide', 'full'];
  const LABEL = { std: '標準幅', wide: '広い幅', full: '全幅' };
  const ICON = { std: 'move-horizontal', wide: 'unfold-horizontal', full: 'maximize-2' };

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

  function boot() {
    // ツールバー右グループに幅トグルを追加
    const group = document.querySelector('#md-toolbar .ml-auto');
    if (group && !document.getElementById('width-toggle-btn')) {
      const btn = document.createElement('button');
      btn.id = 'width-toggle-btn'; btn.className = 'tb-btn';
      btn.addEventListener('click', cycleWidth);
      group.insertBefore(btn, group.firstChild);
    }
    applyWidth();
    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazeUiWidth) {
      COMMANDS.push({ id: 'toggle-width', label: '本文幅を切替（標準/広い/全幅）', icon: 'move-horizontal', run: () => cycleWidth() });
      COMMANDS.__gazeUiWidth = true;
    }
  }

  window.GazeUI = { cycleWidth, applyWidth };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
