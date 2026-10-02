(() => {
  if (!('serviceWorker' in navigator)) return;

  let deferredPrompt = null;
  let installButton = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function ensureInstallButton() {
    if (installButton || isStandalone()) return;
    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'pwa-install';
    installButton.textContent = 'Instalar ROUTINE';
    installButton.hidden = true;
    document.body.appendChild(installButton);

    installButton.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installButton.hidden = true;
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    ensureInstallButton();
    if (installButton) installButton.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installButton) installButton.hidden = true;
  });

  window.addEventListener('load', async () => {
    ensureInstallButton();
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      registration.update();
    } catch (err) {
      console.error('PWA:', err);
    }
  });
})();