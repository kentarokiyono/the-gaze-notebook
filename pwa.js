/* ============================================================================
 * The Gaze — PWA registration & install (Phase 18)
 * ========================================================================== */
(function () {
  'use strict';
  let deferredPrompt = null;

  function register() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW登録失敗', e));
  }

  async function install() {
    if (!deferredPrompt) {
      if (typeof showToast === 'function') showToast('この環境ではインストールできません（対応ブラウザで再度お試しください）', 'error');
      return;
    }
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
  }

  function offlineToast(msg) {
    if (typeof showToast === 'function') showToast(msg, 'success');
  }

  function boot() {
    register();
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
    window.addEventListener('appinstalled', () => { if (typeof showToast === 'function') showToast('アプリをインストールしました', 'success'); });
    window.addEventListener('offline', () => offlineToast('オフラインになりました（キャッシュで動作します）'));
    window.addEventListener('online', () => offlineToast('オンラインに復帰しました'));

    if (typeof COMMANDS !== 'undefined' && Array.isArray(COMMANDS) && !COMMANDS.__gazePwa) {
      COMMANDS.push({ id: 'install-app', label: 'アプリをインストール', icon: 'download', run: () => install() });
      COMMANDS.__gazePwa = true;
    }
  }

  window.GazePWA = { install };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
