// AnnA Nexus: tema independente do carregamento da aplicação.
(() => {
  const storageKey = 'anna-teamhub-theme';
  const root = document.documentElement;
  const button = document.getElementById('theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  function stored() {
    try {
      const value = localStorage.getItem(storageKey);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }
  function apply(theme, persist = false) {
    const value = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = value;
    root.style.colorScheme = value;
    if (meta) meta.setAttribute('content', value === 'dark' ? '#09172b' : '#0c2646');
    if (button) {
      button.textContent = value === 'dark' ? '☀' : '◐';
      button.setAttribute('aria-label', value === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
      button.setAttribute('aria-pressed', String(value === 'dark'));
      button.title = value === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro';
    }
    if (persist) {
      try { localStorage.setItem(storageKey, value); } catch { /* armazenamento indisponível */ }
    }
  }
  const saved = stored();
  apply(saved || (system?.matches ? 'dark' : 'light'));
  button?.addEventListener('click', () => {
    apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  system?.addEventListener?.('change', event => {
    if (!stored()) apply(event.matches ? 'dark' : 'light');
  });
})();
