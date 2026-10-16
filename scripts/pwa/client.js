/* Shared by the two static sites; copied into each build. */
(() => {
  const standalone = window.matchMedia('(display-mode: standalone)');
  const state = { installed: standalone.matches || navigator.standalone === true, prompt: null };
  window.naslInstall = state;
  const notify = () => window.dispatchEvent(new Event('nasl-install-change'));
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.prompt = async () => {
      state.prompt = null;
      notify();
      await event.prompt();
      await event.userChoice;
    };
    notify();
  });
  const installed = () => {
    state.installed = true;
    state.prompt = null;
    notify();
  };
  window.addEventListener('appinstalled', installed);
  standalone.addEventListener('change', () => {
    state.installed = standalone.matches || navigator.standalone === true;
    notify();
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // A failed registration must not prevent an online login. Updates activate after all
      // old tabs close, so a new release never discards an unsent form or offline outbox.
      void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    });
  }
})();
